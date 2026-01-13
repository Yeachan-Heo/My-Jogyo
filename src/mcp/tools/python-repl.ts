/**
 * Python REPL MCP Tool - Execute Python code in a persistent REPL environment.
 *
 * This is the MCP-compatible version of the Python REPL tool. It communicates
 * with the Python bridge (gyoshu_bridge.py) via Unix socket using JSON-RPC 2.0.
 *
 * Features:
 * - Persistent Python namespace across calls
 * - Session locking for safe concurrent access
 * - Auto-capture to Jupyter notebooks
 * - Timeout escalation (SIGINT -> SIGTERM -> SIGKILL)
 * - Scientific markers parsing
 *
 * @module mcp/tools/python-repl
 */

import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as net from "net";
import * as crypto from "crypto";
import { SessionLock, getCurrentProcessStartTime, isProcessAlive as isProcessAliveWithStartTime, getProcessStartTimeLinux, getProcessStartTimeMacOS } from "../../lib/session-lock.js";
import { durableAtomicWrite, fileExists, readFile, readFileNoFollow, readFileNoFollowSync } from "../../lib/atomic-write.js";
import {
  getSessionDir,
  getSessionDirByShortId,
  getSessionLockPath,
  getBridgeSocketPath,
  getRuntimeDir,
  ensureDirSync,
  getNotebookPath,
  getNotebookRootDir,
  shortenSessionId,
  validatePathSegment,
} from "../../lib/paths.js";
import { ensureCellId, NotebookCell, Notebook } from "../../lib/cell-identity.js";
import { getNotebookLockPath, getBridgeMetaLockPath, getBridgeMetaLockPathByShortId, DEFAULT_LOCK_TIMEOUT_MS } from "../../lib/lock-paths.js";
import { withLock } from "../../lib/session-lock.js";
import {
  extractFrontmatter,
  updateFrontmatter,
  updateRun,
  addRun,
  RunEntry,
} from "../../lib/notebook-frontmatter.js";
import { isPathContainedIn } from "../../lib/path-security.js";
import { BridgeMeta, isValidBridgeMeta } from "../../lib/bridge-meta.js";

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_EXECUTION_TIMEOUT_MS = 300000;
const DEFAULT_QUEUE_TIMEOUT_MS = 30000;
const DEFAULT_GRACE_PERIOD_MS = 5000;
const DEFAULT_SIGTERM_GRACE_MS = 3000;
const BRIDGE_SPAWN_TIMEOUT_MS = 5000;

const ERROR_QUEUE_TIMEOUT = -32004;
const ERROR_BRIDGE_FAILED = -32005;
const ERROR_INVALID_ACTION = -32006;

// =============================================================================
// MCP TOOL DEFINITION
// =============================================================================

/**
 * MCP tool definition for python_repl.
 * Follows the Model Context Protocol tool schema format.
 */
export const pythonReplTool = {
  name: "python_repl",
  description:
    "Execute Python code in a persistent REPL environment with scientific markers. " +
    "Actions: execute (run code), interrupt (stop running code), reset (clear namespace), " +
    "get_state (memory and variables). Uses session locking for safe concurrent access. " +
    "Supports auto-capture: when notebookPath + autoCapture=true, code and outputs are " +
    "automatically appended as cells to the specified Jupyter notebook.",
  inputSchema: {
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
      executionLabel: {
        type: "string",
        description:
          "Human-readable label for this code execution. " +
          "Displayed in UI to help users understand the research progress. " +
          "Examples: 'Load and profile dataset', 'Train XGBoost model', 'Generate correlation heatmap'",
      },
      executionTimeout: {
        type: "number",
        description:
          "Timeout for code execution in milliseconds (default: 300000 = 5 min). " +
          "After timeout, triggers SIGINT -> SIGTERM -> SIGKILL escalation.",
      },
      queueTimeout: {
        type: "number",
        description:
          "Timeout for acquiring session lock in milliseconds (default: 30000 = 30 sec). " +
          "Fails if session is busy and lock cannot be acquired within timeout.",
      },
      projectDir: {
        type: "string",
        description: "Project directory containing .venv/. Defaults to current working directory.",
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
      interruptWithTimeout: {
        type: "object",
        properties: {
          gracePeriodMs: {
            type: "number",
            description: "Time in ms to wait between signal escalation steps. Default: 5000",
          },
          preserveOutput: {
            type: "boolean",
            description: "Attempt to capture partial output before forcing termination. Default: true",
          },
        },
        description:
          "Options for graceful interrupt with timeout escalation (interrupt action only). " +
          "Escalates: SIGINT -> gracePeriodMs -> SIGTERM -> gracePeriodMs/2 -> SIGKILL",
      },
    },
    required: ["action", "researchSessionID"],
  },
};

// =============================================================================
// TYPES
// =============================================================================

interface PythonEnvInfoLocal {
  pythonPath: string;
  type: "venv";
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
  partialStdout?: string;
  partialStderr?: string;
  terminatedBy?: "SIGINT" | "SIGTERM" | "SIGKILL" | "graceful";
  terminationTimeMs?: number;
}

interface EscalationResult {
  terminatedBy: "SIGINT" | "SIGTERM" | "SIGKILL" | "already_dead";
  terminationTimeMs: number;
}

interface PythonReplArgs {
  action: "execute" | "interrupt" | "reset" | "get_state";
  researchSessionID: string;
  code?: string;
  executionLabel?: string;
  executionTimeout?: number;
  queueTimeout?: number;
  projectDir?: string;
  notebookPath?: string;
  autoCapture?: boolean;
  reportTitle?: string;
  runId?: string;
  interruptWithTimeout?: {
    gracePeriodMs?: number;
    preserveOutput?: boolean;
  };
}

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

const locks = new Map<string, SessionLock>();
const executionCounters = new Map<string, number>();
let requestIdCounter = 0;

function getNextExecutionCount(sessionId: string): number {
  const current = executionCounters.get(sessionId) || 0;
  const next = current + 1;
  executionCounters.set(sessionId, next);
  return next;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function safeUnlinkSocket(socketPath: string): void {
  try {
    const stat = fs.lstatSync(socketPath);
    if (stat.isSocket()) {
      fs.unlinkSync(socketPath);
    } else {
      process.env.GYOSHU_DEBUG && console.warn(`[python-repl] Refusing to unlink non-socket file: ${socketPath}`);
    }
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code !== 'ENOENT') {
      process.env.GYOSHU_DEBUG && console.warn(`[python-repl] lstat failed for ${socketPath}: ${nodeErr.message}`);
    }
  }
}

function isSocket(filePath: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isSocket();
  } catch {
    return false;
  }
}

function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  if (process.platform === "win32") {
    try { process.kill(pid, signal); } catch {}
  } else {
    try {
      process.kill(-pid, signal);
    } catch {
      try { process.kill(pid, signal); } catch {}
    }
  }
}

function splitIntoLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  return lines.map((line, i) => (i < lines.length - 1 ? line + "\n" : line)).filter(line => line !== "");
}

function convertExecuteResultToOutputs(result: ExecuteResult): CellOutput[] {
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
    const content = await readFileNoFollow(notebookPath);
    return JSON.parse(content) as Notebook;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ELOOP") {
      return null;
    }
    throw error;
  }
}

function deriveLockIdFromPath(notebookPath: string): string {
  const basename = path.basename(notebookPath, ".ipynb");
  return basename || "unknown";
}

async function saveNotebookWithCellIds(
  notebookPath: string,
  notebook: Notebook,
  lockIdentifier?: string
): Promise<void> {
  if (!isPathContainedIn(notebookPath, getNotebookRootDir(), { useRealpath: false })) {
    throw new Error(`Security: notebookPath escapes notebooks directory: ${notebookPath}`);
  }

  try {
    const stat = await fsp.lstat(notebookPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Security: notebookPath is a symlink: ${notebookPath}`);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw e;
    }
  }

  for (let i = 0; i < notebook.cells.length; i++) {
    ensureCellId(notebook.cells[i], i, notebookPath);
  }
  notebook.nbformat = 4;
  notebook.nbformat_minor = 5;
  ensureDirSync(path.dirname(notebookPath));

  const lockId = lockIdentifier || deriveLockIdFromPath(notebookPath);
  await withLock(
    getNotebookLockPath(lockId),
    async () => await durableAtomicWrite(notebookPath, JSON.stringify(notebook, null, 2)),
    DEFAULT_LOCK_TIMEOUT_MS
  );
}

async function appendCodeCellToNotebook(
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
    const lockIdentifier = deriveLockIdFromPath(notebookPath);
    await saveNotebookWithCellIds(notebookPath, notebook!, lockIdentifier);

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

// =============================================================================
// BRIDGE MANAGEMENT
// =============================================================================

function getBridgePath(): string {
  // Navigate from src/mcp/tools to src/bridge
  return path.join(__dirname, "..", "..", "bridge", "gyoshu_bridge.py");
}

function getBridgeMetaPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), "bridge_meta.json");
}

function detectExistingPythonEnv(projectRoot: string): PythonEnvInfoLocal | null {
  const isWindows = process.platform === "win32";
  const binDir = isWindows ? "Scripts" : "bin";
  const pythonExe = isWindows ? "python.exe" : "python";
  const venvPython = path.join(projectRoot, ".venv", binDir, pythonExe);

  if (fs.existsSync(venvPython)) {
    return { pythonPath: venvPython, type: "venv" };
  }
  return null;
}

async function ensurePythonEnvironment(projectRoot: string): Promise<PythonEnvInfoLocal> {
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

async function getChildProcessStartTime(pid: number): Promise<number | undefined> {
  if (process.platform === "linux") {
    const startTime = await getProcessStartTimeLinux(pid);
    return startTime ?? undefined;
  } else if (process.platform === "darwin") {
    const startTime = await getProcessStartTimeMacOS(pid);
    return startTime ?? undefined;
  }
  return undefined;
}

async function verifyProcessIdentity(meta: BridgeMeta): Promise<boolean> {
  if (meta.processStartTime === undefined) {
    return false;
  }
  return await isProcessAliveWithStartTime(meta.pid, meta.processStartTime);
}

function readBridgeMeta(sessionId: string): BridgeMeta | null {
  const metaPath = getBridgeMetaPath(sessionId);
  try {
    if (!fs.existsSync(metaPath)) {
      return null;
    }
    const content = readFileNoFollowSync(metaPath);
    const parsed = JSON.parse(content);
    if (!isValidBridgeMeta(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

let lastWriteSkipLog = 0;
const WRITE_SKIP_LOG_INTERVAL_MS = 60000;

async function writeBridgeMeta(sessionId: string, meta: Partial<BridgeMeta>): Promise<void> {
  const metaPath = getBridgeMetaPath(sessionId);
  const lockPath = getBridgeMetaLockPath(sessionId);

  try {
    await withLock(
      lockPath,
      async () => {
        let existing: Record<string, unknown> = {};
        try {
          if (await fileExists(metaPath)) {
            const content = await readFile<Record<string, unknown>>(metaPath, true);
            existing = content || {};
          }
        } catch {
          // Intentional: parse errors result in empty merge base
        }

        const merged = { ...existing, ...meta };
        await durableAtomicWrite(metaPath, JSON.stringify(merged, null, 2));
      },
      DEFAULT_LOCK_TIMEOUT_MS
    );
  } catch {
    const now = Date.now();
    if (now - lastWriteSkipLog > WRITE_SKIP_LOG_INTERVAL_MS) {
      process.env.GYOSHU_DEBUG && console.warn(`[python-repl] bridge_meta write skipped for ${sessionId} (lock timeout)`);
      lastWriteSkipLog = now;
    }
  }
}

async function deleteBridgeMeta(sessionId: string): Promise<void> {
  const metaPath = getBridgeMetaPath(sessionId);
  const lockPath = getBridgeMetaLockPath(sessionId);

  try {
    await withLock(
      lockPath,
      async () => {
        if (fs.existsSync(metaPath)) {
          fs.unlinkSync(metaPath);
        }
      },
      DEFAULT_LOCK_TIMEOUT_MS
    );
  } catch {
    // Ignore errors during cleanup
  }
}

function ensureSessionDir(sessionId: string): void {
  ensureDirSync(getSessionDir(sessionId));
}

async function spawnBridgeServer(sessionId: string, projectDir?: string): Promise<BridgeMeta> {
  ensureSessionDir(sessionId);

  const socketPath = getBridgeSocketPath(sessionId);
  const bridgePath = getBridgePath();

  const sessionDir = getSessionDir(sessionId);
  if (isPathContainedIn(socketPath, sessionDir, { useRealpath: true })) {
    safeUnlinkSocket(socketPath);
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

  const MAX_STDERR_CHARS = 64 * 1024;
  let stderrBuffer = "";
  let stderrTruncated = false;
  proc.stderr?.on("data", (chunk: Buffer) => {
    if (stderrTruncated) return;
    const text = chunk.toString();
    if (stderrBuffer.length + text.length > MAX_STDERR_CHARS) {
      stderrBuffer = stderrBuffer.slice(0, MAX_STDERR_CHARS - 20) + "\n...[truncated]";
      stderrTruncated = true;
    } else {
      stderrBuffer += text;
    }
  });

  const startTime = Date.now();
  while (!isSocket(socketPath)) {
    if (Date.now() - startTime > BRIDGE_SPAWN_TIMEOUT_MS) {
      killProcessGroup(proc.pid!, "SIGKILL");

      if (fs.existsSync(socketPath) && !isSocket(socketPath)) {
        safeUnlinkSocket(socketPath);
      }

      throw new Error(`Bridge failed to create socket in ${BRIDGE_SPAWN_TIMEOUT_MS}ms. Stderr: ${stderrBuffer}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const processStartTime = await getChildProcessStartTime(proc.pid!);

  const meta: BridgeMeta = {
    pid: proc.pid!,
    socketPath,
    startedAt: new Date().toISOString(),
    sessionId,
    pythonEnv,
    processStartTime,
  };

  await writeBridgeMeta(sessionId, meta);

  return meta;
}

async function ensureBridge(sessionId: string, projectDir?: string): Promise<BridgeMeta> {
  const meta = readBridgeMeta(sessionId);
  const expectedSocketPath = getBridgeSocketPath(sessionId);

  if (meta) {
    if (meta.sessionId !== sessionId) {
      await deleteBridgeMeta(sessionId);
      return spawnBridgeServer(sessionId, projectDir);
    }

    if (meta.socketPath !== expectedSocketPath) {
      await deleteBridgeMeta(sessionId);
      return spawnBridgeServer(sessionId, projectDir);
    }

    const stillOurs = await verifyProcessIdentity(meta);
    if (stillOurs) {
      if (isSocket(meta.socketPath)) {
        return meta;
      } else {
        try {
          process.kill(meta.pid, "SIGKILL");
        } catch {}
      }
    }

    await deleteBridgeMeta(sessionId);
  }

  return spawnBridgeServer(sessionId, projectDir);
}

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
    const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;

    const timer = setTimeout(() => {
      timedOut = true;
      socket.destroy();
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const socket = net.createConnection({ path: socketPath }, () => {
      socket.write(request + "\n");
    });

    socket.on("data", (chunk: Buffer) => {
      responseBuffer += chunk.toString();

      if (responseBuffer.length > MAX_RESPONSE_CHARS) {
        clearTimeout(timer);
        socket.destroy();
        reject(new Error(`Response exceeded ${MAX_RESPONSE_CHARS} characters`));
        return;
      }

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

async function killBridgeWithEscalation(
  sessionId: string,
  options?: { gracePeriodMs?: number }
): Promise<EscalationResult> {
  const gracePeriod = options?.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  const sigtermGrace = Math.max(Math.floor(gracePeriod / 2), 1000);
  const startTime = Date.now();

  const meta = readBridgeMeta(sessionId);
  if (!meta) {
    return { terminatedBy: "already_dead", terminationTimeMs: 0 };
  }

  if (meta.sessionId !== sessionId) {
    process.env.GYOSHU_DEBUG && console.warn(`[python-repl] Session ID mismatch in killBridgeWithEscalation: expected ${sessionId}, got ${meta.sessionId}`);
    await deleteBridgeMeta(sessionId);
    return { terminatedBy: "already_dead", terminationTimeMs: 0 };
  }

  if (!(await verifyProcessIdentity(meta))) {
    await deleteBridgeMeta(sessionId);
    return { terminatedBy: "already_dead", terminationTimeMs: 0 };
  }

  const waitForExit = (timeoutMs: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const checkStart = Date.now();
      const check = async () => {
        const stillOurs = await verifyProcessIdentity(meta);
        if (!stillOurs) {
          resolve(true);
        } else if (Date.now() - checkStart > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  };

  let terminatedBy: EscalationResult["terminatedBy"] = "SIGINT";

  killProcessGroup(meta.pid, "SIGINT");

  if (!(await waitForExit(gracePeriod))) {
    terminatedBy = "SIGTERM";
    killProcessGroup(meta.pid, "SIGTERM");

    if (!(await waitForExit(sigtermGrace))) {
      terminatedBy = "SIGKILL";
      killProcessGroup(meta.pid, "SIGKILL");
      await waitForExit(1000);
    }
  }

  await deleteBridgeMeta(sessionId);

  const sessionDir = getSessionDir(sessionId);
  try {
    if (meta.socketPath && isPathContainedIn(meta.socketPath, sessionDir, { useRealpath: true })) {
      safeUnlinkSocket(meta.socketPath);
    }
  } catch {}

  return {
    terminatedBy,
    terminationTimeMs: Date.now() - startTime,
  };
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

// =============================================================================
// MAIN HANDLER
// =============================================================================

/**
 * Handle python_repl tool calls.
 *
 * @param args - Tool arguments
 * @returns JSON string with the result
 */
export async function handlePythonRepl(args: unknown): Promise<string> {
  const {
    action,
    researchSessionID,
    code,
    executionLabel,
    executionTimeout = DEFAULT_EXECUTION_TIMEOUT_MS,
    queueTimeout = DEFAULT_QUEUE_TIMEOUT_MS,
    projectDir,
    notebookPath,
    autoCapture = false,
    reportTitle,
    runId,
    interruptWithTimeout,
  } = args as PythonReplArgs;

  if (!researchSessionID || typeof researchSessionID !== "string") {
    return JSON.stringify({
      success: false,
      error: { code: ERROR_INVALID_ACTION, message: "researchSessionID is required" },
    });
  }

  try {
    validatePathSegment(researchSessionID, "researchSessionID");
  } catch (e) {
    return JSON.stringify({
      success: false,
      error: {
        code: ERROR_INVALID_ACTION,
        message: `Invalid researchSessionID: ${(e as Error).message}`,
      },
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
    let meta: BridgeMeta;
    try {
      meta = await ensureBridge(researchSessionID, projectDir);
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

            // Update bridge_meta with notebook path for gyoshu-snapshot to find
            if (notebookCapture.captured) {
              await writeBridgeMeta(researchSessionID, {
                notebookPath: captureNotebookPath,
                reportTitle: reportTitle || undefined,
              });
            }

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
                // Frontmatter update is best-effort
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
            await deleteBridgeMeta(researchSessionID);

            try {
              meta = await spawnBridgeServer(researchSessionID, projectDir);
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
        const gracePeriodMs = interruptWithTimeout?.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
        const preserveOutput = interruptWithTimeout?.preserveOutput ?? true;

        let partialStdout: string | undefined;
        let partialStderr: string | undefined;

        if (preserveOutput) {
          try {
            await sendSocketRequest<StateResult>(meta.socketPath, "get_state", {}, 2000);
          } catch {
            // Best-effort partial output capture
          }
        }

        try {
          const result = await sendSocketRequest<InterruptResult>(
            meta.socketPath,
            "interrupt",
            {},
            Math.min(gracePeriodMs, 5000)
          );
          return JSON.stringify({
            success: true,
            ...result,
            terminatedBy: "graceful",
            partialStdout,
            partialStderr,
          });
        } catch (e) {
          const escalationResult = await killBridgeWithEscalation(
            researchSessionID,
            { gracePeriodMs }
          );
          return JSON.stringify({
            success: true,
            status: "forced_kill",
            message: `Bridge was unresponsive, terminated by ${escalationResult.terminatedBy}`,
            terminatedBy: escalationResult.terminatedBy,
            terminationTimeMs: escalationResult.terminationTimeMs,
            partialStdout,
            partialStderr,
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
}

// =============================================================================
// EXPORTS FOR TESTING AND CLEANUP
// =============================================================================

const SESSION_DIR_PATTERN = /^[0-9a-f]{12}$/;

function getBridgeMetaPathByShortId(shortId: string): string {
  return path.join(getSessionDirByShortId(shortId), "bridge_meta.json");
}

function readBridgeMetaByShortId(shortId: string): BridgeMeta | null {
  const metaPath = getBridgeMetaPathByShortId(shortId);
  try {
    if (!fs.existsSync(metaPath)) {
      return null;
    }
    const content = readFileNoFollowSync(metaPath);
    const parsed = JSON.parse(content);
    if (!isValidBridgeMeta(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function deleteBridgeMetaByShortId(shortId: string): Promise<void> {
  const metaPath = getBridgeMetaPathByShortId(shortId);
  const lockPath = getBridgeMetaLockPathByShortId(shortId);

  try {
    await withLock(
      lockPath,
      async () => {
        if (fs.existsSync(metaPath)) {
          fs.unlinkSync(metaPath);
        }
      },
      DEFAULT_LOCK_TIMEOUT_MS
    );
  } catch {
    // Ignore errors during cleanup
  }
}

async function killBridgeByShortId(
  shortId: string,
  options?: { gracePeriodMs?: number }
): Promise<EscalationResult> {
  const gracePeriod = options?.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  const sigtermGrace = Math.max(Math.floor(gracePeriod / 2), 1000);
  const startTime = Date.now();

  const meta = readBridgeMetaByShortId(shortId);
  if (!meta) {
    return { terminatedBy: "already_dead", terminationTimeMs: 0 };
  }

  if (shortenSessionId(meta.sessionId) !== shortId) {
    process.env.GYOSHU_DEBUG && console.warn(`[python-repl] Binding mismatch in killBridgeByShortId: expected ${shortId}, got ${shortenSessionId(meta.sessionId)}`);
    await deleteBridgeMetaByShortId(shortId);
    return { terminatedBy: "already_dead", terminationTimeMs: 0 };
  }

  if (!(await verifyProcessIdentity(meta))) {
    await deleteBridgeMetaByShortId(shortId);
    return { terminatedBy: "already_dead", terminationTimeMs: 0 };
  }

  const waitForExit = (timeoutMs: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const checkStart = Date.now();
      const check = async () => {
        const stillOurs = await verifyProcessIdentity(meta);
        if (!stillOurs) {
          resolve(true);
        } else if (Date.now() - checkStart > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  };

  let terminatedBy: EscalationResult["terminatedBy"] = "SIGINT";

  killProcessGroup(meta.pid, "SIGINT");

  if (!(await waitForExit(gracePeriod))) {
    terminatedBy = "SIGTERM";
    killProcessGroup(meta.pid, "SIGTERM");

    if (!(await waitForExit(sigtermGrace))) {
      terminatedBy = "SIGKILL";
      killProcessGroup(meta.pid, "SIGKILL");
      await waitForExit(1000);
    }
  }

  await deleteBridgeMetaByShortId(shortId);

  const sessionDir = getSessionDirByShortId(shortId);
  try {
    if (meta.socketPath && isPathContainedIn(meta.socketPath, sessionDir, { useRealpath: true })) {
      safeUnlinkSocket(meta.socketPath);
    }
  } catch {}

  return {
    terminatedBy,
    terminationTimeMs: Date.now() - startTime,
  };
}

/**
 * Cleanup all bridge servers. Used by gyoshu-hooks.ts.
 */
export async function cleanupAllBridges(): Promise<void> {
  const runtimeDir = getRuntimeDir();

  if (!fs.existsSync(runtimeDir)) {
    return;
  }

  const entries = fs.readdirSync(runtimeDir, { withFileTypes: true });
  const validSessionDirs = entries.filter(
    (entry) => entry.isDirectory() && SESSION_DIR_PATTERN.test(entry.name)
  );

  for (const entry of validSessionDirs) {
    try {
      await killBridgeByShortId(entry.name);
    } catch {
      // Ignore errors during cleanup
    }
  }
}

/**
 * Kill a specific session's bridge server.
 */
export async function killSessionBridge(
  sessionId: string,
  options?: { gracePeriodMs?: number }
): Promise<EscalationResult> {
  return killBridgeWithEscalation(sessionId, options);
}

/**
 * Reset the execution counter for a session.
 */
export function resetExecutionCounter(sessionId: string): void {
  executionCounters.delete(sessionId);
}

/**
 * Get the current execution count for a session.
 */
export function getExecutionCount(sessionId: string): number {
  return executionCounters.get(sessionId) || 0;
}

export { EscalationResult };
export const ESCALATION_DEFAULTS = {
  gracePeriodMs: DEFAULT_GRACE_PERIOD_MS,
  sigtermGraceMs: DEFAULT_SIGTERM_GRACE_MS,
} as const;
