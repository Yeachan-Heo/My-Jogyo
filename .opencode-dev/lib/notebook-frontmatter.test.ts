import { describe, it, expect, beforeEach } from "bun:test";
import {
  parseSimpleYaml,
  serializeToYaml,
  extractFrontmatter,
  extractFullFrontmatter,
  updateFrontmatter,
  ensureFrontmatterCell,
  validateFrontmatter,
  hasFrontmatter,
  getCurrentRun,
  addRun,
  updateRun,
  GyoshuFrontmatter,
  RunEntry,
} from "./notebook-frontmatter";
import { Notebook } from "./cell-identity";

function createTestNotebook(cells: Notebook["cells"] = []): Notebook {
  return {
    cells,
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python", version: "3.11" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

function createFrontmatterCell(content: string): Notebook["cells"][0] {
  return {
    cell_type: "raw",
    id: "frontmatter-test",
    source: content.split("\n").map((line, i, arr) => (i < arr.length - 1 ? line + "\n" : line)),
    metadata: {},
  };
}

function createValidFrontmatter(overrides: Partial<GyoshuFrontmatter> = {}): GyoshuFrontmatter {
  return {
    schema_version: 1,
    workspace: "test-workspace",
    slug: "test-slug",
    status: "active",
    created: "2026-01-01T10:00:00Z",
    updated: "2026-01-01T12:00:00Z",
    tags: ["test", "unit"],
    ...overrides,
  };
}

describe("parseSimpleYaml", () => {
  it("parses simple key-value pairs", () => {
    const yaml = `
title: Hello World
author: Test Author
count: 42
`;
    const result = parseSimpleYaml(yaml);
    expect(result.title).toBe("Hello World");
    expect(result.author).toBe("Test Author");
    expect(result.count).toBe(42);
  });

  it("parses quoted strings", () => {
    const yaml = `
title: "Hello: World"
path: '/some/path'
`;
    const result = parseSimpleYaml(yaml);
    expect(result.title).toBe("Hello: World");
    expect(result.path).toBe("/some/path");
  });

  it("parses boolean values", () => {
    const yaml = `
enabled: true
disabled: false
`;
    const result = parseSimpleYaml(yaml);
    expect(result.enabled).toBe(true);
    expect(result.disabled).toBe(false);
  });

  it("parses null values", () => {
    const yaml = `
empty: null
tilde: ~
`;
    const result = parseSimpleYaml(yaml);
    expect(result.empty).toBe(null);
    expect(result.tilde).toBe(null);
  });

  it("parses nested objects", () => {
    const yaml = `
gyoshu:
  schema_version: 1
  workspace: customer-analytics
  status: active
`;
    const result = parseSimpleYaml(yaml);
    expect(result.gyoshu).toBeDefined();
    const gyoshu = result.gyoshu as Record<string, unknown>;
    expect(gyoshu.schema_version).toBe(1);
    expect(gyoshu.workspace).toBe("customer-analytics");
    expect(gyoshu.status).toBe("active");
  });

  it("parses simple string arrays", () => {
    const yaml = `
gyoshu:
  tags:
    - ml
    - classification
    - test
`;
    const result = parseSimpleYaml(yaml);
    const gyoshu = result.gyoshu as Record<string, unknown>;
    expect(gyoshu.tags).toEqual(["ml", "classification", "test"]);
  });

  it("parses object arrays", () => {
    const yaml = `
gyoshu:
  runs:
    - id: run-001
      started: "2026-01-01T10:00:00Z"
      status: completed
    - id: run-002
      started: "2026-01-01T14:00:00Z"
      status: in_progress
`;
    const result = parseSimpleYaml(yaml);
    const gyoshu = result.gyoshu as Record<string, unknown>;
    const runs = gyoshu.runs as Record<string, unknown>[];
    expect(runs).toHaveLength(2);
    expect(runs[0].id).toBe("run-001");
    expect(runs[0].status).toBe("completed");
    expect(runs[1].id).toBe("run-002");
    expect(runs[1].status).toBe("in_progress");
  });

  it("skips comment lines", () => {
    const yaml = `
# This is a comment
title: Test
# Another comment
author: Author
`;
    const result = parseSimpleYaml(yaml);
    expect(result.title).toBe("Test");
    expect(result.author).toBe("Author");
    expect(Object.keys(result)).toHaveLength(2);
  });

  it("handles complex frontmatter structure", () => {
    const yaml = `
title: Customer Churn Prediction
date: 2026-01-01
gyoshu:
  schema_version: 1
  workspace: customer-analytics
  slug: churn-prediction
  status: active
  created: "2026-01-01T10:00:00Z"
  updated: "2026-01-01T15:00:00Z"
  tags:
    - ml
    - classification
  runs:
    - id: run-001
      started: "2026-01-01T10:00:00Z"
      ended: "2026-01-01T11:00:00Z"
      status: completed
`;
    const result = parseSimpleYaml(yaml);
    expect(result.title).toBe("Customer Churn Prediction");
    expect(result.date).toBe("2026-01-01");
    const gyoshu = result.gyoshu as Record<string, unknown>;
    expect(gyoshu.schema_version).toBe(1);
    expect(gyoshu.workspace).toBe("customer-analytics");
    expect((gyoshu.tags as string[])).toEqual(["ml", "classification"]);
    expect((gyoshu.runs as unknown[])).toHaveLength(1);
  });
});

describe("serializeToYaml", () => {
  it("serializes simple key-value pairs", () => {
    const obj = { title: "Test", count: 42, enabled: true };
    const yaml = serializeToYaml(obj);
    expect(yaml).toContain("title: Test");
    expect(yaml).toContain("count: 42");
    expect(yaml).toContain("enabled: true");
  });

  it("serializes nested objects", () => {
    const obj = {
      gyoshu: {
        schema_version: 1,
        workspace: "test",
      },
    };
    const yaml = serializeToYaml(obj);
    expect(yaml).toContain("gyoshu:");
    expect(yaml).toContain("  schema_version: 1");
    expect(yaml).toContain("  workspace: test");
  });

  it("serializes string arrays", () => {
    const obj = {
      gyoshu: {
        tags: ["ml", "test"],
      },
    };
    const yaml = serializeToYaml(obj);
    expect(yaml).toContain("gyoshu:");
    expect(yaml).toContain("  tags:");
    expect(yaml).toContain("    - ml");
    expect(yaml).toContain("    - test");
  });

  it("serializes object arrays", () => {
    const obj = {
      gyoshu: {
        runs: [
          { id: "run-001", status: "completed" },
          { id: "run-002", status: "in_progress" },
        ],
      },
    };
    const yaml = serializeToYaml(obj);
    expect(yaml).toContain("runs:");
    expect(yaml).toContain("    - id: run-001");
    expect(yaml).toContain("      status: completed");
    expect(yaml).toContain("    - id: run-002");
  });

  it("quotes strings with special characters", () => {
    const obj = { path: "/some/path:with:colons" };
    const yaml = serializeToYaml(obj);
    expect(yaml).toContain('path: "/some/path:with:colons"');
  });

  it("round-trips parsed YAML", () => {
    const original = {
      gyoshu: {
        schema_version: 1,
        workspace: "test",
        status: "active",
        tags: ["a", "b"],
      },
    };
    const yaml = serializeToYaml(original);
    const parsed = parseSimpleYaml(yaml);
    expect(parsed.gyoshu).toBeDefined();
    const gyoshu = parsed.gyoshu as Record<string, unknown>;
    expect(gyoshu.schema_version).toBe(1);
    expect(gyoshu.workspace).toBe("test");
    expect(gyoshu.tags).toEqual(["a", "b"]);
  });
});

describe("extractFrontmatter", () => {
  it("returns null for empty notebook", () => {
    const notebook = createTestNotebook([]);
    expect(extractFrontmatter(notebook)).toBe(null);
  });

  it("returns null if first cell is not raw type", () => {
    const notebook = createTestNotebook([
      { cell_type: "code", id: "test", source: "print('hello')", metadata: {} },
    ]);
    expect(extractFrontmatter(notebook)).toBe(null);
  });

  it("returns null if raw cell has no YAML delimiters", () => {
    const notebook = createTestNotebook([
      { cell_type: "raw", id: "test", source: "Just some text", metadata: {} },
    ]);
    expect(extractFrontmatter(notebook)).toBe(null);
  });

  it("returns null if no gyoshu namespace", () => {
    const notebook = createTestNotebook([
      createFrontmatterCell(`---
title: Test
author: Someone
---`),
    ]);
    expect(extractFrontmatter(notebook)).toBe(null);
  });

  it("extracts valid gyoshu frontmatter", () => {
    const notebook = createTestNotebook([
      createFrontmatterCell(`---
gyoshu:
  schema_version: 1
  workspace: test-workspace
  slug: test-slug
  status: active
  created: "2026-01-01T10:00:00Z"
  updated: "2026-01-01T12:00:00Z"
  tags:
    - test
---`),
    ]);
    const frontmatter = extractFrontmatter(notebook);
    expect(frontmatter).not.toBe(null);
    expect(frontmatter!.schema_version).toBe(1);
    expect(frontmatter!.workspace).toBe("test-workspace");
    expect(frontmatter!.slug).toBe("test-slug");
    expect(frontmatter!.status).toBe("active");
    expect(frontmatter!.tags).toEqual(["test"]);
  });

  it("extracts optional fields when present", () => {
    const notebook = createTestNotebook([
      createFrontmatterCell(`---
gyoshu:
  schema_version: 1
  workspace: test
  slug: test
  status: active
  created: "2026-01-01T10:00:00Z"
  updated: "2026-01-01T12:00:00Z"
  tags:
    - test
  python_env: .venv
  outputs_dir: outputs/test
---`),
    ]);
    const frontmatter = extractFrontmatter(notebook);
    expect(frontmatter!.python_env).toBe(".venv");
    expect(frontmatter!.outputs_dir).toBe("outputs/test");
  });

  it("extracts run history when present", () => {
    const notebook = createTestNotebook([
      createFrontmatterCell(`---
gyoshu:
  schema_version: 1
  workspace: test
  slug: test
  status: active
  created: "2026-01-01T10:00:00Z"
  updated: "2026-01-01T12:00:00Z"
  tags:
    - test
  runs:
    - id: run-001
      started: "2026-01-01T10:00:00Z"
      ended: "2026-01-01T11:00:00Z"
      status: completed
      notes: Initial run
---`),
    ]);
    const frontmatter = extractFrontmatter(notebook);
    expect(frontmatter!.runs).toHaveLength(1);
    expect(frontmatter!.runs![0].id).toBe("run-001");
    expect(frontmatter!.runs![0].status).toBe("completed");
    expect(frontmatter!.runs![0].notes).toBe("Initial run");
  });

  it("returns null for invalid status", () => {
    const notebook = createTestNotebook([
      createFrontmatterCell(`---
gyoshu:
  schema_version: 1
  workspace: test
  slug: test
  status: invalid_status
  created: "2026-01-01T10:00:00Z"
  updated: "2026-01-01T12:00:00Z"
  tags:
    - test
---`),
    ]);
    expect(extractFrontmatter(notebook)).toBe(null);
  });
});

describe("extractFullFrontmatter", () => {
  it("extracts Quarto-compatible fields", () => {
    const notebook = createTestNotebook([
      createFrontmatterCell(`---
title: Customer Churn Analysis
author: Data Scientist
date: 2026-01-01
gyoshu:
  schema_version: 1
  workspace: analytics
  slug: churn
  status: active
  created: "2026-01-01T10:00:00Z"
  updated: "2026-01-01T12:00:00Z"
  tags:
    - ml
---`),
    ]);
    const full = extractFullFrontmatter(notebook);
    expect(full).not.toBe(null);
    expect(full!.title).toBe("Customer Churn Analysis");
    expect(full!.author).toBe("Data Scientist");
    expect(full!.date).toBe("2026-01-01");
    expect(full!.gyoshu).toBeDefined();
  });
});

describe("updateFrontmatter", () => {
  let notebook: Notebook;

  beforeEach(() => {
    notebook = createTestNotebook([
      createFrontmatterCell(`---
title: Original Title
gyoshu:
  schema_version: 1
  workspace: original-workspace
  slug: original-slug
  status: active
  created: "2026-01-01T10:00:00Z"
  updated: "2026-01-01T12:00:00Z"
  tags:
    - original
---`),
      { cell_type: "code", id: "code-1", source: "print('hello')", metadata: {} },
    ]);
  });

  it("returns new notebook object (immutable)", () => {
    const updated = updateFrontmatter(notebook, { status: "completed" });
    expect(updated).not.toBe(notebook);
    expect(notebook.cells[0]).not.toBe(updated.cells[0]);
  });

  it("preserves existing cells", () => {
    const updated = updateFrontmatter(notebook, { status: "completed" });
    expect(updated.cells).toHaveLength(2);
    const codeCell = updated.cells[1];
    expect(codeCell.cell_type).toBe("code");
  });

  it("updates specified fields", () => {
    const updated = updateFrontmatter(notebook, { status: "completed" });
    const frontmatter = extractFrontmatter(updated);
    expect(frontmatter!.status).toBe("completed");
  });

  it("preserves unmodified fields", () => {
    const updated = updateFrontmatter(notebook, { status: "completed" });
    const frontmatter = extractFrontmatter(updated);
    expect(frontmatter!.workspace).toBe("original-workspace");
    expect(frontmatter!.slug).toBe("original-slug");
    expect(frontmatter!.schema_version).toBe(1);
  });

  it("updates the updated timestamp", () => {
    const originalFrontmatter = extractFrontmatter(notebook);
    const updated = updateFrontmatter(notebook, { status: "completed" });
    const newFrontmatter = extractFrontmatter(updated);
    expect(newFrontmatter!.updated).not.toBe(originalFrontmatter!.updated);
  });

  it("replaces tags when provided", () => {
    const updated = updateFrontmatter(notebook, { tags: ["new", "tags"] });
    const frontmatter = extractFrontmatter(updated);
    expect(frontmatter!.tags).toEqual(["new", "tags"]);
  });

  it("throws if notebook has no cells", () => {
    const empty = createTestNotebook([]);
    expect(() => updateFrontmatter(empty, { status: "completed" })).toThrow(
      "Cannot update frontmatter: notebook has no cells"
    );
  });

  it("throws if first cell is not frontmatter", () => {
    const noFrontmatter = createTestNotebook([
      { cell_type: "code", id: "code-1", source: "print('hello')", metadata: {} },
    ]);
    expect(() => updateFrontmatter(noFrontmatter, { status: "completed" })).toThrow(
      "Cannot update frontmatter: first cell is not a frontmatter cell"
    );
  });
});

describe("ensureFrontmatterCell", () => {
  it("adds frontmatter cell to empty notebook", () => {
    const notebook = createTestNotebook([]);
    const initial = createValidFrontmatter();
    const updated = ensureFrontmatterCell(notebook, initial);
    expect(updated.cells).toHaveLength(1);
    expect(updated.cells[0].cell_type).toBe("raw");
    const frontmatter = extractFrontmatter(updated);
    expect(frontmatter).not.toBe(null);
    expect(frontmatter!.workspace).toBe("test-workspace");
  });

  it("adds frontmatter cell at position 0", () => {
    const notebook = createTestNotebook([
      { cell_type: "code", id: "code-1", source: "print('hello')", metadata: {} },
    ]);
    const initial = createValidFrontmatter();
    const updated = ensureFrontmatterCell(notebook, initial);
    expect(updated.cells).toHaveLength(2);
    expect(updated.cells[0].cell_type).toBe("raw");
    expect(updated.cells[1].cell_type).toBe("code");
  });

  it("does not add duplicate frontmatter cell", () => {
    const notebook = createTestNotebook([
      createFrontmatterCell(`---
gyoshu:
  schema_version: 1
  workspace: existing
  slug: existing
  status: active
  created: "2026-01-01T10:00:00Z"
  updated: "2026-01-01T12:00:00Z"
  tags:
    - existing
---`),
    ]);
    const initial = createValidFrontmatter({ workspace: "new-workspace" });
    const updated = ensureFrontmatterCell(notebook, initial);
    expect(updated.cells).toHaveLength(1);
    const frontmatter = extractFrontmatter(updated);
    expect(frontmatter!.workspace).toBe("existing");
  });

  it("returns new notebook object (immutable)", () => {
    const notebook = createTestNotebook([]);
    const initial = createValidFrontmatter();
    const updated = ensureFrontmatterCell(notebook, initial);
    expect(updated).not.toBe(notebook);
  });

  it("creates cell with proper YAML format", () => {
    const notebook = createTestNotebook([]);
    const initial = createValidFrontmatter({ tags: ["ml", "test"] });
    const updated = ensureFrontmatterCell(notebook, initial);
    const source = Array.isArray(updated.cells[0].source)
      ? updated.cells[0].source.join("")
      : updated.cells[0].source;
    expect(source).toContain("---");
    expect(source).toContain("gyoshu:");
    expect(source).toContain("schema_version: 1");
    expect(source).toContain("- ml");
    expect(source).toContain("- test");
  });

  it("includes frontmatter metadata on cell", () => {
    const notebook = createTestNotebook([]);
    const initial = createValidFrontmatter();
    const updated = ensureFrontmatterCell(notebook, initial);
    const cellMeta = updated.cells[0].metadata?.gyoshu as Record<string, unknown>;
    expect(cellMeta).toBeDefined();
    expect(cellMeta.type).toBe("frontmatter");
  });
});

describe("validateFrontmatter", () => {
  it("validates correct frontmatter", () => {
    const frontmatter = createValidFrontmatter();
    const result = validateFrontmatter(frontmatter);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects unsupported schema version", () => {
    const frontmatter = createValidFrontmatter({ schema_version: 2 });
    const result = validateFrontmatter(frontmatter);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Unsupported schema version: 2. Expected: 1");
  });

  it("rejects invalid status", () => {
    const frontmatter = { ...createValidFrontmatter(), status: "invalid" as any };
    const result = validateFrontmatter(frontmatter);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("Invalid status"))).toBe(true);
  });

  it("accepts missing workspace (now optional)", () => {
    const frontmatter = { ...createValidFrontmatter(), workspace: undefined };
    const result = validateFrontmatter(frontmatter);
    expect(result.isValid).toBe(true);
  });

  it("accepts missing slug (now optional)", () => {
    const frontmatter = { ...createValidFrontmatter(), slug: undefined };
    const result = validateFrontmatter(frontmatter);
    expect(result.isValid).toBe(true);
  });

  it("rejects invalid workspace type", () => {
    const frontmatter = { ...createValidFrontmatter(), workspace: 123 as any };
    const result = validateFrontmatter(frontmatter);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Invalid workspace (must be string if provided)");
  });

  it("validates run entries", () => {
    const frontmatter = createValidFrontmatter({
      runs: [
        { id: "run-001", started: "2026-01-01T10:00:00Z", status: "completed" },
        { id: "", started: "2026-01-01T11:00:00Z", status: "in_progress" },
      ],
    });
    const result = validateFrontmatter(frontmatter);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("Run 1: missing or invalid id"))).toBe(true);
  });

  it("accepts all valid statuses", () => {
    for (const status of ["active", "completed", "archived"] as const) {
      const frontmatter = createValidFrontmatter({ status });
      const result = validateFrontmatter(frontmatter);
      expect(result.isValid).toBe(true);
    }
  });
});

describe("hasFrontmatter", () => {
  it("returns true for notebook with valid frontmatter", () => {
    const notebook = createTestNotebook([
      createFrontmatterCell(`---
gyoshu:
  schema_version: 1
  workspace: test
  slug: test
  status: active
  created: "2026-01-01T10:00:00Z"
  updated: "2026-01-01T12:00:00Z"
  tags:
    - test
---`),
    ]);
    expect(hasFrontmatter(notebook)).toBe(true);
  });

  it("returns false for notebook without frontmatter", () => {
    const notebook = createTestNotebook([
      { cell_type: "code", id: "code-1", source: "print('hello')", metadata: {} },
    ]);
    expect(hasFrontmatter(notebook)).toBe(false);
  });

  it("returns false for empty notebook", () => {
    const notebook = createTestNotebook([]);
    expect(hasFrontmatter(notebook)).toBe(false);
  });
});

describe("getCurrentRun", () => {
  it("returns null if no runs", () => {
    const frontmatter = createValidFrontmatter();
    expect(getCurrentRun(frontmatter)).toBe(null);
  });

  it("returns null if no in_progress run", () => {
    const frontmatter = createValidFrontmatter({
      runs: [
        { id: "run-001", started: "2026-01-01T10:00:00Z", status: "completed" },
        { id: "run-002", started: "2026-01-01T11:00:00Z", status: "failed" },
      ],
    });
    expect(getCurrentRun(frontmatter)).toBe(null);
  });

  it("returns the in_progress run", () => {
    const frontmatter = createValidFrontmatter({
      runs: [
        { id: "run-001", started: "2026-01-01T10:00:00Z", status: "completed" },
        { id: "run-002", started: "2026-01-01T11:00:00Z", status: "in_progress" },
      ],
    });
    const current = getCurrentRun(frontmatter);
    expect(current).not.toBe(null);
    expect(current!.id).toBe("run-002");
  });
});

describe("addRun", () => {
  it("adds run to frontmatter without existing runs", () => {
    const frontmatter = createValidFrontmatter();
    const newRun: RunEntry = {
      id: "run-001",
      started: "2026-01-01T10:00:00Z",
      status: "in_progress",
    };
    const updated = addRun(frontmatter, newRun);
    expect(updated.runs).toHaveLength(1);
    expect(updated.runs![0].id).toBe("run-001");
  });

  it("appends run to existing runs", () => {
    const frontmatter = createValidFrontmatter({
      runs: [{ id: "run-001", started: "2026-01-01T10:00:00Z", status: "completed" }],
    });
    const newRun: RunEntry = {
      id: "run-002",
      started: "2026-01-01T11:00:00Z",
      status: "in_progress",
    };
    const updated = addRun(frontmatter, newRun);
    expect(updated.runs).toHaveLength(2);
    expect(updated.runs![1].id).toBe("run-002");
  });

  it("keeps only last 10 runs", () => {
    const existingRuns: RunEntry[] = Array.from({ length: 10 }, (_, i) => ({
      id: `run-${String(i + 1).padStart(3, "0")}`,
      started: `2026-01-01T${String(i + 10).padStart(2, "0")}:00:00Z`,
      status: "completed" as const,
    }));
    const frontmatter = createValidFrontmatter({ runs: existingRuns });
    const newRun: RunEntry = {
      id: "run-011",
      started: "2026-01-01T20:00:00Z",
      status: "in_progress",
    };
    const updated = addRun(frontmatter, newRun);
    expect(updated.runs).toHaveLength(10);
    expect(updated.runs![0].id).toBe("run-002");
    expect(updated.runs![9].id).toBe("run-011");
  });

  it("updates the updated timestamp", () => {
    const frontmatter = createValidFrontmatter();
    const newRun: RunEntry = {
      id: "run-001",
      started: "2026-01-01T10:00:00Z",
      status: "in_progress",
    };
    const updated = addRun(frontmatter, newRun);
    expect(updated.updated).not.toBe(frontmatter.updated);
  });
});

describe("updateRun", () => {
  it("updates existing run by ID", () => {
    const frontmatter = createValidFrontmatter({
      runs: [
        { id: "run-001", started: "2026-01-01T10:00:00Z", status: "in_progress" },
      ],
    });
    const updated = updateRun(frontmatter, "run-001", {
      status: "completed",
      ended: "2026-01-01T11:00:00Z",
    });
    expect(updated.runs![0].status).toBe("completed");
    expect(updated.runs![0].ended).toBe("2026-01-01T11:00:00Z");
  });

  it("preserves other runs", () => {
    const frontmatter = createValidFrontmatter({
      runs: [
        { id: "run-001", started: "2026-01-01T10:00:00Z", status: "completed" },
        { id: "run-002", started: "2026-01-01T11:00:00Z", status: "in_progress" },
      ],
    });
    const updated = updateRun(frontmatter, "run-002", { status: "completed" });
    expect(updated.runs![0].status).toBe("completed");
    expect(updated.runs![0].id).toBe("run-001");
    expect(updated.runs![1].status).toBe("completed");
  });

  it("returns unchanged frontmatter if no runs", () => {
    const frontmatter = createValidFrontmatter();
    const updated = updateRun(frontmatter, "run-001", { status: "completed" });
    expect(updated.runs).toBeUndefined();
  });

  it("returns unchanged frontmatter if run not found", () => {
    const frontmatter = createValidFrontmatter({
      runs: [{ id: "run-001", started: "2026-01-01T10:00:00Z", status: "in_progress" }],
    });
    const updated = updateRun(frontmatter, "run-999", { status: "completed" });
    expect(updated.runs![0].status).toBe("in_progress");
  });

  it("updates the updated timestamp", () => {
    const frontmatter = createValidFrontmatter({
      runs: [{ id: "run-001", started: "2026-01-01T10:00:00Z", status: "in_progress" }],
    });
    const updated = updateRun(frontmatter, "run-001", { status: "completed" });
    expect(updated.updated).not.toBe(frontmatter.updated);
  });
});
