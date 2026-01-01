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

import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

export type PdfConverter = "pandoc" | "wkhtmltopdf" | "weasyprint";

export interface PdfExportOptions {
  title?: string;
  author?: string;
  date?: string;
  pageSize?: "letter" | "a4";
  margins?: string;
  converter?: PdfConverter;
  cssPath?: string;
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

const CONVERTERS: ConverterConfig[] = [
  {
    name: "pandoc",
    command: "pandoc",
    checkArgs: ["--version"],
    buildArgs: (input, output, opts) => {
      const args = [input, "-o", output, "--pdf-engine=xelatex"];
      if (opts.title) args.push(`--metadata=title:${opts.title}`);
      if (opts.author) args.push(`--metadata=author:${opts.author}`);
      if (opts.pageSize === "a4") args.push("-V", "geometry:a4paper");
      if (opts.margins) args.push("-V", `geometry:margin=${opts.margins}`);
      return args;
    },
    installHint: "Install with: sudo apt install pandoc texlive-xetex (Ubuntu) or brew install pandoc basictex (macOS)",
  },
  {
    name: "wkhtmltopdf",
    command: "wkhtmltopdf",
    checkArgs: ["--version"],
    buildArgs: (input, output, opts) => {
      const args: string[] = [];
      if (opts.pageSize) args.push("--page-size", opts.pageSize.toUpperCase());
      if (opts.margins) {
        args.push("-T", opts.margins, "-B", opts.margins, "-L", opts.margins, "-R", opts.margins);
      }
      if (opts.title) args.push("--title", opts.title);
      args.push(input, output);
      return args;
    },
    installHint: "Install with: sudo apt install wkhtmltopdf (Ubuntu) or brew install wkhtmltopdf (macOS)",
  },
  {
    name: "weasyprint",
    command: "weasyprint",
    checkArgs: ["--version"],
    buildArgs: (input, output, opts) => {
      const args = [input, output];
      if (opts.cssPath) args.push("-s", opts.cssPath);
      return args;
    },
    installHint: "Install with: pip install weasyprint",
  },
];

async function commandExists(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

export async function detectAvailableConverters(): Promise<PdfConverter[]> {
  const available: PdfConverter[] = [];

  for (const converter of CONVERTERS) {
    if (await commandExists(converter.command, converter.checkArgs)) {
      available.push(converter.name);
    }
  }

  return available;
}

export async function getPreferredConverter(): Promise<ConverterConfig | null> {
  for (const converter of CONVERTERS) {
    if (await commandExists(converter.command, converter.checkArgs)) {
      return converter;
    }
  }
  return null;
}

function runCommand(command: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => {
      resolve({ code: 1, stderr: err.message });
    });

    proc.on("close", (code) => {
      resolve({ code: code ?? 1, stderr });
    });
  });
}

async function convertWithHtml(
  markdownPath: string,
  pdfPath: string,
  converter: ConverterConfig,
  opts: PdfExportOptions
): Promise<PdfExportResult> {
  const markdown = await fs.readFile(markdownPath, "utf-8");
  const htmlContent = markdownToHtml(markdown, opts);

  const htmlPath = markdownPath.replace(/\.md$/, ".html");
  await fs.writeFile(htmlPath, htmlContent, "utf-8");

  try {
    const args = converter.buildArgs(htmlPath, pdfPath, opts);
    const result = await runCommand(converter.command, args);

    if (result.code !== 0) {
      return {
        success: false,
        converter: converter.name,
        error: `Conversion failed: ${result.stderr}`,
      };
    }

    return {
      success: true,
      pdfPath,
      converter: converter.name,
    };
  } finally {
    await fs.unlink(htmlPath).catch(() => {});
  }
}

function markdownToHtml(markdown: string, opts: PdfExportOptions): string {
  let html = markdown
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/^(\d+)\. (.+)$/gm, "<li>$2</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n\n/g, "</p><p>")
    .replace(/<!--[^>]+-->/g, "");

  html = processMarkdownTables(html);

  const title = opts.title || "Research Report";
  const pageSize = opts.pageSize === "a4" ? "A4" : "letter";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    @page { size: ${pageSize}; margin: ${opts.margins || "2.5cm"}; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #1a1a1a; border-bottom: 2px solid #333; padding-bottom: 10px; }
    h2 { color: #2a2a2a; margin-top: 30px; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background-color: #f5f5f5; font-weight: 600; }
    tr:nth-child(even) { background-color: #fafafa; }
    code { background-color: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: 'SF Mono', Monaco, monospace; }
    ul, ol { padding-left: 25px; }
    li { margin: 5px 0; }
    hr { border: none; border-top: 1px solid #eee; margin: 30px 0; }
    em { color: #666; font-size: 0.9em; }
  </style>
</head>
<body>
<p>${html}</p>
</body>
</html>`;
}

function processMarkdownTables(html: string): string {
  const tableRegex = /\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/g;

  return html.replace(tableRegex, (match, headerRow, bodyRows) => {
    const headers = headerRow
      .split("|")
      .filter((h: string) => h.trim())
      .map((h: string) => `<th>${h.trim()}</th>`)
      .join("");

    const rows = bodyRows
      .trim()
      .split("\n")
      .map((row: string) => {
        const cells = row
          .split("|")
          .filter((c: string) => c.trim())
          .map((c: string) => `<td>${c.trim()}</td>`)
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");

    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });
}

export async function exportToPdf(
  markdownPath: string,
  pdfPath?: string,
  options: PdfExportOptions = {}
): Promise<PdfExportResult> {
  const inputPath = path.resolve(markdownPath);
  const outputPath = pdfPath ? path.resolve(pdfPath) : inputPath.replace(/\.md$/, ".pdf");

  try {
    await fs.access(inputPath);
  } catch {
    return {
      success: false,
      error: `Input file not found: ${markdownPath}`,
    };
  }

  let converter: ConverterConfig | null = null;

  if (options.converter) {
    converter = CONVERTERS.find((c) => c.name === options.converter) || null;
    if (converter && !(await commandExists(converter.command, converter.checkArgs))) {
      return {
        success: false,
        error: `Requested converter '${options.converter}' is not installed`,
        installHint: converter.installHint,
      };
    }
  } else {
    converter = await getPreferredConverter();
  }

  if (!converter) {
    const hints = CONVERTERS.map((c) => `  - ${c.name}: ${c.installHint}`).join("\n");
    return {
      success: false,
      error: "No PDF converter found",
      installHint: `Install one of the following:\n${hints}`,
    };
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  if (converter.name === "pandoc") {
    const args = converter.buildArgs(inputPath, outputPath, options);
    const result = await runCommand(converter.command, args);

    if (result.code !== 0) {
      if (result.stderr.includes("xelatex") || result.stderr.includes("pdflatex")) {
        return convertWithHtml(inputPath, outputPath, CONVERTERS[1], options);
      }
      return {
        success: false,
        converter: converter.name,
        error: `Conversion failed: ${result.stderr}`,
      };
    }

    return {
      success: true,
      pdfPath: outputPath,
      converter: converter.name,
    };
  }

  return convertWithHtml(inputPath, outputPath, converter, options);
}

export async function exportReportToPdf(
  reportTitle: string,
  options: PdfExportOptions = {}
): Promise<PdfExportResult> {
  const { getReportDir, getReportReadmePath } = await import("./paths");
  
  const reportPath = getReportReadmePath(reportTitle);
  const pdfPath = path.join(getReportDir(reportTitle), "report.pdf");

  try {
    await fs.access(reportPath);
  } catch {
    return {
      success: false,
      error: `Report not found at ${reportPath}. Generate it first.`,
    };
  }

  const titleFromReportTitle = reportTitle
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return exportToPdf(reportPath, pdfPath, {
    title: options.title || `${titleFromReportTitle} Research Report`,
    pageSize: options.pageSize || "letter",
    margins: options.margins || "2.5cm",
    ...options,
  });
}
