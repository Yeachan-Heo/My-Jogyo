/**
 * Gyoshu Snapshot Tool - Provides a compact summary of session state for the planner.
 *
 * Returns structured data about:
 * - Session status and goal
 * - Recent executed cells
 * - Artifacts in session
 * - REPL state (variables, memory)
 * - Notebook outline
 * - Timing information
 *
 * @module gyoshu-snapshot
 */

import { tool } from "@opencode-ai/plugin";
import * as fs from "fs/promises";
import * as path from "path";
import { fileExists, readFile } from "../lib/atomic-write";
import { getLegacyArtifactsDir, getLegacyManifestPath } from "../lib/paths";

// Path resolution is handled by ../lib/paths.ts
// Uses legacy session paths for backward compatibility with existing sessions

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
}

/**
 * Validates session ID for path safety
 */
function validateSessionId(sessionId: string): void {
  if (!sessionId || typeof sessionId !== "string") {
    throw new Error("researchSessionID is required and must be a string");
  }

  if (
    sessionId.includes("..") ||
    sessionId.includes("/") ||
    sessionId.includes("\\")
  ) {
    throw new Error(
      "Invalid researchSessionID: contains path traversal characters"
    );
  }

  if (sessionId.trim().length === 0) {
    throw new Error("Invalid researchSessionID: cannot be empty or whitespace");
  }

  if (sessionId.length > 255) {
    throw new Error(
      "Invalid researchSessionID: exceeds maximum length of 255 characters"
    );
  }
}

/**
 * Gets the path to a session's manifest file
 */
function getManifestPath(sessionId: string): string {
  return getLegacyManifestPath(sessionId);
}

/**
 * Gets the path to a session's artifacts directory
 */
function getArtifactsDir(sessionId: string): string {
  return getLegacyArtifactsDir(sessionId);
}

/**
 * Reads the notebook from a path
 */
async function readNotebook(notebookPath: string): Promise<Notebook | null> {
  try {
    const content = await fs.readFile(notebookPath, "utf-8");
    return JSON.parse(content) as Notebook;
  } catch {
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
 * Scans artifacts directory for files
 */
async function scanArtifacts(sessionId: string): Promise<ArtifactInfo[]> {
  const artifactsDir = getArtifactsDir(sessionId);
  const artifacts: ArtifactInfo[] = [];

  try {
    const entries = await fs.readdir(artifactsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = path.join(artifactsDir, entry.name);
        try {
          const stats = await fs.stat(filePath);
          artifacts.push({
            path: `artifacts/${entry.name}`,
            type: getFileType(entry.name),
            sizeBytes: stats.size,
          });
        } catch {
          // Skip files that can't be stated
        }
      }
    }
  } catch {
    // Artifacts directory doesn't exist - that's fine
  }

  return artifacts;
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

export default tool({
  name: "gyoshu_snapshot",
  description:
    "Get a compact snapshot of Gyoshu session state for the planner. " +
    "Returns session status, recent cells, artifacts, REPL variables, " +
    "notebook outline, and timing information.",

  args: {
    researchSessionID: tool.schema
      .string()
      .describe("Unique identifier for the research session"),
    maxRecentCells: tool.schema
      .number()
      .optional()
      .describe("Maximum number of recent cells to include (default: 10)"),
    maxOutlineCells: tool.schema
      .number()
      .optional()
      .describe("Maximum cells in notebook outline (default: 20)"),
    includeReplState: tool.schema
      .boolean()
      .optional()
      .describe(
        "Whether to query REPL state (may spawn bridge if not running, default: false)"
      ),
  },

  async execute(args) {
    const {
      researchSessionID,
      maxRecentCells = 10,
      maxOutlineCells = 20,
      includeReplState = false,
    } = args;

    // Validate session ID
    validateSessionId(researchSessionID);

    const manifestPath = getManifestPath(researchSessionID);

    // Check if session exists
    if (!(await fileExists(manifestPath))) {
      return JSON.stringify({
        success: false,
        error: `Session '${researchSessionID}' not found`,
        snapshot: null,
      });
    }

    // Read session manifest
    let manifest: SessionManifest;
    try {
      manifest = await readFile<SessionManifest>(manifestPath, true);
    } catch (e) {
      return JSON.stringify({
        success: false,
        error: `Failed to read session manifest: ${(e as Error).message}`,
        snapshot: null,
      });
    }

    // Read notebook if path exists
    let notebook: Notebook | null = null;
    if (manifest.notebookPath) {
      notebook = await readNotebook(manifest.notebookPath);
    }

    // Scan artifacts
    const artifacts = await scanArtifacts(researchSessionID);

    // Build recent cells from manifest
    const recentCells = buildRecentCells(manifest, maxRecentCells);

    // Build notebook outline
    const notebookOutline = notebook
      ? buildNotebookOutline(notebook, maxOutlineCells)
      : [];

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

    // Calculate timing
    const lastActivityAt = manifest.updated || manifest.created;
    const elapsedMinutes = calculateElapsedMinutes(manifest.created);

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
    };

    return JSON.stringify(
      {
        success: true,
        snapshot,
        meta: {
          manifestStatus: manifest.status,
          notebookExists: notebook !== null,
          cellCount: notebook?.cells.length ?? 0,
          artifactCount: artifacts.length,
          executedCellCount: Object.keys(manifest.executedCells || {}).length,
        },
      },
      null,
      2
    );
  },
});
