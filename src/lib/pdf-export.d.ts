/**
 * PDF Export Library - Convert markdown reports to PDF format.
 *
 * Supports multiple PDF converters in priority order:
 * 1. pandoc (best quality, supports LaTeX math)
 * 2. wkhtmltopdf (good quality, widely available)
 * 3. weasyprint (Python-based, good CSS support)
 *
 * @module pdf-export
 */
export type PdfConverter = "pandoc" | "wkhtmltopdf" | "weasyprint";
export interface PdfExportOptions {
    title?: string;
    author?: string;
    date?: string;
    pageSize?: "letter" | "a4";
    margins?: string;
    converter?: PdfConverter;
    cssPath?: string;
    /**
     * Maximum time for the converter subprocess.
     * Defaults to 120s; set `0` to disable timeout.
     */
    timeoutMs?: number;
}
export interface PdfExportResult {
    success: boolean;
    pdfPath?: string;
    converter?: PdfConverter;
    error?: string;
    installHint?: string;
}
interface ConverterConfig {
    name: PdfConverter;
    command: string;
    checkArgs: string[];
    buildArgs: (input: string, output: string, opts: PdfExportOptions) => string[];
    installHint: string;
}
export declare const CONVERTERS: ConverterConfig[];
export declare function detectAvailableConverters(): Promise<PdfConverter[]>;
export declare function getPreferredConverter(): Promise<ConverterConfig | null>;
export declare function exportToPdf(markdownPath: string, pdfPath?: string, options?: PdfExportOptions): Promise<PdfExportResult>;
export declare function exportReportToPdf(reportTitle: string, options?: PdfExportOptions): Promise<PdfExportResult>;
export {};
