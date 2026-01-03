/**
 * Report Markdown Library - Generate publication-quality research reports.
 *
 * Features:
 * - Parse markers from notebook cell outputs
 * - Scan outputs directory for artifacts
 * - Generate markdown reports with sentinel blocks
 * - VibeQuant-style report format
 *
 * Report Structure:
 * - Executive Summary (objective, metrics, status)
 * - Methodology
 * - Performance Metrics table
 * - Key Findings
 * - Output Files
 * - Conclusion
 *
 * @module report-markdown
 */

import * as fs from "fs/promises";
import * as path from "path";
import { parseMarkers, ParsedMarker, getMarkersByType } from "./marker-parser";
import { Notebook, NotebookCell } from "./cell-identity";
import { extractFrontmatter, GyoshuFrontmatter } from "./notebook-frontmatter";
import { getNotebookPath, getReportDir, getReportReadmePath, getReportsRootDir } from "./paths";

export interface ArtifactEntry {
  filename: string;
  relativePath: string;
  sizeBytes: number;
  sizeFormatted: string;
  type: "figure" | "model" | "export" | "other";
  description?: string;
}

/**
 * Context object containing all research data suitable for AI report generation.
 * This structured format allows the AI paper writer to generate narrative reports.
 */
export interface ReportContext {
  /** Research title derived from reportTitle or slug */
  title: string;
  /** Primary research objective */
  objective: string;
  /** List of hypotheses tested */
  hypotheses: string[];
  /** Description of methodology used (if available) */
  methodology: string;
  /** Key findings discovered during research */
  findings: string[];
  /** Named metrics with values */
  metrics: Array<{ name: string; value: string }>;
  /** Known limitations of the research */
  limitations: string[];
  /** Suggested next steps */
  nextSteps: string[];
  /** Artifacts created during research */
  artifacts: ArtifactEntry[];
  /** Combined raw cell outputs for additional context */
  rawOutputs: string;
  /** Notebook frontmatter metadata */
  frontmatter?: GyoshuFrontmatter;
  /** Conclusion statement if available */
  conclusion?: string;
}

export interface MetricEntry {
  name: string;
  value: string;
  subtype?: string;
}

export interface ExecutionHistoryEntry {
  stageId: string;
  status: "completed" | "interrupted" | "failed";
  duration?: string;
  startedAt?: string;
}

export interface ReportModel {
  title: string;
  objective?: string;
  hypotheses: string[];
  methodology?: string;
  metrics: MetricEntry[];
  findings: string[];
  limitations: string[];
  nextSteps: string[];
  conclusion?: string;
  artifacts: ArtifactEntry[];
  frontmatter?: GyoshuFrontmatter;
  generatedAt: string;
  executionHistory?: ExecutionHistoryEntry[];
}

const SENTINEL_BEGIN = (name: string) => `<!-- GYOSHU:REPORT:${name}:BEGIN -->`;
const SENTINEL_END = (name: string) => `<!-- GYOSHU:REPORT:${name}:END -->`;

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function inferArtifactType(filepath: string): ArtifactEntry["type"] {
  const dir = path.dirname(filepath);
  const ext = path.extname(filepath).toLowerCase();

  if (dir.includes("figures") || dir.includes("plots")) return "figure";
  if (dir.includes("models")) return "model";
  if (dir.includes("exports") || dir.includes("data")) return "export";

  if ([".png", ".jpg", ".jpeg", ".svg", ".pdf"].includes(ext)) return "figure";
  if ([".pkl", ".joblib", ".pt", ".h5", ".onnx"].includes(ext)) return "model";
  if ([".csv", ".parquet", ".json", ".xlsx"].includes(ext)) return "export";

  return "other";
}

export function extractMarkersFromNotebook(notebook: Notebook): ParsedMarker[] {
  const allText: string[] = [];

  for (const cell of notebook.cells) {
    if (cell.cell_type !== "code" || !cell.outputs) continue;

    for (const output of cell.outputs as Array<Record<string, unknown>>) {
      if (output.output_type === "stream" && output.name === "stdout") {
        const text = Array.isArray(output.text)
          ? (output.text as string[]).join("")
          : String(output.text || "");
        allText.push(text);
      }
    }
  }

  return parseMarkers(allText.join("\n")).markers;
}

export async function scanOutputsDirectory(outputsDir: string): Promise<ArtifactEntry[]> {
  const artifacts: ArtifactEntry[] = [];

  async function scanDir(dir: string, basePath: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.join(basePath, entry.name);

        if (entry.isDirectory()) {
          await scanDir(fullPath, relativePath);
        } else if (entry.isFile()) {
          try {
            const stat = await fs.stat(fullPath);
            artifacts.push({
              filename: entry.name,
              relativePath,
              sizeBytes: stat.size,
              sizeFormatted: formatBytes(stat.size),
              type: inferArtifactType(relativePath),
            });
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch {
      // Directory doesn't exist or not readable
    }
  }

  await scanDir(outputsDir, "");
  return artifacts;
}

export function buildReportModel(
  frontmatter: GyoshuFrontmatter | undefined,
  markers: ParsedMarker[],
  artifacts: ArtifactEntry[]
): ReportModel {
  const objectives = getMarkersByType(markers, "OBJECTIVE");
  const hypotheses = getMarkersByType(markers, "HYPOTHESIS");
  const findings = getMarkersByType(markers, "FINDING");
  const conclusions = getMarkersByType(markers, "CONCLUSION");
  const metrics = getMarkersByType(markers, "METRIC");
  const limitations = getMarkersByType(markers, "LIMITATION");
  const nextSteps = getMarkersByType(markers, "NEXT_STEP");

  const titleSource = frontmatter?.reportTitle || frontmatter?.slug;
  const title = titleSource
    ? titleSource
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    : "Research";

  // Extract STAGE markers for execution history
  const stageMarkers = getMarkersByType(markers, "STAGE");
  const executionHistory: ExecutionHistoryEntry[] = [];

  for (const marker of stageMarkers) {
    if (marker.subtype === "end" && marker.attributes) {
      executionHistory.push({
        stageId: marker.attributes.id || "unknown",
        status: marker.attributes.status === "interrupted" ? "interrupted" : "completed",
        duration: marker.attributes.duration,
      });
    }
  }

  return {
    title,
    objective: objectives[0]?.content,
    hypotheses: hypotheses.map((m) => m.content),
    methodology: undefined,
    metrics: metrics.map((m) => ({
      name: m.subtype || "metric",
      value: m.content,
      subtype: m.subtype,
    })),
    findings: findings.map((m) => m.content),
    limitations: limitations.map((m) => m.content),
    nextSteps: nextSteps.map((m) => m.content),
    conclusion: conclusions[conclusions.length - 1]?.content,
    artifacts,
    frontmatter,
    generatedAt: new Date().toISOString(),
    executionHistory: executionHistory.length > 0 ? executionHistory : undefined,
  };
}

export function renderReportMarkdown(model: ReportModel): string {
  const lines: string[] = [];

  lines.push(`# ${model.title} Research Report`);
  lines.push("");

  lines.push(SENTINEL_BEGIN("EXEC_SUMMARY"));
  lines.push("## Executive Summary");
  lines.push("");
  if (model.objective) {
    lines.push(`**Research Goal**: ${model.objective}`);
  }
  if (model.metrics.length > 0) {
    const metricSummary = model.metrics
      .slice(0, 3)
      .map((m) => `${m.name}=${m.value}`)
      .join(", ");
    lines.push(`**Key Metrics**: ${metricSummary}`);
  }
  const status = model.frontmatter?.status || "active";
  lines.push(`**Status**: ${status.charAt(0).toUpperCase() + status.slice(1)}`);
  lines.push("");
  lines.push(SENTINEL_END("EXEC_SUMMARY"));
  lines.push("");

  if (model.hypotheses.length > 0) {
    lines.push(SENTINEL_BEGIN("HYPOTHESES"));
    lines.push("## Hypotheses");
    lines.push("");
    for (const h of model.hypotheses) {
      lines.push(`- ${h}`);
    }
    lines.push("");
    lines.push(SENTINEL_END("HYPOTHESES"));
    lines.push("");
  }

  if (model.metrics.length > 0) {
    lines.push(SENTINEL_BEGIN("METRICS"));
    lines.push("## Performance Metrics");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    for (const m of model.metrics) {
      lines.push(`| ${m.name} | ${m.value} |`);
    }
    lines.push("");
    lines.push(SENTINEL_END("METRICS"));
    lines.push("");
  }

  if (model.findings.length > 0) {
    lines.push(SENTINEL_BEGIN("FINDINGS"));
    lines.push("## Key Findings");
    lines.push("");
    for (let i = 0; i < model.findings.length; i++) {
      lines.push(`${i + 1}. ${model.findings[i]}`);
    }
    lines.push("");
    lines.push(SENTINEL_END("FINDINGS"));
    lines.push("");
  }

  if (model.limitations.length > 0) {
    lines.push(SENTINEL_BEGIN("LIMITATIONS"));
    lines.push("## Limitations");
    lines.push("");
    for (const l of model.limitations) {
      lines.push(`- ${l}`);
    }
    lines.push("");
    lines.push(SENTINEL_END("LIMITATIONS"));
    lines.push("");
  }

  if (model.artifacts.length > 0) {
    lines.push(SENTINEL_BEGIN("ARTIFACTS"));
    lines.push("## Output Files");
    lines.push("");

    const sorted = [...model.artifacts].sort((a, b) => {
      const order = { figure: 0, export: 1, model: 2, other: 3 };
      return order[a.type] - order[b.type];
    });

    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const desc = a.description || `${a.type} file`;
      lines.push(`${i + 1}. \`${a.relativePath}\` (${a.sizeFormatted}) - ${desc}`);
    }
    lines.push("");
    lines.push(SENTINEL_END("ARTIFACTS"));
    lines.push("");
  }

  if (model.nextSteps.length > 0) {
    lines.push(SENTINEL_BEGIN("NEXT_STEPS"));
    lines.push("## Recommended Next Steps");
    lines.push("");
    for (const n of model.nextSteps) {
      lines.push(`- ${n}`);
    }
    lines.push("");
    lines.push(SENTINEL_END("NEXT_STEPS"));
    lines.push("");
  }

  if (model.executionHistory && model.executionHistory.length > 0) {
    lines.push(SENTINEL_BEGIN("EXECUTION_HISTORY"));
    lines.push("## Execution History");
    lines.push("");
    lines.push("| Stage | Status | Duration |");
    lines.push("|-------|--------|----------|");
    for (const entry of model.executionHistory) {
      const status = entry.status === "completed" ? "✅" : "⚠️";
      lines.push(`| ${entry.stageId} | ${status} ${entry.status} | ${entry.duration || "-"} |`);
    }
    lines.push("");

    const interrupts = model.executionHistory.filter(e => e.status === "interrupted");
    if (interrupts.length > 0) {
      lines.push(`*Note: ${interrupts.length} stage(s) were interrupted and resumed.*`);
      lines.push("");
    }

    lines.push(SENTINEL_END("EXECUTION_HISTORY"));
    lines.push("");
  }

  if (model.conclusion) {
    lines.push(SENTINEL_BEGIN("CONCLUSION"));
    lines.push("## Conclusion");
    lines.push("");
    lines.push(model.conclusion);
    lines.push("");
    lines.push(SENTINEL_END("CONCLUSION"));
    lines.push("");
  }

  lines.push("---");
  lines.push(`*Generated: ${model.generatedAt}*`);
  lines.push("");

  return lines.join("\n");
}

export async function generateReport(
  reportTitle: string
): Promise<{ reportPath: string; model: ReportModel }> {
  const notebookPath = getNotebookPath(reportTitle);
  const reportDir = getReportDir(reportTitle);
  const reportPath = getReportReadmePath(reportTitle);

  let notebook: Notebook;
  try {
    const content = await fs.readFile(notebookPath, "utf-8");
    notebook = JSON.parse(content) as Notebook;
  } catch (e) {
    throw new Error(`Failed to read notebook: ${(e as Error).message}`);
  }

  const frontmatter = extractFrontmatter(notebook);
  const markers = extractMarkersFromNotebook(notebook);
  const artifacts = await scanOutputsDirectory(reportDir);

  const model = buildReportModel(frontmatter, markers, artifacts);
  const markdown = renderReportMarkdown(model);

  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(reportPath, markdown, "utf-8");

  return { reportPath, model };
}

export async function readExistingReport(reportPath: string): Promise<string | null> {
  try {
    return await fs.readFile(reportPath, "utf-8");
  } catch {
    return null;
  }
}

function extractRawOutputsFromNotebook(notebook: Notebook): string {
  const outputs: string[] = [];

  for (const cell of notebook.cells) {
    if (cell.cell_type !== "code" || !cell.outputs) continue;

    for (const output of cell.outputs as Array<Record<string, unknown>>) {
      if (output.output_type === "stream" && output.name === "stdout") {
        const text = Array.isArray(output.text)
          ? (output.text as string[]).join("")
          : String(output.text || "");
        outputs.push(text);
      }
    }
  }

  return outputs.join("\n");
}

function formatTitleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function gatherReportContext(reportTitle: string): Promise<ReportContext> {
  const notebookPath = getNotebookPath(reportTitle);
  const reportDir = getReportDir(reportTitle);

  let notebook: Notebook;
  try {
    const content = await fs.readFile(notebookPath, "utf-8");
    notebook = JSON.parse(content) as Notebook;
  } catch (e) {
    throw new Error(`Failed to read notebook for context: ${(e as Error).message}`);
  }

  const frontmatter = extractFrontmatter(notebook);
  const markers = extractMarkersFromNotebook(notebook);
  const artifacts = await scanOutputsDirectory(reportDir);

  // SECURITY: rawOutputs is untrusted notebook output - do not execute as code.
  // Limit size to prevent memory issues with large outputs.
  const MAX_RAW_OUTPUT_LENGTH = 10000;
  const allOutputText = extractRawOutputsFromNotebook(notebook);
  const rawOutputs = allOutputText.slice(0, MAX_RAW_OUTPUT_LENGTH);

  const objectives = getMarkersByType(markers, "OBJECTIVE");
  const hypotheses = getMarkersByType(markers, "HYPOTHESIS");
  const findings = getMarkersByType(markers, "FINDING");
  const conclusions = getMarkersByType(markers, "CONCLUSION");
  const metrics = getMarkersByType(markers, "METRIC");
  const limitations = getMarkersByType(markers, "LIMITATION");
  const nextSteps = getMarkersByType(markers, "NEXT_STEP");
  const experiments = getMarkersByType(markers, "EXPERIMENT");
  const analyses = getMarkersByType(markers, "ANALYSIS");

  const titleSource = frontmatter?.reportTitle || frontmatter?.slug || reportTitle;
  const title = formatTitleFromSlug(titleSource);

  const methodologyParts: string[] = [];
  if (experiments.length > 0) {
    methodologyParts.push(...experiments.map((m) => m.content));
  }
  if (analyses.length > 0 && methodologyParts.length === 0) {
    methodologyParts.push(analyses[0]?.content || "");
  }

  return {
    title,
    objective: objectives[0]?.content || "",
    hypotheses: hypotheses.map((m) => m.content),
    methodology: methodologyParts.join(" "),
    findings: findings.map((m) => m.content),
    metrics: metrics.map((m) => ({
      name: m.subtype || "metric",
      value: m.content,
    })),
    limitations: limitations.map((m) => m.content),
    nextSteps: nextSteps.map((m) => m.content),
    artifacts,
    rawOutputs,
    frontmatter,
    conclusion: conclusions[conclusions.length - 1]?.content,
  };
}

export function upsertSentinelBlock(
  existingContent: string,
  blockName: string,
  newContent: string
): string {
  const beginMarker = SENTINEL_BEGIN(blockName);
  const endMarker = SENTINEL_END(blockName);

  const pattern = new RegExp(
    `${beginMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${endMarker.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    )}`,
    "g"
  );

  if (pattern.test(existingContent)) {
    return existingContent.replace(pattern, `${beginMarker}\n${newContent}\n${endMarker}`);
  }

  return existingContent + `\n${beginMarker}\n${newContent}\n${endMarker}\n`;
}
