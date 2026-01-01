/**
 * Gyoshu Completion Tool - Structured completion signaling with evidence.
 * Part of two-layer completion: worker proposes via this tool, planner verifies via snapshot.
 * @module gyoshu-completion
 */

import { tool } from "@opencode-ai/plugin";
import { durableAtomicWrite, fileExists, readFile } from "../lib/atomic-write";
import { getLegacyManifestPath } from "../lib/paths";
import { generateReport } from "../lib/report-markdown";
import { exportToPdf } from "../lib/pdf-export";

interface KeyResult {
  name: string;
  value: string;
  type: string;
}

interface CompletionEvidence {
  executedCellIds: string[];
  artifactPaths: string[];
  keyResults: KeyResult[];
}

type CompletionStatus = "SUCCESS" | "PARTIAL" | "BLOCKED" | "ABORTED" | "FAILED";

interface CompletionRecord {
  timestamp: string;
  status: CompletionStatus;
  summary: string;
  evidence?: CompletionEvidence;
  nextSteps?: string;
  blockers?: string[];
}

interface SessionManifest {
  researchSessionID: string;
  created: string;
  updated: string;
  status: "active" | "completed" | "archived";
  notebookPath: string;
  goalStatus?: string; // COMPLETED | IN_PROGRESS | BLOCKED | ABORTED | FAILED
  completion?: CompletionRecord;
  [key: string]: unknown;
}

interface ValidationWarning {
  code: string;
  message: string;
  severity: "warning" | "error";
}

function getManifestPath(sessionId: string): string {
  return getLegacyManifestPath(sessionId);
}

function validateSessionId(sessionId: string): void {
  if (!sessionId || typeof sessionId !== "string") {
    throw new Error("researchSessionID is required and must be a string");
  }

  if (sessionId.includes("..") || sessionId.includes("/") || sessionId.includes("\\")) {
    throw new Error("Invalid researchSessionID: contains path traversal characters");
  }

  if (sessionId.trim().length === 0) {
    throw new Error("Invalid researchSessionID: cannot be empty or whitespace");
  }

  if (sessionId.length > 255) {
    throw new Error("Invalid researchSessionID: exceeds maximum length of 255 characters");
  }
}

function validateEvidence(
  status: CompletionStatus,
  evidence: CompletionEvidence | undefined,
  blockers: string[] | undefined
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  if (status === "SUCCESS" || status === "PARTIAL") {
    if (!evidence) {
      warnings.push({
        code: "MISSING_EVIDENCE",
        message: `${status} status requires evidence object`,
        severity: "error",
      });
      return warnings;
    }

    if (status === "SUCCESS" && (!evidence.executedCellIds || evidence.executedCellIds.length === 0)) {
      warnings.push({
        code: "NO_EXECUTED_CELLS",
        message: "SUCCESS status requires at least one executed cell",
        severity: "error",
      });
    }

    if (status === "SUCCESS" && (!evidence.keyResults || evidence.keyResults.length === 0)) {
      warnings.push({
        code: "NO_KEY_RESULTS",
        message: "SUCCESS status requires at least one key result",
        severity: "error",
      });
    }

    if (status === "PARTIAL") {
      if ((!evidence.executedCellIds || evidence.executedCellIds.length === 0) &&
          (!evidence.keyResults || evidence.keyResults.length === 0)) {
        warnings.push({
          code: "INSUFFICIENT_PARTIAL_EVIDENCE",
          message: "PARTIAL status should have at least some executed cells or key results",
          severity: "warning",
        });
      }
    }

    if (!evidence.artifactPaths || evidence.artifactPaths.length === 0) {
      warnings.push({
        code: "NO_ARTIFACTS",
        message: "No artifacts recorded (this is informational, not an error)",
        severity: "warning",
      });
    }
  }

  if (status === "BLOCKED") {
    if (!blockers || blockers.length === 0) {
      warnings.push({
        code: "NO_BLOCKERS",
        message: "BLOCKED status requires at least one blocker reason",
        severity: "error",
      });
    }
  }

  return warnings;
}

function hasErrors(warnings: ValidationWarning[]): boolean {
  return warnings.some((w) => w.severity === "error");
}

// Map CompletionStatus to GoalStatus for manifest
// The planner expects: COMPLETED | IN_PROGRESS | BLOCKED | ABORTED | FAILED
// But completion tool uses: SUCCESS | PARTIAL | BLOCKED | ABORTED | FAILED
function mapToGoalStatus(status: CompletionStatus): string {
  switch (status) {
    case "SUCCESS":
      return "COMPLETED";
    case "PARTIAL":
      return "IN_PROGRESS";
    default:
      return status;
  }
}

interface ReportResult {
  generated: boolean;
  reportPath?: string;
  error?: string;
}

interface PdfResult {
  exported: boolean;
  pdfPath?: string;
  converter?: string;
  error?: string;
}

async function tryGenerateReport(
  reportTitle: string | undefined
): Promise<ReportResult> {
  if (!reportTitle) {
    return { generated: false, error: "No reportTitle provided for report generation" };
  }

  try {
    const { reportPath } = await generateReport(reportTitle);
    return { generated: true, reportPath };
  } catch (err) {
    return { generated: false, error: (err as Error).message };
  }
}

async function tryExportPdf(reportPath: string | undefined): Promise<PdfResult> {
  if (!reportPath) {
    return { exported: false, error: "No report path available for PDF export" };
  }

  if (!reportPath.endsWith(".md")) {
    return { exported: false, error: "Report path must end with .md extension" };
  }

  try {
    const pdfPath = reportPath.replace(/\.md$/, ".pdf");
    const result = await exportToPdf(reportPath, pdfPath);
    
    if (result.success) {
      return { 
        exported: true, 
        pdfPath: result.pdfPath,
        converter: result.converter,
      };
    } else {
      return { 
        exported: false, 
        error: result.error,
      };
    }
  } catch (err) {
    return { exported: false, error: (err as Error).message };
  }
}

export default tool({
  name: "gyoshu_completion",
  description:
    "Signal research session completion with structured evidence. " +
    "Validates evidence is present for SUCCESS/PARTIAL status, " +
    "updates session manifest goalStatus, and returns confirmation with validation. " +
    "Part of two-layer completion: worker proposes via this tool, planner verifies via snapshot.",
  args: {
    researchSessionID: tool.schema
      .string()
      .describe("Unique session identifier"),
    status: tool.schema
      .enum(["SUCCESS", "PARTIAL", "BLOCKED", "ABORTED", "FAILED"])
      .describe(
        "Completion status: " +
        "SUCCESS (goal achieved with evidence), " +
        "PARTIAL (some progress, incomplete), " +
        "BLOCKED (cannot proceed due to blockers), " +
        "ABORTED (intentionally stopped), " +
        "FAILED (unrecoverable error)"
      ),
    summary: tool.schema
      .string()
      .describe("Summary of what was accomplished or why completion failed"),
    evidence: tool.schema
      .any()
      .optional()
      .describe(
        "Evidence for SUCCESS/PARTIAL: { executedCellIds: string[], " +
        "artifactPaths: string[], keyResults: Array<{name, value, type}> }"
      ),
    nextSteps: tool.schema
      .string()
      .optional()
      .describe("Suggested next steps for continuing research"),
    blockers: tool.schema
      .any()
      .optional()
      .describe("Array of blocker reasons (required for BLOCKED status)"),
    exportPdf: tool.schema
      .boolean()
      .optional()
      .describe("Export report to PDF when status is SUCCESS (requires pandoc, wkhtmltopdf, or weasyprint)"),
    reportTitle: tool.schema
      .string()
      .optional()
      .describe("Report title for report generation (e.g., 'my-research' for notebooks/my-research.ipynb)"),
  },

  async execute(args) {
    const { researchSessionID, status, summary, evidence, nextSteps, blockers, exportPdf, reportTitle } = args;

    validateSessionId(researchSessionID);

    const manifestPath = getManifestPath(researchSessionID);
    if (!(await fileExists(manifestPath))) {
      throw new Error(`Session '${researchSessionID}' not found. Cannot signal completion for non-existent session.`);
    }

    const typedEvidence = evidence as CompletionEvidence | undefined;
    const typedBlockers = blockers as string[] | undefined;

    const warnings = validateEvidence(status, typedEvidence, typedBlockers);
    const valid = !hasErrors(warnings);

    const manifest = await readFile<SessionManifest>(manifestPath, true);

    const completionRecord: CompletionRecord = {
      timestamp: new Date().toISOString(),
      status,
      summary,
    };

    if (typedEvidence) {
      completionRecord.evidence = typedEvidence;
    }

    if (nextSteps) {
      completionRecord.nextSteps = nextSteps;
    }

    if (typedBlockers && typedBlockers.length > 0) {
      completionRecord.blockers = typedBlockers;
    }

    const updatedManifest: SessionManifest = {
      ...manifest,
      updated: new Date().toISOString(),
      goalStatus: mapToGoalStatus(status),
      completion: completionRecord,
    };

    if (status === "SUCCESS") {
      updatedManifest.status = "completed";
    }

    if (valid) {
      await durableAtomicWrite(manifestPath, JSON.stringify(updatedManifest, null, 2));
    }

    let reportResult: ReportResult | undefined;
    let pdfResult: PdfResult | undefined;
    if (valid && status === "SUCCESS") {
      reportResult = await tryGenerateReport(reportTitle);
      
      if (exportPdf && reportResult.generated && reportResult.reportPath) {
        pdfResult = await tryExportPdf(reportResult.reportPath);
      }
    }

    const response: Record<string, unknown> = {
      success: valid,
      researchSessionID,
      status,
      valid,
      warnings: warnings.length > 0 ? warnings : undefined,
      message: valid
        ? `Completion signal recorded: ${status}`
        : `Completion signal rejected due to validation errors`,
      completion: valid ? completionRecord : undefined,
      manifestUpdated: valid,
      summary: {
        status,
        hasEvidence: !!typedEvidence,
        executedCellCount: typedEvidence?.executedCellIds?.length ?? 0,
        keyResultCount: typedEvidence?.keyResults?.length ?? 0,
        artifactCount: typedEvidence?.artifactPaths?.length ?? 0,
        blockerCount: typedBlockers?.length ?? 0,
      },
    };

    if (reportResult) {
      response.report = reportResult;
    }

    if (pdfResult) {
      response.pdf = pdfResult;
    }

    return JSON.stringify(response, null, 2);
  },
});
