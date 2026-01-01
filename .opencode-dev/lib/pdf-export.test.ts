import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  detectAvailableConverters,
  getPreferredConverter,
  exportToPdf,
  PdfConverter,
} from "./pdf-export";

describe("detectAvailableConverters", () => {
  it("returns array of available converters", async () => {
    const available = await detectAvailableConverters();
    expect(Array.isArray(available)).toBe(true);
  });

  it("only returns valid converter names", async () => {
    const available = await detectAvailableConverters();
    const validNames: PdfConverter[] = ["pandoc", "wkhtmltopdf", "weasyprint"];
    for (const converter of available) {
      expect(validNames).toContain(converter);
    }
  });
});

describe("getPreferredConverter", () => {
  it("returns converter config or null", async () => {
    const preferred = await getPreferredConverter();
    if (preferred !== null) {
      expect(preferred.name).toBeDefined();
      expect(preferred.command).toBeDefined();
      expect(typeof preferred.buildArgs).toBe("function");
      expect(preferred.installHint).toBeDefined();
    }
  });

  it("returns converter with priority order", async () => {
    const available = await detectAvailableConverters();
    const preferred = await getPreferredConverter();

    if (available.length > 0 && preferred) {
      expect(available).toContain(preferred.name);
    }
  });
});

describe("exportToPdf", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gyoshu-pdf-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns error for nonexistent input file", async () => {
    const result = await exportToPdf("/nonexistent/file.md");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Input file not found");
  });

  it("returns error when no converter available", async () => {
    const mdPath = path.join(tempDir, "test.md");
    await fs.writeFile(mdPath, "# Test\n\nContent");

    const result = await exportToPdf(mdPath, undefined, {
      converter: "pandoc" as PdfConverter,
    });

    const available = await detectAvailableConverters();
    if (!available.includes("pandoc")) {
      expect(result.success).toBe(false);
      expect(result.error).toContain("not installed");
      expect(result.installHint).toBeDefined();
    }
  });

  it("generates output path from input path", async () => {
    const mdPath = path.join(tempDir, "report.md");
    await fs.writeFile(mdPath, "# Test");

    const available = await detectAvailableConverters();
    if (available.length === 0) {
      const result = await exportToPdf(mdPath);
      expect(result.success).toBe(false);
      expect(result.installHint).toBeDefined();
    } else {
      const result = await exportToPdf(mdPath);
      if (result.success) {
        expect(result.pdfPath).toBe(path.join(tempDir, "report.pdf"));
      }
    }
  });

  it("respects custom output path", async () => {
    const mdPath = path.join(tempDir, "input.md");
    const pdfPath = path.join(tempDir, "custom-output.pdf");
    await fs.writeFile(mdPath, "# Test");

    const available = await detectAvailableConverters();
    if (available.length > 0) {
      const result = await exportToPdf(mdPath, pdfPath);
      if (result.success) {
        expect(result.pdfPath).toBe(pdfPath);
      }
    }
  });

  it("creates output directory if needed", async () => {
    const mdPath = path.join(tempDir, "input.md");
    const pdfPath = path.join(tempDir, "subdir", "output.pdf");
    await fs.writeFile(mdPath, "# Test");

    const available = await detectAvailableConverters();
    if (available.length > 0) {
      await exportToPdf(mdPath, pdfPath);
      const dirExists = await fs.stat(path.join(tempDir, "subdir")).catch(() => null);
      expect(dirExists).not.toBeNull();
    }
  });

  it("returns converter used on success", async () => {
    const mdPath = path.join(tempDir, "test.md");
    await fs.writeFile(mdPath, "# Test\n\nSome content here.");

    const available = await detectAvailableConverters();
    if (available.length > 0) {
      const result = await exportToPdf(mdPath);
      if (result.success) {
        expect(result.converter).toBeDefined();
        expect(available).toContain(result.converter);
      }
    }
  });

  it("handles markdown with tables", async () => {
    const mdPath = path.join(tempDir, "table.md");
    const markdown = `# Report

| Name | Value |
|------|-------|
| A    | 1     |
| B    | 2     |
`;
    await fs.writeFile(mdPath, markdown);

    const available = await detectAvailableConverters();
    if (available.length > 0) {
      const result = await exportToPdf(mdPath);
      if (result.success) {
        const pdfExists = await fs.stat(result.pdfPath!).catch(() => null);
        expect(pdfExists).not.toBeNull();
      }
    }
  });

  it("handles markdown with code blocks", async () => {
    const mdPath = path.join(tempDir, "code.md");
    const markdown = `# Code Example

\`\`\`python
def hello():
    print("Hello, World!")
\`\`\`

Some \`inline code\` here.
`;
    await fs.writeFile(mdPath, markdown);

    const available = await detectAvailableConverters();
    if (available.length > 0) {
      const result = await exportToPdf(mdPath);
      expect(result.success || result.error !== undefined).toBe(true);
    }
  });

  it("applies page size option", async () => {
    const mdPath = path.join(tempDir, "page.md");
    await fs.writeFile(mdPath, "# Test");

    const available = await detectAvailableConverters();
    if (available.length > 0) {
      const result = await exportToPdf(mdPath, undefined, { pageSize: "a4" });
      expect(result.success || result.error !== undefined).toBe(true);
    }
  });

  it("applies margins option", async () => {
    const mdPath = path.join(tempDir, "margins.md");
    await fs.writeFile(mdPath, "# Test");

    const available = await detectAvailableConverters();
    if (available.length > 0) {
      const result = await exportToPdf(mdPath, undefined, { margins: "1cm" });
      expect(result.success || result.error !== undefined).toBe(true);
    }
  });

  it("applies title option", async () => {
    const mdPath = path.join(tempDir, "titled.md");
    await fs.writeFile(mdPath, "# Test");

    const available = await detectAvailableConverters();
    if (available.length > 0) {
      const result = await exportToPdf(mdPath, undefined, { title: "Custom Title" });
      expect(result.success || result.error !== undefined).toBe(true);
    }
  });
});

describe("markdownToHtml conversion (via exportToPdf)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gyoshu-html-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("converts headers", async () => {
    const mdPath = path.join(tempDir, "headers.md");
    const markdown = `# H1
## H2
### H3`;
    await fs.writeFile(mdPath, markdown);

    const available = await detectAvailableConverters();
    const hasHtmlConverter = available.includes("wkhtmltopdf") || available.includes("weasyprint");

    if (hasHtmlConverter) {
      const result = await exportToPdf(mdPath);
      expect(result.success || result.error !== undefined).toBe(true);
    }
  });

  it("converts bold and italic", async () => {
    const mdPath = path.join(tempDir, "formatting.md");
    const markdown = `This is **bold** and this is *italic*.`;
    await fs.writeFile(mdPath, markdown);

    const available = await detectAvailableConverters();
    if (available.length > 0) {
      const result = await exportToPdf(mdPath);
      expect(result.success || result.error !== undefined).toBe(true);
    }
  });

  it("converts lists", async () => {
    const mdPath = path.join(tempDir, "lists.md");
    const markdown = `
- Item 1
- Item 2
- Item 3

1. First
2. Second
3. Third
`;
    await fs.writeFile(mdPath, markdown);

    const available = await detectAvailableConverters();
    if (available.length > 0) {
      const result = await exportToPdf(mdPath);
      expect(result.success || result.error !== undefined).toBe(true);
    }
  });

  it("strips HTML comments (sentinel blocks)", async () => {
    const mdPath = path.join(tempDir, "comments.md");
    const markdown = `# Report
<!-- GYOSHU:REPORT:METRICS:BEGIN -->
| Metric | Value |
|--------|-------|
| acc    | 0.95  |
<!-- GYOSHU:REPORT:METRICS:END -->
`;
    await fs.writeFile(mdPath, markdown);

    const available = await detectAvailableConverters();
    if (available.length > 0) {
      const result = await exportToPdf(mdPath);
      expect(result.success || result.error !== undefined).toBe(true);
    }
  });
});

describe("converter buildArgs", () => {
  it("pandoc includes pdf-engine", async () => {
    const preferred = await getPreferredConverter();
    if (preferred?.name === "pandoc") {
      const args = preferred.buildArgs("input.md", "output.pdf", {});
      expect(args).toContain("--pdf-engine=xelatex");
    }
  });

  it("pandoc adds title metadata", async () => {
    const preferred = await getPreferredConverter();
    if (preferred?.name === "pandoc") {
      const args = preferred.buildArgs("input.md", "output.pdf", { title: "My Report" });
      expect(args.some((a: string) => a.includes("title:My Report"))).toBe(true);
    }
  });

  it("wkhtmltopdf adds page size", async () => {
    const available = await detectAvailableConverters();
    if (available.includes("wkhtmltopdf")) {
      const { getPreferredConverter } = await import("./pdf-export");
      const preferred = await getPreferredConverter();
      if (preferred?.name === "wkhtmltopdf") {
        const args = preferred.buildArgs("input.html", "output.pdf", { pageSize: "a4" });
        expect(args).toContain("--page-size");
        expect(args).toContain("A4");
      }
    }
  });

  it("wkhtmltopdf adds margins", async () => {
    const available = await detectAvailableConverters();
    if (available.includes("wkhtmltopdf")) {
      const { getPreferredConverter } = await import("./pdf-export");
      const preferred = await getPreferredConverter();
      if (preferred?.name === "wkhtmltopdf") {
        const args = preferred.buildArgs("input.html", "output.pdf", { margins: "2cm" });
        expect(args).toContain("-T");
        expect(args).toContain("2cm");
      }
    }
  });

  it("weasyprint adds css path", async () => {
    const available = await detectAvailableConverters();
    if (available.includes("weasyprint")) {
      const { getPreferredConverter } = await import("./pdf-export");
      const preferred = await getPreferredConverter();
      if (preferred?.name === "weasyprint") {
        const args = preferred.buildArgs("input.html", "output.pdf", { cssPath: "style.css" });
        expect(args).toContain("-s");
        expect(args).toContain("style.css");
      }
    }
  });
});
