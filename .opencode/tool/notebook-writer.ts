/**
 * Notebook Writer Tool - Manages Jupyter notebooks for VibeSci research.
 * Features: nbformat 4.5 with cell IDs, atomic writes, metadata-based report cells.
 * @module notebook-writer
 */

import { tool } from "@opencode-ai/plugin";
import * as fs from "fs/promises";
import * as crypto from "crypto";
import { durableAtomicWrite } from "../lib/atomic-write";
import { ensureCellId, NotebookCell, Notebook } from "../lib/cell-identity";

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

interface VibeSciCellMetadata {
  type?: "report" | "research" | "data";
  version?: number;
  lastUpdated?: string;
}

interface VibeSciNotebookMetadata {
  researchSessionID: string;
  finalized?: string;
  createdAt?: string;
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
      vibesci: {
        researchSessionID: sessionId,
        createdAt: new Date().toISOString(),
      } as VibeSciNotebookMetadata,
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
      vibesci: {
        type: "report",
        version: 1,
        lastUpdated: new Date().toISOString(),
      } as VibeSciCellMetadata,
    },
    source: [
      "# Research Report\n",
      "\n",
      "*Report will be updated as research progresses.*\n",
    ],
  };
}

// IMPORTANT: Uses metadata.vibesci.type === "report", NOT position-based detection
function findReportCellByMetadata(notebook: Notebook): number {
  return notebook.cells.findIndex((cell) => {
    const vibesci = cell.metadata?.vibesci as VibeSciCellMetadata | undefined;
    return vibesci?.type === "report";
  });
}

function generateCellId(): string {
  return `vibesci-${crypto.randomUUID().slice(0, 8)}`;
}

async function readNotebook(notebookPath: string): Promise<Notebook | null> {
  try {
    const content = await fs.readFile(notebookPath, "utf-8");
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
  await durableAtomicWrite(notebookPath, JSON.stringify(notebook, null, 2));
}

export default tool({
  name: "notebook-writer",
  description:
    "Write and manage Jupyter notebooks for VibeSci research. " +
    "Actions: ensure_notebook, append_cell, upsert_report_cell, finalize. " +
    "Uses atomic writes and nbformat 4.5 with cell IDs.",

  parameters: {
    type: "object",
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
      notebookPath: {
        type: "string",
        description: "Absolute path to notebook file (.ipynb)",
      },
      researchSessionID: {
        type: "string",
        description: "Session ID (required when creating new notebook)",
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
      reportContent: {
        type: "string",
        description: "Markdown content for upsert_report_cell",
      },
    },
    required: ["action", "notebookPath"],
  },

  async execute(args: {
    action: "ensure_notebook" | "append_cell" | "upsert_report_cell" | "finalize";
    notebookPath: string;
    researchSessionID?: string;
    cellType?: "code" | "markdown";
    source?: string[];
    outputs?: CellOutput[];
    executionCount?: number;
    reportContent?: string;
  }) {
    const { action, notebookPath } = args;

    let notebook = await readNotebook(notebookPath);
    const isNew = notebook === null;

    if (isNew) {
      notebook = createEmptyNotebook(args.researchSessionID || "unknown");
    }

    const nb = notebook as Notebook;

    switch (action) {
      case "ensure_notebook": {
        if (findReportCellByMetadata(nb) === -1) {
          nb.cells.unshift(createReportCell());
        }
        await saveNotebookWithCellIds(notebookPath, nb);
        return JSON.stringify({
          success: true,
          created: isNew,
          cellCount: nb.cells.length,
          hasReportCell: true,
          message: isNew
            ? `Created new notebook with report cell at ${notebookPath}`
            : `Notebook exists with ${nb.cells.length} cells`,
        });
      }

      case "append_cell": {
        if (!args.cellType) {
          return JSON.stringify({ success: false, error: "cellType is required for append_cell" });
        }

        const cellId = generateCellId();
        const cell: NotebookCell = {
          cell_type: args.cellType,
          id: cellId,
          source: args.source || [],
          metadata: {
            vibesci: {
              type: "research",
              lastUpdated: new Date().toISOString(),
            } as VibeSciCellMetadata,
          },
        };

        if (args.cellType === "code") {
          cell.execution_count = args.executionCount ?? null;
          cell.outputs = args.outputs || [];
        }

        nb.cells.push(cell);
        await saveNotebookWithCellIds(notebookPath, nb);

        return JSON.stringify({
          success: true,
          cellId,
          cellIndex: nb.cells.length - 1,
          cellCount: nb.cells.length,
          message: `Appended ${args.cellType} cell "${cellId}"`,
        });
      }

      case "upsert_report_cell": {
        const reportSource = args.reportContent
          ? args.reportContent.split("\n").map((line, i, arr) =>
              i < arr.length - 1 ? line + "\n" : line
            )
          : ["# Research Report\n", "\n", "*No content provided.*\n"];

        const reportIdx = findReportCellByMetadata(nb);

        if (reportIdx >= 0) {
          const existingCell = nb.cells[reportIdx];
          existingCell.source = reportSource;

          const metadata = existingCell.metadata?.vibesci as VibeSciCellMetadata;
          if (metadata) {
            metadata.version = (metadata.version || 0) + 1;
            metadata.lastUpdated = new Date().toISOString();
          } else {
            existingCell.metadata = {
              ...existingCell.metadata,
              vibesci: {
                type: "report",
                version: 1,
                lastUpdated: new Date().toISOString(),
              } as VibeSciCellMetadata,
            };
          }

          await saveNotebookWithCellIds(notebookPath, nb);

          return JSON.stringify({
            success: true,
            action: "updated",
            cellId: existingCell.id,
            version: (existingCell.metadata?.vibesci as VibeSciCellMetadata)?.version,
            message: "Updated existing report cell",
          });
        } else {
          const cell = createReportCell();
          cell.source = reportSource;
          nb.cells.unshift(cell);

          await saveNotebookWithCellIds(notebookPath, nb);

          return JSON.stringify({
            success: true,
            action: "created",
            cellId: cell.id,
            version: 1,
            message: "Created new report cell",
          });
        }
      }

      case "finalize": {
        const vibesci = nb.metadata.vibesci as VibeSciNotebookMetadata;
        vibesci.finalized = new Date().toISOString();

        await saveNotebookWithCellIds(notebookPath, nb);

        return JSON.stringify({
          success: true,
          finalized: true,
          finalizedAt: vibesci.finalized,
          cellCount: nb.cells.length,
          message: `Notebook finalized at ${vibesci.finalized}`,
        });
      }

      default: {
        return JSON.stringify({ success: false, error: `Unknown action: ${action}` });
      }
    }
  },
});
