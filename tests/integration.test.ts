/**
 * Integration tests for Python bridge + TypeScript communication.
 * Tests: bridge spawning, JSON-RPC over NDJSON, execute/reset/get_state/interrupt/ping methods,
 * marker parsing, and process lifecycle management.
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as crypto from 'crypto';
import checkpointManager from '../src/tool/checkpoint-manager';
import { clearProjectRootCache } from '../src/lib/paths';

const BRIDGE_PATH = path.join(__dirname, '..', '.opencode', 'bridge', 'gyoshu_bridge.py');
const REQUEST_TIMEOUT_MS = 5000;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface ExecuteResult {
  success: boolean;
  stdout: string;
  stderr: string;
  markers: Array<{
    type: string;
    subtype: string | null;
    content: string;
    line_number: number;
    category: string;
  }>;
  artifacts: unknown[];
  timing: {
    started_at: string;
    duration_ms: number;
  };
  memory: {
    rss_mb: number;
    vms_mb: number;
  };
  error?: {
    type: string;
    message: string;
    traceback: string;
  };
}

interface StateResult {
  memory: { rss_mb: number; vms_mb: number };
  variables: string[];
  variable_count: number;
}

interface ResetResult {
  status: string;
  memory: { rss_mb: number; vms_mb: number };
}

interface PingResult {
  status: string;
  timestamp: string;
}

interface InterruptResult {
  status: string;
}

class TestBridge {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private pendingRequests: Map<string, {
    resolve: (response: JsonRpcResponse) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = new Map();
  private requestCounter = 0;
  private stderrBuffer = '';

  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Bridge already started');
    }

    this.process = spawn('python3', [BRIDGE_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    if (!this.process.stdout || !this.process.stdin || !this.process.stderr) {
      throw new Error('Failed to create stdio pipes');
    }

    this.rl = readline.createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });

    this.rl.on('line', (line: string) => {
      this.handleResponse(line);
    });

    this.process.stderr.on('data', (chunk: Buffer) => {
      this.stderrBuffer += chunk.toString();
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const pingResult = await this.request<PingResult>('ping', {});
    if (pingResult.status !== 'ok') {
      throw new Error('Bridge ping failed');
    }
  }

  async stop(): Promise<void> {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Bridge stopped'));
    }
    this.pendingRequests.clear();

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    if (this.process) {
      this.process.stdin?.end();
      
      const exitPromise = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 1000);

        this.process?.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });

      if (!this.process.killed) {
        this.process.kill('SIGTERM');
      }

      await exitPromise;
      this.process = null;
    }
  }

  async request<T>(method: string, params: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    if (!this.process || !this.process.stdin) {
      throw new Error('Bridge not started');
    }

    const id = `test_${++this.requestCounter}`;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (response: JsonRpcResponse) => {
          clearTimeout(timer);
          if (response.error) {
            reject(new Error(`JSON-RPC error: ${response.error.message} (code: ${response.error.code})`));
          } else {
            resolve(response.result as T);
          }
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
        timer,
      });

      this.process!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  private handleResponse(line: string): void {
    try {
      const response = JSON.parse(line) as JsonRpcResponse;

      if (response.jsonrpc !== '2.0') {
        console.warn('Invalid JSON-RPC version in response:', line);
        return;
      }

      const pending = this.pendingRequests.get(response.id);
      if (!pending) {
        console.warn('No pending request for id:', response.id);
        return;
      }

      this.pendingRequests.delete(response.id);
      pending.resolve(response);
    } catch (e) {
      console.error('Failed to parse bridge response:', line, e);
    }
  }

  getStderr(): string {
    return this.stderrBuffer;
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed && this.process.exitCode === null;
  }
}

describe('Python Bridge Integration', () => {
  let bridge: TestBridge;

  beforeAll(async () => {
    await fs.access(BRIDGE_PATH);
  });

  beforeEach(async () => {
    bridge = new TestBridge();
    await bridge.start();
  });

  afterEach(async () => {
    if (bridge) {
      await bridge.stop();
    }
  });

  describe('Bridge Lifecycle', () => {
    test('spawns and responds to ping', async () => {
      const result = await bridge.request<PingResult>('ping', {});

      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('string');
    });

    test('bridge is running after start', () => {
      expect(bridge.isRunning()).toBe(true);
    });

    test('handles multiple sequential requests', async () => {
      const results = [];
      for (let i = 0; i < 5; i++) {
        const result = await bridge.request<PingResult>('ping', {});
        results.push(result);
      }

      expect(results).toHaveLength(5);
      results.forEach(r => expect(r.status).toBe('ok'));
    });
  });

  describe('Execute Method', () => {
    test('executes simple Python code', async () => {
      const result = await bridge.request<ExecuteResult>('execute', {
        code: 'x = 1 + 1',
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    });

    test('captures stdout from print statements', async () => {
      const result = await bridge.request<ExecuteResult>('execute', {
        code: 'print("Hello from Python!")',
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Hello from Python!');
    });

    test('captures stderr', async () => {
      const result = await bridge.request<ExecuteResult>('execute', {
        code: 'import sys; print("Error message", file=sys.stderr)',
      });

      expect(result.success).toBe(true);
      expect(result.stderr).toContain('Error message');
    });

    test('captures syntax errors', async () => {
      const result = await bridge.request<ExecuteResult>('execute', {
        code: 'def bad syntax',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe('SyntaxError');
      expect(result.error!.traceback).toBeDefined();
    });

    test('captures runtime errors', async () => {
      const result = await bridge.request<ExecuteResult>('execute', {
        code: 'undefined_variable',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.type).toBe('NameError');
      expect(result.error!.message).toContain('undefined_variable');
    });

    test('provides timing information', async () => {
      const result = await bridge.request<ExecuteResult>('execute', {
        code: 'import time; time.sleep(0.1)',
      });

      expect(result.success).toBe(true);
      expect(result.timing).toBeDefined();
      expect(result.timing.started_at).toBeDefined();
      expect(result.timing.duration_ms).toBeGreaterThanOrEqual(100);
    });

    test('provides memory information', async () => {
      const result = await bridge.request<ExecuteResult>('execute', {
        code: 'x = [i for i in range(1000)]',
      });

      expect(result.success).toBe(true);
      expect(result.memory).toBeDefined();
      expect(typeof result.memory.rss_mb).toBe('number');
      expect(typeof result.memory.vms_mb).toBe('number');
    });

    test('executes multiline code', async () => {
      const code = `
def greet(name):
    return f"Hello, {name}!"

result = greet("World")
print(result)
`;
      const result = await bridge.request<ExecuteResult>('execute', { code });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Hello, World!');
    });

    test('handles imports', async () => {
      const result = await bridge.request<ExecuteResult>('execute', {
        code: 'import math; print(f"Pi = {math.pi:.4f}")',
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Pi = 3.1416');
    });
  });

  describe('Marker Parsing', () => {
    test('parses simple marker', async () => {
      const result = await bridge.request<ExecuteResult>('execute', {
        code: 'print("[STEP] Loading data...")',
      });

      expect(result.success).toBe(true);
      expect(result.markers).toHaveLength(1);
      expect(result.markers[0].type).toBe('STEP');
      expect(result.markers[0].content).toBe('Loading data...');
      expect(result.markers[0].category).toBe('workflow');
    });

    test('parses marker with subtype', async () => {
      const result = await bridge.request<ExecuteResult>('execute', {
        code: 'print("[METRIC:accuracy] 0.95")',
      });

      expect(result.success).toBe(true);
      expect(result.markers).toHaveLength(1);
      expect(result.markers[0].type).toBe('METRIC');
      expect(result.markers[0].subtype).toBe('accuracy');
      expect(result.markers[0].content).toBe('0.95');
      expect(result.markers[0].category).toBe('calculations');
    });

    test('parses multiple markers', async () => {
      const code = `
print("[OBJECTIVE] Analyze data")
print("[HYPOTHESIS] Data shows pattern")
print("[FINDING] Pattern confirmed")
`;
      const result = await bridge.request<ExecuteResult>('execute', { code });

      expect(result.success).toBe(true);
      expect(result.markers).toHaveLength(3);

      const types = result.markers.map(m => m.type);
      expect(types).toContain('OBJECTIVE');
      expect(types).toContain('HYPOTHESIS');
      expect(types).toContain('FINDING');
    });

    test('includes line numbers in markers', async () => {
      const code = `print("Line 1 no marker")
print("[STEP] Line 2 marker")
print("Line 3 no marker")
print("[INFO] Line 4 marker")`;

      const result = await bridge.request<ExecuteResult>('execute', { code });

      expect(result.success).toBe(true);
      expect(result.markers).toHaveLength(2);
      expect(result.markers[0].line_number).toBe(2);
      expect(result.markers[1].line_number).toBe(4);
    });

    test('parses scientific workflow markers', async () => {
      const code = `
print("[OBJECTIVE] Test data analysis")
print("[HYPOTHESIS] Data will show linear trend")
result = sum(range(10))
print(f"[METRIC:sum] {result}")
print("[CONCLUSION] Analysis complete")
`;
      const result = await bridge.request<ExecuteResult>('execute', { code });

      expect(result.success).toBe(true);
      expect(result.markers.length).toBeGreaterThanOrEqual(4);

      const categories = result.markers.map(m => m.category);
      expect(categories).toContain('research_process');
      expect(categories).toContain('calculations');
    });
  });

  describe('State Persistence', () => {
    test('variables persist across executions', async () => {
      // Given: variable defined in first execution
      await bridge.request<ExecuteResult>('execute', {
        code: 'shared_data = [1, 2, 3]',
      });

      // When: accessing variable in second execution
      const result = await bridge.request<ExecuteResult>('execute', {
        code: 'print(f"Data: {shared_data}")',
      });

      // Then: variable is accessible
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Data: [1, 2, 3]');
    });

    test('functions persist across executions', async () => {
      // Given: function defined
      await bridge.request<ExecuteResult>('execute', {
        code: 'def double(x): return x * 2',
      });

      // When: function called
      const result = await bridge.request<ExecuteResult>('execute', {
        code: 'print(double(21))',
      });

      // Then: function works
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('42');
    });

    test('imports persist across executions', async () => {
      // Given: module imported
      await bridge.request<ExecuteResult>('execute', {
        code: 'import math',
      });

      // When: module used
      const result = await bridge.request<ExecuteResult>('execute', {
        code: 'print(math.sqrt(16))',
      });

      // Then: module is accessible
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('4.0');
    });
  });

  describe('Reset Method', () => {
    test('resets namespace', async () => {
      // Given: variable exists
      await bridge.request<ExecuteResult>('execute', {
        code: 'test_var = 42',
      });

      // When: reset called
      const resetResult = await bridge.request<ResetResult>('reset', {});
      expect(resetResult.status).toBe('reset');
      expect(resetResult.memory).toBeDefined();

      // Then: variable is gone
      const result = await bridge.request<ExecuteResult>('execute', {
        code: 'print(test_var)',
      });

      expect(result.success).toBe(false);
      expect(result.error!.type).toBe('NameError');
    });

    test('preserves helper functions after reset', async () => {
      // Given: reset performed
      await bridge.request<ResetResult>('reset', {});

      // When: using helper function
      const result = await bridge.request<ExecuteResult>('execute', {
        code: 'mem = get_memory(); print(f"RSS: {mem[\'rss_mb\']} MB")',
      });

      // Then: helper function works
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('RSS:');
      expect(result.stdout).toContain('MB');
    });
  });

  describe('Get State Method', () => {
    test('returns empty state after reset', async () => {
      await bridge.request<ResetResult>('reset', {});

      const state = await bridge.request<StateResult>('get_state', {});

      expect(state.variables).toEqual([]);
      expect(state.variable_count).toBe(0);
      expect(state.memory).toBeDefined();
    });

    test('returns user-defined variables', async () => {
      await bridge.request<ResetResult>('reset', {});

      await bridge.request<ExecuteResult>('execute', {
        code: 'my_data = [1, 2, 3]\nmy_func = lambda x: x * 2',
      });

      const state = await bridge.request<StateResult>('get_state', {});

      expect(state.variables).toContain('my_data');
      expect(state.variables).toContain('my_func');
      expect(state.variable_count).toBe(2);
    });

    test('excludes helper functions from variables list', async () => {
      const state = await bridge.request<StateResult>('get_state', {});

      expect(state.variables).not.toContain('clean_memory');
      expect(state.variables).not.toContain('get_memory');
    });

    test('excludes dunder variables', async () => {
      const state = await bridge.request<StateResult>('get_state', {});

      expect(state.variables).not.toContain('__name__');
      expect(state.variables).not.toContain('__doc__');
    });
  });

  describe('Interrupt Method', () => {
    test('returns interrupt_requested status', async () => {
      const result = await bridge.request<InterruptResult>('interrupt', {});

      expect(result.status).toBe('interrupt_requested');
    });
  });

  describe('Protocol Error Handling', () => {
    test('rejects unknown method', async () => {
      await expect(
        bridge.request('nonexistent_method', {})
      ).rejects.toThrow('Method not found');
    });

    test('rejects execute without code parameter', async () => {
      await expect(
        bridge.request('execute', {})
      ).rejects.toThrow('code');
    });

    test('rejects execute with non-string code', async () => {
      await expect(
        bridge.request('execute', { code: 123 })
      ).rejects.toThrow();
    });
  });

  describe('Concurrent Requests', () => {
    test('handles multiple concurrent pings', async () => {
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(bridge.request<PingResult>('ping', {}));
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach(r => expect(r.status).toBe('ok'));
    });
  });
});

describe('Checkpoint System Integration', () => {
  let testDir: string;
  let originalCwd: string;
  let originalProjectRoot: string | undefined;

  async function executeCheckpoint(args: {
    action: string;
    reportTitle?: string;
    runId?: string;
    checkpointId?: string;
    researchSessionID?: string;
    stageId?: string;
    status?: "saved" | "interrupted" | "emergency";
    reason?: "timeout" | "abort" | "error";
    executionCount?: number;
    notebookPathOverride?: string;
    pythonEnv?: {
      pythonPath: string;
      packages: string[];
      platform: string;
    };
    artifacts?: Array<{
      relativePath: string;
      sha256: string;
      sizeBytes: number;
    }>;
    rehydrationMode?: "artifacts_only" | "with_vars";
    rehydrationSource?: string[];
    keepCount?: number;
  }): Promise<{ success: boolean; [key: string]: unknown }> {
    const result = await checkpointManager.execute(args as any);
    return JSON.parse(result);
  }

  async function createTestArtifact(
    relativePath: string,
    content: string
  ): Promise<{ relativePath: string; sha256: string; sizeBytes: number }> {
    const absolutePath = path.join(testDir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf-8");

    const stats = await fs.stat(absolutePath);
    const sha256 = crypto.createHash("sha256").update(content, "utf8").digest("hex");

    return {
      relativePath,
      sha256,
      sizeBytes: stats.size,
    };
  }

  async function createTestNotebook(reportTitle: string): Promise<string> {
    const notebookPath = path.join(testDir, "notebooks", `${reportTitle}.ipynb`);
    await fs.mkdir(path.dirname(notebookPath), { recursive: true });

    const notebook = {
      cells: [
        {
          cell_type: "code",
          source: ["print('[OBJECTIVE] Test research objective')"],
          metadata: {},
          execution_count: 1,
          outputs: [],
        },
      ],
      metadata: {
        kernelspec: {
          display_name: "Python 3",
          language: "python",
          name: "python3",
        },
        language_info: {
          name: "python",
          version: "3.11",
          mimetype: "text/x-python",
          file_extension: ".py",
        },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };

    await fs.writeFile(notebookPath, JSON.stringify(notebook, null, 2));
    return notebookPath;
  }

  async function readTestNotebook(notebookPath: string): Promise<any> {
    const content = await fs.readFile(notebookPath, "utf-8");
    return JSON.parse(content);
  }

  beforeAll(() => {
    originalCwd = process.cwd();
    originalProjectRoot = process.env.GYOSHU_PROJECT_ROOT;
  });

  afterAll(() => {
    if (originalProjectRoot !== undefined) {
      process.env.GYOSHU_PROJECT_ROOT = originalProjectRoot;
    } else {
      delete process.env.GYOSHU_PROJECT_ROOT;
    }
    process.chdir(originalCwd);
    clearProjectRootCache();
  });

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "gyoshu-e2e-test-"));
    process.env.GYOSHU_PROJECT_ROOT = testDir;
    process.chdir(testDir);
    clearProjectRootCache();
    
    // Create required directories
    await fs.mkdir(path.join(testDir, "notebooks"), { recursive: true });
    await fs.mkdir(path.join(testDir, "reports"), { recursive: true });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
    clearProjectRootCache();
  });

  // 5.4.1: Full research with stages + checkpoints
  test('full research workflow with stages and checkpoints', async () => {
    const reportTitle = "e2e-research-test";
    const runId = "run-001";

    // 1. Create notebook with initial content
    await createTestNotebook(reportTitle);

    const artifact = await createTestArtifact(
      `reports/${reportTitle}/data/processed.csv`,
      "col1,col2\n1,2\n3,4\n5,6"
    );

    // 3. Save checkpoint at stage boundary (simulating S01_load_data completion)
    const saveResult = await executeCheckpoint({
      action: "save",
      reportTitle,
      runId,
      checkpointId: "ckpt-001",
      researchSessionID: "ses_e2e_test",
      stageId: "S01_load_data",
      executionCount: 3,
      artifacts: [artifact],
      pythonEnv: {
        pythonPath: "/usr/bin/python3",
        packages: ["pandas==2.0.0", "numpy==1.24.0"],
        platform: "linux",
      },
    });

    expect(saveResult.success).toBe(true);
    expect(saveResult.checkpointId).toBe("ckpt-001");
    expect(saveResult.stageId).toBe("S01_load_data");
    expect(saveResult.manifestSha256).toBeDefined();

    // 4. Verify checkpoint saved correctly by validating it
    const validateResult = await executeCheckpoint({
      action: "validate",
      reportTitle,
      runId,
      checkpointId: "ckpt-001",
    });

    expect(validateResult.success).toBe(true);
    expect(validateResult.valid).toBe(true);
    expect(validateResult.issues).toEqual([]);

    // 5. Verify checkpoint appears in list action
    const listResult = await executeCheckpoint({
      action: "list",
      reportTitle,
      runId,
    });

    expect(listResult.success).toBe(true);
    expect(listResult.count).toBe(1);
    
    const checkpoints = listResult.checkpoints as any[];
    expect(checkpoints[0].checkpointId).toBe("ckpt-001");
    expect(checkpoints[0].stageId).toBe("S01_load_data");
    expect(checkpoints[0].status).toBe("saved");
    expect(checkpoints[0].artifactCount).toBe(1);
  });

  // 5.4.2: Watchdog timeout triggers checkpoint + abort
  test('watchdog timeout triggers emergency checkpoint', async () => {
    const reportTitle = "e2e-watchdog-test";
    const runId = "run-001";

    // 1. Create minimal notebook
    await createTestNotebook(reportTitle);

    // 2. Create emergency checkpoint (simulating watchdog timeout)
    const emergencyResult = await executeCheckpoint({
      action: "emergency",
      reportTitle,
      runId,
      stageId: "S02_analyze_data",
      reason: "timeout",
      researchSessionID: "ses_watchdog_test",
      executionCount: 7,
    });

    expect(emergencyResult.success).toBe(true);
    expect(emergencyResult.action).toBe("emergency");
    
    // 3. Verify status is "interrupted" (per 3.4.3)
    expect(emergencyResult.status).toBe("interrupted");
    
    // 4. Verify reason is "timeout"
    expect(emergencyResult.reason).toBe("timeout");

    // 5. Verify checkpoint is still resumable
    const resumeResult = await executeCheckpoint({
      action: "resume",
      reportTitle,
      runId,
    });

    expect(resumeResult.success).toBe(true);
    expect(resumeResult.found).toBe(true);
    
    const checkpoint = resumeResult.checkpoint as any;
    expect(checkpoint.status).toBe("interrupted");
    expect(checkpoint.checkpointId).toBe(emergencyResult.checkpointId);
  });

  // 5.4.3: Resume from aborted research
  test('resume from aborted research', async () => {
    const reportTitle = "e2e-resume-test";
    const runId = "run-001";

    // 1. Create notebook
    await createTestNotebook(reportTitle);

    // 2. Create artifact that would survive the "abort"
    const artifact = await createTestArtifact(
      `reports/${reportTitle}/models/model.pkl`,
      "fake pickle data for testing"
    );

    // 3. Create emergency checkpoint (simulating abort)
    await executeCheckpoint({
      action: "emergency",
      reportTitle,
      runId,
      stageId: "S03_train_model",
      reason: "abort",
      researchSessionID: "ses_abort_test",
      executionCount: 15,
      artifacts: [artifact],
    });

    // 4. Call resume action
    const resumeResult = await executeCheckpoint({
      action: "resume",
      reportTitle,
      runId,
    });

    expect(resumeResult.success).toBe(true);
    expect(resumeResult.found).toBe(true);

    // 5. Verify rehydration cells are generated
    expect(resumeResult.rehydrationCells).toBeDefined();
    expect(Array.isArray(resumeResult.rehydrationCells)).toBe(true);
    expect((resumeResult.rehydrationCells as string[]).length).toBeGreaterThan(0);

    // 6. Verify correct nextStageId is inferred
    expect(resumeResult.nextStageId).toBe("S04_");

    const checkpoint = resumeResult.checkpoint as any;
    expect(checkpoint.stageId).toBe("S03_train_model");
    expect(checkpoint.status).toBe("interrupted");
  });

  // 5.4.4: Verify notebook contains checkpoint cells
  test('checkpoint cells are appended to notebook', async () => {
    const reportTitle = "e2e-notebook-cell-test";
    const runId = "run-001";

    // 1. Create empty notebook
    const notebookPath = await createTestNotebook(reportTitle);

    // 2. Read initial cell count
    const notebookBefore = await readTestNotebook(notebookPath);
    const initialCellCount = notebookBefore.cells.length;
    expect(initialCellCount).toBe(1); // Should have 1 initial cell

    // 3. Save checkpoint
    const saveResult = await executeCheckpoint({
      action: "save",
      reportTitle,
      runId,
      checkpointId: "ckpt-notebook-test",
      researchSessionID: "ses_notebook_test",
      stageId: "S01_load_data",
    });

    expect(saveResult.success).toBe(true);
    expect(saveResult.checkpointCellId).toBeDefined();

    // 4. Read notebook after checkpoint
    const notebookAfter = await readTestNotebook(notebookPath);
    
    // 5. Verify checkpoint cell exists
    expect(notebookAfter.cells.length).toBe(initialCellCount + 1);

    // 6. Verify cell has gyoshu-checkpoint tag
    const checkpointCell = notebookAfter.cells[notebookAfter.cells.length - 1];
    expect(checkpointCell.metadata.tags).toContain("gyoshu-checkpoint");
    expect(checkpointCell.metadata.gyoshu).toBeDefined();
    expect(checkpointCell.metadata.gyoshu.type).toBe("checkpoint");
    expect(checkpointCell.metadata.gyoshu.checkpointId).toBe("ckpt-notebook-test");
    expect(checkpointCell.metadata.gyoshu.stageId).toBe("S01_load_data");
  });

  // 5.4.5: Verify artifacts in correct locations
  test('artifacts stored in correct locations', async () => {
    const reportTitle = "e2e-artifact-test";
    const runId = "run-001";
    const checkpointId = "ckpt-artifact-test";

    // 1. Create notebook
    await createTestNotebook(reportTitle);

    // 2. Create artifact files at correct paths
    const dataArtifact = await createTestArtifact(
      `reports/${reportTitle}/data/processed.parquet`,
      "fake parquet content"
    );

    const modelArtifact = await createTestArtifact(
      `reports/${reportTitle}/models/classifier.joblib`,
      "fake joblib model"
    );

    // 3. Create checkpoint with artifact entries
    const saveResult = await executeCheckpoint({
      action: "save",
      reportTitle,
      runId,
      checkpointId,
      researchSessionID: "ses_artifact_test",
      stageId: "S03_train_model",
      artifacts: [dataArtifact, modelArtifact],
    });

    expect(saveResult.success).toBe(true);
    expect(saveResult.artifactCount).toBe(2);

    // 4. Verify manifest path follows reports/{reportTitle}/checkpoints/{runId}/{checkpointId}/
    const manifestPath = saveResult.manifestPath as string;
    expect(manifestPath).toContain(`reports/${reportTitle}/checkpoints/${runId}/${checkpointId}`);
    expect(manifestPath).toMatch(/checkpoint\.json$/);

    // 5. Verify manifest contains artifact metadata
    const validateResult = await executeCheckpoint({
      action: "validate",
      reportTitle,
      runId,
      checkpointId,
    });

    expect(validateResult.success).toBe(true);
    expect(validateResult.valid).toBe(true);
    expect(validateResult.artifactCount).toBe(2);
    expect(validateResult.issues).toEqual([]);

    // 6. Verify artifacts are accessible and match their hashes
    const manifestFullPath = path.join(testDir, manifestPath);
    const manifestContent = JSON.parse(await fs.readFile(manifestFullPath, "utf-8"));
    
    expect(manifestContent.artifacts.length).toBe(2);
    
    // Check first artifact
    expect(manifestContent.artifacts[0].relativePath).toBe(dataArtifact.relativePath);
    expect(manifestContent.artifacts[0].sha256).toBe(dataArtifact.sha256);
    expect(manifestContent.artifacts[0].sizeBytes).toBe(dataArtifact.sizeBytes);

    // Check second artifact
    expect(manifestContent.artifacts[1].relativePath).toBe(modelArtifact.relativePath);
    expect(manifestContent.artifacts[1].sha256).toBe(modelArtifact.sha256);
    expect(manifestContent.artifacts[1].sizeBytes).toBe(modelArtifact.sizeBytes);
  });

  // Additional integration test: Multiple checkpoints with resume fallback
  test('resume falls back to valid checkpoint when latest is invalid', async () => {
    const reportTitle = "e2e-fallback-test";
    const runId = "run-001";

    // 1. Create notebook
    await createTestNotebook(reportTitle);

    // 2. Create valid first checkpoint with artifact
    const artifact1 = await createTestArtifact(
      `reports/${reportTitle}/data/stage1.csv`,
      "stage1 data"
    );

    await executeCheckpoint({
      action: "save",
      reportTitle,
      runId,
      checkpointId: "ckpt-001",
      researchSessionID: "ses_fallback_test",
      stageId: "S01_load_data",
      artifacts: [artifact1],
    });

    // 3. Create second checkpoint with artifact
    const artifact2 = await createTestArtifact(
      `reports/${reportTitle}/data/stage2.csv`,
      "stage2 data"
    );

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 50));

    await executeCheckpoint({
      action: "save",
      reportTitle,
      runId,
      checkpointId: "ckpt-002",
      researchSessionID: "ses_fallback_test",
      stageId: "S02_eda_analysis",
      artifacts: [artifact2],
    });

    // 4. Corrupt the second checkpoint's artifact (simulate crash/corruption)
    await fs.writeFile(
      path.join(testDir, artifact2.relativePath),
      "corrupted content that changes the hash"
    );

    // 5. Resume should fall back to first checkpoint
    const resumeResult = await executeCheckpoint({
      action: "resume",
      reportTitle,
      runId,
    });

    expect(resumeResult.success).toBe(true);
    expect(resumeResult.found).toBe(true);

    const checkpoint = resumeResult.checkpoint as any;
    // Should fall back to ckpt-001 since ckpt-002's artifact is corrupted
    expect(checkpoint.checkpointId).toBe("ckpt-001");
    expect(checkpoint.stageId).toBe("S01_load_data");
  });
});

describe('Bridge Spawn Edge Cases', () => {
  test('bridge starts and logs to stderr', async () => {
    const bridge = new TestBridge();
    await bridge.start();

    await new Promise(resolve => setTimeout(resolve, 50));

    const stderr = bridge.getStderr();
    expect(stderr).toContain('gyoshu_bridge');
    expect(stderr).toContain('Started');

    await bridge.stop();
  });

  test('bridge can be stopped and restarted', async () => {
    const bridge = new TestBridge();

    await bridge.start();
    const result1 = await bridge.request<PingResult>('ping', {});
    expect(result1.status).toBe('ok');
    await bridge.stop();

    await bridge.start();
    const result2 = await bridge.request<PingResult>('ping', {});
    expect(result2.status).toBe('ok');
    await bridge.stop();
  });

  test('stopping already stopped bridge is safe', async () => {
    const bridge = new TestBridge();
    await bridge.start();
    await bridge.stop();

    await bridge.stop();
    await bridge.stop();
  });
});
