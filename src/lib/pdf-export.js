"use strict";
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
exports.CONVERTERS = void 0;
exports.detectAvailableConverters = detectAvailableConverters;
exports.getPreferredConverter = getPreferredConverter;
exports.exportToPdf = exportToPdf;
exports.exportReportToPdf = exportReportToPdf;
const child_process_1 = require("child_process");
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs/promises"));
const fs_1 = require("fs");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const atomic_write_1 = require("./atomic-write");
let sanitizeHtmlLib = null;
try {
    sanitizeHtmlLib = require("sanitize-html");
}
catch {
    // Package not available - will use fallback sanitization
}
const path_security_1 = require("./path-security");
const paths_1 = require("./paths");
exports.CONVERTERS = [
    {
        name: "pandoc",
        command: "pandoc",
        checkArgs: ["--version"],
        buildArgs: (input, output, opts) => {
            // Security: pandoc reads a sanitized HTML file produced by markdownToHtml() + sanitizeHtml().
            // Use --from=html so pandoc does NOT re-interpret markdown syntax (e.g., images/links) inside text.
            const args = ["--from=html", input, "-o", output, "--pdf-engine=xelatex"];
            if (opts.title)
                args.push(`--metadata=title:${opts.title}`);
            if (opts.author)
                args.push(`--metadata=author:${opts.author}`);
            if (opts.pageSize === "a4")
                args.push("-V", "geometry:a4paper");
            if (opts.margins)
                args.push("-V", `geometry:margin=${opts.margins}`);
            return args;
        },
        installHint: "Install with: sudo apt install pandoc texlive-xetex (Ubuntu) or brew install pandoc basictex (macOS)",
    },
    {
        name: "wkhtmltopdf",
        command: "wkhtmltopdf",
        checkArgs: ["--version"],
        buildArgs: (input, output, opts) => {
            const args = [
                "--disable-local-file-access",
                "--disable-external-links",
                "--disable-javascript",
                "--disable-plugins",
                "--no-images",
            ];
            if (opts.pageSize)
                args.push("--page-size", opts.pageSize.toUpperCase());
            if (opts.margins) {
                args.push("-T", opts.margins, "-B", opts.margins, "-L", opts.margins, "-R", opts.margins);
            }
            if (opts.title)
                args.push("--title", opts.title);
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
            // Defense-in-depth: --base-url "" provides limited protection
            // Primary SSRF defense is HTML sanitization in sanitizeHtml()
            const args = ["--base-url", "", input, output];
            if (opts.cssPath)
                args.push("-s", opts.cssPath);
            return args;
        },
        installHint: "Install with: pip install weasyprint",
    },
];
const COMMAND_EXISTS_TIMEOUT_MS = 5000;
const DEFAULT_CONVERTER_TIMEOUT_MS = 120000;
async function commandExists(command, args) {
    return new Promise((resolve) => {
        const proc = (0, child_process_1.spawn)(command, args, { stdio: "ignore" });
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            proc.kill();
            resolve(false);
        }, COMMAND_EXISTS_TIMEOUT_MS);
        proc.on("error", () => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            resolve(false);
        });
        proc.on("close", (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            resolve(code === 0);
        });
    });
}
async function detectAvailableConverters() {
    const available = [];
    for (const converter of exports.CONVERTERS) {
        if (await commandExists(converter.command, converter.checkArgs)) {
            available.push(converter.name);
        }
    }
    return available;
}
async function getPreferredConverter() {
    for (const converter of exports.CONVERTERS) {
        if (await commandExists(converter.command, converter.checkArgs)) {
            return converter;
        }
    }
    return null;
}
// FIX-166: Clamp timeout to sane bounds to prevent DoS via infinite timeout
const MAX_TIMEOUT_MS = 3600000; // 1 hour max
const MIN_TIMEOUT_MS = 1000; // 1 second min
function getConverterTimeoutMs(opts) {
    // FIX-171: Type check opts.timeoutMs before Math.trunc (Math.trunc(null) = 0)
    if (typeof opts.timeoutMs === 'number') {
        const value = Math.trunc(opts.timeoutMs);
        // 0 means "no timeout" - allow it but clamp positive values
        if (value === 0)
            return 0;
        return Math.max(MIN_TIMEOUT_MS, Math.min(value, MAX_TIMEOUT_MS));
    }
    // FIX-170: Max-length guard for env var (prevents parse-time overhead DoS)
    const envValue = process.env.GYOSHU_PDF_EXPORT_TIMEOUT_MS;
    if (envValue && envValue.length <= 20) {
        const parsed = Number(envValue);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.max(MIN_TIMEOUT_MS, Math.min(Math.trunc(parsed), MAX_TIMEOUT_MS));
        }
    }
    return DEFAULT_CONVERTER_TIMEOUT_MS;
}
function runCommand(command, args, timeoutMs) {
    return new Promise((resolve) => {
        // FIX-151: Spawn in own process group on POSIX so timeout can kill entire group
        const proc = (0, child_process_1.spawn)(command, args, {
            stdio: ["ignore", "ignore", "pipe"],
            detached: process.platform !== "win32",
        });
        let stderr = "";
        let stderrTruncated = false;
        let settled = false;
        let timedOut = false;
        let timeoutHandle;
        // FIX-152: Cap stderr at 64KB to prevent memory bloat
        const MAX_STDERR_CHARS = 64 * 1024;
        const finalize = (code) => {
            if (settled)
                return;
            settled = true;
            if (timeoutHandle)
                clearTimeout(timeoutHandle);
            resolve({ code, stderr, timedOut });
        };
        proc.stderr?.on("data", (data) => {
            // FIX-152: Skip accumulation once truncated
            if (stderrTruncated)
                return;
            const chunk = data.toString();
            if (stderr.length + chunk.length > MAX_STDERR_CHARS) {
                stderr = stderr.slice(0, MAX_STDERR_CHARS - 20) + "\n...[truncated]";
                stderrTruncated = true;
            }
            else {
                stderr += chunk;
            }
        });
        proc.on("error", (err) => {
            if (!stderrTruncated) {
                stderr += err.message;
            }
            finalize(1);
        });
        proc.on("close", (code) => {
            finalize(code ?? 1);
        });
        if (timeoutMs > 0) {
            timeoutHandle = setTimeout(() => {
                if (settled)
                    return;
                timedOut = true;
                if (!stderrTruncated) {
                    stderr += (stderr ? "\n" : "") + `Timed out after ${timeoutMs}ms`;
                }
                try {
                    // FIX-151: Kill entire process group on POSIX (e.g., pandoc spawns xelatex)
                    if (process.platform === "win32") {
                        proc.kill("SIGKILL");
                    }
                    else {
                        // Negative PID kills the process group
                        try {
                            process.kill(-proc.pid, "SIGKILL");
                        }
                        catch {
                            // Fallback to just the process if group kill fails
                            proc.kill("SIGKILL");
                        }
                    }
                }
                catch {
                    // Ignore kill errors
                }
                finalize(124);
            }, timeoutMs);
        }
    });
}
async function convertWithHtml(markdownPath, pdfPath, converter, opts) {
    // Security: readFileNoFollow uses O_NOFOLLOW to atomically reject symlinks
    // at open time, preventing TOCTOU race conditions
    let markdown;
    try {
        markdown = await (0, atomic_write_1.readFileNoFollow)(markdownPath);
    }
    catch (err) {
        const code = err.code;
        if (code === "ELOOP") {
            return { success: false, error: "Security: markdown path is a symlink" };
        }
        throw err;
    }
    const htmlContent = markdownToHtml(markdown, opts);
    // Security: Use OS temp directory for intermediate HTML file to avoid
    // writing attacker-controlled content next to user-provided markdown paths
    // FIX-118: Use crypto.randomUUID() for unpredictable temp path (prevents race condition attacks)
    // FIX-122: Use realpathSync to resolve TMPDIR symlinks on macOS (e.g., /var -> /private/var)
    // This prevents ensureDirSync failures when TMPDIR path contains symlinks
    const tmpDir = (0, fs_1.realpathSync)(os.tmpdir());
    const htmlPath = path.join(tmpDir, `gyoshu-pdf-${crypto.randomUUID()}.html`);
    await (0, atomic_write_1.durableAtomicWrite)(htmlPath, htmlContent);
    // FIX-113: Check if pdfPath already exists as symlink (prevent symlink overwrite attack)
    try {
        const outputStat = await fs.lstat(pdfPath);
        if (outputStat.isSymbolicLink()) {
            await fs.unlink(htmlPath).catch(() => { });
            return { success: false, error: "Security: output path is a symlink" };
        }
    }
    catch (err) {
        // ENOENT is fine - file doesn't exist yet
        if (err.code !== "ENOENT") {
            await fs.unlink(htmlPath).catch(() => { });
            throw err;
        }
    }
    // FIX-113: Write to temp output then atomic rename (prevents partial writes and symlink races)
    const tempPdfPath = `${pdfPath}.tmp.${crypto.randomUUID()}`;
    let success = false;
    try {
        const args = converter.buildArgs(htmlPath, tempPdfPath, opts);
        const timeoutMs = getConverterTimeoutMs(opts);
        const result = await runCommand(converter.command, args, timeoutMs);
        if (result.code !== 0) {
            return {
                success: false,
                converter: converter.name,
                error: result.timedOut
                    ? `Conversion timed out after ${timeoutMs}ms: ${result.stderr}`
                    : `Conversion failed: ${result.stderr}`,
            };
        }
        // FIX-113: Atomic rename temp to final output
        if (process.platform === "win32") {
            await (0, atomic_write_1.atomicReplaceWindows)(tempPdfPath, pdfPath);
        }
        else {
            await fs.rename(tempPdfPath, pdfPath);
        }
        success = true;
        return {
            success: true,
            pdfPath,
            converter: converter.name,
        };
    }
    finally {
        await fs.unlink(htmlPath).catch(() => { });
        if (!success) {
            // Only clean up temp output on failure (on success, it was renamed)
            await fs.unlink(tempPdfPath).catch(() => { });
        }
    }
}
/**
 * Sanitize HTML to prevent SSRF and local file disclosure.
 * This is the PRIMARY security control - converter flags are defense-in-depth only.
 *
 * Uses allowlist-based sanitization via sanitize-html library.
 * Only permits safe structural tags with no URL-bearing attributes.
 */
function sanitizeHtml(html) {
    if (sanitizeHtmlLib) {
        return sanitizeHtmlLib(html, {
            allowedTags: [
                "h1", "h2", "h3", "h4", "h5", "h6",
                "p", "br", "hr",
                "ul", "ol", "li",
                "blockquote", "pre", "code",
                "table", "thead", "tbody", "tr", "th", "td",
                "strong", "em", "b", "i", "u", "s",
                "span", "div",
                "a",
            ],
            allowedAttributes: {
                a: [],
                th: ["colspan", "rowspan"],
                td: ["colspan", "rowspan"],
                "*": ["class"],
            },
            allowedSchemes: [],
            allowedSchemesByTag: {},
            allowedStyles: {},
            disallowedTagsMode: "discard",
            allowProtocolRelative: false,
        });
    }
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/\s(on\w+|href|src|style)="[^"]*"/gi, "")
        .replace(/\s(on\w+|href|src|style)='[^']*'/gi, "");
}
/**
 * Sanitize plain text to prevent HTML/template injection.
 * Used for user-provided values that go into HTML template.
 */
function sanitizeText(text) {
    return text.replace(/[<>&"']/g, (c) => {
        const entities = {
            "<": "&lt;",
            ">": "&gt;",
            "&": "&amp;",
            '"': "&quot;",
            "'": "&#39;",
        };
        return entities[c] || c;
    });
}
/**
 * Sanitize CSS value to prevent injection attacks.
 * Only allows safe characters for margin/size values.
 */
function sanitizeCssValue(value) {
    // Only allow alphanumeric, dots, spaces, and common CSS units
    // Blocks: url(), expression(), @import, javascript:, etc.
    const sanitized = value.replace(/[^a-zA-Z0-9.\s%-]/g, "");
    return sanitized || "2.5cm"; // Fallback to safe default
}
function markdownToHtml(markdown, opts) {
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
    html = sanitizeHtml(html);
    const safeTitle = sanitizeText(opts.title || "Research Report");
    const safeMargins = sanitizeCssValue(opts.margins || "2.5cm");
    const pageSize = opts.pageSize === "a4" ? "A4" : "letter";
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${safeTitle}</title>
  <style>
    @page { size: ${pageSize}; margin: ${safeMargins}; }
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
function processMarkdownTables(html) {
    const tableRegex = /\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/g;
    return html.replace(tableRegex, (match, headerRow, bodyRows) => {
        const headers = headerRow
            .split("|")
            .filter((h) => h.trim())
            .map((h) => `<th>${h.trim()}</th>`)
            .join("");
        const rows = bodyRows
            .trim()
            .split("\n")
            .map((row) => {
            const cells = row
                .split("|")
                .filter((c) => c.trim())
                .map((c) => `<td>${c.trim()}</td>`)
                .join("");
            return `<tr>${cells}</tr>`;
        })
            .join("");
        return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    });
}
async function exportToPdf(markdownPath, pdfPath, options = {}) {
    const inputPath = path.resolve(markdownPath);
    const outputPath = pdfPath ? path.resolve(pdfPath) : inputPath.replace(/\.md$/, ".pdf");
    try {
        await fs.access(inputPath);
    }
    catch {
        return {
            success: false,
            error: `Input file not found: ${markdownPath}`,
        };
    }
    // Security: reject symlinks to prevent file disclosure
    const inputStat = await fs.lstat(inputPath);
    if (inputStat.isSymbolicLink()) {
        return { success: false, error: "Security: input file is a symlink" };
    }
    let converter = null;
    if (options.converter) {
        converter = exports.CONVERTERS.find((c) => c.name === options.converter) || null;
        if (converter && !(await commandExists(converter.command, converter.checkArgs))) {
            return {
                success: false,
                error: `Requested converter '${options.converter}' is not installed`,
                installHint: converter.installHint,
            };
        }
    }
    else {
        converter = await getPreferredConverter();
    }
    if (!converter) {
        const hints = exports.CONVERTERS.map((c) => `  - ${c.name}: ${c.installHint}`).join("\n");
        return {
            success: false,
            error: "No PDF converter found",
            installHint: `Install one of the following:\n${hints}`,
        };
    }
    // Security: validate output path is contained within reports directory
    // Check parent directory since outputPath (PDF file) may not exist yet
    const parentDir = path.dirname(outputPath);
    const reportsRoot = (0, paths_1.getReportsRootDir)();
    // FIX-148: Fail-fast with a lexical check to avoid creating directories outside reportsRoot
    if (!(0, path_security_1.isPathContainedIn)(parentDir, reportsRoot, { useRealpath: false })) {
        return { success: false, error: "Security: output path escapes reports directory" };
    }
    // FIX-146: Create directory first, then validate containment (dir must exist for realpath)
    try {
        (0, paths_1.ensureDirSync)(parentDir);
    }
    catch (err) {
        return {
            success: false,
            error: `Failed to create output directory: ${err.message}`,
        };
    }
    // Symlink-aware containment check (defense against symlink-based escapes)
    if (!(0, path_security_1.isPathContainedIn)(parentDir, reportsRoot, { useRealpath: true })) {
        return { success: false, error: "Security: output path escapes reports directory" };
    }
    // FIX-145: Use the available converter (not just non-pandoc) for HTML-based conversion
    // All conversions go through sanitizeHtml() for security, so any converter is safe
    const htmlConverter = converter;
    return convertWithHtml(inputPath, outputPath, htmlConverter, options);
}
async function exportReportToPdf(reportTitle, options = {}) {
    const { getReportDir, getReportReadmePath } = await import("./paths");
    const reportPath = getReportReadmePath(reportTitle);
    const pdfPath = path.join(getReportDir(reportTitle), "report.pdf");
    try {
        await fs.access(reportPath);
    }
    catch {
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
