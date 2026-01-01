/**
 * Python REPL Tool - Execute Python code in a persistent REPL environment.
 * JSON-RPC 2.0 over Unix socket. Session locking, timeout escalation (SIGINT→SIGTERM→SIGKILL).
 * 
 * Persistence: Python bridge runs as a socket server that persists across tool invocations.
 * Variables survive between calls as long as the bridge server is running.
 * 
 * Auto-Capture: When notebookPath is provided with autoCapture=true, executed code
 * and outputs are automatically appended as cells to the specified Jupyter notebook.
 * 
 * @module python-repl
 */

import { tool } from "@opencode-ai/plugin";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as net from "net";
import * as crypto from "crypto";
import { SessionLock } from "../lib/session-lock";
import {
  getSessionDir,
  getSessionLockPath,
  getBridgeSocketPath,
  getRuntimeDir,
  ensureDirSync,
  getNotebookPath,
} from "../lib/paths";
import { durableAtomicWrite } from "../lib/atomic-write";
import { ensureCellId, NotebookCell, Notebook } from "../lib/cell-identity";
import {
  extractFrontmatter,
  updateFrontmatter,
  updateRun,
  addRun,
  RunEntry,
} from "../lib/notebook-frontmatter";

const DEFAULT_EXECUTION_TIMEOUT_MS = 300000;
const DEFAULT_QUEUE_TIMEOUT_MS = 30000;
const TIMEOUT_SIGINT_TO_SIGTERM_MS = 5000;
const TIMEOUT_SIGTERM_TO_SIGKILL_MS = 3000;
const BRIDGE_SPAWN_TIMEOUT_MS = 5000;

const ERROR_QUEUE_TIMEOUT = -32004;
const ERROR_BRIDGE_FAILED = -32005;
const ERROR_INVALID_ACTION = -32006;

/** Simplified Python environment info - only .venv supported */
interface PythonEnvInfo {
  pythonPath: string;
  type: "venv";
}

interface BridgeMeta {
  pid: number;
  socketPath: string;
  startedAt: string;
  sessionId: string;
  pythonEnv?: PythonEnvInfo;
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

// =============================================================================
// NOTEBOOK CELL OUTPUT TYPES (nbformat spec)
// =============================================================================

interface StreamOutput {
  output_type: "stream";
  name: "stdout" | "stderr";
  text: string[];
}

interface ExecuteResultOutput {
  output_type: "execute_result";
  execution_count: number;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

interface DisplayDataOutput {
  output_type: "display_data";
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

interface ErrorOutput {
  output_type: "error";
  ename: string;
  evalue: string;
  traceback: string[];
}

type CellOutput = StreamOutput | ExecuteResultOutput | DisplayDataOutput | ErrorOutput;

interface NotebookCaptureResult {
  captured: boolean;
  cellId?: string;
  cellIndex?: number;
  error?: string;
}

// =============================================================================
// AUTO-CAPTURE HELPERS (exported for testing)
// =============================================================================

export function splitIntoLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  return lines.map((line, i) => (i < lines.length - 1 ? line + "\n" : line)).filter(line => line !== "");
}

export function convertExecuteResultToOutputs(result: ExecuteResult): CellOutput[] {
  const outputs: CellOutput[] = [];

  if (result.stdout) {
    outputs.push({
      output_type: "stream",
      name: "stdout",
      text: splitIntoLines(result.stdout),
    });
  }

  if (result.stderr) {
    outputs.push({
      output_type: "stream",
      name: "stderr",
      text: splitIntoLines(result.stderr),
    });
  }

  if (result.error) {
    const traceback = result.error.traceback
      ? splitIntoLines(result.error.traceback)
      : [`${result.error.type}: ${result.error.message}`];
    
    outputs.push({
      output_type: "error",
      ename: result.error.type || "Error",
      evalue: result.error.message || "",
      traceback,
    });
  }

  return outputs;
}

function generateCellId(): string {
  return `gyoshu-${crypto.randomUUID().slice(0, 8)}`;
}

function createEmptyNotebook(sessionId: string): Notebook {
  return {
    cells: [],
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
      gyoshu: {
        researchSessionID: sessionId,
        createdAt: new Date().toISOString(),
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

async function readNotebook(notebookPath: string): Promise<Notebook | null> {
  try {
    const content = await fsp.readFile(notebookPath, "utf-8");
    return JSON.parse(content) as Notebook;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function saveNotebookWithCellIds(
  notebookPath: string,
  notebook: Notebook
): Promise<void> {
  for (let i = 0; i < notebook.cells.length; i++) {
    ensureCellId(notebook.cells[i], i, notebookPath);
  }
  notebook.nbformat = 4;
  notebook.nbformat_minor = 5;
  ensureDirSync(path.dirname(notebookPath));
  await durableAtomicWrite(notebookPath, JSON.stringify(notebook, null, 2));
}

export async function appendCodeCellToNotebook(
  notebookPath: string,
  sessionId: string,
  code: string,
  outputs: CellOutput[],
  executionCount: number
): Promise<NotebookCaptureResult> {
  try {
    let notebook = await readNotebook(notebookPath);
    const isNew = notebook === null;

    if (isNew) {
      notebook = createEmptyNotebook(sessionId);
    }

    const cellId = generateCellId();
    const cell: NotebookCell = {
      cell_type: "code",
      id: cellId,
      source: splitIntoLines(code),
      metadata: {
        gyoshu: {
          type: "research",
          lastUpdated: new Date().toISOString(),
          autoCaptured: true,
        },
      },
      execution_count: executionCount,
      outputs,
    };

    notebook!.cells.push(cell);
    await saveNotebookWithCellIds(notebookPath, notebook!);

    return {
      captured: true,
      cellId,
      cellIndex: notebook!.cells.length - 1,
    };
  } catch (error) {
    return {
      captured: false,
      error: (error as Error).message,
    };
  }
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

interface InterruptResult {
  status: string;
}

const locks = new Map<string, SessionLock>();
const executionCounters = new Map<string, number>();
let requestIdCounter = 0;

export function getNextExecutionCount(sessionId: string): number {
  const current = executionCounters.get(sessionId) || 0;
  const next = current + 1;
  executionCounters.set(sessionId, next);
  return next;
}

function getBridgePath(): string {
  return path.join(__dirname, "..", "bridge", "gyoshu_bridge.py");
}

function getBridgeMetaPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), "bridge_meta.json");
}

function detectExistingPythonEnv(projectRoot: string): PythonEnvInfo | null {
  const isWindows = process.platform === "win32";
  const binDir = isWindows ? "Scripts" : "bin";
  const pythonExe = isWindows ? "python.exe" : "python";
  const venvPython = path.join(projectRoot, ".venv", binDir, pythonExe);

  if (fs.existsSync(venvPython)) {
    return { pythonPath: venvPython, type: "venv" };
  }
  return null;
}

async function ensurePythonEnvironment(projectRoot: string): Promise<PythonEnvInfo> {
  const existing = detectExistingPythonEnv(projectRoot);
  if (existing) {
    return existing;
  }
  throw new Error(
    "No .venv found. Create a virtual environment first:\n" +
    "  python -m venv .venv\n" +
    "  .venv/bin/pip install pandas numpy matplotlib"
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read bridge metadata from disk
 */
function readBridgeMeta(sessionId: string): BridgeMeta | null {
  const metaPath = getBridgeMetaPath(sessionId);
  try {
    if (!fs.existsSync(metaPath)) {
      return null;
    }
    const content = fs.readFileSync(metaPath, "utf-8");
    return JSON.parse(content) as BridgeMeta;
  } catch {
    return null;
  }
}

/**
 * Write bridge metadata to disk
 */
function writeBridgeMeta(sessionId: string, meta: BridgeMeta): void {
  const metaPath = getBridgeMetaPath(sessionId);
  try {
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  } catch {
  }
}

/**
 * Delete bridge metadata from disk
 */
function deleteBridgeMeta(sessionId: string): void {
  const metaPath = getBridgeMetaPath(sessionId);
  try {
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Ensure the session directory exists
 */
function ensureSessionDir(sessionId: string): void {
  ensureDirSync(getSessionDir(sessionId));
}

async function spawnBridgeServer(sessionId: string, projectDir?: string): Promise<BridgeMeta> {
  ensureSessionDir(sessionId);
  
  const socketPath = getBridgeSocketPath(sessionId);
  const bridgePath = getBridgePath();
  
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }
  
  const effectiveProjectDir = projectDir || process.cwd();
  const pythonEnv = await ensurePythonEnvironment(effectiveProjectDir);
  
  const bridgeArgs = [bridgePath, "--server", "--socket", socketPath];
  
  const proc = spawn(pythonEnv.pythonPath, bridgeArgs, {
    stdio: ["ignore", "ignore", "pipe"],
    cwd: effectiveProjectDir,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    detached: true,
  });
  
  proc.unref();
  
  let stderrBuffer = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
  });
  
  const startTime = Date.now();
  while (!fs.existsSync(socketPath)) {
    if (Date.now() - startTime > BRIDGE_SPAWN_TIMEOUT_MS) {
      try {
        process.kill(proc.pid!, "SIGKILL");
      } catch {}
      throw new Error(`Bridge failed to start in ${BRIDGE_SPAWN_TIMEOUT_MS}ms. Stderr: ${stderrBuffer}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  
  const meta: BridgeMeta = {
    pid: proc.pid!,
    socketPath,
    startedAt: new Date().toISOString(),
    sessionId,
    pythonEnv,
  };
  
  writeBridgeMeta(sessionId, meta);
  
  return meta;
}

/**
 * Get or spawn a bridge server for the session
 */
async function ensureBridge(sessionId: string, projectDir?: string): Promise<BridgeMeta> {
  const meta = readBridgeMeta(sessionId);
  
  if (meta && isProcessAlive(meta.pid)) {
    if (fs.existsSync(meta.socketPath)) {
      return meta;
    } else {
      try {
        process.kill(meta.pid, "SIGKILL");
      } catch {}
    }
  }
  
  if (meta) {
    deleteBridgeMeta(sessionId);
  }
  
  return spawnBridgeServer(sessionId, projectDir);
}

/**
 * Send a JSON-RPC request over Unix socket
 */
function sendSocketRequest<T>(
  socketPath: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = `req_${++requestIdCounter}`;
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });
    
    let responseBuffer = "";
    let timedOut = false;
    
    const timer = setTimeout(() => {
      timedOut = true;
      socket.destroy();
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    
    const socket = net.createConnection({ path: socketPath }, () => {
      // Connected - send request
      socket.write(request + "\n");
    });
    
    socket.on("data", (chunk: Buffer) => {
      responseBuffer += chunk.toString();
      
      // Look for complete JSON line
      const newlineIndex = responseBuffer.indexOf("\n");
      if (newlineIndex !== -1) {
        clearTimeout(timer);
        const jsonLine = responseBuffer.slice(0, newlineIndex);
        socket.end();
        
        try {
          const response = JSON.parse(jsonLine);
          
          if (response.jsonrpc !== "2.0") {
            reject(new Error(`Invalid JSON-RPC version in response`));
            return;
          }
          
          if (response.id !== id) {
            reject(new Error(`Response ID mismatch: expected ${id}, got ${response.id}`));
            return;
          }
          
          if (response.error) {
            reject(new Error(response.error.message || "Unknown error"));
          } else {
            resolve(response.result as T);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${(e as Error).message}`));
        }
      }
    });
    
    socket.on("error", (err) => {
      if (!timedOut) {
        clearTimeout(timer);
        reject(err);
      }
    });
    
    socket.on("close", () => {
      if (!timedOut && responseBuffer.indexOf("\n") === -1) {
        clearTimeout(timer);
        reject(new Error("Connection closed without response"));
      }
    });
  });
}

/**
 * Kill a bridge server with escalation (SIGINT → SIGTERM → SIGKILL)
 */
async function killBridgeWithEscalation(sessionId: string): Promise<void> {
  const meta = readBridgeMeta(sessionId);
  if (!meta) return;
  
  if (!isProcessAlive(meta.pid)) {
    deleteBridgeMeta(sessionId);
    return;
  }
  
  const waitForExit = (timeoutMs: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const check = () => {
        if (!isProcessAlive(meta.pid)) {
          resolve(true);
        } else if (Date.now() - startTime > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  };
  
  // SIGINT
  try {
    process.kill(meta.pid, "SIGINT");
  } catch {}
  
  if (!(await waitForExit(TIMEOUT_SIGINT_TO_SIGTERM_MS))) {
    // SIGTERM
    try {
      process.kill(meta.pid, "SIGTERM");
    } catch {}
    
    if (!(await waitForExit(TIMEOUT_SIGTERM_TO_SIGKILL_MS))) {
      // SIGKILL
      try {
        process.kill(meta.pid, "SIGKILL");
      } catch {}
    }
  }
  
  // Clean up metadata
  deleteBridgeMeta(sessionId);
  
  // Clean up socket file
  try {
    if (fs.existsSync(meta.socketPath)) {
      fs.unlinkSync(meta.socketPath);
    }
  } catch {}
}

function getOrCreateLock(sessionId: string): SessionLock {
  let lock = locks.get(sessionId);
  if (!lock) {
    ensureSessionDir(sessionId);
    lock = new SessionLock(getSessionLockPath(sessionId));
    locks.set(sessionId, lock);
  }
  return lock;
}

export default tool({
  name: "python-repl",
  description:
    "Execute Python code in a persistent REPL environment with scientific markers. " +
    "Actions: execute (run code), interrupt (stop running code), reset (clear namespace), " +
    "get_state (memory and variables). Uses session locking for safe concurrent access. " +
    "Supports auto-capture: when notebookPath + autoCapture=true, code and outputs are " +
    "automatically appended as cells to the specified Jupyter notebook.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["execute", "interrupt", "reset", "get_state"],
        description:
          "execute: Run Python code, " +
          "interrupt: Send interrupt to running code, " +
          "reset: Clear execution namespace, " +
          "get_state: Get memory usage and variables",
      },
      researchSessionID: {
        type: "string",
        description: "Unique identifier for the research session",
      },
      code: {
        type: "string",
        description: "Python code to execute (required for 'execute' action)",
      },
      description: {
        type: "string",
        description:
          "Human-readable description of what this code execution does. " +
          "Displayed in UI to help users understand the research progress. " +
          "Examples: 'Load and profile dataset', 'Train XGBoost model', 'Generate correlation heatmap'",
      },
      executionTimeout: {
        type: "number",
        description:
          "Timeout for code execution in milliseconds (default: 300000 = 5 min). " +
          "After timeout, triggers SIGINT → SIGTERM → SIGKILL escalation.",
      },
      queueTimeout: {
        type: "number",
        description:
          "Timeout for acquiring session lock in milliseconds (default: 30000 = 30 sec). " +
          "Fails if session is busy and lock cannot be acquired within timeout.",
      },
      projectDir: {
        type: "string",
        description:
          "Project directory containing .venv/. Defaults to current working directory.",
      },
      notebookPath: {
        type: "string",
        description:
          "Absolute path to Jupyter notebook (.ipynb) for auto-capture. " +
          "When provided with autoCapture=true, executed code and outputs are " +
          "automatically appended as cells to this notebook.",
      },
      autoCapture: {
        type: "boolean",
        description:
          "If true, automatically capture code and outputs to notebook. " +
          "Requires notebookPath or reportTitle to be specified. Defaults to false.",
      },
      reportTitle: {
        type: "string",
        description:
          "Title for notebook auto-capture (alternative to notebookPath). " +
          "Computes path as: notebooks/{reportTitle}.ipynb",
      },
      runId: {
        type: "string",
        description:
          "Current run ID for frontmatter tracking. " +
          "When provided with auto-capture, updates the run status in notebook frontmatter.",
      },
    },
    required: ["action", "researchSessionID"],
  },

  async execute(args: {
    action: "execute" | "interrupt" | "reset" | "get_state";
    researchSessionID: string;
    code?: string;
    description?: string;
    executionTimeout?: number;
    queueTimeout?: number;
    projectDir?: string;
    notebookPath?: string;
    autoCapture?: boolean;
    reportTitle?: string;
    runId?: string;
  }) {
    const {
      action,
      researchSessionID,
      code,
      description,
      executionTimeout = DEFAULT_EXECUTION_TIMEOUT_MS,
      queueTimeout = DEFAULT_QUEUE_TIMEOUT_MS,
      notebookPath,
      autoCapture = false,
      reportTitle,
      runId,
    } = args;

    if (!researchSessionID || typeof researchSessionID !== "string") {
      return JSON.stringify({
        success: false,
        error: { code: ERROR_INVALID_ACTION, message: "researchSessionID is required" },
      });
    }

    const lock = getOrCreateLock(researchSessionID);

    try {
      await lock.acquire(queueTimeout);
    } catch (e) {
      return JSON.stringify({
        success: false,
        error: {
          code: ERROR_QUEUE_TIMEOUT,
          message: `Session busy, queue timeout exceeded (${queueTimeout}ms)`,
          details: (e as Error).message,
        },
      });
    }

    try {
      // Ensure bridge is running
      let meta: BridgeMeta;
      try {
        meta = await ensureBridge(researchSessionID, args.projectDir);
      } catch (e) {
        return JSON.stringify({
          success: false,
          error: {
            code: ERROR_BRIDGE_FAILED,
            message: "Failed to start Python bridge",
            details: (e as Error).message,
          },
        });
      }

      switch (action) {
        case "execute": {
          if (!code) {
            return JSON.stringify({
              success: false,
              error: { code: ERROR_INVALID_ACTION, message: "code is required for execute action" },
            });
          }

          if (description) {
            console.log(`▶ ${description}`);
          }

          const executeAndCapture = async (result: ExecuteResult): Promise<string> => {
            const executionCount = getNextExecutionCount(researchSessionID);
            let notebookCapture: NotebookCaptureResult | undefined;

            let captureNotebookPath = notebookPath;
            if (!captureNotebookPath && reportTitle) {
              captureNotebookPath = getNotebookPath(reportTitle);
            }

            if (autoCapture && captureNotebookPath) {
              const outputs = convertExecuteResultToOutputs(result);
              notebookCapture = await appendCodeCellToNotebook(
                captureNotebookPath,
                researchSessionID,
                code,
                outputs,
                executionCount
              );

              if (runId && notebookCapture.captured) {
                try {
                  const notebook = await readNotebook(captureNotebookPath);
                  if (notebook) {
                    const frontmatter = extractFrontmatter(notebook);
                    if (frontmatter) {
                      const runStatus = result.error ? "failed" : "in_progress";
                      const updatedFrontmatter = updateRun(frontmatter, runId, {
                        status: runStatus as "in_progress" | "completed" | "failed",
                      });
                      const updatedNotebook = updateFrontmatter(notebook, updatedFrontmatter);
                      await saveNotebookWithCellIds(captureNotebookPath, updatedNotebook);
                    }
                  }
                } catch {
                }
              }
            }

            return JSON.stringify({
              ...result,
              pythonEnv: meta.pythonEnv,
              executionCount,
              notebookCapture,
              notebookPath: captureNotebookPath,
            });
          };

          try {
            const result = await sendSocketRequest<ExecuteResult>(
              meta.socketPath,
              "execute",
              { code, timeout: executionTimeout / 1000 },
              executionTimeout + 10000
            );
            return await executeAndCapture(result);
          } catch (e) {
            const errorMsg = (e as Error).message;
            
            if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("ENOENT")) {
              deleteBridgeMeta(researchSessionID);
              
              try {
                meta = await spawnBridgeServer(researchSessionID, args.projectDir);
                const result = await sendSocketRequest<ExecuteResult>(
                  meta.socketPath,
                  "execute",
                  { code, timeout: executionTimeout / 1000 },
                  executionTimeout + 10000
                );
                return await executeAndCapture(result);
              } catch (retryError) {
                return JSON.stringify({
                  success: false,
                  error: {
                    type: "ExecutionError",
                    message: `Bridge restart failed: ${(retryError as Error).message}`,
                    traceback: null,
                  },
                  stdout: "",
                  stderr: "",
                  markers: [],
                  artifacts: [],
                });
              }
            }
            
            return JSON.stringify({
              success: false,
              error: {
                type: "ExecutionError",
                message: errorMsg,
                traceback: null,
              },
              stdout: "",
              stderr: "",
              markers: [],
              artifacts: [],
            });
          }
        }

        case "interrupt": {
          try {
            const result = await sendSocketRequest<InterruptResult>(meta.socketPath, "interrupt", {}, 5000);
            return JSON.stringify({ success: true, ...result });
          } catch (e) {
            await killBridgeWithEscalation(researchSessionID);
            return JSON.stringify({
              success: true,
              status: "forced_kill",
              message: "Bridge was unresponsive, process killed",
            });
          }
        }

        case "reset": {
          try {
            const result = await sendSocketRequest<ResetResult>(meta.socketPath, "reset", {}, 10000);
            return JSON.stringify({ success: true, ...result });
          } catch (e) {
            await killBridgeWithEscalation(researchSessionID);
            return JSON.stringify({
              success: true,
              status: "bridge_restarted",
              message: "Bridge reset failed, process killed. Will restart on next call.",
              memory: { rss_mb: 0, vms_mb: 0 },
            });
          }
        }

        case "get_state": {
          try {
            const result = await sendSocketRequest<StateResult>(meta.socketPath, "get_state", {}, 5000);
            return JSON.stringify({ success: true, ...result });
          } catch (e) {
            return JSON.stringify({
              success: false,
              error: {
                code: ERROR_BRIDGE_FAILED,
                message: "Failed to get state from bridge",
                details: (e as Error).message,
              },
            });
          }
        }

        default: {
          return JSON.stringify({
            success: false,
            error: { code: ERROR_INVALID_ACTION, message: `Unknown action: ${action}` },
          });
        }
      }
    } finally {
      await lock.release();
    }
  },
});

/**
 * Cleanup function exported for use by gyoshu-hooks.ts
 * Kills all known bridge servers
 */
export async function cleanupAllBridges(): Promise<void> {
  const runtimeDir = getRuntimeDir();
  
  if (!fs.existsSync(runtimeDir)) {
    return;
  }
  
  const sessions = fs.readdirSync(runtimeDir);
  
  for (const sessionId of sessions) {
    try {
      await killBridgeWithEscalation(sessionId);
    } catch {
    }
  }
}

export async function killSessionBridge(sessionId: string): Promise<void> {
  await killBridgeWithEscalation(sessionId);
}

export function resetExecutionCounter(sessionId: string): void {
  executionCounters.delete(sessionId);
}

export function getExecutionCount(sessionId: string): number {
  return executionCounters.get(sessionId) || 0;
}
