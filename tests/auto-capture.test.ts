/**
 * Tests for python-repl auto-capture functionality.
 * Tests the notebook cell capture mechanism that automatically records
 * executed code and outputs to Jupyter notebooks.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-capture-test-"));
});

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

describe("Auto-Capture: splitIntoLines", () => {
  const { splitIntoLines } = require("../.opencode/tool/python-repl.ts");

  test("splits single line without trailing newline", () => {
    const result = splitIntoLines("hello");
    expect(result).toEqual(["hello"]);
  });

  test("splits multiple lines with newlines preserved", () => {
    const result = splitIntoLines("line1\nline2\nline3");
    expect(result).toEqual(["line1\n", "line2\n", "line3"]);
  });

  test("handles empty string", () => {
    const result = splitIntoLines("");
    expect(result).toEqual([]);
  });

  test("handles string with only newlines", () => {
    const result = splitIntoLines("\n\n");
    expect(result).toEqual(["\n", "\n"]);
  });

  test("handles trailing newline", () => {
    const result = splitIntoLines("line1\nline2\n");
    expect(result).toEqual(["line1\n", "line2\n"]);
  });
});

describe("Auto-Capture: convertExecuteResultToOutputs", () => {
  const { convertExecuteResultToOutputs } = require("../.opencode/tool/python-repl.ts");

  test("converts stdout to stream output", () => {
    const result = {
      success: true,
      stdout: "Hello, World!\n",
      stderr: "",
      markers: [],
      artifacts: [],
      timing: { started_at: "2025-01-01T00:00:00Z", duration_ms: 100 },
      memory: { rss_mb: 50, vms_mb: 100 },
    };

    const outputs = convertExecuteResultToOutputs(result);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toEqual({
      output_type: "stream",
      name: "stdout",
      text: ["Hello, World!\n"],
    });
  });

  test("converts stderr to stream output", () => {
    const result = {
      success: true,
      stdout: "",
      stderr: "Warning: deprecated\n",
      markers: [],
      artifacts: [],
      timing: { started_at: "2025-01-01T00:00:00Z", duration_ms: 100 },
      memory: { rss_mb: 50, vms_mb: 100 },
    };

    const outputs = convertExecuteResultToOutputs(result);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toEqual({
      output_type: "stream",
      name: "stderr",
      text: ["Warning: deprecated\n"],
    });
  });

  test("converts error to error output", () => {
    const result = {
      success: false,
      stdout: "",
      stderr: "",
      markers: [],
      artifacts: [],
      timing: { started_at: "2025-01-01T00:00:00Z", duration_ms: 100 },
      memory: { rss_mb: 50, vms_mb: 100 },
      error: {
        type: "ValueError",
        message: "invalid literal",
        traceback: "Traceback (most recent call last):\n  File...\nValueError: invalid literal",
      },
    };

    const outputs = convertExecuteResultToOutputs(result);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].output_type).toBe("error");
    expect((outputs[0] as any).ename).toBe("ValueError");
    expect((outputs[0] as any).evalue).toBe("invalid literal");
    expect((outputs[0] as any).traceback).toHaveLength(3);
  });

  test("converts mixed stdout, stderr, and error", () => {
    const result = {
      success: false,
      stdout: "Output before error\n",
      stderr: "Some warning\n",
      markers: [],
      artifacts: [],
      timing: { started_at: "2025-01-01T00:00:00Z", duration_ms: 100 },
      memory: { rss_mb: 50, vms_mb: 100 },
      error: {
        type: "RuntimeError",
        message: "Something went wrong",
        traceback: "Traceback...\n",
      },
    };

    const outputs = convertExecuteResultToOutputs(result);
    expect(outputs).toHaveLength(3);
    expect(outputs[0].output_type).toBe("stream");
    expect((outputs[0] as any).name).toBe("stdout");
    expect(outputs[1].output_type).toBe("stream");
    expect((outputs[1] as any).name).toBe("stderr");
    expect(outputs[2].output_type).toBe("error");
  });

  test("handles empty result (no outputs)", () => {
    const result = {
      success: true,
      stdout: "",
      stderr: "",
      markers: [],
      artifacts: [],
      timing: { started_at: "2025-01-01T00:00:00Z", duration_ms: 100 },
      memory: { rss_mb: 50, vms_mb: 100 },
    };

    const outputs = convertExecuteResultToOutputs(result);
    expect(outputs).toEqual([]);
  });
});

describe("Auto-Capture: appendCodeCellToNotebook", () => {
  const { appendCodeCellToNotebook } = require("../.opencode/tool/python-repl.ts");

  test("creates new notebook when file doesn't exist", async () => {
    const notebookPath = path.join(tempDir, "new-notebook.ipynb");
    const code = "print('hello')";
    const outputs = [
      { output_type: "stream", name: "stdout", text: ["hello\n"] },
    ];

    const result = await appendCodeCellToNotebook(
      notebookPath,
      "test-session",
      code,
      outputs,
      1
    );

    expect(result.captured).toBe(true);
    expect(result.cellId).toBeDefined();
    expect(result.cellIndex).toBe(0);

    const content = await fs.readFile(notebookPath, "utf-8");
    const notebook = JSON.parse(content);
    expect(notebook.cells).toHaveLength(1);
    expect(notebook.cells[0].cell_type).toBe("code");
    expect(notebook.cells[0].source).toEqual(["print('hello')"]);
    expect(notebook.cells[0].outputs).toEqual(outputs);
    expect(notebook.cells[0].execution_count).toBe(1);
    expect(notebook.nbformat).toBe(4);
    expect(notebook.nbformat_minor).toBe(5);
  });

  test("appends to existing notebook", async () => {
    const notebookPath = path.join(tempDir, "existing-notebook.ipynb");
    const existingNotebook = {
      cells: [
        {
          cell_type: "code",
          id: "existing-cell",
          source: ["x = 1"],
          outputs: [],
          execution_count: 1,
          metadata: {},
        },
      ],
      metadata: {
        kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
        language_info: { name: "python" },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };
    await fs.writeFile(notebookPath, JSON.stringify(existingNotebook, null, 2));

    const result = await appendCodeCellToNotebook(
      notebookPath,
      "test-session",
      "print(x)",
      [{ output_type: "stream", name: "stdout", text: ["1\n"] }],
      2
    );

    expect(result.captured).toBe(true);
    expect(result.cellIndex).toBe(1);

    const content = await fs.readFile(notebookPath, "utf-8");
    const notebook = JSON.parse(content);
    expect(notebook.cells).toHaveLength(2);
    expect(notebook.cells[1].source).toEqual(["print(x)"]);
    expect(notebook.cells[1].execution_count).toBe(2);
  });

  test("creates parent directories if needed", async () => {
    const notebookPath = path.join(tempDir, "nested", "dir", "notebook.ipynb");

    const result = await appendCodeCellToNotebook(
      notebookPath,
      "test-session",
      "x = 1",
      [],
      1
    );

    expect(result.captured).toBe(true);
    const exists = await fs.access(notebookPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  test("handles multiline code", async () => {
    const notebookPath = path.join(tempDir, "multiline.ipynb");
    const code = "def greet(name):\n    return f'Hello, {name}'\n\nprint(greet('World'))";

    const result = await appendCodeCellToNotebook(
      notebookPath,
      "test-session",
      code,
      [{ output_type: "stream", name: "stdout", text: ["Hello, World\n"] }],
      1
    );

    expect(result.captured).toBe(true);

    const content = await fs.readFile(notebookPath, "utf-8");
    const notebook = JSON.parse(content);
    expect(notebook.cells[0].source).toEqual([
      "def greet(name):\n",
      "    return f'Hello, {name}'\n",
      "\n",
      "print(greet('World'))"
    ]);
  });

  test("includes autoCaptured metadata", async () => {
    const notebookPath = path.join(tempDir, "metadata.ipynb");

    await appendCodeCellToNotebook(
      notebookPath,
      "test-session",
      "x = 1",
      [],
      1
    );

    const content = await fs.readFile(notebookPath, "utf-8");
    const notebook = JSON.parse(content);
    expect(notebook.cells[0].metadata.gyoshu.autoCaptured).toBe(true);
    expect(notebook.cells[0].metadata.gyoshu.type).toBe("research");
    expect(notebook.cells[0].metadata.gyoshu.lastUpdated).toBeDefined();
  });
});

describe("Auto-Capture: Execution Counter", () => {
  const { 
    getExecutionCount, 
    resetExecutionCounter,
    getNextExecutionCount 
  } = require("../.opencode/tool/python-repl.ts");

  beforeEach(() => {
    resetExecutionCounter("counter-test-session");
  });

  test("starts at 0", () => {
    expect(getExecutionCount("counter-test-session")).toBe(0);
  });

  test("increments execution count", () => {
    expect(getNextExecutionCount("counter-test-session")).toBe(1);
    expect(getNextExecutionCount("counter-test-session")).toBe(2);
    expect(getNextExecutionCount("counter-test-session")).toBe(3);
    expect(getExecutionCount("counter-test-session")).toBe(3);
  });

  test("resets execution count", () => {
    getNextExecutionCount("counter-test-session");
    getNextExecutionCount("counter-test-session");
    resetExecutionCounter("counter-test-session");
    expect(getExecutionCount("counter-test-session")).toBe(0);
    expect(getNextExecutionCount("counter-test-session")).toBe(1);
  });

  test("maintains separate counters per session", () => {
    resetExecutionCounter("session-a");
    resetExecutionCounter("session-b");

    getNextExecutionCount("session-a");
    getNextExecutionCount("session-a");
    getNextExecutionCount("session-b");

    expect(getExecutionCount("session-a")).toBe(2);
    expect(getExecutionCount("session-b")).toBe(1);
  });
});
