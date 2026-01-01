import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  extractMarkersFromNotebook,
  scanOutputsDirectory,
  buildReportModel,
  renderReportMarkdown,
  upsertSentinelBlock,
  ArtifactEntry,
  MetricEntry,
  ReportModel,
} from "./report-markdown";
import { Notebook } from "./cell-identity";
import { GyoshuFrontmatter } from "./notebook-frontmatter";

// =============================================================================
// TEST FIXTURES
// =============================================================================

function createTestNotebook(cells: Notebook["cells"]): Notebook {
  return {
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
    cells,
  };
}

function createCodeCell(
  source: string | string[],
  outputs: unknown[] = []
): Notebook["cells"][0] {
  return {
    cell_type: "code",
    execution_count: null,
    metadata: {},
    outputs,
    source: Array.isArray(source) ? source : [source],
  };
}

function createStreamOutput(text: string | string[]): Record<string, unknown> {
  return {
    output_type: "stream",
    name: "stdout",
    text: Array.isArray(text) ? text : [text],
  };
}

// =============================================================================
// extractMarkersFromNotebook
// =============================================================================

describe("extractMarkersFromNotebook", () => {
  it("extracts markers from cell outputs", () => {
    const notebook = createTestNotebook([
      createCodeCell("print('[OBJECTIVE] Test research goal')", [
        createStreamOutput("[OBJECTIVE] Test research goal\n"),
      ]),
    ]);

    const markers = extractMarkersFromNotebook(notebook);
    expect(markers.length).toBe(1);
    expect(markers[0].type).toBe("OBJECTIVE");
    expect(markers[0].content).toBe("Test research goal");
  });

  it("extracts multiple markers from single cell", () => {
    const notebook = createTestNotebook([
      createCodeCell("print(...)", [
        createStreamOutput([
          "[OBJECTIVE] My goal\n",
          "[HYPOTHESIS] My hypothesis\n",
          "[METRIC:accuracy] 0.95\n",
        ]),
      ]),
    ]);

    const markers = extractMarkersFromNotebook(notebook);
    expect(markers.length).toBe(3);
    expect(markers[0].type).toBe("OBJECTIVE");
    expect(markers[1].type).toBe("HYPOTHESIS");
    expect(markers[2].type).toBe("METRIC");
    expect(markers[2].subtype).toBe("accuracy");
  });

  it("extracts markers from multiple cells", () => {
    const notebook = createTestNotebook([
      createCodeCell("# Cell 1", [createStreamOutput("[FINDING] Discovery 1\n")]),
      createCodeCell("# Cell 2", [createStreamOutput("[FINDING] Discovery 2\n")]),
      createCodeCell("# Cell 3", [createStreamOutput("[CONCLUSION] Final result\n")]),
    ]);

    const markers = extractMarkersFromNotebook(notebook);
    expect(markers.length).toBe(3);
    expect(markers[0].content).toBe("Discovery 1");
    expect(markers[1].content).toBe("Discovery 2");
    expect(markers[2].type).toBe("CONCLUSION");
  });

  it("ignores cells without outputs", () => {
    const notebook = createTestNotebook([
      createCodeCell("x = 1", []),
      createCodeCell("print('[FINDING] Found')", [createStreamOutput("[FINDING] Found\n")]),
    ]);

    const markers = extractMarkersFromNotebook(notebook);
    expect(markers.length).toBe(1);
    expect(markers[0].content).toBe("Found");
  });

  it("ignores markdown cells", () => {
    const notebook = createTestNotebook([
      {
        cell_type: "markdown",
        metadata: {},
        source: ["[OBJECTIVE] Not a marker - in markdown"],
      },
      createCodeCell("print('[FINDING] Real marker')", [
        createStreamOutput("[FINDING] Real marker\n"),
      ]),
    ]);

    const markers = extractMarkersFromNotebook(notebook);
    expect(markers.length).toBe(1);
    expect(markers[0].type).toBe("FINDING");
  });

  it("handles empty notebook", () => {
    const notebook = createTestNotebook([]);
    const markers = extractMarkersFromNotebook(notebook);
    expect(markers.length).toBe(0);
  });

  it("handles stderr output (ignored)", () => {
    const notebook = createTestNotebook([
      createCodeCell("print(...)", [
        {
          output_type: "stream",
          name: "stderr",
          text: ["[WARNING] Error message\n"],
        },
      ]),
    ]);

    const markers = extractMarkersFromNotebook(notebook);
    expect(markers.length).toBe(0);
  });
});

// =============================================================================
// scanOutputsDirectory
// =============================================================================

describe("scanOutputsDirectory", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gyoshu-report-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("scans empty directory", async () => {
    const artifacts = await scanOutputsDirectory(tempDir);
    expect(artifacts.length).toBe(0);
  });

  it("finds files in directory", async () => {
    await fs.writeFile(path.join(tempDir, "test.csv"), "a,b,c\n1,2,3");

    const artifacts = await scanOutputsDirectory(tempDir);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0].filename).toBe("test.csv");
    expect(artifacts[0].relativePath).toBe("test.csv");
    expect(artifacts[0].type).toBe("export");
  });

  it("infers artifact types from path", async () => {
    await fs.mkdir(path.join(tempDir, "figures"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "models"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "exports"), { recursive: true });

    await fs.writeFile(path.join(tempDir, "figures", "plot.png"), "PNG");
    await fs.writeFile(path.join(tempDir, "models", "model.pkl"), "model");
    await fs.writeFile(path.join(tempDir, "exports", "data.csv"), "data");

    const artifacts = await scanOutputsDirectory(tempDir);
    expect(artifacts.length).toBe(3);

    const figureArtifact = artifacts.find((a) => a.filename === "plot.png");
    const modelArtifact = artifacts.find((a) => a.filename === "model.pkl");
    const exportArtifact = artifacts.find((a) => a.filename === "data.csv");

    expect(figureArtifact?.type).toBe("figure");
    expect(modelArtifact?.type).toBe("model");
    expect(exportArtifact?.type).toBe("export");
  });

  it("infers types from file extension", async () => {
    await fs.writeFile(path.join(tempDir, "chart.svg"), "<svg></svg>");
    await fs.writeFile(path.join(tempDir, "results.json"), "{}");
    await fs.writeFile(path.join(tempDir, "weights.pt"), "pytorch");

    const artifacts = await scanOutputsDirectory(tempDir);

    const svg = artifacts.find((a) => a.filename === "chart.svg");
    const json = artifacts.find((a) => a.filename === "results.json");
    const pt = artifacts.find((a) => a.filename === "weights.pt");

    expect(svg?.type).toBe("figure");
    expect(json?.type).toBe("export");
    expect(pt?.type).toBe("model");
  });

  it("formats file sizes correctly", async () => {
    const content = "x".repeat(2048); // 2KB
    await fs.writeFile(path.join(tempDir, "file.txt"), content);

    const artifacts = await scanOutputsDirectory(tempDir);
    expect(artifacts[0].sizeBytes).toBe(2048);
    expect(artifacts[0].sizeFormatted).toBe("2 KB");
  });

  it("handles nonexistent directory", async () => {
    const artifacts = await scanOutputsDirectory("/nonexistent/path");
    expect(artifacts.length).toBe(0);
  });

  it("scans nested directories", async () => {
    await fs.mkdir(path.join(tempDir, "a", "b"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "a", "b", "deep.txt"), "deep");

    const artifacts = await scanOutputsDirectory(tempDir);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0].relativePath).toBe(path.join("a", "b", "deep.txt"));
  });
});

// =============================================================================
// buildReportModel
// =============================================================================

describe("buildReportModel", () => {
  it("builds model from empty data", () => {
    const model = buildReportModel(undefined, [], []);

    expect(model.title).toBe("Research");
    expect(model.objective).toBeUndefined();
    expect(model.hypotheses).toEqual([]);
    expect(model.metrics).toEqual([]);
    expect(model.findings).toEqual([]);
    expect(model.artifacts).toEqual([]);
    expect(model.generatedAt).toBeDefined();
  });

  it("extracts objective from markers", () => {
    const markers = [{ type: "OBJECTIVE", content: "Test goal", raw: "[OBJECTIVE] Test goal" }];
    const model = buildReportModel(undefined, markers, []);

    expect(model.objective).toBe("Test goal");
  });

  it("extracts hypotheses from markers", () => {
    const markers = [
      { type: "HYPOTHESIS", content: "H1", raw: "[HYPOTHESIS] H1" },
      { type: "HYPOTHESIS", content: "H2", raw: "[HYPOTHESIS] H2" },
    ];
    const model = buildReportModel(undefined, markers, []);

    expect(model.hypotheses).toEqual(["H1", "H2"]);
  });

  it("extracts metrics with subtypes", () => {
    const markers = [
      { type: "METRIC", subtype: "accuracy", content: "0.95", raw: "[METRIC:accuracy] 0.95" },
      { type: "METRIC", subtype: "f1", content: "0.87", raw: "[METRIC:f1] 0.87" },
    ];
    const model = buildReportModel(undefined, markers, []);

    expect(model.metrics.length).toBe(2);
    expect(model.metrics[0].name).toBe("accuracy");
    expect(model.metrics[0].value).toBe("0.95");
    expect(model.metrics[1].name).toBe("f1");
  });

  it("extracts findings", () => {
    const markers = [
      { type: "FINDING", content: "Discovery 1", raw: "[FINDING] Discovery 1" },
      { type: "FINDING", content: "Discovery 2", raw: "[FINDING] Discovery 2" },
    ];
    const model = buildReportModel(undefined, markers, []);

    expect(model.findings).toEqual(["Discovery 1", "Discovery 2"]);
  });

  it("uses last conclusion", () => {
    const markers = [
      { type: "CONCLUSION", content: "First conclusion", raw: "[CONCLUSION] First conclusion" },
      { type: "CONCLUSION", content: "Final conclusion", raw: "[CONCLUSION] Final conclusion" },
    ];
    const model = buildReportModel(undefined, markers, []);

    expect(model.conclusion).toBe("Final conclusion");
  });

  it("extracts title from frontmatter slug", () => {
    const frontmatter: GyoshuFrontmatter = {
      workspace: "test",
      slug: "customer-churn-analysis",
      status: "active",
    };
    const model = buildReportModel(frontmatter, [], []);

    expect(model.title).toBe("Customer Churn Analysis");
  });

  it("includes artifacts", () => {
    const artifacts: ArtifactEntry[] = [
      {
        filename: "plot.png",
        relativePath: "figures/plot.png",
        sizeBytes: 1024,
        sizeFormatted: "1 KB",
        type: "figure",
      },
    ];
    const model = buildReportModel(undefined, [], artifacts);

    expect(model.artifacts.length).toBe(1);
    expect(model.artifacts[0].filename).toBe("plot.png");
  });

  it("extracts limitations", () => {
    const markers = [
      { type: "LIMITATION", content: "Small dataset", raw: "[LIMITATION] Small dataset" },
    ];
    const model = buildReportModel(undefined, markers, []);

    expect(model.limitations).toEqual(["Small dataset"]);
  });

  it("extracts next steps", () => {
    const markers = [
      { type: "NEXT_STEP", content: "Collect more data", raw: "[NEXT_STEP] Collect more data" },
    ];
    const model = buildReportModel(undefined, markers, []);

    expect(model.nextSteps).toEqual(["Collect more data"]);
  });
});

// =============================================================================
// renderReportMarkdown
// =============================================================================

describe("renderReportMarkdown", () => {
  it("renders basic report structure", () => {
    const model: ReportModel = {
      title: "Test Report",
      hypotheses: [],
      metrics: [],
      findings: [],
      limitations: [],
      nextSteps: [],
      artifacts: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    };

    const markdown = renderReportMarkdown(model);

    expect(markdown).toContain("# Test Report Research Report");
    expect(markdown).toContain("## Executive Summary");
    expect(markdown).toContain("*Generated: 2026-01-01T00:00:00.000Z*");
  });

  it("includes objective in executive summary", () => {
    const model: ReportModel = {
      title: "Test",
      objective: "Analyze customer behavior",
      hypotheses: [],
      metrics: [],
      findings: [],
      limitations: [],
      nextSteps: [],
      artifacts: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    };

    const markdown = renderReportMarkdown(model);

    expect(markdown).toContain("**Research Goal**: Analyze customer behavior");
  });

  it("renders metrics table", () => {
    const model: ReportModel = {
      title: "Test",
      hypotheses: [],
      metrics: [
        { name: "accuracy", value: "0.95" },
        { name: "precision", value: "0.90" },
      ],
      findings: [],
      limitations: [],
      nextSteps: [],
      artifacts: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    };

    const markdown = renderReportMarkdown(model);

    expect(markdown).toContain("## Performance Metrics");
    expect(markdown).toContain("| Metric | Value |");
    expect(markdown).toContain("| accuracy | 0.95 |");
    expect(markdown).toContain("| precision | 0.90 |");
  });

  it("renders numbered findings", () => {
    const model: ReportModel = {
      title: "Test",
      hypotheses: [],
      metrics: [],
      findings: ["First discovery", "Second discovery"],
      limitations: [],
      nextSteps: [],
      artifacts: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    };

    const markdown = renderReportMarkdown(model);

    expect(markdown).toContain("## Key Findings");
    expect(markdown).toContain("1. First discovery");
    expect(markdown).toContain("2. Second discovery");
  });

  it("renders hypotheses section", () => {
    const model: ReportModel = {
      title: "Test",
      hypotheses: ["H1: Feature X is important", "H2: Model Y performs best"],
      metrics: [],
      findings: [],
      limitations: [],
      nextSteps: [],
      artifacts: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    };

    const markdown = renderReportMarkdown(model);

    expect(markdown).toContain("## Hypotheses");
    expect(markdown).toContain("- H1: Feature X is important");
    expect(markdown).toContain("- H2: Model Y performs best");
  });

  it("renders artifacts with sizes", () => {
    const model: ReportModel = {
      title: "Test",
      hypotheses: [],
      metrics: [],
      findings: [],
      limitations: [],
      nextSteps: [],
      artifacts: [
        {
          filename: "plot.png",
          relativePath: "figures/plot.png",
          sizeBytes: 1024,
          sizeFormatted: "1 KB",
          type: "figure",
        },
      ],
      generatedAt: "2026-01-01T00:00:00.000Z",
    };

    const markdown = renderReportMarkdown(model);

    expect(markdown).toContain("## Output Files");
    expect(markdown).toContain("`figures/plot.png` (1 KB)");
  });

  it("includes sentinel blocks for each section", () => {
    const model: ReportModel = {
      title: "Test",
      objective: "Goal",
      hypotheses: ["H1"],
      metrics: [{ name: "acc", value: "0.9" }],
      findings: ["F1"],
      limitations: ["L1"],
      nextSteps: ["N1"],
      artifacts: [
        {
          filename: "x.png",
          relativePath: "x.png",
          sizeBytes: 100,
          sizeFormatted: "100 B",
          type: "figure",
        },
      ],
      conclusion: "Done",
      generatedAt: "2026-01-01T00:00:00.000Z",
    };

    const markdown = renderReportMarkdown(model);

    expect(markdown).toContain("<!-- GYOSHU:REPORT:EXEC_SUMMARY:BEGIN -->");
    expect(markdown).toContain("<!-- GYOSHU:REPORT:EXEC_SUMMARY:END -->");
    expect(markdown).toContain("<!-- GYOSHU:REPORT:HYPOTHESES:BEGIN -->");
    expect(markdown).toContain("<!-- GYOSHU:REPORT:METRICS:BEGIN -->");
    expect(markdown).toContain("<!-- GYOSHU:REPORT:FINDINGS:BEGIN -->");
    expect(markdown).toContain("<!-- GYOSHU:REPORT:LIMITATIONS:BEGIN -->");
    expect(markdown).toContain("<!-- GYOSHU:REPORT:ARTIFACTS:BEGIN -->");
    expect(markdown).toContain("<!-- GYOSHU:REPORT:NEXT_STEPS:BEGIN -->");
    expect(markdown).toContain("<!-- GYOSHU:REPORT:CONCLUSION:BEGIN -->");
  });

  it("omits empty sections", () => {
    const model: ReportModel = {
      title: "Minimal",
      hypotheses: [],
      metrics: [],
      findings: [],
      limitations: [],
      nextSteps: [],
      artifacts: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    };

    const markdown = renderReportMarkdown(model);

    expect(markdown).not.toContain("## Hypotheses");
    expect(markdown).not.toContain("## Performance Metrics");
    expect(markdown).not.toContain("## Key Findings");
    expect(markdown).not.toContain("## Limitations");
    expect(markdown).not.toContain("## Output Files");
    expect(markdown).not.toContain("## Recommended Next Steps");
    expect(markdown).not.toContain("## Conclusion");
  });
});

// =============================================================================
// upsertSentinelBlock
// =============================================================================

describe("upsertSentinelBlock", () => {
  it("replaces existing sentinel block", () => {
    const existing = `# Report
<!-- GYOSHU:REPORT:METRICS:BEGIN -->
Old metrics
<!-- GYOSHU:REPORT:METRICS:END -->
Footer`;

    const result = upsertSentinelBlock(existing, "METRICS", "New metrics table");

    expect(result).toContain("<!-- GYOSHU:REPORT:METRICS:BEGIN -->");
    expect(result).toContain("New metrics table");
    expect(result).toContain("<!-- GYOSHU:REPORT:METRICS:END -->");
    expect(result).not.toContain("Old metrics");
    expect(result).toContain("Footer");
  });

  it("appends new sentinel block if not present", () => {
    const existing = "# Report\n\nSome content";

    const result = upsertSentinelBlock(existing, "FINDINGS", "New findings");

    expect(result).toContain("# Report");
    expect(result).toContain("Some content");
    expect(result).toContain("<!-- GYOSHU:REPORT:FINDINGS:BEGIN -->");
    expect(result).toContain("New findings");
    expect(result).toContain("<!-- GYOSHU:REPORT:FINDINGS:END -->");
  });

  it("preserves content outside sentinel blocks", () => {
    const existing = `# Title

User notes here

<!-- GYOSHU:REPORT:METRICS:BEGIN -->
Auto-generated
<!-- GYOSHU:REPORT:METRICS:END -->

More user notes`;

    const result = upsertSentinelBlock(existing, "METRICS", "Updated metrics");

    expect(result).toContain("# Title");
    expect(result).toContain("User notes here");
    expect(result).toContain("Updated metrics");
    expect(result).toContain("More user notes");
  });

  it("handles multiple sentinel blocks", () => {
    const existing = `<!-- GYOSHU:REPORT:A:BEGIN -->
A content
<!-- GYOSHU:REPORT:A:END -->

<!-- GYOSHU:REPORT:B:BEGIN -->
B content
<!-- GYOSHU:REPORT:B:END -->`;

    const result = upsertSentinelBlock(existing, "B", "Updated B");

    expect(result).toContain("A content");
    expect(result).toContain("Updated B");
    expect(result).not.toContain("B content");
  });
});
