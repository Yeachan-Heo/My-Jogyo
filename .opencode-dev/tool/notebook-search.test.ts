/**
 * Integration tests for notebook-search.ts
 *
 * Tests full-text search within Jupyter notebooks for Gyoshu research.
 *
 * Test Strategy:
 * - Creates temporary directories for project root
 * - Sets GYOSHU_PROJECT_ROOT for project-local isolation
 * - Creates test notebooks with known content
 * - Tests search in code cells, markdown cells, and outputs
 * - Tests scoped and global search
 * - Tests scoring and ranking
 *
 * @module notebook-search.test
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// Import the notebook-search tool
import notebookSearch from "./notebook-search";

// Import path utilities
import { clearProjectRootCache, getResearchNotebooksDir, getResearchDir } from "../lib/paths";

// =============================================================================
// TEST SETUP
// =============================================================================

/** Test directory for project root (isolated per test) */
let testProjectDir: string;

/** Original environment variable values */
let originalProjectRoot: string | undefined;

/**
 * Helper to execute the notebook-search tool and parse the result.
 */
async function execute(args: {
  query: string;
  researchId?: string;
  includeOutputs?: boolean;
  limit?: number;
}): Promise<{
  success: boolean;
  query?: string;
  scope?: string;
  totalMatches?: number;
  returnedMatches?: number;
  results?: Array<{
    notebookPath: string;
    researchId: string;
    runId: string;
    cellId: string;
    cellType: "code" | "markdown" | "raw";
    matchLocation: "source" | "output";
    snippet: string;
    score: number;
    lineNumber: number;
  }>;
  error?: string;
  message?: string;
  [key: string]: unknown;
}> {
  const result = await notebookSearch.execute(args as any);
  return JSON.parse(result);
}

/**
 * Create a research directory with the necessary structure.
 */
async function createResearch(researchId: string): Promise<void> {
  const researchDir = path.join(testProjectDir, "gyoshu", "research", researchId);
  const notebooksDir = path.join(researchDir, "notebooks");
  
  await fs.mkdir(notebooksDir, { recursive: true });
  
  // Create a minimal research.json
  await fs.writeFile(
    path.join(researchDir, "research.json"),
    JSON.stringify({
      schemaVersion: 1,
      researchId,
      title: `Test Research ${researchId}`,
      status: "active",
      runs: [],
    })
  );
}

/**
 * Create a Jupyter notebook with specified content.
 */
interface NotebookCell {
  cell_type: "code" | "markdown" | "raw";
  id?: string;
  source: string[];
  outputs?: Array<{
    output_type: "stream" | "execute_result" | "display_data" | "error";
    name?: string;
    text?: string[];
    data?: Record<string, unknown>;
    ename?: string;
    evalue?: string;
    traceback?: string[];
  }>;
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
}

async function createNotebook(
  researchId: string,
  runId: string,
  cells: NotebookCell[]
): Promise<string> {
  const notebooksDir = getResearchNotebooksDir(researchId);
  await fs.mkdir(notebooksDir, { recursive: true });
  
  const notebook = {
    cells: cells.map((cell, idx) => ({
      ...cell,
      id: cell.id || `cell-${idx}`,
      metadata: cell.metadata || {},
    })),
    metadata: {
      kernelspec: {
        name: "python3",
        display_name: "Python 3",
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  
  const notebookPath = path.join(notebooksDir, `${runId}.ipynb`);
  await fs.writeFile(notebookPath, JSON.stringify(notebook, null, 2));
  
  return notebookPath;
}

/**
 * Create a simple code cell.
 */
function codeCell(
  source: string | string[],
  outputs?: NotebookCell["outputs"],
  id?: string
): NotebookCell {
  return {
    cell_type: "code",
    id,
    source: Array.isArray(source) ? source : [source],
    outputs: outputs || [],
    execution_count: 1,
  };
}

/**
 * Create a simple markdown cell.
 */
function markdownCell(source: string | string[], id?: string): NotebookCell {
  return {
    cell_type: "markdown",
    id,
    source: Array.isArray(source) ? source : [source],
  };
}

/**
 * Create a stream output (stdout/stderr).
 */
function streamOutput(text: string | string[], name: "stdout" | "stderr" = "stdout") {
  return {
    output_type: "stream" as const,
    name,
    text: Array.isArray(text) ? text : [text],
  };
}

/**
 * Create an execute_result output.
 */
function executeResult(text: string | string[]) {
  return {
    output_type: "execute_result" as const,
    data: {
      "text/plain": Array.isArray(text) ? text : [text],
    },
    metadata: {},
  };
}

/**
 * Create an error output.
 */
function errorOutput(ename: string, evalue: string) {
  return {
    output_type: "error" as const,
    ename,
    evalue,
    traceback: [`${ename}: ${evalue}`],
  };
}

beforeAll(() => {
  // Save original environment variable
  originalProjectRoot = process.env.GYOSHU_PROJECT_ROOT;
});

afterAll(async () => {
  // Restore original environment variable
  if (originalProjectRoot !== undefined) {
    process.env.GYOSHU_PROJECT_ROOT = originalProjectRoot;
  } else {
    delete process.env.GYOSHU_PROJECT_ROOT;
  }
  clearProjectRootCache();
});

beforeEach(async () => {
  // Create a unique temp directory for project root
  testProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "gyoshu-notebook-search-test-"));
  
  // Create gyoshu directory structure
  await fs.mkdir(path.join(testProjectDir, "gyoshu", "research"), { recursive: true });
  
  // Create config.json marker
  await fs.writeFile(
    path.join(testProjectDir, "gyoshu", "config.json"),
    JSON.stringify({
      version: "1.0.0",
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
    })
  );
  
  // Set the project root to our test directory
  process.env.GYOSHU_PROJECT_ROOT = testProjectDir;
  
  // Clear the cached project root
  clearProjectRootCache();
});

afterEach(async () => {
  // Clean up the test project directory
  if (testProjectDir) {
    await fs.rm(testProjectDir, { recursive: true, force: true });
  }
  
  // Clear cache after each test
  clearProjectRootCache();
});

// =============================================================================
// CODE CELL SEARCH TESTS
// =============================================================================

describe("Code Cell Search", () => {
  test("finds match in code cell source", async () => {
    await createResearch("test-research-code");
    await createNotebook("test-research-code", "run-001", [
      codeCell("import pandas as pd\ndf = pd.read_csv('data.csv')"),
    ]);
    
    const result = await execute({ query: "pandas" });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results![0].cellType).toBe("code");
    expect(result.results![0].matchLocation).toBe("source");
    expect(result.results![0].snippet).toContain("pandas");
  });
  
  test("returns correct line number for match", async () => {
    await createResearch("test-research-lines");
    await createNotebook("test-research-lines", "run-001", [
      codeCell([
        "# First line\n",
        "# Second line\n",
        "# Third line with target_keyword\n",
        "# Fourth line\n",
      ]),
    ]);
    
    const result = await execute({ query: "target_keyword" });
    
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results![0].lineNumber).toBe(3);
  });
  
  test("finds multiple matches in same cell", async () => {
    await createResearch("test-research-multi");
    await createNotebook("test-research-multi", "run-001", [
      codeCell([
        "data = load_data()\n",
        "clean_data = process_data(data)\n",
        "save_data(clean_data)\n",
      ]),
    ]);
    
    const result = await execute({ query: "data" });
    
    expect(result.success).toBe(true);
    // "data" appears multiple times (data, load_data, clean_data, process_data, save_data, clean_data)
    expect(result.totalMatches).toBeGreaterThanOrEqual(3);
  });
  
  test("finds matches across multiple cells", async () => {
    await createResearch("test-research-cells");
    await createNotebook("test-research-cells", "run-001", [
      codeCell("import numpy as np"),
      codeCell("array = np.array([1, 2, 3])"),
      codeCell("result = np.sum(array)"),
    ]);
    
    const result = await execute({ query: "np" });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBeGreaterThanOrEqual(3);
    
    // Verify different cells are matched
    const cellIds = new Set(result.results!.map(r => r.cellId));
    expect(cellIds.size).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// MARKDOWN CELL SEARCH TESTS
// =============================================================================

describe("Markdown Cell Search", () => {
  test("finds match in markdown cell", async () => {
    await createResearch("test-research-md");
    await createNotebook("test-research-md", "run-001", [
      markdownCell("# Analysis Results\n\nThe correlation coefficient is 0.85"),
    ]);
    
    const result = await execute({ query: "correlation" });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(1);
    expect(result.results![0].cellType).toBe("markdown");
    expect(result.results![0].matchLocation).toBe("source");
  });
  
  test("finds matches in markdown headers", async () => {
    await createResearch("test-research-md-header");
    await createNotebook("test-research-md-header", "run-001", [
      markdownCell("# Machine Learning Pipeline"),
      markdownCell("## Data Preprocessing"),
      markdownCell("### Feature Engineering"),
    ]);
    
    const result = await execute({ query: "Machine Learning" });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(1);
    expect(result.results![0].snippet).toContain("Machine Learning");
  });
  
  test("finds matches in markdown with formatting", async () => {
    await createResearch("test-research-md-format");
    await createNotebook("test-research-md-format", "run-001", [
      markdownCell("The **important** result shows *significant* improvement"),
    ]);
    
    const result = await execute({ query: "significant" });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(1);
  });
});

// =============================================================================
// OUTPUT SEARCH TESTS
// =============================================================================

describe("Output Search", () => {
  test("finds match in stdout output when includeOutputs is true", async () => {
    await createResearch("test-research-stdout");
    await createNotebook("test-research-stdout", "run-001", [
      codeCell("print('Hello World')", [streamOutput("Hello World\n")]),
    ]);
    
    const result = await execute({ query: "Hello World", includeOutputs: true });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBeGreaterThanOrEqual(1);
    
    // Should find at least one output match
    const outputMatches = result.results!.filter(r => r.matchLocation === "output");
    expect(outputMatches.length).toBeGreaterThanOrEqual(1);
  });
  
  test("does not search outputs when includeOutputs is false", async () => {
    await createResearch("test-research-no-output");
    await createNotebook("test-research-no-output", "run-001", [
      codeCell("x = 1", [streamOutput("output_only_text\n")]),
    ]);
    
    const result = await execute({ query: "output_only_text", includeOutputs: false });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(0);
  });
  
  test("finds match in execute_result output", async () => {
    await createResearch("test-research-exec-result");
    await createNotebook("test-research-exec-result", "run-001", [
      codeCell("df.describe()", [executeResult("DataFrame statistics summary")]),
    ]);
    
    const result = await execute({ query: "statistics", includeOutputs: true });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBeGreaterThanOrEqual(1);
    
    const outputMatches = result.results!.filter(r => r.matchLocation === "output");
    expect(outputMatches.length).toBeGreaterThanOrEqual(1);
  });
  
  test("finds match in error output", async () => {
    await createResearch("test-research-error");
    await createNotebook("test-research-error", "run-001", [
      codeCell("1/0", [errorOutput("ZeroDivisionError", "division by zero")]),
    ]);
    
    const result = await execute({ query: "ZeroDivisionError", includeOutputs: true });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBeGreaterThanOrEqual(1);
  });
  
  test("defaults to including outputs", async () => {
    await createResearch("test-research-default-output");
    await createNotebook("test-research-default-output", "run-001", [
      codeCell("x = 1", [streamOutput("default_output_search\n")]),
    ]);
    
    // Don't specify includeOutputs - should default to true
    const result = await execute({ query: "default_output_search" });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// SCOPED SEARCH TESTS
// =============================================================================

describe("Scoped Search", () => {
  test("searches only specified research when researchId provided", async () => {
    await createResearch("research-alpha");
    await createResearch("research-beta");
    
    await createNotebook("research-alpha", "run-001", [
      codeCell("alpha_unique_identifier = 1"),
    ]);
    await createNotebook("research-beta", "run-001", [
      codeCell("beta_unique_identifier = 2"),
    ]);
    
    const result = await execute({
      query: "alpha_unique_identifier",
      researchId: "research-alpha",
    });
    
    expect(result.success).toBe(true);
    expect(result.scope).toBe("research-alpha");
    expect(result.totalMatches).toBe(1);
    expect(result.results![0].researchId).toBe("research-alpha");
  });
  
  test("does not find matches in other research when scoped", async () => {
    await createResearch("research-one");
    await createResearch("research-two");
    
    await createNotebook("research-one", "run-001", [
      codeCell("cross_research_term = 1"),
    ]);
    await createNotebook("research-two", "run-001", [
      codeCell("other_term = 2"),
    ]);
    
    const result = await execute({
      query: "cross_research_term",
      researchId: "research-two",
    });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(0);
  });
  
  test("returns error for non-existent researchId", async () => {
    const result = await execute({
      query: "anything",
      researchId: "non-existent-research",
    });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
  
  test("returns error for path traversal in researchId", async () => {
    const result = await execute({
      query: "anything",
      researchId: "../malicious",
    });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("path traversal");
  });
});

// =============================================================================
// GLOBAL SEARCH TESTS
// =============================================================================

describe("Global Search", () => {
  test("searches all research projects when no researchId provided", async () => {
    await createResearch("global-research-a");
    await createResearch("global-research-b");
    await createResearch("global-research-c");
    
    await createNotebook("global-research-a", "run-001", [
      codeCell("common_search_term = 'a'"),
    ]);
    await createNotebook("global-research-b", "run-001", [
      codeCell("common_search_term = 'b'"),
    ]);
    await createNotebook("global-research-c", "run-001", [
      codeCell("common_search_term = 'c'"),
    ]);
    
    const result = await execute({ query: "common_search_term" });
    
    expect(result.success).toBe(true);
    expect(result.scope).toBe("global");
    expect(result.totalMatches).toBe(3);
    
    // Verify all research projects are represented
    const researchIds = new Set(result.results!.map(r => r.researchId));
    expect(researchIds.has("global-research-a")).toBe(true);
    expect(researchIds.has("global-research-b")).toBe(true);
    expect(researchIds.has("global-research-c")).toBe(true);
  });
  
  test("returns researchesSearched count", async () => {
    await createResearch("count-research-1");
    await createResearch("count-research-2");
    
    await createNotebook("count-research-1", "run-001", [
      codeCell("counted_term = 1"),
    ]);
    await createNotebook("count-research-2", "run-001", [
      codeCell("counted_term = 2"),
    ]);
    
    const result = await execute({ query: "counted_term" });
    
    expect(result.success).toBe(true);
    expect(result.researchesSearched).toBe(2);
  });
  
  test("returns notebooksSearched count", async () => {
    await createResearch("multi-nb-research");
    
    await createNotebook("multi-nb-research", "run-001", [
      codeCell("multi_notebook_term = 1"),
    ]);
    await createNotebook("multi-nb-research", "run-002", [
      codeCell("multi_notebook_term = 2"),
    ]);
    await createNotebook("multi-nb-research", "run-003", [
      codeCell("multi_notebook_term = 3"),
    ]);
    
    const result = await execute({ query: "multi_notebook_term" });
    
    expect(result.success).toBe(true);
    expect(result.notebooksSearched).toBe(3);
  });
});

// =============================================================================
// NO MATCHES TESTS
// =============================================================================

describe("No Matches", () => {
  test("returns empty results when no matches found", async () => {
    await createResearch("empty-research");
    await createNotebook("empty-research", "run-001", [
      codeCell("x = 1"),
      markdownCell("# Title"),
    ]);
    
    const result = await execute({ query: "nonexistent_term_xyz123" });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(0);
    expect(result.results).toHaveLength(0);
    expect(result.message).toContain("No matches found");
  });
  
  test("returns empty results when no notebooks exist in research", async () => {
    await createResearch("no-notebooks-research");
    
    const result = await execute({
      query: "anything",
      researchId: "no-notebooks-research",
    });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(0);
    expect(result.results).toHaveLength(0);
  });
  
  test("returns empty results when no research exists", async () => {
    // Don't create any research
    
    const result = await execute({ query: "anything" });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(0);
  });
});

// =============================================================================
// SCORING AND RANKING TESTS
// =============================================================================

describe("Scoring and Ranking", () => {
  test("sorts results by score descending", async () => {
    await createResearch("score-research");
    await createNotebook("score-research", "run-001", [
      // Multiple matches - some in source, some in output
      codeCell("print('score_test')", [streamOutput("score_test output")]),
      markdownCell("This also contains score_test"),
    ]);
    
    const result = await execute({ query: "score_test", includeOutputs: true });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBeGreaterThanOrEqual(2);
    
    // Verify results are sorted by score descending
    const scores = result.results!.map(r => r.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });
  
  test("source matches score higher than output matches", async () => {
    await createResearch("source-vs-output");
    await createNotebook("source-vs-output", "run-001", [
      codeCell("x = 1", [streamOutput("ranking_test_term")]),
      codeCell("ranking_test_term = 2"),
    ]);
    
    const result = await execute({ query: "ranking_test_term", includeOutputs: true });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBeGreaterThanOrEqual(2);
    
    const sourceMatches = result.results!.filter(r => r.matchLocation === "source");
    const outputMatches = result.results!.filter(r => r.matchLocation === "output");
    
    expect(sourceMatches.length).toBeGreaterThanOrEqual(1);
    expect(outputMatches.length).toBeGreaterThanOrEqual(1);
    
    // Source matches should have higher scores
    const minSourceScore = Math.min(...sourceMatches.map(r => r.score));
    const maxOutputScore = Math.max(...outputMatches.map(r => r.score));
    expect(minSourceScore).toBeGreaterThan(maxOutputScore);
  });
  
  test("respects limit parameter", async () => {
    await createResearch("limit-research");
    await createNotebook("limit-research", "run-001", [
      codeCell([
        "limit_term_1\n",
        "limit_term_2\n",
        "limit_term_3\n",
        "limit_term_4\n",
        "limit_term_5\n",
      ]),
    ]);
    
    const result = await execute({
      query: "limit_term",
      limit: 3,
    });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(5);
    expect(result.returnedMatches).toBe(3);
    expect(result.results).toHaveLength(3);
  });
  
  test("returns matchesByLocation breakdown", async () => {
    await createResearch("location-breakdown");
    await createNotebook("location-breakdown", "run-001", [
      codeCell("location_breakdown_test", [streamOutput("location_breakdown_test output")]),
    ]);
    
    const result = await execute({ query: "location_breakdown_test", includeOutputs: true });
    
    expect(result.success).toBe(true);
    expect(result.matchesByLocation).toBeDefined();
    expect(result.matchesByLocation!.source).toBeGreaterThanOrEqual(1);
    expect(result.matchesByLocation!.output).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// CASE SENSITIVITY TESTS
// =============================================================================

describe("Case Sensitivity", () => {
  test("search is case-insensitive", async () => {
    await createResearch("case-research");
    await createNotebook("case-research", "run-001", [
      codeCell("CamelCaseVariable = 1"),
    ]);
    
    // Search with different cases
    const lowerResult = await execute({ query: "camelcasevariable" });
    const upperResult = await execute({ query: "CAMELCASEVARIABLE" });
    const mixedResult = await execute({ query: "CamelCaseVariable" });
    
    expect(lowerResult.success).toBe(true);
    expect(lowerResult.totalMatches).toBe(1);
    
    expect(upperResult.success).toBe(true);
    expect(upperResult.totalMatches).toBe(1);
    
    expect(mixedResult.success).toBe(true);
    expect(mixedResult.totalMatches).toBe(1);
  });
  
  test("exact case match scores higher", async () => {
    await createResearch("exact-case-research");
    await createNotebook("exact-case-research", "run-001", [
      codeCell("ExactCase = 1\nexactcase = 2"),
    ]);
    
    const result = await execute({ query: "ExactCase" });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(2);
    
    // First result should be exact case match with higher score
    expect(result.results![0].snippet).toContain("ExactCase");
  });
});

// =============================================================================
// SNIPPET GENERATION TESTS
// =============================================================================

describe("Snippet Generation", () => {
  test("generates contextual snippet around match", async () => {
    await createResearch("snippet-research");
    await createNotebook("snippet-research", "run-001", [
      codeCell("prefix_text snippet_target_word suffix_text more_content"),
    ]);
    
    const result = await execute({ query: "snippet_target_word" });
    
    expect(result.success).toBe(true);
    expect(result.results![0].snippet).toContain("snippet_target_word");
    expect(result.results![0].snippet).toContain("prefix_text");
    expect(result.results![0].snippet).toContain("suffix_text");
  });
  
  test("truncates long snippets", async () => {
    await createResearch("long-snippet-research");
    const longContent = "a".repeat(100) + "target_in_long" + "b".repeat(100);
    await createNotebook("long-snippet-research", "run-001", [
      codeCell(longContent),
    ]);
    
    const result = await execute({ query: "target_in_long" });
    
    expect(result.success).toBe(true);
    expect(result.results![0].snippet.length).toBeLessThanOrEqual(250);
    expect(result.results![0].snippet).toContain("target_in_long");
  });
  
  test("adds ellipsis when content is truncated", async () => {
    await createResearch("ellipsis-research");
    const longContent = "x".repeat(100) + "ellipsis_test" + "y".repeat(100);
    await createNotebook("ellipsis-research", "run-001", [
      codeCell(longContent),
    ]);
    
    const result = await execute({ query: "ellipsis_test" });
    
    expect(result.success).toBe(true);
    expect(result.results![0].snippet).toContain("...");
  });
});

// =============================================================================
// EDGE CASES AND ERROR HANDLING TESTS
// =============================================================================

describe("Edge Cases and Error Handling", () => {
  test("returns error for empty query", async () => {
    const result = await execute({ query: "" });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("empty");
  });
  
  test("returns error for whitespace-only query", async () => {
    const result = await execute({ query: "   " });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("empty");
  });
  
  test("handles malformed notebook gracefully", async () => {
    await createResearch("malformed-research");
    const notebooksDir = getResearchNotebooksDir("malformed-research");
    await fs.mkdir(notebooksDir, { recursive: true });
    
    // Create invalid JSON
    await fs.writeFile(
      path.join(notebooksDir, "bad-notebook.ipynb"),
      "{ invalid json"
    );
    
    // Also create a valid notebook
    await createNotebook("malformed-research", "good-run", [
      codeCell("valid_content = 1"),
    ]);
    
    const result = await execute({
      query: "valid_content",
      researchId: "malformed-research",
    });
    
    // Should still succeed and find the valid notebook
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(1);
  });
  
  test("handles notebook without cells array", async () => {
    await createResearch("no-cells-research");
    const notebooksDir = getResearchNotebooksDir("no-cells-research");
    await fs.mkdir(notebooksDir, { recursive: true });
    
    await fs.writeFile(
      path.join(notebooksDir, "no-cells.ipynb"),
      JSON.stringify({ nbformat: 4, metadata: {} })
    );
    
    const result = await execute({
      query: "anything",
      researchId: "no-cells-research",
    });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(0);
  });
  
  test("handles cell without source", async () => {
    await createResearch("no-source-research");
    const notebooksDir = getResearchNotebooksDir("no-source-research");
    await fs.mkdir(notebooksDir, { recursive: true });
    
    // Create notebook with cell missing source
    await fs.writeFile(
      path.join(notebooksDir, "no-source.ipynb"),
      JSON.stringify({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {},
        cells: [
          { cell_type: "code", id: "cell-1" },
        ],
      })
    );
    
    // Also create valid notebook
    await createNotebook("no-source-research", "valid-run", [
      codeCell("valid_source = 1"),
    ]);
    
    const result = await execute({
      query: "valid_source",
      researchId: "no-source-research",
    });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(1);
  });
  
  test("returns correct runId from notebook filename", async () => {
    await createResearch("runid-research");
    await createNotebook("runid-research", "my-custom-run-id", [
      codeCell("runid_test = 1"),
    ]);
    
    const result = await execute({
      query: "runid_test",
      researchId: "runid-research",
    });
    
    expect(result.success).toBe(true);
    expect(result.results![0].runId).toBe("my-custom-run-id");
  });
  
  test("returns correct cellId", async () => {
    await createResearch("cellid-research");
    await createNotebook("cellid-research", "run-001", [
      codeCell("cellid_test = 1", [], "custom-cell-id"),
    ]);
    
    const result = await execute({
      query: "cellid_test",
      researchId: "cellid-research",
    });
    
    expect(result.success).toBe(true);
    expect(result.results![0].cellId).toBe("custom-cell-id");
  });
  
  test("generates cellId if not present in notebook", async () => {
    await createResearch("auto-cellid-research");
    const notebooksDir = getResearchNotebooksDir("auto-cellid-research");
    await fs.mkdir(notebooksDir, { recursive: true });
    
    // Create notebook without cell IDs (older format)
    await fs.writeFile(
      path.join(notebooksDir, "no-id.ipynb"),
      JSON.stringify({
        nbformat: 4,
        nbformat_minor: 4, // Older version without cell IDs
        metadata: {},
        cells: [
          { cell_type: "code", source: ["auto_cellid_test = 1"], outputs: [] },
        ],
      })
    );
    
    const result = await execute({
      query: "auto_cellid_test",
      researchId: "auto-cellid-research",
    });
    
    expect(result.success).toBe(true);
    expect(result.results![0].cellId).toBe("cell-0");
  });
});

// =============================================================================
// MIXED CONTENT TESTS
// =============================================================================

describe("Mixed Content", () => {
  test("searches across code and markdown cells", async () => {
    await createResearch("mixed-research");
    await createNotebook("mixed-research", "run-001", [
      markdownCell("# Analysis of mixed_content_term"),
      codeCell("result = calculate(mixed_content_term)"),
      markdownCell("The mixed_content_term shows significance"),
    ]);
    
    const result = await execute({ query: "mixed_content_term" });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(3);
    
    const codeMatches = result.results!.filter(r => r.cellType === "code");
    const markdownMatches = result.results!.filter(r => r.cellType === "markdown");
    
    expect(codeMatches.length).toBe(1);
    expect(markdownMatches.length).toBe(2);
  });
  
  test("searches source and output in same cell", async () => {
    await createResearch("source-output-research");
    await createNotebook("source-output-research", "run-001", [
      codeCell(
        "print('source_and_output_term')",
        [streamOutput("source_and_output_term was printed")]
      ),
    ]);
    
    const result = await execute({ query: "source_and_output_term", includeOutputs: true });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(2);
    
    const sourceMatches = result.results!.filter(r => r.matchLocation === "source");
    const outputMatches = result.results!.filter(r => r.matchLocation === "output");
    
    expect(sourceMatches.length).toBe(1);
    expect(outputMatches.length).toBe(1);
    expect(sourceMatches[0].cellId).toBe(outputMatches[0].cellId);
  });
});

// =============================================================================
// MULTI-NOTEBOOK TESTS
// =============================================================================

describe("Multi-Notebook Search", () => {
  test("searches across multiple notebooks in same research", async () => {
    await createResearch("multi-nb");
    
    await createNotebook("multi-nb", "run-001", [
      codeCell("multi_nb_term = 'first'"),
    ]);
    await createNotebook("multi-nb", "run-002", [
      codeCell("multi_nb_term = 'second'"),
    ]);
    await createNotebook("multi-nb", "run-003", [
      codeCell("multi_nb_term = 'third'"),
    ]);
    
    const result = await execute({
      query: "multi_nb_term",
      researchId: "multi-nb",
    });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(3);
    expect(result.notebooksSearched).toBe(3);
    
    // Verify different runs are matched
    const runIds = new Set(result.results!.map(r => r.runId));
    expect(runIds.has("run-001")).toBe(true);
    expect(runIds.has("run-002")).toBe(true);
    expect(runIds.has("run-003")).toBe(true);
  });
  
  test("returns correct notebookPath for each match", async () => {
    await createResearch("path-research");
    
    const nb1Path = await createNotebook("path-research", "run-alpha", [
      codeCell("path_test = 1"),
    ]);
    const nb2Path = await createNotebook("path-research", "run-beta", [
      codeCell("path_test = 2"),
    ]);
    
    const result = await execute({
      query: "path_test",
      researchId: "path-research",
    });
    
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(2);
    
    const paths = result.results!.map(r => r.notebookPath);
    expect(paths).toContain(nb1Path);
    expect(paths).toContain(nb2Path);
  });
});
