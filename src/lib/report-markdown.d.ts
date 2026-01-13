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
import { ParsedMarker } from "./marker-parser";
import { Notebook } from "./cell-identity";
import { GyoshuFrontmatter } from "./notebook-frontmatter";
/**
 * Minimal citation interface for fallback mode.
 */
interface Citation {
    doi?: string;
    arxivId?: string;
    title?: string;
    authors?: string[];
    year?: number;
}
/**
 * Findings separated by verification status.
 */
export interface SeparatedFindings {
    /** Findings with both [STAT:ci] and [STAT:effect_size] nearby */
    verified: ParsedMarker[];
    /** Findings with partial evidence (one of CI or effect_size) */
    partial: ParsedMarker[];
    /** Findings without statistical evidence */
    exploratory: ParsedMarker[];
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
export declare function separateFindings(markers: ParsedMarker[]): SeparatedFindings;
/**
 * Required sections for IMRAD report structure validation.
 */
export interface RequiredSection {
    /** Marker type to check for */
    marker: string;
    /** Report section name */
    section: string;
    /** Description of what's missing */
    description: string;
}
/**
 * Validate that required IMRAD sections are present.
 *
 * @param markers - Array of all parsed markers
 * @returns Array of missing section info (empty if all sections present)
 */
export declare function validateIMRADSections(markers: ParsedMarker[]): RequiredSection[];
/**
 * A resolved citation ready for the References section.
 */
export interface ResolvedCitation {
    /** Original identifier from the marker (DOI or arXiv ID) */
    identifier: string;
    /** Citation number in the report (1-indexed) */
    number: number;
    /** Resolved citation metadata (null if resolution failed) */
    citation: Citation | null;
    /** Formatted APA string (or fallback if resolution failed) */
    formatted: string;
}
/**
 * Extract citation markers and their identifiers from parsed markers.
 *
 * @param markers - Array of parsed markers
 * @returns Array of unique citation identifiers in order of first appearance
 */
export declare function collectCitationIdentifiers(markers: ParsedMarker[]): string[];
export declare function resolveCitations(identifiers: string[]): Promise<ResolvedCitation[]>;
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
    metrics: Array<{
        name: string;
        value: string;
    }>;
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
    separatedFindings?: SeparatedFindings;
    limitations: string[];
    nextSteps: string[];
    conclusion?: string;
    artifacts: ArtifactEntry[];
    frontmatter?: GyoshuFrontmatter;
    generatedAt: string;
    executionHistory?: ExecutionHistoryEntry[];
    missingSections?: RequiredSection[];
    citations?: ResolvedCitation[];
}
export declare function extractMarkersFromNotebook(notebook: Notebook): ParsedMarker[];
export declare function scanOutputsDirectory(outputsDir: string): Promise<ArtifactEntry[]>;
export declare function buildReportModel(frontmatter: GyoshuFrontmatter | undefined, markers: ParsedMarker[], artifacts: ArtifactEntry[]): ReportModel;
export declare function renderReportMarkdown(model: ReportModel): string;
export declare function generateReport(reportTitle: string): Promise<{
    reportPath: string;
    model: ReportModel;
}>;
export declare function readExistingReport(reportPath: string): Promise<string | null>;
export declare function gatherReportContext(reportTitle: string): Promise<ReportContext>;
export declare function upsertSentinelBlock(existingContent: string, blockName: string, newContent: string): string;
export {};
