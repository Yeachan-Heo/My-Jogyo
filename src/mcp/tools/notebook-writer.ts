/**
 * MCP Notebook Writer Tool - Manages Jupyter notebooks for Gyoshu research.
 * Features: nbformat 4.5 with cell IDs, atomic writes, metadata-based report cells.
 * @module mcp/tools/notebook-writer
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { durableAtomicWrite, readFileNoFollow } from "../../lib/atomic-write.js";
import { ensureCellId, NotebookCell, Notebook } from "../../lib/cell-identity.js";
import { ensureDirSync, getNotebookPath, getNotebookRootDir, validatePathSegment } from "../../lib/paths.js";
import { isPathContainedIn } from "../../lib/path-security.js";
import { ensureFrontmatterCell, GyoshuFrontmatter } from "../../lib/notebook-frontmatter.js";
import { getNotebookLockPath, DEFAULT_LOCK_TIMEOUT_MS } from "../../lib/lock-paths.js";
import { withLock } from "../../lib/session-lock.js";

// =============================================================================
// MCP TOOL DEFINITION
// =============================================================================

export const notebookWriterTool = {
  name: "notebook_writer",
  description:
    "Write and manage Jupyter notebooks for Gyoshu research. " +
    "Actions: ensure_notebook, append_cell, upsert_report_cell, finalize. " +
    "Uses atomic writes and nbformat 4.5 with cell IDs.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["ensure_notebook", "append_cell", "upsert_report_cell", "finalize"],
        description:
          "ensure_notebook: create with report cell, " +
          "append_cell: add code/markdown, " +
          "upsert_report_cell: update report, " +
          "finalize: mark complete",
      },
      reportTitle: {
        type: "string",
        description:
          "Title for the report/notebook (e.g., 'wine-quality-analysis'). " +
          "Used to generate notebook path as notebooks/{reportTitle}.ipynb",
      },
      notebookPath: {
        type: "string",
        description: "Absolute path to notebook file (.ipynb) - legacy mode, prefer reportTitle",
      },
      researchSessionID: {
        type: "string",
        description: "Session ID (required when creating new notebook with legacy path)",
      },
      cellType: {
        type: "string",
        enum: ["code", "markdown"],
        description: "Cell type for append_cell",
      },
      source: {
        type: "array",
        items: { type: "string" },
        description: "Cell source lines for append_cell",
      },
      outputs: {
        type: "array",
        items: { type: "object" },
        description: "Cell outputs (stream/execute_result/display_data/error)",
      },
      executionCount: {
        type: "number",
        description: "Execution count for code cells",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          "Cell tags for categorization (Papermill-style). " +
          "Standard Gyoshu tags: gyoshu-objective, gyoshu-hypothesis, gyoshu-config, " +
          "gyoshu-data, gyoshu-analysis, gyoshu-finding, gyoshu-conclusion, " +
          "gyoshu-run-start, gyoshu-run-end, gyoshu-report",
      },
      reportContent: {
        type: "string",
        description: "Markdown content for upsert_report_cell",
      },
    },
    required: ["action"],
  },
};

// =============================================================================
// INTERNAL INTERFACES
// =============================================================================

interface GyoshuCellMetadata {
  type?: "report" | "research" | "data";
  version?: number;
  lastUpdated?: string;
}

interface GyoshuNotebookMetadata {
  researchSessionID: string;
  finalized?: string;
  createdAt?: string;
}

interface NotebookWriterArgs {
  action: "ensure_notebook" | "append_cell" | "upsert_report_cell" | "finalize";
  reportTitle?: string;
  notebookPath?: string;
  researchSessionID?: string;
  cellType?: "code" | "markdown";
  source?: string[];
  outputs?: unknown[];
  executionCount?: number;
  tags?: string[];
  reportContent?: string;
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

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
      } as GyoshuNotebookMetadata,
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

function createReportCell(): NotebookCell {
  return {
    cell_type: "markdown",
    id: `report-${crypto.randomUUID().slice(0, 8)}`,
    metadata: {
      tags: ["gyoshu-report"],
      gyoshu: {
        type: "report",
        version: 1,
        lastUpdated: new Date().toISOString(),
      } as GyoshuCellMetadata,
    },
    source: [
      "# Research Report\n",
      "\n",
      "*Report will be updated as research progresses.*\n",
    ],
  };
}

// IMPORTANT: Uses metadata.gyoshu.type === "report", NOT position-based detection
function findReportCellByMetadata(notebook: Notebook): number {
  return notebook.cells.findIndex((cell) => {
    const gyoshu = cell.metadata?.gyoshu as GyoshuCellMetadata | undefined;
    return gyoshu?.type === "report";
  });
}

function generateCellId(): string {
  return `gyoshu-${crypto.randomUUID().slice(0, 8)}`;
}

async function readNotebook(notebookPath: string): Promise<Notebook | null> {
  try {
    const content = await readFileNoFollow(notebookPath);
    return JSON.parse(content) as Notebook;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Helper to derive a lock identifier from a notebook path.
 * Extracts the basename without .ipynb extension.
 */
function deriveLockIdFromPath(notebookPath: string): string {
  const basename = path.basename(notebookPath, ".ipynb");
  return basename || "unknown";
}

async function saveNotebookWithCellIds(
  notebookPath: string,
  notebook: Notebook,
  lockIdentifier?: string
): Promise<void> {
  // In-memory operations (no lock needed)
  for (let i = 0; i < notebook.cells.length; i++) {
    ensureCellId(notebook.cells[i], i, notebookPath);
  }
  notebook.nbformat = 4;
  notebook.nbformat_minor = 5;

  // Directory creation (idempotent, no lock needed)
  ensureDirSync(path.dirname(notebookPath));

  // File write (needs lock for parallel safety)
  const lockId = lockIdentifier || deriveLockIdFromPath(notebookPath);
  await withLock(
    getNotebookLockPath(lockId),
    async () => await durableAtomicWrite(notebookPath, JSON.stringify(notebook, null, 2)),
    DEFAULT_LOCK_TIMEOUT_MS
  );
}

// =============================================================================
// MCP HANDLER
// =============================================================================

export async function handleNotebookWriter(args: unknown): Promise<unknown> {
  const typedArgs = args as NotebookWriterArgs;
  const { action, reportTitle } = typedArgs;

  // Validate action
  if (!action) {
    return {
      success: false,
      error: "action is required",
    };
  }

  // Validate reportTitle to prevent directory traversal attacks
  if (reportTitle) {
    try {
      validatePathSegment(reportTitle, "reportTitle");
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  // Determine notebook path - reportTitle (preferred) or legacy notebookPath
  let notebookPath: string;
  const useReportTitle = !!reportTitle;

  if (useReportTitle) {
    // Flat path: notebooks/{reportTitle}.ipynb
    notebookPath = getNotebookPath(reportTitle);
  } else if (typedArgs.notebookPath) {
    // Legacy path: absolute path provided directly
    notebookPath = typedArgs.notebookPath;
  } else {
    return {
      success: false,
      error: "Either reportTitle or notebookPath must be provided",
    };
  }

  // Security: validate notebookPath is within notebooks directory
  if (!isPathContainedIn(notebookPath, getNotebookRootDir())) {
    return {
      success: false,
      error: "notebookPath must be within the notebooks directory",
    };
  }

  // Security: reject symlinks to prevent directory escape attacks
  try {
    const stats = await fs.lstat(notebookPath);
    if (stats.isSymbolicLink()) {
      return {
        success: false,
        error: "notebookPath must not be a symbolic link",
      };
    }
  } catch (e) {
    // File doesn't exist yet - that's OK for create operations
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw e;
    }
  }

  const lockIdentifier = reportTitle || deriveLockIdFromPath(notebookPath);

  let notebook = await readNotebook(notebookPath);
  const isNew = notebook === null;

  if (isNew) {
    notebook = createEmptyNotebook(typedArgs.researchSessionID || "unknown");
  }

  let nb = notebook as Notebook;

  switch (action) {
    case "ensure_notebook": {
      let addedFrontmatter = false;
      if (isNew && useReportTitle) {
        const now = new Date().toISOString();
        const initialFrontmatter: GyoshuFrontmatter = {
          schema_version: 1,
          reportTitle: reportTitle!,
          status: "active",
          created: now,
          updated: now,
          tags: [],
          runs: [],
        };
        nb = ensureFrontmatterCell(nb, initialFrontmatter);
        addedFrontmatter = true;
      }

      if (findReportCellByMetadata(nb) === -1) {
        const reportCell = createReportCell();
        if (addedFrontmatter) {
          nb.cells.splice(1, 0, reportCell);
        } else {
          nb.cells.unshift(reportCell);
        }
      }

      await saveNotebookWithCellIds(notebookPath, nb, lockIdentifier);
      return {
        success: true,
        created: isNew,
        cellCount: nb.cells.length,
        hasReportCell: true,
        hasFrontmatter: useReportTitle && isNew,
        reportTitle: useReportTitle ? reportTitle : undefined,
        notebookPath,
        message: isNew
          ? `Created new notebook${useReportTitle ? " with frontmatter" : ""} at ${notebookPath}`
          : `Notebook exists with ${nb.cells.length} cells`,
      };
    }

    case "append_cell": {
      if (!typedArgs.cellType) {
        return { success: false, error: "cellType is required for append_cell" };
      }

      const cellId = generateCellId();
      const cell: NotebookCell = {
        cell_type: typedArgs.cellType,
        id: cellId,
        source: typedArgs.source || [],
        metadata: {
          gyoshu: {
            type: "research",
            lastUpdated: new Date().toISOString(),
          } as GyoshuCellMetadata,
        },
      };

      // Apply cell tags if provided (Papermill-style)
      if (typedArgs.tags && Array.isArray(typedArgs.tags) && typedArgs.tags.length > 0) {
        cell.metadata!.tags = typedArgs.tags;
      }

      if (typedArgs.cellType === "code") {
        cell.execution_count = typedArgs.executionCount ?? null;
        cell.outputs = typedArgs.outputs || [];
      }

      nb.cells.push(cell);
      await saveNotebookWithCellIds(notebookPath, nb, lockIdentifier);

      return {
        success: true,
        cellId,
        cellIndex: nb.cells.length - 1,
        cellCount: nb.cells.length,
        tags: typedArgs.tags,
        message: `Appended ${typedArgs.cellType} cell "${cellId}"${typedArgs.tags ? ` with tags: ${typedArgs.tags.join(", ")}` : ""}`,
      };
    }

    case "upsert_report_cell": {
      const reportSource = typedArgs.reportContent
        ? typedArgs.reportContent.split("\n").map((line, i, arr) =>
            i < arr.length - 1 ? line + "\n" : line
          )
        : ["# Research Report\n", "\n", "*No content provided.*\n"];

      const reportIdx = findReportCellByMetadata(nb);

      if (reportIdx >= 0) {
        const existingCell = nb.cells[reportIdx];
        existingCell.source = reportSource;

        const metadata = existingCell.metadata?.gyoshu as GyoshuCellMetadata;
        if (metadata) {
          metadata.version = (metadata.version || 0) + 1;
          metadata.lastUpdated = new Date().toISOString();
        } else {
          existingCell.metadata = {
            ...existingCell.metadata,
            gyoshu: {
              type: "report",
              version: 1,
              lastUpdated: new Date().toISOString(),
            } as GyoshuCellMetadata,
          };
        }

        await saveNotebookWithCellIds(notebookPath, nb, lockIdentifier);

        return {
          success: true,
          action: "updated",
          cellId: existingCell.id,
          version: (existingCell.metadata?.gyoshu as GyoshuCellMetadata)?.version,
          message: "Updated existing report cell",
        };
      } else {
        const cell = createReportCell();
        cell.source = reportSource;
        nb.cells.unshift(cell);

        await saveNotebookWithCellIds(notebookPath, nb, lockIdentifier);

        return {
          success: true,
          action: "created",
          cellId: cell.id,
          version: 1,
          message: "Created new report cell",
        };
      }
    }

    case "finalize": {
      const gyoshu = nb.metadata.gyoshu as GyoshuNotebookMetadata;
      gyoshu.finalized = new Date().toISOString();

      await saveNotebookWithCellIds(notebookPath, nb, lockIdentifier);

      return {
        success: true,
        finalized: true,
        finalizedAt: gyoshu.finalized,
        cellCount: nb.cells.length,
        message: `Notebook finalized at ${gyoshu.finalized}`,
      };
    }

    default: {
      return { success: false, error: `Unknown action: ${action}` };
    }
  }
}
