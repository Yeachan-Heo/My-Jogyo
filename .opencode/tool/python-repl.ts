/**
 * Python REPL Tool - Execute Python code in a persistent REPL environment.
 * JSON-RPC 2.0 over Unix socket. Session locking, timeout escalation (SIGINT→SIGTERM→SIGKILL).
 * 
 * Persistence: Python bridge runs as a socket server that persists across tool invocations.
 * Variables survive between calls as long as the bridge server is running.
 * 
 * @module python-repl
 */

import { tool } from "@opencode-ai/plugin";
import { spawn } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as net from "net";
import { SessionLock } from "../lib/session-lock";

const DEFAULT_EXECUTION_TIMEOUT_MS = 300000;
const DEFAULT_QUEUE_TIMEOUT_MS = 30000;
const TIMEOUT_SIGINT_TO_SIGTERM_MS = 5000;
const TIMEOUT_SIGTERM_TO_SIGKILL_MS = 3000;
const BRIDGE_SPAWN_TIMEOUT_MS = 5000;

const ERROR_QUEUE_TIMEOUT = -32004;
const ERROR_BRIDGE_FAILED = -32005;
const ERROR_INVALID_ACTION = -32006;

/** Python environment types */
type PythonEnvType = "system" | "venv" | "uv" | "poetry" | "conda" | "custom";

/** Detected Python environment */
interface PythonEnvironment {
  type: PythonEnvType;
  pythonPath: string;
  command: string[];  // e.g., ["uv", "run", "python"] or [".venv/bin/python"]
  projectDir: string;
  detected: boolean;  // false if fallback to system
}

/** Metadata about a running bridge server */
interface BridgeMeta {
  pid: number;
  socketPath: string;
  startedAt: string;
  sessionId: string;
  pythonEnv?: PythonEnvironment;  // Track which environment was used
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

interface InterruptResult {
  status: string;
}

const locks = new Map<string, SessionLock>();
let requestIdCounter = 0;

function getBridgePath(): string {
  return path.join(__dirname, "..", "bridge", "vibesci_bridge.py");
}

function getSessionDir(sessionId: string): string {
  return path.join(os.homedir(), ".vibesci", "sessions", sessionId);
}

function getLockPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), "session.lock");
}

function getSocketPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), "bridge.sock");
}

function getBridgeMetaPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), "bridge_meta.json");
}

/**
 * Detect the Python environment for a project directory.
 * Priority: VIBESCI_PYTHON_PATH > .venv/venv > uv > poetry > conda > system
 */
function detectPythonEnvironment(projectDir: string): PythonEnvironment {
  const fallback: PythonEnvironment = {
    type: "system",
    pythonPath: "python3",
    command: ["python3"],
    projectDir,
    detected: false,
  };

  // 1. Check VIBESCI_PYTHON_PATH env var (user override)
  const customPath = process.env.VIBESCI_PYTHON_PATH;
  if (customPath && fs.existsSync(customPath)) {
    console.log(`[python-repl] Using custom Python: ${customPath}`);
    return {
      type: "custom",
      pythonPath: customPath,
      command: [customPath],
      projectDir,
      detected: true,
    };
  }

  // 2. Check for local .venv or venv directory
  const venvPaths = [
    path.join(projectDir, ".venv", "bin", "python"),
    path.join(projectDir, "venv", "bin", "python"),
    path.join(projectDir, ".venv", "Scripts", "python.exe"),  // Windows
    path.join(projectDir, "venv", "Scripts", "python.exe"),   // Windows
  ];
  
  for (const venvPath of venvPaths) {
    if (fs.existsSync(venvPath)) {
      console.log(`[python-repl] Using venv: ${venvPath}`);
      return {
        type: "venv",
        pythonPath: venvPath,
        command: [venvPath],
        projectDir,
        detected: true,
      };
    }
  }

  // 3. Check for uv (pyproject.toml with uv.lock or [tool.uv])
  const pyprojectPath = path.join(projectDir, "pyproject.toml");
  const uvLockPath = path.join(projectDir, "uv.lock");
  
  if (fs.existsSync(uvLockPath)) {
    console.log(`[python-repl] Detected uv project (uv.lock)`);
    return {
      type: "uv",
      pythonPath: "uv",
      command: ["uv", "run", "python"],
      projectDir,
      detected: true,
    };
  }
  
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, "utf-8");
      
      // Check for [tool.uv] section
      if (content.includes("[tool.uv]")) {
        console.log(`[python-repl] Detected uv project ([tool.uv])`);
        return {
          type: "uv",
          pythonPath: "uv",
          command: ["uv", "run", "python"],
          projectDir,
          detected: true,
        };
      }
      
      // 4. Check for poetry ([tool.poetry] or poetry.lock)
      const poetryLockPath = path.join(projectDir, "poetry.lock");
      if (content.includes("[tool.poetry]") || fs.existsSync(poetryLockPath)) {
        console.log(`[python-repl] Detected poetry project`);
        return {
          type: "poetry",
          pythonPath: "poetry",
          command: ["poetry", "run", "python"],
          projectDir,
          detected: true,
        };
      }
    } catch (e) {
      console.warn(`[python-repl] Failed to read pyproject.toml: ${e}`);
    }
  }

  // 5. Check for conda (environment.yml)
  const condaEnvPath = path.join(projectDir, "environment.yml");
  const condaEnvYamlPath = path.join(projectDir, "environment.yaml");
  
  if (fs.existsSync(condaEnvPath) || fs.existsSync(condaEnvYamlPath)) {
    console.log(`[python-repl] Detected conda project (environment.yml)`);
    return {
      type: "conda",
      pythonPath: "conda",
      command: ["conda", "run", "--no-capture-output", "python"],
      projectDir,
      detected: true,
    };
  }

  // 6. Fallback to system python3
  console.log(`[python-repl] No virtual environment detected, using system python3`);
  return fallback;
}

/**
 * Check if a process is alive by sending signal 0
 */
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
  } catch (e) {
    console.warn(`[python-repl] Failed to read bridge meta for ${sessionId}:`, e);
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
  } catch (e) {
    console.error(`[python-repl] Failed to write bridge meta for ${sessionId}:`, e);
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
  const dir = getSessionDir(sessionId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Spawn a new bridge server process using detected Python environment
 */
async function spawnBridgeServer(sessionId: string, projectDir?: string): Promise<BridgeMeta> {
  ensureSessionDir(sessionId);
  
  const socketPath = getSocketPath(sessionId);
  const bridgePath = getBridgePath();
  
  // Clean up any existing socket file
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }
  
  // Detect Python environment from project directory
  const effectiveProjectDir = projectDir || process.cwd();
  const pythonEnv = detectPythonEnvironment(effectiveProjectDir);
  
  // Build spawn command based on environment type
  const bridgeArgs = [bridgePath, "--server", "--socket", socketPath];
  let spawnCommand: string;
  let spawnArgs: string[];
  
  if (pythonEnv.type === "uv") {
    spawnCommand = "uv";
    spawnArgs = ["run", "python", ...bridgeArgs];
  } else if (pythonEnv.type === "poetry") {
    spawnCommand = "poetry";
    spawnArgs = ["run", "python", ...bridgeArgs];
  } else if (pythonEnv.type === "conda") {
    spawnCommand = "conda";
    spawnArgs = ["run", "--no-capture-output", "python", ...bridgeArgs];
  } else {
    spawnCommand = pythonEnv.pythonPath;
    spawnArgs = bridgeArgs;
  }
  
  console.log(`[python-repl] Spawning bridge: ${spawnCommand} ${spawnArgs.join(" ")}`);
  
  const proc = spawn(spawnCommand, spawnArgs, {
    stdio: ["ignore", "ignore", "pipe"],
    cwd: pythonEnv.projectDir,  // Run in project dir for venv activation
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    detached: true,
  });
  
  proc.unref();
  
  let stderrBuffer = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
    console.log(`[python-repl] Bridge stderr: ${chunk.toString().trim()}`);
  });
  
  const startTime = Date.now();
  while (!fs.existsSync(socketPath)) {
    if (Date.now() - startTime > BRIDGE_SPAWN_TIMEOUT_MS) {
      try {
        process.kill(proc.pid!, "SIGKILL");
      } catch {}
      throw new Error(`Bridge server failed to start within ${BRIDGE_SPAWN_TIMEOUT_MS}ms. Env: ${pythonEnv.type}. Stderr: ${stderrBuffer}`);
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
  console.log(`[python-repl] Spawned bridge server for ${sessionId}: PID=${proc.pid}, env=${pythonEnv.type}`);
  
  return meta;
}

/**
 * Get or spawn a bridge server for the session
 */
async function ensureBridge(sessionId: string, projectDir?: string): Promise<BridgeMeta> {
  const meta = readBridgeMeta(sessionId);
  
  if (meta && isProcessAlive(meta.pid)) {
    if (fs.existsSync(meta.socketPath)) {
      console.log(`[python-repl] Reusing existing bridge for ${sessionId}: PID=${meta.pid}`);
      return meta;
    } else {
      console.warn(`[python-repl] Bridge socket missing for ${sessionId}, killing PID=${meta.pid}`);
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
  
  console.log(`[python-repl] Killing bridge for ${sessionId}: PID=${meta.pid}`);
  
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
    lock = new SessionLock(getLockPath(sessionId));
    locks.set(sessionId, lock);
  }
  return lock;
}

export default tool({
  name: "python-repl",
  description:
    "Execute Python code in a persistent REPL environment with scientific markers. " +
    "Actions: execute (run code), interrupt (stop running code), reset (clear namespace), " +
    "get_state (memory and variables). Uses session locking for safe concurrent access.",

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
          "Project directory for virtual environment detection. " +
          "Detects uv, poetry, venv, conda environments. Defaults to current working directory.",
      },
    },
    required: ["action", "researchSessionID"],
  },

  async execute(args: {
    action: "execute" | "interrupt" | "reset" | "get_state";
    researchSessionID: string;
    code?: string;
    executionTimeout?: number;
    queueTimeout?: number;
    projectDir?: string;
  }) {
    const {
      action,
      researchSessionID,
      code,
      executionTimeout = DEFAULT_EXECUTION_TIMEOUT_MS,
      queueTimeout = DEFAULT_QUEUE_TIMEOUT_MS,
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

          try {
            const result = await sendSocketRequest<ExecuteResult>(
              meta.socketPath,
              "execute",
              { code, timeout: executionTimeout / 1000 },
              executionTimeout + 10000
            );
            return JSON.stringify({ ...result, pythonEnv: meta.pythonEnv });
          } catch (e) {
            const errorMsg = (e as Error).message;
            
            // If connection failed, bridge might have died - clean up and retry once
            if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("ENOENT")) {
              console.warn(`[python-repl] Bridge connection failed for ${researchSessionID}, restarting...`);
              deleteBridgeMeta(researchSessionID);
              
              try {
                meta = await spawnBridgeServer(researchSessionID, args.projectDir);
                const result = await sendSocketRequest<ExecuteResult>(
                  meta.socketPath,
                  "execute",
                  { code, timeout: executionTimeout / 1000 },
                  executionTimeout + 10000
                );
                return JSON.stringify({ ...result, pythonEnv: meta.pythonEnv });
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
 * Cleanup function exported for use by vibesci-hooks.ts
 * Kills all known bridge servers
 */
export async function cleanupAllBridges(): Promise<void> {
  const sessionsDir = path.join(os.homedir(), ".vibesci", "sessions");
  
  if (!fs.existsSync(sessionsDir)) {
    return;
  }
  
  const sessions = fs.readdirSync(sessionsDir);
  
  for (const sessionId of sessions) {
    try {
      await killBridgeWithEscalation(sessionId);
    } catch (e) {
      console.warn(`[python-repl] Failed to cleanup bridge for ${sessionId}:`, e);
    }
  }
}

/**
 * Kill a specific session's bridge
 */
export async function killSessionBridge(sessionId: string): Promise<void> {
  await killBridgeWithEscalation(sessionId);
}
