/**
 * Gyoshu Snapshot MCP Tool - Provides a compact summary of session state for the planner.
 *
 * Returns structured data about:
 * - Session status and goal
 * - Recent executed cells
 * - Artifacts in session
 * - REPL state (variables, memory)
 * - Notebook outline
 * - Timing information
 *
 * @module mcp/tools/gyoshu-snapshot
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { fileExists, readFile, readFileNoFollow } from "../../lib/atomic-write";
import {
  getCheckpointDir,
  getSessionDir,
  getReportDir,
  getNotebookPath,
  getLegacyArtifactsDir,
  getLegacyManifestPath,
  validatePathSegment,
} from "../../lib/paths";
import { isValidBridgeMeta, type BridgeMeta, type VerificationState } from "../../lib/bridge-meta";

/**
 * Session manifest structure (matches session-manager.ts)
 */
interface SessionManifest {
  researchSessionID: string;
  created: string;
  updated: string;
  status: "active" | "completed" | "archived";
  notebookPath: string;
  environment: {
    pythonVersion: string;
    platform: string;
    packages: Record<string, string>;
    randomSeeds: Record<string, number>;
  };
  executedCells: Record<
    string,
    {
      executionCount: number;
      contentHash: string;
      timestamp: string;
      success: boolean;
    }
  >;
  executionOrder: string[];
  lastSuccessfulExecution: number;
  // Extended fields that may be present
  mode?: string;
  goal?: string;
  goalStatus?: string;
  cycle?: number;
  reportTitle?: string;
  runId?: string;
  budgets?: {
    currentCycle?: number;
  };
}

/**
 * Notebook cell structure (matches notebook-writer.ts)
 */
interface NotebookCell {
  cell_type: "code" | "markdown";
  id?: string;
  source: string[];
  metadata?: {
    gyoshu?: {
      type?: "report" | "research" | "data";
      version?: number;
      lastUpdated?: string;
    };
  };
  execution_count?: number | null;
  outputs?: unknown[];
}

/**
 * Notebook structure
 */
interface Notebook {
  cells: NotebookCell[];
  metadata: {
    gyoshu?: {
      researchSessionID: string;
      finalized?: string;
      createdAt?: string;
    };
  };
  nbformat: number;
  nbformat_minor: number;
}

/**
 * Recent cell info for snapshot
 */
interface RecentCellInfo {
  cellId: string;
  cellType: string;
  executionCount: number;
  hasOutput: boolean;
  timestamp: string;
}

/**
 * Artifact info for snapshot
 */
interface ArtifactInfo {
  path: string;
  type: string;
  sizeBytes: number;
}

/**
 * REPL state summary
 */
interface ReplStateSummary {
  variableCount: number;
  variables: string[];
  memoryMb: number;
}

/**
 * Notebook outline entry
 */
interface NotebookOutlineEntry {
  cellId: string;
  type: string;
  preview: string;
}

/**
 * Checkpoint info for snapshot
 */
interface CheckpointInfo {
  checkpointId: string;
  stageId: string;
  createdAt: string;
  status: string;
  /**
   * Validation status of the checkpoint manifest.
   * - "valid": Manifest SHA256 is correct
   * - "invalid_sha256": Manifest SHA256 mismatch (corrupted)
   * - "emergency_no_artifacts": Emergency checkpoint with no artifacts
   * - "parse_error": Failed to parse checkpoint.json
   */
  validationStatus: "valid" | "invalid_sha256" | "emergency_no_artifacts" | "parse_error";
}

/**
 * Record of a single challenge round in adversarial verification.
 * Tracks trust scores and challenge outcomes from Baksa (critic).
 */
interface ChallengeRecord {
  /** Challenge round number (1-indexed) */
  round: number;
  /** ISO 8601 timestamp when challenge was issued */
  timestamp: string;
  /** Trust score from Baksa (0-100) */
  trustScore: number;
  /** List of challenges that failed verification */
  failedChallenges: string[];
  /** List of challenges that passed verification */
  passedChallenges: string[];
}

/**
 * Complete session snapshot structure
 */
interface SessionSnapshot {
  sessionId: string;
  mode: string;
  goalStatus: string;
  goal?: string;
  cycle: number;

  // Recent execution history
  recentCells: RecentCellInfo[];

  // Artifacts in session
  artifacts: ArtifactInfo[];

  // REPL state summary
  replState: ReplStateSummary;

  // Notebook outline
  notebookOutline: NotebookOutlineEntry[];

  // Timing
  lastActivityAt: string;
  elapsedMinutes: number;

  // Checkpoint info
  lastCheckpoint?: CheckpointInfo;
  /**
   * Whether the checkpoint manifest is valid.
   * NOTE: This validates manifest SHA256 only, not artifact integrity.
   * Use checkpoint-manager(action: "validate") for full validation.
   */
  resumable: boolean;

  challengeHistory: ChallengeRecord[];
  /** Current challenge round. 0 = not started, 1+ = active rounds */
  currentChallengeRound: number;
  verificationStatus: "pending" | "in_progress" | "verified" | "failed";
}

function validateSessionId(sessionId: string): void {
  validatePathSegment(sessionId, "researchSessionID");
}

/**
 * Scans canonical report directory for artifacts.
 * Falls back to legacy artifacts directory if report dir doesn't exist.
 */
async function scanReportArtifacts(reportTitle: string | undefined, sessionId: string): Promise<ArtifactInfo[]> {
  const artifacts: ArtifactInfo[] = [];

  let scanDir: string | null = null;
  let pathPrefix = "artifacts/";

  if (reportTitle) {
    const canonicalDir = getReportDir(reportTitle);
    try {
      await fs.access(canonicalDir);
      scanDir = canonicalDir;
      pathPrefix = "";
    } catch {
      // Fall through to legacy
    }
  }

  if (!scanDir) {
    scanDir = getLegacyArtifactsDir(sessionId);
  }

  try {
    const entries = await fs.readdir(scanDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = path.join(scanDir, entry.name);
        try {
          const stats = await fs.lstat(filePath);
          if (stats.isSymbolicLink()) {
            continue; // Skip symlinks
          }
          artifacts.push({
            path: `${pathPrefix}${entry.name}`,
            type: getFileType(entry.name),
            sizeBytes: stats.size,
          });
        } catch {
          // Skip files that can't be stated
        }
      } else if (entry.isDirectory()) {
        const subDir = path.join(scanDir, entry.name);
        try {
          const subEntries = await fs.readdir(subDir, { withFileTypes: true });
          for (const subEntry of subEntries) {
            if (subEntry.isFile()) {
              const subFilePath = path.join(subDir, subEntry.name);
              try {
                const stats = await fs.lstat(subFilePath);
                if (stats.isSymbolicLink()) {
                  continue; // Skip symlinks
                }
                artifacts.push({
                  path: `${pathPrefix}${entry.name}/${subEntry.name}`,
                  type: getFileType(subEntry.name),
                  sizeBytes: stats.size,
                });
              } catch {
                // Skip files that can't be stated
              }
            }
          }
        } catch {
          // Skip directories that can't be read
        }
      }
    }
  } catch {
    // Directory doesn't exist - that's fine
  }

  return artifacts;
}

/**
 * Reads the notebook from a path
 * Security: Uses O_NOFOLLOW to atomically reject symlinks (no TOCTOU race)
 */
async function readNotebook(notebookPath: string): Promise<Notebook | null> {
  try {
    // Security: readFileNoFollow uses O_NOFOLLOW to atomically reject symlinks
    const content = await readFileNoFollow(notebookPath);
    return JSON.parse(content) as Notebook;
  } catch {
    // Returns null for ENOENT, ELOOP (symlink), or parse errors
    return null;
  }
}

/**
 * Extracts a preview from cell source (first ~80 chars)
 */
function getCellPreview(cell: NotebookCell): string {
  const source = Array.isArray(cell.source) ? cell.source.join("") : cell.source;
  const firstLine = source.split("\n")[0] || "";
  return firstLine.slice(0, 80) + (firstLine.length > 80 ? "..." : "");
}

/**
 * Gets MIME type from file extension
 */
function getFileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const typeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".json": "application/json",
    ".html": "text/html",
    ".txt": "text/plain",
    ".py": "text/x-python",
    ".npy": "application/octet-stream",
    ".pkl": "application/octet-stream",
    ".parquet": "application/parquet",
  };
  return typeMap[ext] || "application/octet-stream";
}

/**
 * Builds recent cells from manifest execution data
 */
function buildRecentCells(
  manifest: SessionManifest,
  maxCells: number = 10
): RecentCellInfo[] {
  const executionOrder = manifest.executionOrder || [];
  const executedCells = manifest.executedCells || {};

  // Get the most recent cells (last N in execution order)
  const recentCellIds = executionOrder.slice(-maxCells);

  return recentCellIds.map((cellId) => {
    const cellData = executedCells[cellId];
    return {
      cellId,
      cellType: "code", // Manifest tracks code cells primarily
      executionCount: cellData?.executionCount ?? 0,
      hasOutput: cellData?.success ?? false,
      timestamp: cellData?.timestamp ?? "",
    };
  });
}

/**
 * Builds notebook outline from cells
 */
function buildNotebookOutline(
  notebook: Notebook,
  maxCells: number = 20
): NotebookOutlineEntry[] {
  const outline: NotebookOutlineEntry[] = [];

  for (let i = 0; i < Math.min(notebook.cells.length, maxCells); i++) {
    const cell = notebook.cells[i];
    const cellId = cell.id || `cell-${i}`;
    const gyoshuMeta = cell.metadata?.gyoshu;

    let type: string = cell.cell_type;
    if (gyoshuMeta?.type) {
      type = `${cell.cell_type}:${gyoshuMeta.type}`;
    }

    outline.push({
      cellId,
      type,
      preview: getCellPreview(cell),
    });
  }

  return outline;
}

/**
 * Calculates elapsed time in minutes from session creation
 */
function calculateElapsedMinutes(createdAt: string): number {
  try {
    const created = new Date(createdAt);
    const now = new Date();
    const diffMs = now.getTime() - created.getTime();
    return Math.round(diffMs / 60000);
  } catch {
    return 0;
  }
}

const BRIDGE_META_FILE = "bridge_meta.json";
const SESSION_MANIFEST_FILE = "session_manifest.json";

/**
 * Result of loading a session manifest, including source for observability.
 * Matches gyoshu-completion.ts ManifestLoadResult.
 */
interface ManifestLoadResult {
  manifest: SessionManifest;
  source: "session_manifest" | "bridge_meta" | "legacy_manifest";
}

/**
 * Get path to session_manifest.json in session's runtime directory.
 */
function getManifestPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), SESSION_MANIFEST_FILE);
}

/**
 * Get path to bridge_meta.json in session's runtime directory.
 */
function getBridgeMetaPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), BRIDGE_META_FILE);
}

async function readBridgeMeta(sessionId: string): Promise<BridgeMeta | null> {
  const metaPath = getBridgeMetaPath(sessionId);
  if (!(await fileExists(metaPath))) {
    return null;
  }
  try {
    const meta = await readFile<unknown>(metaPath, true);
    if (!isValidBridgeMeta(meta)) {
      return null;
    }
    return meta;
  } catch {
    return null;
  }
}

/**
 * Create a minimal session manifest from bridge metadata.
 * Used as fallback when session_manifest.json doesn't exist.
 */
function createMinimalManifestFromBridgeMeta(sessionId: string, bridgeMeta: BridgeMeta): SessionManifest {
  const timestamp = bridgeMeta.bridgeStarted || bridgeMeta.startedAt || new Date().toISOString();
  return {
    researchSessionID: sessionId,
    created: timestamp,
    updated: timestamp,
    status: "active",
    notebookPath: bridgeMeta.notebookPath || "",
    reportTitle: bridgeMeta.reportTitle,
    environment: {
      pythonVersion: "",
      platform: "",
      packages: {},
      randomSeeds: {},
    },
    executedCells: {},
    executionOrder: [],
    lastSuccessfulExecution: 0,
  };
}

/**
 * Load session manifest using the same fallback chain as gyoshu-completion.ts:
 * 1. session_manifest.json (canonical location in runtime dir)
 * 2. bridge_meta.json (created by python-repl.ts)
 * 3. Legacy manifest path (~/.gyoshu/sessions/{sessionId}/manifest.json)
 *
 * Returns null if session not found in any location.
 */
async function loadSessionManifest(sessionId: string): Promise<ManifestLoadResult | null> {
  // 1. Try session_manifest.json first (canonical location)
  const manifestPath = getManifestPath(sessionId);
  if (await fileExists(manifestPath)) {
    const manifest = await readFile<SessionManifest>(manifestPath, true).catch(() => null);
    if (manifest) {
      return { manifest, source: "session_manifest" };
    }
  }

  // 2. Fall back to bridge_meta.json (created by python-repl.ts)
  const bridgeMeta = await readBridgeMeta(sessionId);
  if (bridgeMeta) {
    const manifest = createMinimalManifestFromBridgeMeta(sessionId, bridgeMeta);
    return { manifest, source: "bridge_meta" };
  }

  // 3. Fall back to legacy manifest path
  const legacyPath = getLegacyManifestPath(sessionId);
  if (await fileExists(legacyPath)) {
    const manifest = await readFile<SessionManifest>(legacyPath, true).catch(() => null);
    if (manifest) {
      return { manifest, source: "legacy_manifest" };
    }
  }

  return null;
}

function mapVerificationToSnapshot(verification: VerificationState | undefined): {
  challengeHistory: ChallengeRecord[];
  currentChallengeRound: number;
  verificationStatus: "pending" | "in_progress" | "verified" | "failed";
} {
  // Defensive: return defaults if verification is missing or malformed
  if (!verification || typeof verification !== "object") {
    return {
      challengeHistory: [],
      currentChallengeRound: 0,
      verificationStatus: "pending",
    };
  }

  // Defensive: ensure history is an array
  const history = Array.isArray(verification.history) ? verification.history : [];
  const currentRound = typeof verification.currentRound === "number" ? verification.currentRound : 0;
  const maxRounds = typeof verification.maxRounds === "number" ? verification.maxRounds : 3;

  // Map history with defensive checks on each entry
  const challengeHistory: ChallengeRecord[] = history
    .filter((round) => round && typeof round === "object")
    .map((round) => ({
      round: typeof round.round === "number" ? round.round : 0,
      timestamp: typeof round.timestamp === "string" ? round.timestamp : "",
      trustScore: typeof round.trustScore === "number" ? round.trustScore : 0,
      passedChallenges:
        round.outcome === "passed"
          ? [`Round ${round.round}: Verification passed with trust score ${round.trustScore}`]
          : [],
      failedChallenges:
        round.outcome === "failed" || round.outcome === "rework_requested"
          ? [
              `Round ${round.round}: ${round.outcome === "failed" ? "Verification failed" : "Rework requested"} (trust score: ${round.trustScore})`,
            ]
          : [],
    }));

  // Determine status with consistency check
  let verificationStatus: "pending" | "in_progress" | "verified" | "failed";

  if (challengeHistory.length === 0) {
    // No history - check currentRound for consistency
    if (currentRound === 0) {
      verificationStatus = "pending";
    } else {
      // Inconsistent state: currentRound > 0 but no history
      // Treat as "in_progress" since verification started but no results yet
      verificationStatus = "in_progress";
    }
  } else {
    const latestOutcome = history[history.length - 1]?.outcome;
    if (latestOutcome === "passed") {
      verificationStatus = "verified";
    } else if (currentRound >= maxRounds) {
      // latestOutcome is not "passed" (already checked above), so verification failed
      verificationStatus = "failed";
    } else {
      verificationStatus = "in_progress";
    }
  }

  return {
    challengeHistory,
    currentChallengeRound: currentRound,
    verificationStatus,
  };
}

/**
 * Input arguments for gyoshu_snapshot tool
 */
interface GyoshuSnapshotArgs {
  researchSessionID: string;
  maxRecentCells?: number;
  maxOutlineCells?: number;
  includeReplState?: boolean;
}

/**
 * MCP Tool Definition for gyoshu_snapshot
 */
export const gyoshuSnapshotTool = {
  name: "gyoshu_snapshot",
  description:
    "Get a compact snapshot of Gyoshu session state for the planner. " +
    "Returns session status, recent cells, artifacts, REPL variables, " +
    "notebook outline, and timing information.",
  inputSchema: {
    type: "object" as const,
    properties: {
      researchSessionID: {
        type: "string",
        description: "Unique identifier for the research session",
      },
      maxRecentCells: {
        type: "number",
        description: "Maximum number of recent cells to include (default: 10)",
      },
      maxOutlineCells: {
        type: "number",
        description: "Maximum cells in notebook outline (default: 20)",
      },
      includeReplState: {
        type: "boolean",
        description:
          "Whether to query REPL state (may spawn bridge if not running, default: false)",
      },
    },
    required: ["researchSessionID"],
  },
};

/**
 * Handler function for gyoshu_snapshot MCP tool
 */
export async function handleGyoshuSnapshot(args: unknown): Promise<unknown> {
  const {
    researchSessionID,
    maxRecentCells = 10,
    maxOutlineCells = 20,
    includeReplState = false,
  } = args as GyoshuSnapshotArgs;

  validateSessionId(researchSessionID);

  // Load session manifest using same fallback chain as gyoshu-completion.ts:
  // 1. session_manifest.json -> 2. bridge_meta.json -> 3. legacy manifest
  const loadResult = await loadSessionManifest(researchSessionID);

  if (!loadResult) {
    return JSON.stringify({
      success: false,
      error: `Session '${researchSessionID}' not found`,
      snapshot: null,
    });
  }

  const { manifest, source: manifestSource } = loadResult;
  const notebookPath = manifest.notebookPath;
  const reportTitle =
    manifest.reportTitle || manifest.goal?.toLowerCase().replace(/\s+/g, "-").slice(0, 50);

  // Read bridge meta separately for verification state (if not already loaded via manifest)
  const bridgeMeta = await readBridgeMeta(researchSessionID);

  // Read notebook - try canonical path first, then manifest path
  let notebook: Notebook | null = null;
  if (reportTitle) {
    const canonicalNotebookPath = getNotebookPath(reportTitle);
    notebook = await readNotebook(canonicalNotebookPath);
  }
  if (!notebook && notebookPath) {
    notebook = await readNotebook(notebookPath);
  }

  // Scan artifacts using canonical report dir with legacy fallback
  const artifacts = await scanReportArtifacts(reportTitle, researchSessionID);

  let lastCheckpoint: CheckpointInfo | undefined = undefined;
  let resumable = false;

  const effectiveReportTitle =
    reportTitle ||
    manifest.reportTitle ||
    manifest.goal?.toLowerCase().replace(/\s+/g, "-").slice(0, 50);

  if (effectiveReportTitle) {
    try {
      const checkpointDir = getCheckpointDir(
        effectiveReportTitle,
        manifest.runId || "run-001"
      );

      const entries = await fs.readdir(checkpointDir, { withFileTypes: true }).catch(() => []);
      if (entries.length > 0) {
        const latest = entries
          .filter((e) => e.isDirectory())
          .sort()
          .pop();
        if (latest) {
          const checkpointManifestPath = path.join(
            checkpointDir,
            latest.name,
            "checkpoint.json"
          );
          const content = await readFileNoFollow(checkpointManifestPath).catch(() => null);
          if (content) {
            try {
              const ckpt = JSON.parse(content);

              const storedSha256 = ckpt.manifestSha256;
              const manifestBase = { ...ckpt };
              delete manifestBase.manifestSha256;
              const computedSha256 = crypto
                .createHash("sha256")
                .update(JSON.stringify(manifestBase, null, 2), "utf8")
                .digest("hex");

              const sha256Valid = storedSha256 === computedSha256;
              const isEmergencyWithNoArtifacts =
                ckpt.status === "emergency" && (!ckpt.artifacts || ckpt.artifacts.length === 0);

              let validationStatus: CheckpointInfo["validationStatus"];

              if (!sha256Valid) {
                validationStatus = "invalid_sha256";
                resumable = false;
              } else if (isEmergencyWithNoArtifacts) {
                validationStatus = "emergency_no_artifacts";
                resumable = false;
              } else {
                validationStatus = "valid";
                resumable = true;
              }

              lastCheckpoint = {
                checkpointId: ckpt.checkpointId,
                stageId: ckpt.stageId,
                createdAt: ckpt.createdAt,
                status: ckpt.status,
                validationStatus,
              };
            } catch {
              lastCheckpoint = {
                checkpointId: latest.name,
                stageId: "unknown",
                createdAt: new Date().toISOString(),
                status: "unknown",
                validationStatus: "parse_error",
              };
              resumable = false;
            }
          }
        }
      }
    } catch {
      // Checkpoint lookup failed - not critical
    }
  }

  // Build recent cells from manifest
  const recentCells = buildRecentCells(manifest, maxRecentCells);

  // Build notebook outline
  const notebookOutline = notebook ? buildNotebookOutline(notebook, maxOutlineCells) : [];

  // Get REPL state (optional - requires bridge to be running)
  let replState: ReplStateSummary = {
    variableCount: 0,
    variables: [],
    memoryMb: 0,
  };

  if (includeReplState) {
    // Note: We don't spawn the bridge here - just report unavailable
    // The planner can use python-repl get_state directly if needed
    // This keeps snapshot lightweight and non-side-effecty
    replState = {
      variableCount: -1, // -1 indicates "not queried"
      variables: [],
      memoryMb: -1,
    };
  }

  const lastActivityAt = manifest.updated || manifest.created;
  const elapsedMinutes = calculateElapsedMinutes(manifest.created);

  const verificationData = mapVerificationToSnapshot(bridgeMeta?.verification);

  // Build complete snapshot
  const snapshot: SessionSnapshot = {
    sessionId: researchSessionID,
    mode: manifest.mode || "unknown",
    goalStatus: manifest.goalStatus || "unknown",
    goal: manifest.goal,
    cycle: manifest.budgets?.currentCycle || 0,

    recentCells,
    artifacts,
    replState,
    notebookOutline,

    lastActivityAt,
    elapsedMinutes,

    lastCheckpoint,
    resumable,

    challengeHistory: verificationData.challengeHistory,
    currentChallengeRound: verificationData.currentChallengeRound,
    verificationStatus: verificationData.verificationStatus,
  };

  return JSON.stringify(
    {
      success: true,
      snapshot,
      meta: {
        manifestSource,
        manifestStatus: manifest.status,
        notebookExists: notebook !== null,
        cellCount: notebook?.cells.length ?? 0,
        artifactCount: artifacts.length,
        executedCellCount: Object.keys(manifest.executedCells || {}).length,
        resumableNote: "manifest-only validation; use checkpoint-manager validate for full check",
      },
    },
    null,
    2
  );
}
