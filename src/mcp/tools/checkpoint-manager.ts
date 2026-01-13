/**
 * Checkpoint Manager MCP Tool - Manages checkpoints for Gyoshu research resume capability
 *
 * Provides CRUD operations for checkpoint manifests with:
 * - Atomic, durable writes via durableAtomicWrite
 * - SHA256 integrity verification for manifests and artifacts
 * - Automatic rehydration cell generation for resume
 * - Checkpoint pruning to manage storage
 *
 * Storage Structure:
 * ```
 * reports/{reportTitle}/checkpoints/{runId}/
 * └── {checkpointId}/
 *     └── checkpoint.json    # CheckpointManifest
 * ```
 *
 * @see docs/stage-protocol.md for checkpoint protocol specification
 * @see src/lib/checkpoint-schema.ts for manifest schema
 * @module mcp/tools/checkpoint-manager
 */

import * as fs from "fs/promises";
import { constants as fsConstants } from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { durableAtomicWrite, readFileNoFollow } from "../../lib/atomic-write.js";
import {
  getCheckpointDir,
  getCheckpointManifestPath,
  getNotebookPath,
  getNotebookRootDir,
  getReportsRootDir,
  ensureDirSync,
  validatePathSegment,
} from "../../lib/paths.js";
import { isPathContainedIn } from "../../lib/path-security.js";
import { getNotebookLockPath, DEFAULT_LOCK_TIMEOUT_MS } from "../../lib/lock-paths.js";
import { withLock } from "../../lib/session-lock.js";
import { validateArtifactPath } from "../../lib/artifact-security.js";
import { openNoFollow } from "../../lib/atomic-write.js";
import {
  CheckpointManifest,
  CheckpointStatus,
  EmergencyReason,
  ArtifactEntry,
  PythonEnvMetadata,
  RehydrationMode,
  TrustLevel,
  validateCheckpointManifest,
} from "../../lib/checkpoint-schema.js";
import type { Notebook, NotebookCell } from "../../lib/cell-identity.js";

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default number of checkpoints to keep when pruning */
const DEFAULT_KEEP_COUNT = 5;

/** Tag applied to checkpoint cells in notebooks */
const CHECKPOINT_CELL_TAG = "gyoshu-checkpoint";

/** Session-scoped stage ID counters for deterministic normalization */
const stageIdCounters = new Map<string, number>();

/**
 * Normalize a stage ID to match the required format S{NN}_{verb}_{noun}.
 * If already in correct format, returns as-is.
 * Otherwise, auto-generates a compliant stage ID using a session-scoped counter.
 *
 * @param stageId - Input stage ID (e.g., "data-loading" or "S01_load_data")
 * @param sessionId - Session ID for scoped counter (optional, uses hash-based if not provided)
 * @returns Normalized stage ID in S{NN}_{verb}_{noun} format
 */
function normalizeStageId(stageId: string, sessionId?: string): string {
  // Check if already in correct format
  const validPattern = /^S[0-9]{2}_[a-z]+_[a-z_]+$/;
  if (validPattern.test(stageId)) {
    return stageId;
  }

  // Convert input to snake_case for the noun part
  const normalized = stageId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_") // Replace non-alphanumeric with underscore
    .replace(/^_+|_+$/g, "")     // Trim leading/trailing underscores
    .replace(/_+/g, "_");        // Collapse multiple underscores

  // Split into verb and noun parts, defaulting to "run" as verb
  const parts = normalized.split("_").filter(Boolean);
  const verb = parts.length > 1 ? parts[0] : "run";
  const noun = parts.length > 1 ? parts.slice(1).join("_") : (parts[0] || "stage");

  // Get session-scoped counter or use hash-based fallback
  let stageNum: string;
  if (sessionId) {
    const currentCount = stageIdCounters.get(sessionId) || 0;
    stageIdCounters.set(sessionId, currentCount + 1);
    stageNum = String(currentCount + 1).padStart(2, "0");
  } else {
    // Hash-based fallback for deterministic output without session
    const hash = crypto.createHash("md5").update(stageId).digest("hex");
    stageNum = String(parseInt(hash.slice(0, 4), 16) % 100).padStart(2, "0");
  }

  return `S${stageNum}_${verb}_${noun}`;
}

// =============================================================================
// MCP TOOL DEFINITION
// =============================================================================

/**
 * MCP tool definition for checkpoint-manager.
 * Follows the MCP JSON Schema format for tool definitions.
 */
export const checkpointManagerTool = {
  name: "checkpoint_manager",
  description:
    "Manage checkpoints for research resume capability. " +
    "Actions: save (create checkpoint), list (find checkpoints), " +
    "validate (verify integrity), resume (find last valid + generate rehydration), " +
    "prune (keep last K checkpoints), emergency (fast checkpoint for watchdog/abort).",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["save", "list", "validate", "resume", "prune", "emergency"],
        description:
          "Operation to perform: " +
          "save=create new checkpoint, " +
          "list=find checkpoints for reportTitle/runId, " +
          "validate=verify artifact integrity, " +
          "resume=find last valid checkpoint and generate rehydration code, " +
          "prune=keep last K checkpoints, " +
          "emergency=fast checkpoint for watchdog/abort (skips artifact validation)",
      },
      reportTitle: {
        type: "string",
        description: "Report/research title (required for all actions)",
      },
      runId: {
        type: "string",
        description: "Run identifier (required for save/validate, optional for list/resume/prune)",
      },
      checkpointId: {
        type: "string",
        description: "Checkpoint identifier (required for save/validate)",
      },
      researchSessionID: {
        type: "string",
        description: "Research session ID (required for save)",
      },
      stageId: {
        type: "string",
        description: "Stage ID this checkpoint was created after, e.g. S01_load_data (required for save)",
      },
      status: {
        type: "string",
        enum: ["saved", "interrupted", "emergency"],
        description: "Checkpoint status (default: saved)",
      },
      reason: {
        type: "string",
        enum: ["timeout", "abort", "error"],
        description: "Reason for emergency checkpoint (required when status=emergency)",
      },
      trustLevel: {
        type: "string",
        enum: ["local", "imported", "untrusted"],
        description: "Trust level for checkpoint (default: local)",
      },
      executionCount: {
        type: "number",
        description: "REPL execution count at checkpoint time",
      },
      notebookPathOverride: {
        type: "string",
        description: "Override notebook path (defaults to notebooks/{reportTitle}.ipynb)",
      },
      pythonEnv: {
        type: "object",
        properties: {
          pythonPath: { type: "string" },
          packages: { type: "array", items: { type: "string" } },
          platform: { type: "string" },
          randomSeeds: {
            type: "object",
            additionalProperties: { type: "number" },
          },
        },
        description: "Python environment metadata for reproducibility",
      },
      artifacts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            relativePath: { type: "string" },
            sha256: { type: "string" },
            sizeBytes: { type: "number" },
          },
          required: ["relativePath", "sha256", "sizeBytes"],
        },
        description: "Array of artifact entries with paths and integrity hashes",
      },
      rehydrationMode: {
        type: "string",
        enum: ["artifacts_only", "with_vars"],
        description: "Rehydration mode (default: artifacts_only)",
      },
      rehydrationSource: {
        type: "array",
        items: { type: "string" },
        description: "Custom rehydration cell source lines (auto-generated if not provided)",
      },
      keepCount: {
        type: "number",
        description: "Number of checkpoints to keep when pruning (default: 5)",
      },
    },
    required: ["action", "reportTitle"],
  },
};

// =============================================================================
// TYPES
// =============================================================================

interface CheckpointManagerArgs {
  action: "save" | "list" | "validate" | "resume" | "prune" | "emergency";
  reportTitle: string;
  runId?: string;
  checkpointId?: string;
  researchSessionID?: string;
  stageId?: string;
  status?: "saved" | "interrupted" | "emergency";
  reason?: "timeout" | "abort" | "error";
  trustLevel?: "local" | "imported" | "untrusted";
  executionCount?: number;
  notebookPathOverride?: string;
  pythonEnv?: {
    pythonPath: string;
    packages: string[];
    platform: string;
    randomSeeds?: Record<string, number>;
  };
  artifacts?: Array<{
    relativePath: string;
    sha256: string;
    sizeBytes: number;
  }>;
  rehydrationMode?: "artifacts_only" | "with_vars";
  rehydrationSource?: string[];
  keepCount?: number;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate SHA256 hash of a string.
 *
 * @param content - String content to hash
 * @returns Lowercase hex SHA256 hash
 */
function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Escape special characters for use in Python string literals.
 */
function escapePythonString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

const PYTHON_KEYWORDS = new Set([
  "and", "as", "assert", "break", "class", "continue", "def", "del",
  "elif", "else", "except", "finally", "for", "from", "global", "if",
  "import", "in", "is", "lambda", "not", "or", "pass", "raise", "return",
  "try", "while", "with", "yield", "None", "True", "False", "async", "await"
]);

/**
 * Convert a filename to a valid Python identifier.
 */
function toValidPythonIdentifier(name: string): string {
  let varName = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (/^[0-9]/.test(varName)) {
    varName = "_" + varName;
  }
  if (PYTHON_KEYWORDS.has(varName.toLowerCase()) || PYTHON_KEYWORDS.has(varName)) {
    varName = varName + "_var";
  }
  return varName || "_artifact";
}

/**
 * Calculate manifest SHA256 by hashing manifest without the manifestSha256 field.
 *
 * @param manifest - The checkpoint manifest (without manifestSha256)
 * @returns SHA256 hash of the manifest content
 */
function calculateManifestSha256(
  manifest: Omit<CheckpointManifest, "manifestSha256">
): string {
  const content = JSON.stringify(manifest, null, 2);
  return sha256(content);
}

/**
 * Generate a unique cell ID for checkpoint cells.
 *
 * @returns A unique cell ID string
 */
function generateCheckpointCellId(): string {
  return `ckpt-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Read a Jupyter notebook from disk.
 * Security: Uses O_NOFOLLOW to atomically reject symlinks (no TOCTOU race)
 *
 * @param notebookPath - Path to the .ipynb file
 * @returns Parsed notebook or null if not found
 */
async function readNotebook(notebookPath: string): Promise<Notebook | null> {
  try {
    const content = await readFileNoFollow(notebookPath);
    return JSON.parse(content) as Notebook;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT" || err.code === "ELOOP") {
      return null;
    }
    throw error;
  }
}

/**
 * Write a notebook to disk atomically.
 *
 * @param notebookPath - Path to write the notebook
 * @param notebook - The notebook object to write
 */
async function writeNotebook(
  notebookPath: string,
  notebook: Notebook
): Promise<void> {
  await durableAtomicWrite(notebookPath, JSON.stringify(notebook, null, 2));
}

/**
 * Create a checkpoint marker cell for the notebook.
 *
 * @param checkpointId - The checkpoint identifier
 * @param stageId - The stage this checkpoint was created after
 * @param manifestPath - Path to the checkpoint manifest
 * @returns A notebook cell with checkpoint marker
 */
function createCheckpointCell(
  checkpointId: string,
  stageId: string,
  manifestPath: string
): NotebookCell {
  const cellId = generateCheckpointCellId();
  const timestamp = new Date().toISOString();

  return {
    cell_type: "code",
    id: cellId,
    source: [
      `# [CHECKPOINT:saved:id=${checkpointId}:stage=${stageId}:manifest=${manifestPath}]\n`,
      `# Checkpoint created at ${timestamp}\n`,
      `print("[CHECKPOINT:saved:id=${checkpointId}:stage=${stageId}]")\n`,
    ],
    metadata: {
      tags: [CHECKPOINT_CELL_TAG],
      gyoshu: {
        type: "checkpoint",
        checkpointId,
        stageId,
        createdAt: timestamp,
      },
    },
    execution_count: null,
    outputs: [],
  };
}

/**
 * Append a checkpoint cell to a notebook.
 *
 * @param notebookPath - Path to the notebook
 * @param checkpointId - The checkpoint identifier
 * @param stageId - The stage this checkpoint was created after
 * @param manifestPath - Path to the checkpoint manifest
 * @returns The cell ID of the appended cell
 */
async function appendCheckpointCell(
  notebookPath: string,
  checkpointId: string,
  stageId: string,
  manifestPath: string
): Promise<string> {
  let notebook = await readNotebook(notebookPath);

  if (!notebook) {
    // Create a minimal notebook if it doesn't exist
    notebook = {
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
      },
      nbformat: 4,
      nbformat_minor: 5,
    };
  }

  const cell = createCheckpointCell(checkpointId, stageId, manifestPath);
  notebook.cells.push(cell);

  await writeNotebook(notebookPath, notebook);

  return cell.id!;
}

/**
 * List all checkpoint IDs in a checkpoint directory.
 *
 * @param checkpointDir - Path to the checkpoints directory for a run
 * @returns Array of checkpoint IDs
 */
async function listCheckpointIds(checkpointDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(checkpointDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Load a checkpoint manifest from disk.
 * Security: Uses O_NOFOLLOW to atomically reject symlinks (no TOCTOU race).
 *
 * @param manifestPath - Path to the checkpoint.json file
 * @returns The parsed manifest or null if not found/invalid
 */
async function loadManifest(
  manifestPath: string
): Promise<CheckpointManifest | null> {
  try {
    // Security: readFileNoFollow uses O_NOFOLLOW to atomically reject symlinks
    const content = await readFileNoFollow(manifestPath);
    const manifest = JSON.parse(content);

    const validation = validateCheckpointManifest(manifest);
    if (!validation.success) {
      process.env.GYOSHU_DEBUG && console.warn(`Invalid manifest at ${manifestPath}:`, validation.error);
      return null;
    }

    return manifest as CheckpointManifest;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    // ELOOP means symlink was rejected by O_NOFOLLOW
    if (err.code === "ELOOP") {
      process.env.GYOSHU_DEBUG && console.warn(`Security: checkpoint manifest is a symlink, rejecting: ${manifestPath}`);
      return null;
    }
    process.env.GYOSHU_DEBUG && console.warn(`Error loading manifest at ${manifestPath}:`, error);
    return null;
  }
}

async function validateParentDirectories(
  relativePath: string,
  projectRoot: string
): Promise<{ valid: boolean; issue?: string }> {
  const segments = path.normalize(relativePath).split(path.sep);
  let currentPath = projectRoot;

  for (let i = 0; i < segments.length - 1; i++) {
    currentPath = path.join(currentPath, segments[i]);
    try {
      const stats = await fs.lstat(currentPath);
      if (stats.isSymbolicLink()) {
        return {
          valid: false,
          issue: `Parent directory is a symlink: ${segments.slice(0, i + 1).join(path.sep)}`,
        };
      }
    } catch (err) {
      return {
        valid: false,
        issue: `Cannot verify parent directory: ${(err as Error).message}`,
      };
    }
  }

  return { valid: true };
}

async function validateArtifact(
  artifact: ArtifactEntry,
  projectRoot: string,
  trustLevel: TrustLevel = "local"
): Promise<{ valid: boolean; issue?: string }> {
  if (trustLevel === "untrusted" || trustLevel === "imported") {
    const parentCheck = await validateParentDirectories(artifact.relativePath, projectRoot);
    if (!parentCheck.valid) {
      return parentCheck;
    }
  }

  let artifactPath: string;
  try {
    artifactPath = validateArtifactPath(artifact.relativePath, projectRoot);
  } catch (error) {
    return {
      valid: false,
      issue: (error as Error).message,
    };
  }

  let fd: fs.FileHandle | undefined;
  try {
    fd = await openNoFollow(artifactPath, fsConstants.O_RDONLY);

    // Security: Verify realpath containment to prevent symlinked parent directory escape
    // This check applies to ALL trust levels (including local) because a symlinked parent
    // directory could allow reading files outside the intended artifact root
    const artifactRealPath = await fs.realpath(artifactPath);
    if (!isPathContainedIn(artifactRealPath, projectRoot, { useRealpath: false })) {
      await fd.close();
      return {
        valid: false,
        issue: `Security: artifact escapes project root via symlinked parent: ${artifact.relativePath}`,
      };
    }

    const stats = await fd.stat();
    if (stats.size !== artifact.sizeBytes) {
      await fd.close();
      return {
        valid: false,
        issue: `Size mismatch for ${artifact.relativePath}: expected ${artifact.sizeBytes}, got ${stats.size}`,
      };
    }

    const hash = crypto.createHash("sha256");
    const stream = fd.createReadStream();

    const computedHash = await new Promise<string>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });

    await fd.close();

    if (computedHash.toLowerCase() !== artifact.sha256.toLowerCase()) {
      return {
        valid: false,
        issue: `SHA256 mismatch for ${artifact.relativePath}: expected ${artifact.sha256}, got ${computedHash}`,
      };
    }

    return { valid: true };
  } catch (error) {
    if (fd) await fd.close().catch(() => {});
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return {
        valid: false,
        issue: `Artifact not found: ${artifact.relativePath}`,
      };
    }
    if (err.code === 'ELOOP') {
      return {
        valid: false,
        issue: `Artifact is a symlink (not allowed): ${artifact.relativePath}`,
      };
    }
    return {
      valid: false,
      issue: `Cannot validate artifact: ${artifact.relativePath}: ${err.message}`,
    };
  }
}

/**
 * Generate rehydration code for loading artifacts.
 *
 * @param artifacts - Array of artifact entries
 * @param mode - Rehydration mode (artifacts_only or with_vars)
 * @param checkpointId - The checkpoint ID for the REHYDRATED marker
 * @param randomSeeds - Optional map of random seeds to restore (e.g., {"random": 42, "numpy": 123})
 * @returns Array of Python code lines for rehydration
 */
function generateRehydrationCode(
  artifacts: ArtifactEntry[],
  mode: RehydrationMode,
  checkpointId: string,
  randomSeeds?: Record<string, number>
): string[] {
  const lines: string[] = [
    "# Rehydration cell - auto-generated by checkpoint-manager",
    "# Load artifacts from checkpoint",
    "",
  ];

  // Group artifacts by type for imports
  const hasParquet = artifacts.some((a) => a.relativePath.endsWith(".parquet"));
  const hasPickle = artifacts.some(
    (a) =>
      a.relativePath.endsWith(".pkl") || a.relativePath.endsWith(".pickle")
  );
  const hasJoblib = artifacts.some((a) => a.relativePath.endsWith(".joblib"));
  const hasCsv = artifacts.some((a) => a.relativePath.endsWith(".csv"));
  const hasJson = artifacts.some((a) => a.relativePath.endsWith(".json"));

  // Check for random seeds to restore
  const hasRandomSeed = randomSeeds && randomSeeds["random"] !== undefined;
  const hasNumpySeed = randomSeeds && randomSeeds["numpy"] !== undefined;

  // Add imports
  if (hasParquet || hasCsv) {
    lines.push("import pandas as pd");
  }
  if (hasPickle) {
    lines.push("import pickle");
  }
  if (hasJoblib) {
    lines.push("import joblib");
  }
  if (hasJson) {
    lines.push("import json");
  }
  if (hasRandomSeed) {
    lines.push("import random");
  }
  if (hasNumpySeed) {
    lines.push("import numpy as np");
  }
  lines.push("");

  // Generate random seed restoration code
  if (hasRandomSeed || hasNumpySeed) {
    lines.push("# Restore random seeds for reproducibility");
    if (hasRandomSeed) {
      lines.push(`random.seed(${randomSeeds!["random"]})`);
    }
    if (hasNumpySeed) {
      lines.push(`np.random.seed(${randomSeeds!["numpy"]})`);
    }
    lines.push("");
  }

  // Generate load code for each artifact
  for (const artifact of artifacts) {
    const baseName = path.basename(artifact.relativePath, path.extname(artifact.relativePath));
    const varName = toValidPythonIdentifier(baseName);
    const escapedPath = escapePythonString(artifact.relativePath);

    if (artifact.relativePath.endsWith(".parquet")) {
      lines.push(`${varName} = pd.read_parquet("${escapedPath}")`);
    } else if (artifact.relativePath.endsWith(".csv")) {
      lines.push(`${varName} = pd.read_csv("${escapedPath}")`);
    } else if (
      artifact.relativePath.endsWith(".pkl") ||
      artifact.relativePath.endsWith(".pickle")
    ) {
      lines.push(`with open("${escapedPath}", "rb") as f:`);
      lines.push(`    ${varName} = pickle.load(f)`);
    } else if (artifact.relativePath.endsWith(".joblib")) {
      lines.push(`${varName} = joblib.load("${escapedPath}")`);
    } else if (artifact.relativePath.endsWith(".json")) {
      lines.push(`with open("${escapedPath}", "r") as f:`);
      lines.push(`    ${varName} = json.load(f)`);
    } else {
      lines.push(`# TODO: Load ${escapedPath} manually`);
    }
  }

  lines.push("");
  lines.push(`print("[REHYDRATED:from=${escapePythonString(checkpointId)}]")`);

  return lines;
}

/**
 * Infer the next stage ID from the current stage ID.
 * Increments the stage number (e.g., S01_load_data -> S02_*)
 *
 * @param currentStageId - The current stage ID
 * @returns The inferred next stage ID prefix
 */
function inferNextStageId(currentStageId: string): string {
  const match = currentStageId.match(/^S(\d{2})_/);
  if (match) {
    const nextNum = parseInt(match[1], 10) + 1;
    return `S${nextNum.toString().padStart(2, "0")}_`;
  }
  return "S??_";
}

// =============================================================================
// MCP HANDLER
// =============================================================================

/**
 * Handle MCP tool calls for checkpoint-manager.
 *
 * @param args - The arguments passed to the tool
 * @returns The result as a JSON string
 */
export async function handleCheckpointManager(args: unknown): Promise<string> {
  const typedArgs = args as CheckpointManagerArgs;
  const { action, reportTitle, runId, checkpointId } = typedArgs;

  // Validate reportTitle for all actions
  if (!reportTitle) {
    throw new Error("reportTitle is required for all checkpoint operations");
  }
  validatePathSegment(reportTitle, "reportTitle");

  // Get project root (current working directory)
  const projectRoot = process.cwd();

  switch (action) {
    // =========================================================================
    // SAVE ACTION - Create a new checkpoint
    // =========================================================================
    case "save": {
      if (!runId) {
        throw new Error("runId is required for save action");
      }
      if (!checkpointId) {
        throw new Error("checkpointId is required for save action");
      }
      if (!typedArgs.stageId) {
        throw new Error("stageId is required for save action");
      }
      if (!typedArgs.researchSessionID) {
        throw new Error("researchSessionID is required for save action");
      }

      validatePathSegment(runId, "runId");
      validatePathSegment(checkpointId, "checkpointId");

      const status: CheckpointStatus = typedArgs.status || "saved";

      // Validate emergency checkpoints have a reason
      if (status === "emergency" && !typedArgs.reason) {
        throw new Error("reason is required for emergency checkpoints");
      }

      // Determine notebook path
      const notebookPath =
        typedArgs.notebookPathOverride || getNotebookPath(reportTitle);

      // Validate notebookPathOverride if provided (security: containment + symlink check)
      if (typedArgs.notebookPathOverride) {
        const resolvedNotebookPath = path.resolve(typedArgs.notebookPathOverride);
        // Check containment within notebooks directory
        if (!isPathContainedIn(resolvedNotebookPath, getNotebookRootDir())) {
          throw new Error(
            `notebookPathOverride must be within notebooks directory: ${resolvedNotebookPath}`
          );
        }
        // Check for symlink if path exists
        try {
          const stat = await fs.lstat(resolvedNotebookPath);
          if (stat.isSymbolicLink()) {
            throw new Error(
              `notebookPathOverride cannot be a symlink: ${resolvedNotebookPath}`
            );
          }
        } catch (err) {
          // ENOENT is OK - notebook may not exist yet and will be created
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw err;
          }
        }
      }

      // Create checkpoint directory
      const manifestPath = getCheckpointManifestPath(
        reportTitle,
        runId,
        checkpointId
      );
      const checkpointDir = path.dirname(manifestPath);
      ensureDirSync(checkpointDir);

      // Build artifacts array
      const artifacts: ArtifactEntry[] = typedArgs.artifacts || [];

      // Build python env metadata with sensible defaults
      const pythonEnv: PythonEnvMetadata = typedArgs.pythonEnv || {
        pythonPath: process.env.PYTHON_PATH || "/usr/bin/python3",
        packages: [],
        platform: process.platform,
      };

      // Build rehydration config
      const rehydrationMode: RehydrationMode =
        typedArgs.rehydrationMode || "artifacts_only";
      const rehydrationCellSource =
        typedArgs.rehydrationSource ||
        generateRehydrationCode(artifacts, rehydrationMode, checkpointId, pythonEnv.randomSeeds);

      // Normalize stageId to required format
      const normalizedStageId = normalizeStageId(typedArgs.stageId, typedArgs.researchSessionID);

      // Build manifest without sha256 first
      const manifestBase: Omit<CheckpointManifest, "manifestSha256"> = {
        checkpointId,
        researchSessionID: typedArgs.researchSessionID,
        reportTitle,
        runId,
        stageId: normalizedStageId,
        status,
        ...(status === "emergency" && typedArgs.reason
          ? { reason: typedArgs.reason as EmergencyReason }
          : {}),
        trustLevel: (typedArgs.trustLevel as TrustLevel) || "local",
        createdAt: new Date().toISOString(),
        executionCount: typedArgs.executionCount || 0,
        notebook: {
          path: path.relative(projectRoot, notebookPath),
          checkpointCellId: `ckpt-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`, // Placeholder, updated after cell append
        },
        pythonEnv,
        artifacts,
        rehydration: {
          mode: rehydrationMode,
          rehydrationCellSource,
        },
      };

      // Calculate manifest SHA256
      const manifestSha256 = calculateManifestSha256(manifestBase);

      // Complete manifest
      const manifest: CheckpointManifest = {
        ...manifestBase,
        manifestSha256,
      };

      // Append checkpoint cell and write manifest atomically under notebook lock
      // This prevents concurrent checkpoint writes from corrupting the notebook
      const cellId = await withLock(
        getNotebookLockPath(reportTitle),
        async () => {
          // Append checkpoint cell to notebook and get cell ID
          const id = await appendCheckpointCell(
            notebookPath,
            checkpointId,
            typedArgs.stageId!,
            path.relative(projectRoot, manifestPath)
          );

          // Update manifest with cell ID
          manifest.notebook.checkpointCellId = id;

          // Recalculate SHA256 with updated cell ID
          const finalManifestBase: Omit<CheckpointManifest, "manifestSha256"> = {
            ...manifest,
          };
          delete (finalManifestBase as any).manifestSha256;
          manifest.manifestSha256 = calculateManifestSha256(finalManifestBase);

          // Write manifest atomically
          await durableAtomicWrite(manifestPath, JSON.stringify(manifest, null, 2));

          return id;
        },
        DEFAULT_LOCK_TIMEOUT_MS
      );

      return JSON.stringify(
        {
          success: true,
          action: "save",
          checkpointId,
          reportTitle,
          runId,
          stageId: normalizedStageId,
          status,
          manifestPath: path.relative(projectRoot, manifestPath),
          notebookPath: path.relative(projectRoot, notebookPath),
          checkpointCellId: cellId,
          artifactCount: artifacts.length,
          manifestSha256: manifest.manifestSha256,
        },
        null,
        2
      );
    }

    // =========================================================================
    // LIST ACTION - Find checkpoints for reportTitle/runId
    // =========================================================================
    case "list": {
      interface CheckpointSummary {
        checkpointId: string;
        runId: string;
        stageId: string;
        status: CheckpointStatus;
        createdAt: string;
        artifactCount: number;
      }

      const checkpoints: CheckpointSummary[] = [];

      if (runId) {
        // List checkpoints for specific run
        validatePathSegment(runId, "runId");
        const checkpointDir = getCheckpointDir(reportTitle, runId);
        const checkpointIds = await listCheckpointIds(checkpointDir);

        for (const ckptId of checkpointIds) {
          const manifestPath = getCheckpointManifestPath(
            reportTitle,
            runId,
            ckptId
          );
          const manifest = await loadManifest(manifestPath);
          if (manifest) {
            checkpoints.push({
              checkpointId: manifest.checkpointId,
              runId: manifest.runId,
              stageId: manifest.stageId,
              status: manifest.status,
              createdAt: manifest.createdAt,
              artifactCount: manifest.artifacts.length,
            });
          }
        }
      } else {
        // List all checkpoints across all runs
        const reportDir = path.join(projectRoot, "reports", reportTitle, "checkpoints");
        let runIds: string[] = [];

        try {
          const entries = await fs.readdir(reportDir, { withFileTypes: true });
          runIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }

        for (const rid of runIds) {
          const checkpointDir = getCheckpointDir(reportTitle, rid);
          const checkpointIds = await listCheckpointIds(checkpointDir);

          for (const ckptId of checkpointIds) {
            const manifestPath = getCheckpointManifestPath(
              reportTitle,
              rid,
              ckptId
            );
            const manifest = await loadManifest(manifestPath);
            if (manifest) {
              checkpoints.push({
                checkpointId: manifest.checkpointId,
                runId: manifest.runId,
                stageId: manifest.stageId,
                status: manifest.status,
                createdAt: manifest.createdAt,
                artifactCount: manifest.artifacts.length,
              });
            }
          }
        }
      }

      // Sort by createdAt descending (newest first)
      checkpoints.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      return JSON.stringify(
        {
          success: true,
          action: "list",
          reportTitle,
          runId: runId || null,
          checkpoints,
          count: checkpoints.length,
        },
        null,
        2
      );
    }

    // =========================================================================
    // VALIDATE ACTION - Verify checkpoint integrity
    // =========================================================================
    case "validate": {
      if (!runId) {
        throw new Error("runId is required for validate action");
      }
      if (!checkpointId) {
        throw new Error("checkpointId is required for validate action");
      }

      validatePathSegment(runId, "runId");
      validatePathSegment(checkpointId, "checkpointId");

      const manifestPath = getCheckpointManifestPath(
        reportTitle,
        runId,
        checkpointId
      );

      try {
        await fs.access(manifestPath);
      } catch {
        return JSON.stringify(
          {
            success: true,
            action: "validate",
            valid: false,
            checkpointId,
            reportTitle,
            runId,
            issues: [`Manifest not found: ${manifestPath}`],
          },
          null,
          2
        );
      }

      // Load and validate manifest
      const manifest = await loadManifest(manifestPath);
      if (!manifest) {
        return JSON.stringify(
          {
            success: true,
            action: "validate",
            valid: false,
            checkpointId,
            reportTitle,
            runId,
            issues: ["Manifest failed to parse or validate"],
          },
          null,
          2
        );
      }

      // Verify manifest SHA256
      const manifestBase: Omit<CheckpointManifest, "manifestSha256"> = {
        ...manifest,
      };
      delete (manifestBase as any).manifestSha256;
      const expectedSha256 = calculateManifestSha256(manifestBase);

      const issues: string[] = [];

      if (expectedSha256 !== manifest.manifestSha256) {
        issues.push(
          `Manifest SHA256 mismatch: expected ${expectedSha256}, got ${manifest.manifestSha256}`
        );
      }

      // Validate each artifact
      const trustLevel = manifest.trustLevel || "local";
      for (const artifact of manifest.artifacts) {
        const result = await validateArtifact(artifact, projectRoot, trustLevel);
        if (!result.valid && result.issue) {
          issues.push(result.issue);
        }
      }

      return JSON.stringify(
        {
          success: true,
          action: "validate",
          valid: issues.length === 0,
          checkpointId,
          reportTitle,
          runId,
          stageId: manifest.stageId,
          status: manifest.status,
          createdAt: manifest.createdAt,
          artifactCount: manifest.artifacts.length,
          issues,
        },
        null,
        2
      );
    }

    // =========================================================================
    // RESUME ACTION - Find last valid checkpoint and generate rehydration
    // =========================================================================
    case "resume": {
      interface ResumeResult {
        success: boolean;
        action: "resume";
        found: boolean;
        reportTitle: string;
        runId?: string;
        checkpoint?: {
          checkpointId: string;
          runId: string;
          stageId: string;
          status: CheckpointStatus;
          createdAt: string;
          artifactCount: number;
        };
        rehydrationCells?: string[];
        nextStageId?: string;
        validationIssues?: string[];
        searchedCount?: number;
        trustWarning?: string;
      }

      // Collect all checkpoints
      const allCheckpoints: {
        manifest: CheckpointManifest;
        manifestPath: string;
      }[] = [];

      if (runId) {
        validatePathSegment(runId, "runId");
        const checkpointDir = getCheckpointDir(reportTitle, runId);
        const checkpointIds = await listCheckpointIds(checkpointDir);

        for (const ckptId of checkpointIds) {
          const manifestPath = getCheckpointManifestPath(
            reportTitle,
            runId,
            ckptId
          );
          const manifest = await loadManifest(manifestPath);
          if (manifest) {
            allCheckpoints.push({ manifest, manifestPath });
          }
        }
      } else {
        // Search all runs
        const reportDir = path.join(projectRoot, "reports", reportTitle, "checkpoints");
        let runIds: string[] = [];

        try {
          const entries = await fs.readdir(reportDir, { withFileTypes: true });
          runIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }

        for (const rid of runIds) {
          const checkpointDir = getCheckpointDir(reportTitle, rid);
          const checkpointIds = await listCheckpointIds(checkpointDir);

          for (const ckptId of checkpointIds) {
            const manifestPath = getCheckpointManifestPath(
              reportTitle,
              rid,
              ckptId
            );
            const manifest = await loadManifest(manifestPath);
            if (manifest) {
              allCheckpoints.push({ manifest, manifestPath });
            }
          }
        }
      }

      // Sort by createdAt descending (newest first)
      allCheckpoints.sort(
        (a, b) =>
          new Date(b.manifest.createdAt).getTime() -
          new Date(a.manifest.createdAt).getTime()
      );

      // Find first valid checkpoint
      for (const { manifest } of allCheckpoints) {
        const issues: string[] = [];

        // Verify manifest SHA256
        const manifestBase: Omit<CheckpointManifest, "manifestSha256"> = {
          ...manifest,
        };
        delete (manifestBase as any).manifestSha256;
        const expectedSha256 = calculateManifestSha256(manifestBase);

        if (expectedSha256 !== manifest.manifestSha256) {
          process.env.GYOSHU_DEBUG && console.warn(
            `[checkpoint-manager] Skipping checkpoint ${manifest.checkpointId}: Manifest SHA256 mismatch`
          );
          continue;
        }

        // Validate all artifacts
        let allArtifactsValid = true;
        const trustLevel = manifest.trustLevel || "local";
        for (const artifact of manifest.artifacts) {
          const result = await validateArtifact(artifact, projectRoot, trustLevel);
          if (!result.valid) {
            allArtifactsValid = false;
            issues.push(result.issue || "Unknown artifact issue");
          }
        }

        if (!allArtifactsValid) {
          process.env.GYOSHU_DEBUG && console.warn(
            `[checkpoint-manager] Skipping invalid checkpoint ${manifest.checkpointId}: ${issues.join("; ")}`
          );
        }

        if (allArtifactsValid) {
          // Found a valid checkpoint
          const result: ResumeResult = {
            success: true,
            action: "resume",
            found: true,
            reportTitle,
            runId: manifest.runId,
            checkpoint: {
              checkpointId: manifest.checkpointId,
              runId: manifest.runId,
              stageId: manifest.stageId,
              status: manifest.status,
              createdAt: manifest.createdAt,
              artifactCount: manifest.artifacts.length,
            },
            rehydrationCells: manifest.rehydration.rehydrationCellSource,
            nextStageId: inferNextStageId(manifest.stageId),
            searchedCount: allCheckpoints.length,
          };

          if (trustLevel !== "local") {
            result.trustWarning = `Checkpoint is ${trustLevel} - verify source before resuming`;
          }

          return JSON.stringify(result, null, 2);
        }
      }

      // No valid checkpoint found
      const result: ResumeResult = {
        success: true,
        action: "resume",
        found: false,
        reportTitle,
        runId: runId || undefined,
        searchedCount: allCheckpoints.length,
        validationIssues:
          allCheckpoints.length > 0
            ? ["No valid checkpoints found - all failed integrity checks"]
            : ["No checkpoints exist for this research/run"],
      };

      return JSON.stringify(result, null, 2);
    }

    // =========================================================================
    // PRUNE ACTION - Keep only last K checkpoints
    // =========================================================================
    case "prune": {
      if (!runId) {
        throw new Error("runId is required for prune action");
      }

      validatePathSegment(runId, "runId");

      const keepCount = typedArgs.keepCount || DEFAULT_KEEP_COUNT;

      // List all checkpoints for this run
      const checkpointDir = getCheckpointDir(reportTitle, runId);
      const checkpointIds = await listCheckpointIds(checkpointDir);

      // Load manifests and sort by createdAt
      const checkpointsWithTime: {
        checkpointId: string;
        createdAt: string;
        manifestPath: string;
      }[] = [];

      for (const ckptId of checkpointIds) {
        const manifestPath = getCheckpointManifestPath(
          reportTitle,
          runId,
          ckptId
        );
        const manifest = await loadManifest(manifestPath);
        if (manifest) {
          checkpointsWithTime.push({
            checkpointId: ckptId,
            createdAt: manifest.createdAt,
            manifestPath,
          });
        }
      }

      // Sort by createdAt ascending (oldest first)
      checkpointsWithTime.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      // Calculate how many to prune
      const prunedIds: string[] = [];
      const toPrune = checkpointsWithTime.length - keepCount;

      if (toPrune > 0) {
        const checkpointsToPrune = checkpointsWithTime.slice(0, toPrune);

        for (const ckpt of checkpointsToPrune) {
          const ckptDir = path.dirname(ckpt.manifestPath);
          try {
            // Security: Verify path is contained within reports directory before deletion
            if (!isPathContainedIn(ckptDir, getReportsRootDir(), { useRealpath: true })) {
              throw new Error(`Security: ${ckptDir} escapes containment`);
            }
            await fs.rm(ckptDir, { recursive: true, force: true });
            prunedIds.push(ckpt.checkpointId);
          } catch (error) {
            process.env.GYOSHU_DEBUG && console.warn(
              `Failed to prune checkpoint ${ckpt.checkpointId}:`,
              error
            );
          }
        }
      }

      return JSON.stringify(
        {
          success: true,
          action: "prune",
          reportTitle,
          runId,
          keepCount,
          pruned: prunedIds.length,
          prunedIds,
          kept: checkpointsWithTime.length - prunedIds.length,
          totalBefore: checkpointsWithTime.length,
        },
        null,
        2
      );
    }

    // =========================================================================
    // EMERGENCY ACTION - Fast checkpoint for watchdog/abort scenarios
    // =========================================================================
    case "emergency": {
      if (!runId) {
        throw new Error("runId is required for emergency action");
      }
      if (!typedArgs.stageId) {
        throw new Error("stageId is required for emergency action");
      }
      if (!typedArgs.reason) {
        throw new Error("reason is required for emergency action");
      }

      validatePathSegment(runId, "runId");

      // Auto-generate checkpointId if not provided (fast path)
      const emergencyCheckpointId =
        checkpointId ||
        `ckpt-emergency-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;

      if (checkpointId) {
        validatePathSegment(checkpointId, "checkpointId");
      }

      // Use "interrupted" status for emergency checkpoints (per 3.4.3)
      const emergencyStatus: CheckpointStatus = "interrupted";

      // Determine notebook path (may not exist)
      const notebookPath =
        typedArgs.notebookPathOverride || getNotebookPath(reportTitle);

      // Validate notebookPathOverride if provided (security: containment + symlink check)
      if (typedArgs.notebookPathOverride) {
        const resolvedNotebookPath = path.resolve(typedArgs.notebookPathOverride);
        // Check containment within notebooks directory
        if (!isPathContainedIn(resolvedNotebookPath, getNotebookRootDir())) {
          throw new Error(
            `notebookPathOverride must be within notebooks directory: ${resolvedNotebookPath}`
          );
        }
        // Check for symlink if path exists
        try {
          const stat = await fs.lstat(resolvedNotebookPath);
          if (stat.isSymbolicLink()) {
            throw new Error(
              `notebookPathOverride cannot be a symlink: ${resolvedNotebookPath}`
            );
          }
        } catch (err) {
          // ENOENT is OK - notebook may not exist yet and will be created
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw err;
          }
        }
      }

      // Create checkpoint directory
      const manifestPath = getCheckpointManifestPath(
        reportTitle,
        runId,
        emergencyCheckpointId
      );
      const emergencyCheckpointDir = path.dirname(manifestPath);
      ensureDirSync(emergencyCheckpointDir);

      // Accept artifacts as-is without validation (3.4.2)
      // Artifacts can have sha256: "unknown" for emergency saves
      const artifacts: ArtifactEntry[] = typedArgs.artifacts || [];

      // Build python env metadata (optional for emergency)
      const pythonEnv: PythonEnvMetadata = typedArgs.pythonEnv || {
        pythonPath: "unknown",
        packages: [],
        platform: process.platform,
      };

      // Build rehydration config (minimal for emergency)
      const rehydrationMode: RehydrationMode =
        typedArgs.rehydrationMode || "artifacts_only";
      const rehydrationCellSource =
        typedArgs.rehydrationSource ||
        generateRehydrationCode(artifacts, rehydrationMode, emergencyCheckpointId, pythonEnv.randomSeeds);

      // Normalize stageId
      const emergencyStageId = normalizeStageId(typedArgs.stageId || "emergency_checkpoint", typedArgs.researchSessionID);

      // Build manifest without sha256 first
      const manifestBase: Omit<CheckpointManifest, "manifestSha256"> = {
        checkpointId: emergencyCheckpointId,
        researchSessionID: typedArgs.researchSessionID || "unknown-session",
        reportTitle,
        runId,
        stageId: emergencyStageId,
        status: emergencyStatus,
        reason: typedArgs.reason as EmergencyReason,
        createdAt: new Date().toISOString(),
        executionCount: typedArgs.executionCount || 0,
        notebook: {
          path: path.relative(projectRoot, notebookPath),
          checkpointCellId: `ckpt-emergency-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`, // Placeholder for emergency
        },
        pythonEnv,
        artifacts,
        rehydration: {
          mode: rehydrationMode,
          rehydrationCellSource,
        },
      };

      // Calculate manifest SHA256
      const emergencyManifestSha256 = calculateManifestSha256(manifestBase);

      // Complete manifest
      const emergencyManifest: CheckpointManifest = {
        ...manifestBase,
        manifestSha256: emergencyManifestSha256,
      };

      // Wrap notebook cell append and manifest write in notebook lock
      let cellId: string | null = null;
      await withLock(
        getNotebookLockPath(reportTitle),
        async () => {
          try {
            cellId = await appendCheckpointCell(
              notebookPath,
              emergencyCheckpointId,
              typedArgs.stageId!,
              path.relative(projectRoot, manifestPath)
            );

            // Update manifest with cell ID
            emergencyManifest.notebook.checkpointCellId = cellId;

            // Recalculate SHA256 with updated cell ID
            const finalManifestBase: Omit<CheckpointManifest, "manifestSha256"> = {
              ...emergencyManifest,
            };
            delete (finalManifestBase as any).manifestSha256;
            emergencyManifest.manifestSha256 =
              calculateManifestSha256(finalManifestBase);
          } catch (error) {
            // Cell append failed - continue without it (emergency save prioritizes speed)
            process.env.GYOSHU_DEBUG && console.warn(
              `Emergency checkpoint: Failed to append notebook cell: ${error}`
            );
          }

          // Write manifest atomically
          await durableAtomicWrite(
            manifestPath,
            JSON.stringify(emergencyManifest, null, 2)
          );
        },
        DEFAULT_LOCK_TIMEOUT_MS
      );

      return JSON.stringify(
        {
          success: true,
          action: "emergency",
          checkpointId: emergencyCheckpointId,
          reportTitle,
          runId,
          stageId: emergencyStageId,
          status: emergencyStatus,
          reason: typedArgs.reason,
          manifestPath: path.relative(projectRoot, manifestPath),
          notebookPath: path.relative(projectRoot, notebookPath),
          checkpointCellId: cellId,
          cellAppendSucceeded: cellId !== null,
          artifactCount: artifacts.length,
          artifactsValidated: false, // Emergency checkpoints skip validation
          manifestSha256: emergencyManifest.manifestSha256,
        },
        null,
        2
      );
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
