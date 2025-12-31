/**
 * Integration tests for Python bridge + TypeScript communication.
 * Tests: bridge spawning, JSON-RPC over NDJSON, execute/reset/get_state/interrupt/ping methods,
 * marker parsing, and process lifecycle management.
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'bun:test';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import * as fs from 'fs/promises';

const BRIDGE_PATH = path.join(__dirname, '..', '.opencode', 'bridge', 'vibesci_bridge.py');
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

describe('Bridge Spawn Edge Cases', () => {
  test('bridge starts and logs to stderr', async () => {
    const bridge = new TestBridge();
    await bridge.start();

    await new Promise(resolve => setTimeout(resolve, 50));

    const stderr = bridge.getStderr();
    expect(stderr).toContain('vibesci_bridge');
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
