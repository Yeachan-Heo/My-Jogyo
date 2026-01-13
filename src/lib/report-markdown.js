"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.separateFindings = separateFindings;
exports.validateIMRADSections = validateIMRADSections;
exports.collectCitationIdentifiers = collectCitationIdentifiers;
exports.resolveCitations = resolveCitations;
exports.extractMarkersFromNotebook = extractMarkersFromNotebook;
exports.scanOutputsDirectory = scanOutputsDirectory;
exports.buildReportModel = buildReportModel;
exports.renderReportMarkdown = renderReportMarkdown;
exports.generateReport = generateReport;
exports.readExistingReport = readExistingReport;
exports.gatherReportContext = gatherReportContext;
exports.upsertSentinelBlock = upsertSentinelBlock;
const fs = __importStar(require("fs/promises"));
const fsSync = __importStar(require("fs"));
const path = __importStar(require("path"));
const marker_parser_1 = require("./marker-parser");
const atomic_write_1 = require("./atomic-write");
const notebook_frontmatter_1 = require("./notebook-frontmatter");
const paths_1 = require("./paths");
// =============================================================================
// FINDING VERIFICATION - Separate verified vs unverified findings
// =============================================================================
/**
 * Number of lines to look back for statistical evidence before a finding.
 */
const STAT_LOOKBACK_LINES = 10;
/**
 * Check if a STAT marker with specific subtype exists within N lines before a given line.
 *
 * @param markers - All parsed markers
 * @param targetLine - Line number of the finding
 * @param statSubtype - The STAT subtype to look for (e.g., 'ci', 'effect_size')
 * @param lookback - Number of lines to look back (default: 10)
 * @returns true if the required STAT marker exists within the lookback window
 */
function hasStatMarkerBefore(markers, targetLine, statSubtype, lookback = STAT_LOOKBACK_LINES) {
    const minLine = Math.max(1, targetLine - lookback);
    return markers.some((m) => m.type === "STAT" &&
        m.subtype === statSubtype &&
        m.lineNumber >= minLine &&
        m.lineNumber < targetLine);
}
/**
 * Separate findings into verified, partial, and exploratory categories.
 *
 * The "Finding Gating Rule" categorizes findings based on statistical evidence:
 * - Verified: Has both [STAT:ci] and [STAT:effect_size] within 10 lines before
 * - Partial: Has one of [STAT:ci] or [STAT:effect_size]
 * - Exploratory: Missing statistical evidence
 *
 * @param markers - Array of all parsed markers from notebook output
 * @returns SeparatedFindings with verified, partial, and exploratory arrays
 *
 * @example
 * ```typescript
 * const markers = extractMarkersFromNotebook(notebook);
 * const { verified, partial, exploratory } = separateFindings(markers);
 * console.log(`Verified: ${verified.length}, Exploratory: ${exploratory.length}`);
 * ```
 */
function separateFindings(markers) {
    const findings = (0, marker_parser_1.getMarkersByType)(markers, "FINDING");
    const verified = [];
    const partial = [];
    const exploratory = [];
    for (const finding of findings) {
        const hasCI = hasStatMarkerBefore(markers, finding.lineNumber, "ci");
        const hasEffectSize = hasStatMarkerBefore(markers, finding.lineNumber, "effect_size");
        if (hasCI && hasEffectSize) {
            verified.push(finding);
        }
        else if (hasCI || hasEffectSize) {
            partial.push(finding);
        }
        else {
            exploratory.push(finding);
        }
    }
    return { verified, partial, exploratory };
}
/**
 * IMRAD sections and their corresponding markers.
 */
const REQUIRED_IMRAD_SECTIONS = [
    { marker: "OBJECTIVE", section: "Introduction", description: "No research objective defined" },
    { marker: "EXPERIMENT", section: "Methods", description: "No experimental methodology described" },
    { marker: "FINDING", section: "Results", description: "No findings reported" },
    { marker: "CONCLUSION", section: "Conclusion", description: "No conclusions drawn" },
];
/**
 * Validate that required IMRAD sections are present.
 *
 * @param markers - Array of all parsed markers
 * @returns Array of missing section info (empty if all sections present)
 */
function validateIMRADSections(markers) {
    const missing = [];
    for (const req of REQUIRED_IMRAD_SECTIONS) {
        const found = (0, marker_parser_1.getMarkersByType)(markers, req.marker);
        if (found.length === 0) {
            missing.push(req);
        }
    }
    return missing;
}
/**
 * Determines if an identifier is an arXiv ID.
 * arXiv IDs are typically: YYMM.NNNNN or older format like hep-ph/9901234
 */
function isArxivId(identifier) {
    // New format: YYMM.NNNNN (e.g., 2301.12345)
    if (/^\d{4}\.\d{4,5}(v\d+)?$/i.test(identifier)) {
        return true;
    }
    // Old format: category/YYMMNNN (e.g., hep-ph/9901234)
    if (/^[a-z-]+\/\d{7}$/i.test(identifier)) {
        return true;
    }
    return false;
}
/**
 * Extract citation markers and their identifiers from parsed markers.
 *
 * @param markers - Array of parsed markers
 * @returns Array of unique citation identifiers in order of first appearance
 */
function collectCitationIdentifiers(markers) {
    const citationMarkers = (0, marker_parser_1.getMarkersByType)(markers, "CITATION");
    const identifiers = [];
    const seen = new Set();
    for (const marker of citationMarkers) {
        // The identifier is in the subtype (e.g., [CITATION:10.1145/2939672.2939785])
        const identifier = marker.subtype?.trim();
        if (identifier && !seen.has(identifier)) {
            seen.add(identifier);
            identifiers.push(identifier);
        }
    }
    return identifiers;
}
async function resolveCitations(identifiers) {
    return identifiers.map((identifier, i) => ({
        identifier,
        number: i + 1,
        citation: null,
        formatted: isArxivId(identifier)
            ? `arXiv:${identifier}`
            : `https://doi.org/${identifier}`,
    }));
}
const SENTINEL_BEGIN = (name) => `<!-- GYOSHU:REPORT:${name}:BEGIN -->`;
const SENTINEL_END = (name) => `<!-- GYOSHU:REPORT:${name}:END -->`;
function formatBytes(bytes) {
    if (bytes === 0)
        return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
function inferArtifactType(filepath) {
    const dir = path.dirname(filepath);
    const ext = path.extname(filepath).toLowerCase();
    if (dir.includes("figures") || dir.includes("plots"))
        return "figure";
    if (dir.includes("models"))
        return "model";
    if (dir.includes("exports") || dir.includes("data"))
        return "export";
    if ([".png", ".jpg", ".jpeg", ".svg", ".pdf"].includes(ext))
        return "figure";
    if ([".pkl", ".joblib", ".pt", ".h5", ".onnx"].includes(ext))
        return "model";
    if ([".csv", ".parquet", ".json", ".xlsx"].includes(ext))
        return "export";
    return "other";
}
function extractMarkersFromNotebook(notebook) {
    const allText = [];
    for (const cell of notebook.cells) {
        if (cell.cell_type !== "code" || !cell.outputs)
            continue;
        for (const output of cell.outputs) {
            if (output.output_type === "stream" && output.name === "stdout") {
                const text = Array.isArray(output.text)
                    ? output.text.join("")
                    : String(output.text || "");
                allText.push(text);
            }
        }
    }
    return (0, marker_parser_1.parseMarkers)(allText.join("\n")).markers;
}
async function scanOutputsDirectory(outputsDir) {
    const artifacts = [];
    async function scanDir(dir, basePath) {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.join(basePath, entry.name);
                if (entry.isDirectory()) {
                    await scanDir(fullPath, relativePath);
                }
                else if (entry.isFile()) {
                    try {
                        const stat = await fs.lstat(fullPath);
                        if (stat.isSymbolicLink()) {
                            continue; // Skip symlinks for security
                        }
                        artifacts.push({
                            filename: entry.name,
                            relativePath,
                            sizeBytes: stat.size,
                            sizeFormatted: formatBytes(stat.size),
                            type: inferArtifactType(relativePath),
                        });
                    }
                    catch {
                        // Skip files we can't stat
                    }
                }
            }
        }
        catch {
            // Directory doesn't exist or not readable
        }
    }
    await scanDir(outputsDir, "");
    return artifacts;
}
function buildReportModel(frontmatter, markers, artifacts) {
    const objectives = (0, marker_parser_1.getMarkersByType)(markers, "OBJECTIVE");
    const hypotheses = (0, marker_parser_1.getMarkersByType)(markers, "HYPOTHESIS");
    const findings = (0, marker_parser_1.getMarkersByType)(markers, "FINDING");
    const conclusions = (0, marker_parser_1.getMarkersByType)(markers, "CONCLUSION");
    const metrics = (0, marker_parser_1.getMarkersByType)(markers, "METRIC");
    const limitations = (0, marker_parser_1.getMarkersByType)(markers, "LIMITATION");
    const nextSteps = (0, marker_parser_1.getMarkersByType)(markers, "NEXT_STEP");
    const titleSource = frontmatter?.reportTitle || frontmatter?.slug;
    const title = titleSource
        ? titleSource
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ")
        : "Research";
    const stageMarkers = (0, marker_parser_1.getMarkersByType)(markers, "STAGE");
    const executionHistory = [];
    for (const marker of stageMarkers) {
        if (marker.subtype === "end" && marker.attributes) {
            executionHistory.push({
                stageId: marker.attributes.id || "unknown",
                status: marker.attributes.status === "interrupted" ? "interrupted" : "completed",
                duration: marker.attributes.duration,
            });
        }
    }
    const separated = separateFindings(markers);
    const missingSections = validateIMRADSections(markers);
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
        separatedFindings: separated,
        limitations: limitations.map((m) => m.content),
        nextSteps: nextSteps.map((m) => m.content),
        conclusion: conclusions[conclusions.length - 1]?.content,
        artifacts,
        frontmatter,
        generatedAt: new Date().toISOString(),
        executionHistory: executionHistory.length > 0 ? executionHistory : undefined,
        missingSections: missingSections.length > 0 ? missingSections : undefined,
    };
}
function renderReportMarkdown(model) {
    const lines = [];
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
    if (model.separatedFindings) {
        const { verified, partial, exploratory } = model.separatedFindings;
        if (verified.length > 0) {
            lines.push(SENTINEL_BEGIN("VERIFIED_FINDINGS"));
            lines.push("## Key Findings (Verified)");
            lines.push("");
            lines.push("*These findings have full statistical evidence (CI + effect size).*");
            lines.push("");
            for (let i = 0; i < verified.length; i++) {
                lines.push(`${i + 1}. ${verified[i].content}`);
            }
            lines.push("");
            lines.push(SENTINEL_END("VERIFIED_FINDINGS"));
            lines.push("");
        }
        if (partial.length > 0) {
            lines.push(SENTINEL_BEGIN("PARTIAL_FINDINGS"));
            lines.push("## Findings (Partial Evidence)");
            lines.push("");
            lines.push("*These findings have partial statistical evidence.*");
            lines.push("");
            for (let i = 0; i < partial.length; i++) {
                lines.push(`${i + 1}. ${partial[i].content}`);
            }
            lines.push("");
            lines.push(SENTINEL_END("PARTIAL_FINDINGS"));
            lines.push("");
        }
        if (exploratory.length > 0) {
            lines.push(SENTINEL_BEGIN("EXPLORATORY"));
            lines.push("## Exploratory Observations");
            lines.push("");
            lines.push("*These observations lack full statistical evidence and should be verified.*");
            lines.push("");
            for (let i = 0; i < exploratory.length; i++) {
                lines.push(`${i + 1}. ${exploratory[i].content}`);
            }
            lines.push("");
            lines.push(SENTINEL_END("EXPLORATORY"));
            lines.push("");
        }
    }
    else if (model.findings.length > 0) {
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
        for (const a of sorted) {
            if (a.type === "figure") {
                // Embed figures as images for direct viewing in markdown
                const altText = a.description || path.basename(a.filename, path.extname(a.filename));
                lines.push(`![${altText}](${a.relativePath})`);
                lines.push(`*${a.filename} (${a.sizeFormatted})*`);
                lines.push("");
            }
            else {
                // Keep other artifacts as file links
                const desc = a.description || `${a.type} file`;
                lines.push(`- \`${a.relativePath}\` (${a.sizeFormatted}) - ${desc}`);
            }
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
    if (model.missingSections && model.missingSections.length > 0) {
        lines.push(SENTINEL_BEGIN("MISSING_SECTIONS"));
        lines.push("## Missing IMRAD Sections");
        lines.push("");
        lines.push("*The following required report sections are missing:*");
        lines.push("");
        for (const section of model.missingSections) {
            lines.push(`- **${section.section}**: [SECTION MISSING: No [${section.marker}] marker found]`);
        }
        lines.push("");
        lines.push(SENTINEL_END("MISSING_SECTIONS"));
        lines.push("");
    }
    if (model.citations && model.citations.length > 0) {
        lines.push(SENTINEL_BEGIN("REFERENCES"));
        lines.push("## References");
        lines.push("");
        for (const citation of model.citations) {
            lines.push(`${citation.number}. ${citation.formatted}`);
        }
        lines.push("");
        lines.push(SENTINEL_END("REFERENCES"));
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
async function generateReport(reportTitle) {
    const notebookPath = (0, paths_1.getNotebookPath)(reportTitle);
    const reportDir = (0, paths_1.getReportDir)(reportTitle);
    const reportPath = (0, paths_1.getReportReadmePath)(reportTitle);
    let notebook;
    try {
        const content = await (0, atomic_write_1.readFileNoFollow)(notebookPath);
        notebook = JSON.parse(content);
    }
    catch (e) {
        throw new Error(`Failed to read notebook: ${e.message}`);
    }
    const frontmatter = (0, notebook_frontmatter_1.extractFrontmatter)(notebook);
    const markers = extractMarkersFromNotebook(notebook);
    // FIX-176: Validate reportDir is not a symlink before scanning
    let artifacts = [];
    try {
        const stat = fsSync.lstatSync(reportDir);
        if (!stat.isSymbolicLink() && stat.isDirectory()) {
            artifacts = await scanOutputsDirectory(reportDir);
        }
    }
    catch {
        // Directory doesn't exist yet, empty artifacts
    }
    const model = buildReportModel(frontmatter, markers, artifacts);
    const citationIdentifiers = collectCitationIdentifiers(markers);
    if (citationIdentifiers.length > 0) {
        model.citations = await resolveCitations(citationIdentifiers);
    }
    const markdown = renderReportMarkdown(model);
    (0, paths_1.ensureDirSync)(reportDir, 0o755);
    await (0, atomic_write_1.durableAtomicWrite)(reportPath, markdown);
    return { reportPath, model };
}
async function readExistingReport(reportPath) {
    try {
        return await (0, atomic_write_1.readFileNoFollow)(reportPath);
    }
    catch {
        return null;
    }
}
function extractRawOutputsFromNotebook(notebook) {
    const outputs = [];
    for (const cell of notebook.cells) {
        if (cell.cell_type !== "code" || !cell.outputs)
            continue;
        for (const output of cell.outputs) {
            if (output.output_type === "stream" && output.name === "stdout") {
                const text = Array.isArray(output.text)
                    ? output.text.join("")
                    : String(output.text || "");
                outputs.push(text);
            }
        }
    }
    return outputs.join("\n");
}
function formatTitleFromSlug(slug) {
    return slug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}
async function gatherReportContext(reportTitle) {
    const notebookPath = (0, paths_1.getNotebookPath)(reportTitle);
    const reportDir = (0, paths_1.getReportDir)(reportTitle);
    let notebook;
    try {
        const content = await (0, atomic_write_1.readFileNoFollow)(notebookPath);
        notebook = JSON.parse(content);
    }
    catch (e) {
        throw new Error(`Failed to read notebook for context: ${e.message}`);
    }
    const frontmatter = (0, notebook_frontmatter_1.extractFrontmatter)(notebook);
    const markers = extractMarkersFromNotebook(notebook);
    // FIX-176: Validate reportDir is not a symlink before scanning
    let artifacts = [];
    try {
        const stat = fsSync.lstatSync(reportDir);
        if (!stat.isSymbolicLink() && stat.isDirectory()) {
            artifacts = await scanOutputsDirectory(reportDir);
        }
    }
    catch {
        // Directory doesn't exist yet
    }
    // SECURITY: rawOutputs is untrusted notebook output - do not execute as code.
    // Limit size to prevent memory issues with large outputs.
    const MAX_RAW_OUTPUT_LENGTH = 10000;
    const allOutputText = extractRawOutputsFromNotebook(notebook);
    const rawOutputs = allOutputText.slice(0, MAX_RAW_OUTPUT_LENGTH);
    const objectives = (0, marker_parser_1.getMarkersByType)(markers, "OBJECTIVE");
    const hypotheses = (0, marker_parser_1.getMarkersByType)(markers, "HYPOTHESIS");
    const findings = (0, marker_parser_1.getMarkersByType)(markers, "FINDING");
    const conclusions = (0, marker_parser_1.getMarkersByType)(markers, "CONCLUSION");
    const metrics = (0, marker_parser_1.getMarkersByType)(markers, "METRIC");
    const limitations = (0, marker_parser_1.getMarkersByType)(markers, "LIMITATION");
    const nextSteps = (0, marker_parser_1.getMarkersByType)(markers, "NEXT_STEP");
    const experiments = (0, marker_parser_1.getMarkersByType)(markers, "EXPERIMENT");
    const analyses = (0, marker_parser_1.getMarkersByType)(markers, "ANALYSIS");
    const titleSource = frontmatter?.reportTitle || frontmatter?.slug || reportTitle;
    const title = formatTitleFromSlug(titleSource);
    const methodologyParts = [];
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
function upsertSentinelBlock(existingContent, blockName, newContent) {
    const beginMarker = SENTINEL_BEGIN(blockName);
    const endMarker = SENTINEL_END(blockName);
    const pattern = new RegExp(`${beginMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
    if (pattern.test(existingContent)) {
        return existingContent.replace(pattern, `${beginMarker}\n${newContent}\n${endMarker}`);
    }
    return existingContent + `\n${beginMarker}\n${newContent}\n${endMarker}\n`;
}
