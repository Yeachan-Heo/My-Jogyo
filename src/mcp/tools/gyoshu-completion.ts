/**
 * Gyoshu Completion MCP Tool - Structured completion signaling with evidence.
 * Part of two-layer completion: worker proposes via this tool, planner verifies via snapshot.
 *
 * MCP-compatible version of the OpenCode plugin tool.
 *
 * @module mcp/tools/gyoshu-completion
 */

import * as path from "path";
import { durableAtomicWrite, fileExists, readFile, readFileNoFollow } from "../../lib/atomic-write";
import { getSessionDir, getNotebookPath, getLegacyManifestPath, validatePathSegment } from "../../lib/paths";
import { gatherReportContext, ReportContext, generateReport } from "../../lib/report-markdown";
import { exportToPdf, PdfExportResult } from "../../lib/pdf-export";
import { runQualityGates, QualityGateResult } from "../../lib/quality-gates";
import { evaluateGoalGate, recommendPivot, GoalGateResult } from "../../lib/goal-gates";
import { evaluateReportGate, ReportGateResult } from "../../lib/report-gates";
import { extractFrontmatter, GyoshuFrontmatter } from "../../lib/notebook-frontmatter";
import type { Notebook } from "../../lib/cell-identity";
import { getReportLockPath, DEFAULT_LOCK_TIMEOUT_MS } from "../../lib/lock-paths";
import { withLock } from "../../lib/session-lock";
import { isValidBridgeMeta, type BridgeMeta } from "../../lib/bridge-meta";

// =============================================================================
// CONSTANTS
// =============================================================================

const BRIDGE_META_FILE = "bridge_meta.json";

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

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

interface ChallengeResponse {
  challengeId: string;
  response: string;
  verificationCode?: string;
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

// =============================================================================
// MCP TOOL DEFINITION
// =============================================================================

/**
 * MCP Tool definition for gyoshu_completion.
 */
export const gyoshuCompletionTool = {
  name: "gyoshu_completion",
  description:
    "Signal research session completion with structured evidence. " +
    "Validates evidence is present for SUCCESS/PARTIAL status, " +
    "updates session manifest goalStatus, and returns confirmation with validation. " +
    "Part of two-layer completion: worker proposes via this tool, planner verifies via snapshot.",
  inputSchema: {
    type: "object" as const,
    properties: {
      researchSessionID: {
        type: "string",
        description: "Unique session identifier",
      },
      status: {
        type: "string",
        enum: ["SUCCESS", "PARTIAL", "BLOCKED", "ABORTED", "FAILED"],
        description:
          "Completion status: " +
          "SUCCESS (goal achieved with evidence), " +
          "PARTIAL (some progress, incomplete), " +
          "BLOCKED (cannot proceed due to blockers), " +
          "ABORTED (intentionally stopped), " +
          "FAILED (unrecoverable error)",
      },
      summary: {
        type: "string",
        description: "Summary of what was accomplished or why completion failed",
      },
      evidence: {
        type: "object",
        description:
          "Evidence for SUCCESS/PARTIAL: { executedCellIds: string[], " +
          "artifactPaths: string[], keyResults: Array<{name, value, type}> }",
        properties: {
          executedCellIds: {
            type: "array",
            items: { type: "string" },
          },
          artifactPaths: {
            type: "array",
            items: { type: "string" },
          },
          keyResults: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                value: { type: "string" },
                type: { type: "string" },
              },
              required: ["name", "value", "type"],
            },
          },
        },
      },
      nextSteps: {
        type: "string",
        description: "Suggested next steps for continuing research",
      },
      blockers: {
        type: "array",
        items: { type: "string" },
        description: "Array of blocker reasons (required for BLOCKED status)",
      },
      exportPdf: {
        type: "boolean",
        description:
          "Export report to PDF when status is SUCCESS (requires pandoc, wkhtmltopdf, or weasyprint)",
      },
      reportTitle: {
        type: "string",
        description:
          "Report title for report generation (e.g., 'my-research' for notebooks/my-research.ipynb)",
      },
      challengeRound: {
        type: "number",
        description:
          "Current challenge round (0 = initial submission, 1+ = rework submission after Baksa challenge)",
      },
      challengeResponses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            challengeId: { type: "string" },
            response: { type: "string" },
            verificationCode: { type: "string" },
          },
          required: ["challengeId", "response"],
        },
        description:
          "Responses to specific challenges from Baksa: Array<{ challengeId: string, response: string, verificationCode?: string }>",
      },
    },
    required: ["researchSessionID", "status", "summary"],
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getManifestPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), "session_manifest.json");
}

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

function createMinimalManifestFromBridgeMeta(
  sessionId: string,
  bridgeMeta: BridgeMeta
): SessionManifest {
  // Accept both startedAt (python-repl.ts) and bridgeStarted (session-manager.ts)
  const timestamp = bridgeMeta.bridgeStarted || bridgeMeta.startedAt || new Date().toISOString();
  return {
    researchSessionID: sessionId,
    created: timestamp,
    updated: timestamp,
    status: "active",
    notebookPath: bridgeMeta.notebookPath || "",
    reportTitle: bridgeMeta.reportTitle,
  };
}

interface ManifestLoadResult {
  manifest: SessionManifest;
  source: "session_manifest" | "bridge_meta" | "legacy_manifest";
}

async function loadSessionManifest(sessionId: string): Promise<ManifestLoadResult | null> {
  const manifestPath = getManifestPath(sessionId);
  if (await fileExists(manifestPath)) {
    const manifest = await readFile<SessionManifest>(manifestPath, true).catch(() => null);
    if (manifest) {
      return { manifest, source: "session_manifest" };
    }
  }

  const bridgeMeta = await readBridgeMeta(sessionId);
  if (bridgeMeta) {
    const manifest = createMinimalManifestFromBridgeMeta(sessionId, bridgeMeta);
    return { manifest, source: "bridge_meta" };
  }

  const legacyPath = getLegacyManifestPath(sessionId);
  if (await fileExists(legacyPath)) {
    const manifest = await readFile<SessionManifest>(legacyPath, true).catch(() => null);
    if (manifest) {
      return { manifest, source: "legacy_manifest" };
    }
  }

  return null;
}

function validateSessionId(sessionId: string): void {
  validatePathSegment(sessionId, "researchSessionID");
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
      if (
        (!evidence.executedCellIds || evidence.executedCellIds.length === 0) &&
        (!evidence.keyResults || evidence.keyResults.length === 0)
      ) {
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

function validateChallengeEvidence(
  challengeRound: number | undefined,
  evidence: CompletionEvidence | undefined,
  challengeResponses: ChallengeResponse[] | undefined
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  if (!challengeRound || challengeRound === 0) {
    return warnings;
  }

  if (!challengeResponses || challengeResponses.length === 0) {
    warnings.push({
      code: "NO_CHALLENGE_RESPONSES",
      message: `Challenge round ${challengeRound} requires challengeResponses addressing Baksa's challenges`,
      severity: "error",
    });
  } else {
    for (const resp of challengeResponses) {
      if (!resp.challengeId || !resp.response) {
        warnings.push({
          code: "INCOMPLETE_CHALLENGE_RESPONSE",
          message: `Challenge response must include challengeId and response text`,
          severity: "error",
        });
        break;
      }
      if (resp.response.length < 20) {
        warnings.push({
          code: "SHALLOW_CHALLENGE_RESPONSE",
          message: `Challenge response for '${resp.challengeId}' is too brief - provide substantive evidence`,
          severity: "warning",
        });
      }
    }
  }

  if (evidence) {
    if (!evidence.keyResults || evidence.keyResults.length < 2) {
      warnings.push({
        code: "INSUFFICIENT_REWORK_RESULTS",
        message: `Rework submission (round ${challengeRound}) requires at least 2 key results to demonstrate improvement`,
        severity: "warning",
      });
    }

    if (challengeResponses && challengeResponses.length > 0) {
      const hasVerificationCode = challengeResponses.some((r) => r.verificationCode);
      if (!hasVerificationCode) {
        warnings.push({
          code: "NO_VERIFICATION_CODE",
          message:
            "Rework submission should include verificationCode in at least one challenge response for reproducibility",
          severity: "warning",
        });
      }
    }
  }

  return warnings;
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

interface AIReportResult {
  ready: boolean;
  context?: ReportContext;
  error?: string;
}

async function tryGatherAIContext(reportTitle: string | undefined): Promise<AIReportResult> {
  if (!reportTitle) {
    return { ready: false, error: "No reportTitle provided for AI report context" };
  }

  try {
    const context = await gatherReportContext(reportTitle);
    return { ready: true, context };
  } catch (err) {
    return { ready: false, error: (err as Error).message };
  }
}

// =============================================================================
// INPUT VALIDATION
// =============================================================================

interface GyoshuCompletionArgs {
  researchSessionID: string;
  status: CompletionStatus;
  summary: string;
  evidence?: CompletionEvidence;
  nextSteps?: string;
  blockers?: string[];
  exportPdf?: boolean;
  reportTitle?: string;
  challengeRound?: number;
  challengeResponses?: ChallengeResponse[];
}

function validateArgs(args: unknown): GyoshuCompletionArgs {
  if (!args || typeof args !== "object") {
    throw new Error("Invalid arguments: expected an object");
  }

  const obj = args as Record<string, unknown>;

  // Required fields
  if (!obj.researchSessionID || typeof obj.researchSessionID !== "string") {
    throw new Error("researchSessionID is required and must be a string");
  }

  if (!obj.status || typeof obj.status !== "string") {
    throw new Error("status is required and must be a string");
  }

  const validStatuses: CompletionStatus[] = ["SUCCESS", "PARTIAL", "BLOCKED", "ABORTED", "FAILED"];
  if (!validStatuses.includes(obj.status as CompletionStatus)) {
    throw new Error(`status must be one of: ${validStatuses.join(", ")}`);
  }

  if (!obj.summary || typeof obj.summary !== "string") {
    throw new Error("summary is required and must be a string");
  }

  return {
    researchSessionID: obj.researchSessionID,
    status: obj.status as CompletionStatus,
    summary: obj.summary,
    evidence: obj.evidence as CompletionEvidence | undefined,
    nextSteps: obj.nextSteps as string | undefined,
    blockers: obj.blockers as string[] | undefined,
    exportPdf: obj.exportPdf as boolean | undefined,
    reportTitle: obj.reportTitle as string | undefined,
    challengeRound: obj.challengeRound as number | undefined,
    challengeResponses: obj.challengeResponses as ChallengeResponse[] | undefined,
  };
}

// =============================================================================
// HANDLER FUNCTION
// =============================================================================

/**
 * Handle gyoshu_completion tool invocation.
 *
 * @param args - Tool arguments (will be validated)
 * @returns JSON string with completion result
 */
export async function handleGyoshuCompletion(args: unknown): Promise<string> {
  const {
    researchSessionID,
    status,
    summary,
    evidence,
    nextSteps,
    blockers,
    exportPdf,
    reportTitle,
    challengeRound,
    challengeResponses,
  } = validateArgs(args);

  validateSessionId(researchSessionID);

  const manifestLoadResult = await loadSessionManifest(researchSessionID);
  if (!manifestLoadResult) {
    throw new Error(
      `Session '${researchSessionID}' not found. ` +
        `No session_manifest.json, bridge_meta.json, or legacy manifest found. ` +
        `Ensure the session was created via python-repl before calling completion.`
    );
  }
  const { manifest: initialManifest, source: manifestSource } = manifestLoadResult;

  const typedEvidence = evidence as CompletionEvidence | undefined;
  const typedBlockers = blockers as string[] | undefined;
  const typedChallengeResponses = challengeResponses as ChallengeResponse[] | undefined;

  const baseWarnings = validateEvidence(status, typedEvidence, typedBlockers);
  const challengeWarnings = validateChallengeEvidence(challengeRound, typedEvidence, typedChallengeResponses);
  const warnings = [...baseWarnings, ...challengeWarnings];
  const valid = !hasErrors(warnings);

  let qualityGateResult: QualityGateResult | undefined;
  let goalGateResult: GoalGateResult | undefined;
  let reportGateResult: ReportGateResult | undefined;
  let frontmatter: GyoshuFrontmatter | null = null;
  let adjustedStatus = status;

  // Fix 1: SUCCESS status requires reportTitle for quality gate validation
  if (status === "SUCCESS" && !reportTitle) {
    adjustedStatus = "PARTIAL";
    warnings.push({
      code: "MISSING_REPORT_TITLE",
      message: "SUCCESS status requires reportTitle for quality gate validation. Downgrading to PARTIAL.",
      severity: "warning",
    });
  }

  if (status === "SUCCESS" && reportTitle) {
    try {
      const notebookPath = getNotebookPath(reportTitle);
      const notebookContent = await readFileNoFollow(notebookPath);
      const notebook = JSON.parse(notebookContent) as Notebook;

      const allOutput: string[] = [];
      for (const cell of notebook.cells) {
        if (cell.cell_type === "code" && cell.outputs) {
          for (const output of cell.outputs as Array<Record<string, unknown>>) {
            if (output.output_type === "stream" && output.name === "stdout") {
              const text = Array.isArray(output.text)
                ? (output.text as string[]).join("")
                : String(output.text || "");
              allOutput.push(text);
            }
          }
        }
      }

      // Run Quality Gates (Trust Gate)
      qualityGateResult = runQualityGates(allOutput.join("\n"));

      if (!qualityGateResult.passed) {
        adjustedStatus = "PARTIAL";
      }

      // Extract frontmatter for Goal Gate evaluation
      frontmatter = extractFrontmatter(notebook);

      // Evaluate Goal Gate (in addition to Trust Gate / quality gates)
      // Only evaluate if frontmatter has a goal_contract (backward compatibility)
      if (adjustedStatus === "SUCCESS" && frontmatter?.goal_contract) {
        goalGateResult = evaluateGoalGate(
          frontmatter.goal_contract,
          allOutput.join("\n"),
          typedEvidence?.artifactPaths || []
        );

        // Apply Two-Gate Decision Matrix
        // If Trust Gate passed (quality gates) but Goal Gate failed
        if (!goalGateResult.passed) {
          adjustedStatus = "PARTIAL";
          warnings.push({
            code: "GOAL_NOT_MET",
            message: `Goal criteria not met: ${goalGateResult.metCount}/${goalGateResult.totalCount} criteria passed`,
            severity: "warning",
          });
        }
      }
      // If no goal_contract, skip Goal Gate (backward compatibility)
    } catch (e) {
      // Fix 2: Don't swallow quality gate errors - downgrade to PARTIAL
      adjustedStatus = "PARTIAL";
      warnings.push({
        code: "QUALITY_GATE_ERROR",
        message: `Quality gate check failed: ${(e as Error).message}. Downgrading to PARTIAL.`,
        severity: "warning",
      });
    }
  }

  // =========================================================================
  // REPORT GENERATION AND REPORT GATE
  // Must run BEFORE manifest write so adjustedStatus changes are persisted
  // =========================================================================
  let aiReportResult: AIReportResult | undefined;
  let generatedReportPath: string | undefined;
  let pdfExportResult: PdfExportResult | undefined;

  // Generate report for both SUCCESS and PARTIAL completions
  // PARTIAL still produces valuable artifacts that should be documented
  if (valid && (adjustedStatus === "SUCCESS" || adjustedStatus === "PARTIAL")) {
    aiReportResult = await tryGatherAIContext(reportTitle);

    if (reportTitle) {
      try {
        // Wrap report generation and PDF export with REPORT_LOCK to prevent
        // concurrent write corruption when multiple processes try to generate
        await withLock(
          getReportLockPath(reportTitle),
          async () => {
            const { reportPath } = await generateReport(reportTitle);
            generatedReportPath = reportPath;

            // Run Report Gate (RGEP v1) - validate report completeness
            // This is the third gate in the Three-Gate system:
            // 1. Trust Gate (quality gates) - statistical rigor
            // 2. Goal Gate - acceptance criteria met
            // 3. Report Gate - report is complete and well-formed
            reportGateResult = evaluateReportGate(reportTitle);

            if (!reportGateResult.passed && adjustedStatus === "SUCCESS") {
              adjustedStatus = "PARTIAL";
              warnings.push({
                code: "REPORT_INCOMPLETE",
                message: `Report Gate failed: ${reportGateResult.violations.length} violation(s). Score: ${reportGateResult.score}/100`,
                severity: "warning",
              });
            }

            // Only export PDF for SUCCESS (fully validated research)
            if (exportPdf && reportPath && adjustedStatus === "SUCCESS") {
              pdfExportResult = await exportToPdf(reportPath);
            }
          },
          DEFAULT_LOCK_TIMEOUT_MS
        );
      } catch (e) {
        process.env.GYOSHU_DEBUG &&
          console.warn(`Report generation failed: ${(e as Error).message}`);
        // Gate failure must fail-safe: downgrade to PARTIAL, never silently pass
        if (adjustedStatus === "SUCCESS") {
          adjustedStatus = "PARTIAL";
          warnings.push({
            code: "REPORT_GENERATION_ERROR",
            message: `Report generation failed: ${(e as Error).message}. Downgrading to PARTIAL.`,
            severity: "warning",
          });
        }
      }
    }
  }

  const manifestPath = getManifestPath(researchSessionID);
  const completionRecord: CompletionRecord = {
    timestamp: new Date().toISOString(),
    status: adjustedStatus,
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
    ...initialManifest,
    updated: new Date().toISOString(),
    goalStatus: mapToGoalStatus(adjustedStatus),
    completion: completionRecord,
  };

  if (adjustedStatus === "SUCCESS") {
    updatedManifest.status = "completed";
  }

  if (valid) {
    await durableAtomicWrite(manifestPath, JSON.stringify(updatedManifest, null, 2));
  }

  const response: Record<string, unknown> = {
    success: valid,
    researchSessionID,
    status: adjustedStatus,
    originalStatus: status !== adjustedStatus ? status : undefined,
    valid,
    warnings: warnings.length > 0 ? warnings : undefined,
    message: valid
      ? `Completion signal recorded: ${adjustedStatus}`
      : `Completion signal rejected due to validation errors`,
    completion: valid ? completionRecord : undefined,
    manifestUpdated: valid,
    manifestSource,
    summary: {
      status: adjustedStatus,
      hasEvidence: !!typedEvidence,
      executedCellCount: typedEvidence?.executedCellIds?.length ?? 0,
      keyResultCount: typedEvidence?.keyResults?.length ?? 0,
      artifactCount: typedEvidence?.artifactPaths?.length ?? 0,
      blockerCount: typedBlockers?.length ?? 0,
    },
    challengeStatus: {
      round: challengeRound ?? 0,
      responsesProvided: typedChallengeResponses?.length ?? 0,
      isRework: (challengeRound ?? 0) > 0,
    },
  };

  if (aiReportResult) {
    response.aiReport = aiReportResult;
    if (generatedReportPath) {
      response.reportPath = generatedReportPath;
      let msg = `Completion signal recorded: ${adjustedStatus}. Report generated at ${generatedReportPath}`;
      if (pdfExportResult?.success) {
        response.pdfPath = pdfExportResult.pdfPath;
        msg += `. PDF exported to ${pdfExportResult.pdfPath}`;
      } else if (pdfExportResult && !pdfExportResult.success) {
        response.pdfError = pdfExportResult.error;
      }
      response.message = msg;
    } else if (aiReportResult.ready) {
      response.message = `Completion signal recorded: ${adjustedStatus}. IMPORTANT: Now invoke jogyo-paper-writer agent with the context below to generate the narrative report.`;
    }
  }

  if (qualityGateResult) {
    response.qualityGates = {
      passed: qualityGateResult.passed,
      score: qualityGateResult.score,
      violations: qualityGateResult.violations,
      findingsValidation: qualityGateResult.findingsValidation,
      mlValidation: qualityGateResult.mlValidation,
    };

    if (!qualityGateResult.passed) {
      response.message = `Completion signal recorded: ${adjustedStatus} (downgraded from SUCCESS due to ${qualityGateResult.violations.length} quality gate violation(s))`;
    }
  }

  if (goalGateResult) {
    response.goalGates = {
      passed: goalGateResult.passed,
      overallStatus: goalGateResult.overallStatus,
      metCount: goalGateResult.metCount,
      totalCount: goalGateResult.totalCount,
      criteriaResults: goalGateResult.criteriaResults,
    };

    if (!goalGateResult.passed && goalGateResult.overallStatus === "NOT_MET") {
      const pivot = recommendPivot(
        goalGateResult,
        1,
        frontmatter?.goal_contract?.max_goal_attempts || 3
      );
      response.pivotRecommendation = pivot;
    }

    if (!goalGateResult.passed) {
      response.message = `Completion signal recorded: ${adjustedStatus} (Goal Gate failed: ${goalGateResult.metCount}/${goalGateResult.totalCount} criteria met)`;
    }
  }

  if (reportGateResult) {
    response.reportGates = {
      passed: reportGateResult.passed,
      overallStatus: reportGateResult.overallStatus,
      score: reportGateResult.score,
      violations: reportGateResult.violations,
      sectionValidation: reportGateResult.sectionValidation,
      findingCount: reportGateResult.findingCount,
    };

    if (!reportGateResult.passed) {
      response.message = `Completion signal recorded: ${adjustedStatus} (Report Gate failed: score ${reportGateResult.score}/100)`;
    }
  }

  return JSON.stringify(response, null, 2);
}
