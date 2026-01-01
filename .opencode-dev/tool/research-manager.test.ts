/**
 * Integration tests for research-manager.ts
 *
 * Tests CRUD operations for research projects and runs,
 * atomic writes, and error handling.
 *
 * @module research-manager.test
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// Import the research-manager tool
import researchManager from "./research-manager";

// Import path utilities for cache clearing
import { clearProjectRootCache } from "../lib/paths";

// =============================================================================
// TEST SETUP
// =============================================================================

/** Test directory for isolated tests */
let testDir: string;

/** Original environment variable value */
let originalProjectRoot: string | undefined;

/**
 * Helper to execute the research-manager tool and parse the result.
 */
async function execute(args: {
  action: string;
  researchId?: string;
  runId?: string;
  data?: unknown;
}): Promise<{ success: boolean; [key: string]: unknown }> {
  const result = await researchManager.execute(args as any);
  return JSON.parse(result);
}

beforeAll(() => {
  // Save original environment variable
  originalProjectRoot = process.env.GYOSHU_PROJECT_ROOT;
});

afterAll(() => {
  // Restore original environment variable
  if (originalProjectRoot !== undefined) {
    process.env.GYOSHU_PROJECT_ROOT = originalProjectRoot;
  } else {
    delete process.env.GYOSHU_PROJECT_ROOT;
  }
  clearProjectRootCache();
});

beforeEach(async () => {
  // Create a unique temp directory for each test
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "gyoshu-research-manager-test-"));

  // Set the project root to our test directory
  process.env.GYOSHU_PROJECT_ROOT = testDir;

  // Clear the cached project root so it picks up our new environment variable
  clearProjectRootCache();
});

afterEach(async () => {
  // Clean up the test directory
  if (testDir) {
    await fs.rm(testDir, { recursive: true, force: true });
  }

  // Clear cache after each test
  clearProjectRootCache();
});

// =============================================================================
// RESEARCH CRUD OPERATIONS
// =============================================================================

describe("Research CRUD Operations", () => {
  describe("action: create", () => {
    test("creates a new research project with minimal data", async () => {
      const result = await execute({
        action: "create",
        researchId: "test-research-001",
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("create");
      expect(result.researchId).toBe("test-research-001");
      expect(result.manifest).toBeDefined();

      const manifest = result.manifest as any;
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.researchId).toBe("test-research-001");
      expect(manifest.title).toBe("test-research-001"); // Default title is researchId
      expect(manifest.status).toBe("active");
      expect(manifest.tags).toEqual([]);
      expect(manifest.runs).toEqual([]);
      expect(manifest.createdAt).toBeDefined();
      expect(manifest.updatedAt).toBeDefined();
    });

    test("creates a new research project with custom data", async () => {
      const result = await execute({
        action: "create",
        researchId: "custom-research",
        data: {
          title: "My Custom Research",
          tags: ["ml", "classification"],
          parentResearchId: "parent-123",
        },
      });

      expect(result.success).toBe(true);
      const manifest = result.manifest as any;
      expect(manifest.title).toBe("My Custom Research");
      expect(manifest.tags).toEqual(["ml", "classification"]);
      expect(manifest.parentResearchId).toBe("parent-123");
    });

    test("creates research directories correctly", async () => {
      await execute({
        action: "create",
        researchId: "dir-test-research",
      });

      // Verify directory structure
      const researchPath = path.join(testDir, "gyoshu", "research", "dir-test-research");
      const runsDir = path.join(researchPath, "runs");
      const notebooksDir = path.join(researchPath, "notebooks");
      const artifactsDir = path.join(researchPath, "artifacts");
      const manifestPath = path.join(researchPath, "research.json");

      expect(await fs.access(researchPath).then(() => true).catch(() => false)).toBe(true);
      expect(await fs.access(runsDir).then(() => true).catch(() => false)).toBe(true);
      expect(await fs.access(notebooksDir).then(() => true).catch(() => false)).toBe(true);
      expect(await fs.access(artifactsDir).then(() => true).catch(() => false)).toBe(true);
      expect(await fs.access(manifestPath).then(() => true).catch(() => false)).toBe(true);
    });

    test("throws error if researchId is missing", async () => {
      await expect(
        execute({ action: "create" })
      ).rejects.toThrow("researchId is required for create action");
    });

    test("throws error if research already exists", async () => {
      await execute({
        action: "create",
        researchId: "duplicate-research",
      });

      await expect(
        execute({
          action: "create",
          researchId: "duplicate-research",
        })
      ).rejects.toThrow("already exists");
    });

    test("rejects invalid researchId with path traversal", async () => {
      await expect(
        execute({
          action: "create",
          researchId: "../malicious",
        })
      ).rejects.toThrow("path traversal");
    });

    test("rejects empty researchId", async () => {
      await expect(
        execute({
          action: "create",
          researchId: "   ",
        })
      ).rejects.toThrow("empty or whitespace");
    });

    test("rejects researchId exceeding max length", async () => {
      const longId = "a".repeat(300);
      await expect(
        execute({
          action: "create",
          researchId: longId,
        })
      ).rejects.toThrow("exceeds maximum length");
    });
  });

  describe("action: get", () => {
    test("retrieves existing research project", async () => {
      await execute({
        action: "create",
        researchId: "get-test-research",
        data: { title: "Get Test Research", tags: ["test"] },
      });

      const result = await execute({
        action: "get",
        researchId: "get-test-research",
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("get");
      expect(result.researchId).toBe("get-test-research");

      const manifest = result.manifest as any;
      expect(manifest.title).toBe("Get Test Research");
      expect(manifest.tags).toEqual(["test"]);
    });

    test("throws error if research not found", async () => {
      await expect(
        execute({
          action: "get",
          researchId: "nonexistent-research",
        })
      ).rejects.toThrow("not found");
    });

    test("throws error if researchId is missing", async () => {
      await expect(
        execute({ action: "get" })
      ).rejects.toThrow("researchId is required");
    });
  });

  describe("action: list", () => {
    test("returns empty list when no research exists", async () => {
      const result = await execute({ action: "list" });

      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
      expect(result.researches).toEqual([]);
      expect(result.count).toBe(0);
    });

    test("lists all research projects", async () => {
      // Create multiple research projects
      await execute({
        action: "create",
        researchId: "research-alpha",
        data: { title: "Alpha Research", tags: ["alpha"] },
      });
      await execute({
        action: "create",
        researchId: "research-beta",
        data: { title: "Beta Research", tags: ["beta"] },
      });
      await execute({
        action: "create",
        researchId: "research-gamma",
        data: { title: "Gamma Research", tags: ["gamma"] },
      });

      const result = await execute({ action: "list" });

      expect(result.success).toBe(true);
      expect(result.count).toBe(3);

      const researches = result.researches as any[];
      const titles = researches.map((r) => r.title);
      expect(titles).toContain("Alpha Research");
      expect(titles).toContain("Beta Research");
      expect(titles).toContain("Gamma Research");
    });

    test("returns research with summary info", async () => {
      await execute({
        action: "create",
        researchId: "summary-test",
        data: { title: "Summary Test", tags: ["tag1", "tag2"] },
      });

      // Add a run to verify runCount
      await execute({
        action: "addRun",
        researchId: "summary-test",
        runId: "run-001",
        data: { goal: "Test run", mode: "REPL" },
      });

      const result = await execute({ action: "list" });
      const researches = result.researches as any[];
      const research = researches.find((r) => r.researchId === "summary-test");

      expect(research).toBeDefined();
      expect(research.title).toBe("Summary Test");
      expect(research.status).toBe("active");
      expect(research.tags).toEqual(["tag1", "tag2"]);
      expect(research.runCount).toBe(1);
      expect(research.createdAt).toBeDefined();
      expect(research.updatedAt).toBeDefined();
    });

    test("sorts research by updatedAt descending", async () => {
      // Create research projects with small delays
      await execute({
        action: "create",
        researchId: "oldest",
        data: { title: "Oldest" },
      });

      await new Promise((r) => setTimeout(r, 10)); // Small delay

      await execute({
        action: "create",
        researchId: "middle",
        data: { title: "Middle" },
      });

      await new Promise((r) => setTimeout(r, 10)); // Small delay

      await execute({
        action: "create",
        researchId: "newest",
        data: { title: "Newest" },
      });

      const result = await execute({ action: "list" });
      const researches = result.researches as any[];

      // Should be sorted with newest first
      expect(researches[0].researchId).toBe("newest");
      expect(researches[researches.length - 1].researchId).toBe("oldest");
    });
  });

  describe("action: update", () => {
    test("updates research title", async () => {
      await execute({
        action: "create",
        researchId: "update-test",
        data: { title: "Original Title" },
      });

      const result = await execute({
        action: "update",
        researchId: "update-test",
        data: { title: "Updated Title" },
      });

      expect(result.success).toBe(true);
      const manifest = result.manifest as any;
      expect(manifest.title).toBe("Updated Title");
    });

    test("updates research status", async () => {
      await execute({
        action: "create",
        researchId: "status-test",
      });

      const result = await execute({
        action: "update",
        researchId: "status-test",
        data: { status: "completed" },
      });

      expect(result.success).toBe(true);
      const manifest = result.manifest as any;
      expect(manifest.status).toBe("completed");
    });

    test("merges tags instead of replacing", async () => {
      await execute({
        action: "create",
        researchId: "tags-test",
        data: { tags: ["original", "tag"] },
      });

      const result = await execute({
        action: "update",
        researchId: "tags-test",
        data: { tags: ["new", "tag"] },
      });

      expect(result.success).toBe(true);
      const manifest = result.manifest as any;
      // Should contain both old and new tags (deduplicated)
      expect(manifest.tags).toContain("original");
      expect(manifest.tags).toContain("new");
      expect(manifest.tags).toContain("tag");
      expect(manifest.tags.length).toBe(3); // No duplicate "tag"
    });

    test("updates summaries", async () => {
      await execute({
        action: "create",
        researchId: "summaries-test",
      });

      const result = await execute({
        action: "update",
        researchId: "summaries-test",
        data: {
          summaries: {
            executive: "This research explores...",
            methods: ["method1"],
            pitfalls: ["pitfall1"],
          },
        },
      });

      expect(result.success).toBe(true);
      const manifest = result.manifest as any;
      expect(manifest.summaries.executive).toBe("This research explores...");
      expect(manifest.summaries.methods).toContain("method1");
      expect(manifest.summaries.pitfalls).toContain("pitfall1");
    });

    test("preserves immutable fields", async () => {
      const createResult = await execute({
        action: "create",
        researchId: "immutable-test",
      });
      const originalManifest = createResult.manifest as any;

      await execute({
        action: "update",
        researchId: "immutable-test",
        data: {
          researchId: "hacked-id",
          schemaVersion: 999,
          createdAt: "1999-01-01T00:00:00Z",
        },
      });

      const getResult = await execute({
        action: "get",
        researchId: "immutable-test",
      });
      const updatedManifest = getResult.manifest as any;

      // These should not be overwritten
      expect(updatedManifest.researchId).toBe("immutable-test");
      expect(updatedManifest.schemaVersion).toBe(1);
      expect(updatedManifest.createdAt).toBe(originalManifest.createdAt);
    });

    test("updates updatedAt timestamp", async () => {
      const createResult = await execute({
        action: "create",
        researchId: "timestamp-test",
      });
      const originalUpdatedAt = (createResult.manifest as any).updatedAt;

      await new Promise((r) => setTimeout(r, 10)); // Small delay

      const updateResult = await execute({
        action: "update",
        researchId: "timestamp-test",
        data: { title: "New Title" },
      });
      const newUpdatedAt = (updateResult.manifest as any).updatedAt;

      expect(new Date(newUpdatedAt).getTime()).toBeGreaterThan(
        new Date(originalUpdatedAt).getTime()
      );
    });

    test("throws error if research not found", async () => {
      await expect(
        execute({
          action: "update",
          researchId: "nonexistent",
          data: { title: "New Title" },
        })
      ).rejects.toThrow("not found");
    });
  });

  describe("action: delete", () => {
    test("deletes existing research", async () => {
      await execute({
        action: "create",
        researchId: "delete-test",
      });

      const result = await execute({
        action: "delete",
        researchId: "delete-test",
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("delete");

      // Verify it's actually deleted
      await expect(
        execute({
          action: "get",
          researchId: "delete-test",
        })
      ).rejects.toThrow("not found");
    });

    test("deletes research directory and all contents", async () => {
      await execute({
        action: "create",
        researchId: "full-delete-test",
      });

      // Add a run to ensure runs directory has content
      await execute({
        action: "addRun",
        researchId: "full-delete-test",
        runId: "run-001",
        data: { goal: "Test" },
      });

      const researchPath = path.join(testDir, "gyoshu", "research", "full-delete-test");

      // Verify directory exists before delete
      expect(await fs.access(researchPath).then(() => true).catch(() => false)).toBe(true);

      await execute({
        action: "delete",
        researchId: "full-delete-test",
      });

      // Verify directory is completely removed
      expect(await fs.access(researchPath).then(() => true).catch(() => false)).toBe(false);
    });

    test("throws error if research not found", async () => {
      await expect(
        execute({
          action: "delete",
          researchId: "nonexistent",
        })
      ).rejects.toThrow("not found");
    });
  });
});

// =============================================================================
// RUN OPERATIONS
// =============================================================================

describe("Run Operations", () => {
  // Create a research project before each run test
  beforeEach(async () => {
    await execute({
      action: "create",
      researchId: "run-test-research",
      data: { title: "Run Test Research" },
    });
  });

  describe("action: addRun", () => {
    test("adds a new run with minimal data", async () => {
      const result = await execute({
        action: "addRun",
        researchId: "run-test-research",
        runId: "run-001",
        data: { goal: "Test goal", mode: "REPL" },
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("addRun");
      expect(result.researchId).toBe("run-test-research");
      expect(result.runId).toBe("run-001");

      // Check run summary
      const runSummary = result.runSummary as any;
      expect(runSummary.runId).toBe("run-001");
      expect(runSummary.goal).toBe("Test goal");
      expect(runSummary.mode).toBe("REPL");
      expect(runSummary.status).toBe("PENDING");
      expect(runSummary.startedAt).toBeDefined();
      expect(runSummary.notebookPath).toBe("notebooks/run-001.ipynb");
      expect(runSummary.artifactsDir).toBe("artifacts/run-001/");

      const runDetail = result.runDetail as any;
      expect(runDetail.schemaVersion).toBe(1);
      expect(runDetail.runId).toBe("run-001");
      expect(runDetail.researchId).toBe("run-test-research");
    });

    test("adds a new run with full data", async () => {
      const result = await execute({
        action: "addRun",
        researchId: "run-test-research",
        runId: "full-run",
        data: {
          goal: "Full test",
          mode: "AUTO",
          status: "IN_PROGRESS",
          sessionId: "session-123",
          keyResults: [{ type: "finding", text: "Found something" }],
          executionLog: [{ timestamp: "2025-01-01T00:00:00Z", event: "Started" }],
        },
      });

      expect(result.success).toBe(true);

      const runSummary = result.runSummary as any;
      expect(runSummary.mode).toBe("AUTO");
      expect(runSummary.status).toBe("IN_PROGRESS");

      const runDetail = result.runDetail as any;
      expect(runDetail.sessionId).toBe("session-123");
      expect(runDetail.keyResults).toHaveLength(1);
      expect(runDetail.executionLog).toHaveLength(1);
    });

    test("creates run directories", async () => {
      await execute({
        action: "addRun",
        researchId: "run-test-research",
        runId: "dir-test-run",
        data: { goal: "Test" },
      });

      const runArtifactsDir = path.join(
        testDir,
        "gyoshu",
        "research",
        "run-test-research",
        "artifacts",
        "dir-test-run"
      );
      const plotsDir = path.join(runArtifactsDir, "plots");
      const exportsDir = path.join(runArtifactsDir, "exports");

      expect(await fs.access(runArtifactsDir).then(() => true).catch(() => false)).toBe(true);
      expect(await fs.access(plotsDir).then(() => true).catch(() => false)).toBe(true);
      expect(await fs.access(exportsDir).then(() => true).catch(() => false)).toBe(true);
    });

    test("creates run detail file", async () => {
      await execute({
        action: "addRun",
        researchId: "run-test-research",
        runId: "file-test-run",
        data: { goal: "Test" },
      });

      const runDetailPath = path.join(
        testDir,
        "gyoshu",
        "research",
        "run-test-research",
        "runs",
        "file-test-run.json"
      );

      expect(await fs.access(runDetailPath).then(() => true).catch(() => false)).toBe(true);

      // Verify content
      const content = await fs.readFile(runDetailPath, "utf-8");
      const runDetail = JSON.parse(content);
      expect(runDetail.runId).toBe("file-test-run");
    });

    test("adds run to research manifest", async () => {
      await execute({
        action: "addRun",
        researchId: "run-test-research",
        runId: "manifest-run",
        data: { goal: "Test" },
      });

      const getResult = await execute({
        action: "get",
        researchId: "run-test-research",
      });

      const manifest = getResult.manifest as any;
      expect(manifest.runs).toHaveLength(1);
      expect(manifest.runs[0].runId).toBe("manifest-run");
    });

    test("updates research updatedAt when adding run", async () => {
      const createResult = await execute({
        action: "get",
        researchId: "run-test-research",
      });
      const originalUpdatedAt = (createResult.manifest as any).updatedAt;

      await new Promise((r) => setTimeout(r, 10)); // Small delay

      await execute({
        action: "addRun",
        researchId: "run-test-research",
        runId: "timestamp-run",
        data: { goal: "Test" },
      });

      const getResult = await execute({
        action: "get",
        researchId: "run-test-research",
      });
      const newUpdatedAt = (getResult.manifest as any).updatedAt;

      expect(new Date(newUpdatedAt).getTime()).toBeGreaterThan(
        new Date(originalUpdatedAt).getTime()
      );
    });

    test("throws error if research not found", async () => {
      await expect(
        execute({
          action: "addRun",
          researchId: "nonexistent",
          runId: "run-001",
          data: { goal: "Test" },
        })
      ).rejects.toThrow("not found");
    });

    test("throws error if run already exists", async () => {
      await execute({
        action: "addRun",
        researchId: "run-test-research",
        runId: "duplicate-run",
        data: { goal: "Test" },
      });

      await expect(
        execute({
          action: "addRun",
          researchId: "run-test-research",
          runId: "duplicate-run",
          data: { goal: "Test" },
        })
      ).rejects.toThrow("already exists");
    });

    test("throws error if runId is missing", async () => {
      await expect(
        execute({
          action: "addRun",
          researchId: "run-test-research",
          data: { goal: "Test" },
        })
      ).rejects.toThrow("runId is required");
    });

    test("rejects invalid runId with path traversal", async () => {
      await expect(
        execute({
          action: "addRun",
          researchId: "run-test-research",
          runId: "../malicious",
          data: { goal: "Test" },
        })
      ).rejects.toThrow("path traversal");
    });
  });

  describe("action: getRun", () => {
    beforeEach(async () => {
      await execute({
        action: "addRun",
        researchId: "run-test-research",
        runId: "get-run-test",
        data: {
          goal: "Get run test",
          mode: "PLANNER",
          keyResults: [{ type: "metric", name: "accuracy", text: "0.95" }],
        },
      });
    });

    test("retrieves run summary and detail", async () => {
      const result = await execute({
        action: "getRun",
        researchId: "run-test-research",
        runId: "get-run-test",
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("getRun");
      expect(result.researchId).toBe("run-test-research");
      expect(result.runId).toBe("get-run-test");

      const runSummary = result.runSummary as any;
      expect(runSummary.runId).toBe("get-run-test");
      expect(runSummary.goal).toBe("Get run test");
      expect(runSummary.mode).toBe("PLANNER");

      const runDetail = result.runDetail as any;
      expect(runDetail.runId).toBe("get-run-test");
      expect(runDetail.keyResults).toHaveLength(1);
      expect(runDetail.keyResults[0].type).toBe("metric");
    });

    test("includes notebook and artifacts paths", async () => {
      const result = await execute({
        action: "getRun",
        researchId: "run-test-research",
        runId: "get-run-test",
      });

      expect(result.notebookPath).toBeDefined();
      expect(result.artifactsDir).toBeDefined();
      expect((result.notebookPath as string)).toContain("get-run-test.ipynb");
      expect((result.artifactsDir as string)).toContain("get-run-test");
    });

    test("throws error if research not found", async () => {
      await expect(
        execute({
          action: "getRun",
          researchId: "nonexistent",
          runId: "run-001",
        })
      ).rejects.toThrow("not found");
    });

    test("throws error if run not found", async () => {
      await expect(
        execute({
          action: "getRun",
          researchId: "run-test-research",
          runId: "nonexistent-run",
        })
      ).rejects.toThrow("not found");
    });
  });

  describe("action: updateRun", () => {
    beforeEach(async () => {
      await execute({
        action: "addRun",
        researchId: "run-test-research",
        runId: "update-run-test",
        data: {
          goal: "Original goal",
          mode: "REPL",
          keyResults: [],
          artifacts: [],
        },
      });
    });

    test("updates run status", async () => {
      const result = await execute({
        action: "updateRun",
        researchId: "run-test-research",
        runId: "update-run-test",
        data: { status: "COMPLETED" },
      });

      expect(result.success).toBe(true);
      const runSummary = result.runSummary as any;
      expect(runSummary.status).toBe("COMPLETED");
    });

    test("updates run goal", async () => {
      const result = await execute({
        action: "updateRun",
        researchId: "run-test-research",
        runId: "update-run-test",
        data: { goal: "Updated goal" },
      });

      expect(result.success).toBe(true);
      const runSummary = result.runSummary as any;
      expect(runSummary.goal).toBe("Updated goal");
    });

    test("sets endedAt when run completes", async () => {
      const endTime = new Date().toISOString();
      const result = await execute({
        action: "updateRun",
        researchId: "run-test-research",
        runId: "update-run-test",
        data: { status: "COMPLETED", endedAt: endTime },
      });

      expect(result.success).toBe(true);
      const runSummary = result.runSummary as any;
      expect(runSummary.endedAt).toBe(endTime);
    });

    test("appends key results", async () => {
      await execute({
        action: "updateRun",
        researchId: "run-test-research",
        runId: "update-run-test",
        data: {
          keyResults: [{ type: "finding", text: "Finding 1" }],
        },
      });

      const result = await execute({
        action: "updateRun",
        researchId: "run-test-research",
        runId: "update-run-test",
        data: {
          keyResults: [{ type: "conclusion", text: "Conclusion 1" }],
        },
      });

      const runDetail = result.runDetail as any;
      expect(runDetail.keyResults).toHaveLength(2);
      expect(runDetail.keyResults[0].type).toBe("finding");
      expect(runDetail.keyResults[1].type).toBe("conclusion");
    });

    test("appends artifacts", async () => {
      const result = await execute({
        action: "updateRun",
        researchId: "run-test-research",
        runId: "update-run-test",
        data: {
          artifacts: [
            { path: "plots/chart.png", type: "plot", createdAt: new Date().toISOString() },
          ],
        },
      });

      const runDetail = result.runDetail as any;
      expect(runDetail.artifacts).toHaveLength(1);
      expect(runDetail.artifacts[0].path).toBe("plots/chart.png");
    });

    test("appends execution log", async () => {
      await execute({
        action: "updateRun",
        researchId: "run-test-research",
        runId: "update-run-test",
        data: {
          executionLog: [{ timestamp: new Date().toISOString(), event: "Started" }],
        },
      });

      const result = await execute({
        action: "updateRun",
        researchId: "run-test-research",
        runId: "update-run-test",
        data: {
          executionLog: [{ timestamp: new Date().toISOString(), event: "Completed" }],
        },
      });

      const runDetail = result.runDetail as any;
      expect(runDetail.executionLog).toHaveLength(2);
      expect(runDetail.executionLog[0].event).toBe("Started");
      expect(runDetail.executionLog[1].event).toBe("Completed");
    });

    test("preserves immutable run fields", async () => {
      const result = await execute({
        action: "updateRun",
        researchId: "run-test-research",
        runId: "update-run-test",
        data: {
          runId: "hacked-id",
          researchId: "hacked-research",
          schemaVersion: 999,
        },
      });

      const runDetail = result.runDetail as any;
      expect(runDetail.runId).toBe("update-run-test");
      expect(runDetail.researchId).toBe("run-test-research");
      expect(runDetail.schemaVersion).toBe(1);
    });

    test("updates research manifest updatedAt", async () => {
      const getResult = await execute({
        action: "get",
        researchId: "run-test-research",
      });
      const originalUpdatedAt = (getResult.manifest as any).updatedAt;

      await new Promise((r) => setTimeout(r, 10)); // Small delay

      await execute({
        action: "updateRun",
        researchId: "run-test-research",
        runId: "update-run-test",
        data: { status: "COMPLETED" },
      });

      const newGetResult = await execute({
        action: "get",
        researchId: "run-test-research",
      });
      const newUpdatedAt = (newGetResult.manifest as any).updatedAt;

      expect(new Date(newUpdatedAt).getTime()).toBeGreaterThan(
        new Date(originalUpdatedAt).getTime()
      );
    });

    test("throws error if research not found", async () => {
      await expect(
        execute({
          action: "updateRun",
          researchId: "nonexistent",
          runId: "run-001",
          data: { status: "COMPLETED" },
        })
      ).rejects.toThrow("not found");
    });

    test("throws error if run not found", async () => {
      await expect(
        execute({
          action: "updateRun",
          researchId: "run-test-research",
          runId: "nonexistent-run",
          data: { status: "COMPLETED" },
        })
      ).rejects.toThrow("not found");
    });
  });
});

// =============================================================================
// ATOMIC WRITE VERIFICATION
// =============================================================================

describe("Atomic Write Verification", () => {
  test("research.json is valid JSON after create", async () => {
    await execute({
      action: "create",
      researchId: "atomic-test",
      data: { title: "Atomic Test" },
    });

    const manifestPath = path.join(testDir, "gyoshu", "research", "atomic-test", "research.json");
    const content = await fs.readFile(manifestPath, "utf-8");

    // Should not throw
    const parsed = JSON.parse(content);
    expect(parsed.researchId).toBe("atomic-test");
  });

  test("research.json is valid JSON after update", async () => {
    await execute({
      action: "create",
      researchId: "atomic-update-test",
    });

    await execute({
      action: "update",
      researchId: "atomic-update-test",
      data: { title: "Updated Title" },
    });

    const manifestPath = path.join(
      testDir,
      "gyoshu",
      "research",
      "atomic-update-test",
      "research.json"
    );
    const content = await fs.readFile(manifestPath, "utf-8");

    const parsed = JSON.parse(content);
    expect(parsed.title).toBe("Updated Title");
  });

  test("run detail file is valid JSON after addRun", async () => {
    await execute({
      action: "create",
      researchId: "atomic-run-test",
    });

    await execute({
      action: "addRun",
      researchId: "atomic-run-test",
      runId: "run-001",
      data: { goal: "Test" },
    });

    const runDetailPath = path.join(
      testDir,
      "gyoshu",
      "research",
      "atomic-run-test",
      "runs",
      "run-001.json"
    );
    const content = await fs.readFile(runDetailPath, "utf-8");

    const parsed = JSON.parse(content);
    expect(parsed.runId).toBe("run-001");
  });

  test("run detail file is valid JSON after updateRun", async () => {
    await execute({
      action: "create",
      researchId: "atomic-run-update-test",
    });

    await execute({
      action: "addRun",
      researchId: "atomic-run-update-test",
      runId: "run-001",
      data: { goal: "Original" },
    });

    await execute({
      action: "updateRun",
      researchId: "atomic-run-update-test",
      runId: "run-001",
      data: { goal: "Updated", status: "COMPLETED" },
    });

    const runDetailPath = path.join(
      testDir,
      "gyoshu",
      "research",
      "atomic-run-update-test",
      "runs",
      "run-001.json"
    );
    const content = await fs.readFile(runDetailPath, "utf-8");

    const parsed = JSON.parse(content);
    expect(parsed.runId).toBe("run-001");
  });

  test("no temp files remain after successful operations", async () => {
    await execute({
      action: "create",
      researchId: "temp-cleanup-test",
    });

    await execute({
      action: "addRun",
      researchId: "temp-cleanup-test",
      runId: "run-001",
      data: { goal: "Test" },
    });

    const researchPath = path.join(testDir, "gyoshu", "research", "temp-cleanup-test");
    const runsPath = path.join(researchPath, "runs");

    // Check for temp files in research directory
    const researchFiles = await fs.readdir(researchPath);
    const researchTempFiles = researchFiles.filter((f) => f.includes(".tmp."));
    expect(researchTempFiles.length).toBe(0);

    // Check for temp files in runs directory
    const runsFiles = await fs.readdir(runsPath);
    const runsTempFiles = runsFiles.filter((f) => f.includes(".tmp."));
    expect(runsTempFiles.length).toBe(0);
  });

  test("sequential operations maintain data integrity", async () => {
    await execute({
      action: "create",
      researchId: "sequential-test",
    });

    for (let i = 0; i < 5; i++) {
      const result = await execute({
        action: "addRun",
        researchId: "sequential-test",
        runId: `run-${i}`,
        data: { goal: `Test ${i}` },
      });
      expect(result.success).toBe(true);
    }

    const getResult = await execute({
      action: "get",
      researchId: "sequential-test",
    });
    const manifest = getResult.manifest as any;
    expect(manifest.runs.length).toBe(5);

    for (let i = 0; i < 5; i++) {
      const runDetailPath = path.join(
        testDir,
        "gyoshu",
        "research",
        "sequential-test",
        "runs",
        `run-${i}.json`
      );
      const content = await fs.readFile(runDetailPath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.runId).toBe(`run-${i}`);
    }
  });
});

// =============================================================================
// NOTEBOOK-BASED LISTING
// =============================================================================

describe("Notebook-Based Listing", () => {
  const createNotebookWithFrontmatter = async (
    reportTitle: string,
    frontmatter: {
      status: string;
      tags: string[];
      created: string;
      updated: string;
    }
  ) => {
    const notebookRoot = path.join(testDir, "notebooks");
    await fs.mkdir(notebookRoot, { recursive: true });

    const notebookPath = path.join(notebookRoot, `${reportTitle}.ipynb`);
    const notebook = {
      cells: [
        {
          cell_type: "raw",
          source: [
            "---\n",
            "gyoshu:\n",
            "  schema_version: 1\n",
            "  workspace: \"\"\n",
            `  slug: ${reportTitle}\n`,
            `  status: ${frontmatter.status}\n`,
            `  created: "${frontmatter.created}"\n`,
            `  updated: "${frontmatter.updated}"\n`,
            "  tags:\n",
            ...frontmatter.tags.map((t) => `    - ${t}\n`),
            "---\n",
          ],
          metadata: {},
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };
    await fs.writeFile(notebookPath, JSON.stringify(notebook, null, 2));
    return notebookPath;
  };

  test("lists research from notebooks with frontmatter", async () => {
    await createNotebookWithFrontmatter("churn-prediction", {
      status: "active",
      tags: ["ml", "classification"],
      created: "2026-01-01T10:00:00Z",
      updated: "2026-01-01T12:00:00Z",
    });

    const result = await execute({ action: "list" });

    expect(result.success).toBe(true);
    expect(result.source).toBe("notebooks");
    expect(result.count).toBe(1);
    
    const researches = result.researches as any[];
    expect(researches[0].reportTitle).toBe("churn-prediction");
    expect(researches[0].status).toBe("active");
    expect(researches[0].tags).toContain("ml");
  });

  test("lists multiple notebooks", async () => {
    await createNotebookWithFrontmatter("churn-prediction", {
      status: "active",
      tags: ["ml"],
      created: "2026-01-01T10:00:00Z",
      updated: "2026-01-01T14:00:00Z",
    });
    await createNotebookWithFrontmatter("ltv-modeling", {
      status: "completed",
      tags: ["regression"],
      created: "2026-01-01T09:00:00Z",
      updated: "2026-01-01T11:00:00Z",
    });
    await createNotebookWithFrontmatter("eda-analysis", {
      status: "active",
      tags: ["eda"],
      created: "2026-01-01T08:00:00Z",
      updated: "2026-01-01T10:00:00Z",
    });

    const result = await execute({ action: "list" });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    
    const researches = result.researches as any[];
    expect(researches[0].reportTitle).toBe("churn-prediction");
    expect(researches[2].reportTitle).toBe("eda-analysis");
  });

  test("filters notebooks by status", async () => {
    await createNotebookWithFrontmatter("active-research", {
      status: "active",
      tags: [],
      created: "2026-01-01T10:00:00Z",
      updated: "2026-01-01T12:00:00Z",
    });
    await createNotebookWithFrontmatter("completed-research", {
      status: "completed",
      tags: [],
      created: "2026-01-01T09:00:00Z",
      updated: "2026-01-01T11:00:00Z",
    });

    const result = await execute({ 
      action: "list", 
      data: { status: "active" } 
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    
    const researches = result.researches as any[];
    expect(researches[0].reportTitle).toBe("active-research");
  });

  test("filters notebooks by tags", async () => {
    await createNotebookWithFrontmatter("ml-research", {
      status: "active",
      tags: ["ml", "classification"],
      created: "2026-01-01T10:00:00Z",
      updated: "2026-01-01T12:00:00Z",
    });
    await createNotebookWithFrontmatter("stats-research", {
      status: "active",
      tags: ["statistics"],
      created: "2026-01-01T09:00:00Z",
      updated: "2026-01-01T11:00:00Z",
    });

    const result = await execute({ 
      action: "list", 
      data: { tags: ["ml"] } 
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    
    const researches = result.researches as any[];
    expect(researches[0].reportTitle).toBe("ml-research");
  });

  test("falls back to legacy when no notebooks exist", async () => {
    await execute({
      action: "create",
      researchId: "legacy-research",
      data: { title: "Legacy Research" },
    });

    const result = await execute({ action: "list" });

    expect(result.success).toBe(true);
    expect(result.source).toBe("legacy");
    expect(result.count).toBe(1);
    
    const researches = result.researches as any[];
    expect(researches[0].researchId).toBe("legacy-research");
  });

  test("skips notebooks without valid frontmatter", async () => {
    const notebookRoot = path.join(testDir, "notebooks");
    await fs.mkdir(notebookRoot, { recursive: true });

    const invalidNotebook = {
      cells: [{ cell_type: "code", source: ["print('hello')"], metadata: {} }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };
    await fs.writeFile(
      path.join(notebookRoot, "no-frontmatter.ipynb"),
      JSON.stringify(invalidNotebook)
    );

    await createNotebookWithFrontmatter("valid-research", {
      status: "active",
      tags: [],
      created: "2026-01-01T10:00:00Z",
      updated: "2026-01-01T12:00:00Z",
    });

    const result = await execute({ action: "list" });

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    
    const researches = result.researches as any[];
    expect(researches[0].reportTitle).toBe("valid-research");
  });

  test("returns empty list when notebooks dir does not exist", async () => {
    const result = await execute({ action: "list" });

    expect(result.success).toBe(true);
    expect(result.source).toBe("legacy");
    expect(result.count).toBe(0);
    expect(result.researches).toEqual([]);
  });
});

// =============================================================================
// ERROR HANDLING
// =============================================================================

describe("Error Handling", () => {
  test("rejects unknown action", async () => {
    await expect(
      execute({ action: "unknown" })
    ).rejects.toThrow("Unknown action");
  });

  test("validation errors include helpful messages", async () => {
    try {
      await execute({
        action: "create",
        researchId: "../test",
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("path traversal");
    }
  });

  test("not found errors are descriptive", async () => {
    try {
      await execute({
        action: "get",
        researchId: "does-not-exist-123",
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("does-not-exist-123");
      expect(err.message).toContain("not found");
    }
  });
});
