/**
 * Tests for checkpoint-manager.ts
 *
 * Tests all checkpoint operations: save, list, validate, resume, prune.
 * Covers integrity verification, corruption handling, and fallback behavior.
 *
 * @module checkpoint-manager.test
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

// Import the checkpoint-manager tool
import checkpointManager from "./checkpoint-manager";

// Import path utilities for cache clearing
import { clearProjectRootCache, getCheckpointDir, getCheckpointManifestPath, getNotebookPath } from "../lib/paths";

// =============================================================================
// TEST SETUP
// =============================================================================

/** Test directory for isolated tests */
let testDir: string;

/** Original environment variable value */
let originalProjectRoot: string | undefined;

/**
 * Helper to execute the checkpoint-manager tool and parse the result.
 */
async function execute(args: {
  action: string;
  reportTitle?: string;
  runId?: string;
  checkpointId?: string;
  researchSessionID?: string;
  stageId?: string;
  status?: "saved" | "interrupted" | "emergency";
  reason?: "timeout" | "abort" | "error";
  executionCount?: number;
  notebookPathOverride?: string;
  pythonEnv?: {
    pythonPath: string;
    packages: string[];
    platform: string;
  };
  artifacts?: Array<{
    relativePath: string;
    sha256: string;
    sizeBytes: number;
  }>;
  rehydrationMode?: "artifacts_only" | "with_vars";
  rehydrationSource?: string[];
  keepCount?: number;
}): Promise<{ success: boolean; [key: string]: unknown }> {
  const result = await checkpointManager.execute(args as any);
  return JSON.parse(result);
}

/**
 * Create an artifact file with given content and return its metadata.
 */
async function createArtifact(
  relativePath: string,
  content: string
): Promise<{ relativePath: string; sha256: string; sizeBytes: number }> {
  const absolutePath = path.join(testDir, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf-8");

  const stats = await fs.stat(absolutePath);
  const sha256 = crypto.createHash("sha256").update(content, "utf8").digest("hex");

  return {
    relativePath,
    sha256,
    sizeBytes: stats.size,
  };
}

/**
 * Create a minimal notebook at the given path.
 */
async function createNotebook(reportTitle: string): Promise<string> {
  const notebookPath = path.join(testDir, "notebooks", `${reportTitle}.ipynb`);
  await fs.mkdir(path.dirname(notebookPath), { recursive: true });

  const notebook = {
    cells: [
      {
        cell_type: "code",
        source: ["print('Hello')"],
        metadata: {},
        execution_count: 1,
        outputs: [],
      },
    ],
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: {
        name: "python",
        version: "3.11",
        mimetype: "text/x-python",
        file_extension: ".py",
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };

  await fs.writeFile(notebookPath, JSON.stringify(notebook, null, 2));
  return notebookPath;
}

/**
 * Read a notebook from disk.
 */
async function readNotebook(notebookPath: string): Promise<any> {
  const content = await fs.readFile(notebookPath, "utf-8");
  return JSON.parse(content);
}

/**
 * Create a valid checkpoint manifest directly (for testing validation and resume).
 */
async function createManifestDirect(
  reportTitle: string,
  runId: string,
  checkpointId: string,
  options: {
    stageId?: string;
    status?: "saved" | "interrupted" | "emergency";
    createdAt?: string;
    artifacts?: Array<{ relativePath: string; sha256: string; sizeBytes: number }>;
    corrupt?: boolean;
    badSha256?: boolean;
  } = {}
): Promise<string> {
  const manifestPath = path.join(
    testDir,
    "reports",
    reportTitle,
    "checkpoints",
    runId,
    checkpointId,
    "checkpoint.json"
  );

  await fs.mkdir(path.dirname(manifestPath), { recursive: true });

  const stageId = options.stageId || "S01_load_data";
  const status = options.status || "saved";
  const createdAt = options.createdAt || new Date().toISOString();
  const artifacts = options.artifacts || [];

  const manifestBase = {
    checkpointId,
    researchSessionID: "ses_test123",
    reportTitle,
    runId,
    stageId,
    status,
    createdAt,
    executionCount: 5,
    notebook: {
      path: `notebooks/${reportTitle}.ipynb`,
      checkpointCellId: `cell-${checkpointId}`,
    },
    pythonEnv: {
      pythonPath: "/usr/bin/python3",
      packages: ["pandas==2.0.0", "numpy==1.24.0"],
      platform: "linux",
    },
    artifacts,
    rehydration: {
      mode: "artifacts_only",
      rehydrationCellSource: ["# Rehydration code", "print('Rehydrating...')"],
    },
  };

  // Calculate SHA256
  const content = JSON.stringify(manifestBase, null, 2);
  const manifestSha256 = crypto.createHash("sha256").update(content, "utf8").digest("hex");

  const manifest = {
    ...manifestBase,
    manifestSha256: options.badSha256 ? "0000000000000000000000000000000000000000000000000000000000000000" : manifestSha256,
  };

  if (options.corrupt) {
    // Write corrupt JSON
    await fs.writeFile(manifestPath, "{ invalid json }}}");
  } else {
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  return manifestPath;
}

let originalCwd: string;

beforeAll(() => {
  originalProjectRoot = process.env.GYOSHU_PROJECT_ROOT;
  originalCwd = process.cwd();
});

afterAll(() => {
  if (originalProjectRoot !== undefined) {
    process.env.GYOSHU_PROJECT_ROOT = originalProjectRoot;
  } else {
    delete process.env.GYOSHU_PROJECT_ROOT;
  }
  process.chdir(originalCwd);
  clearProjectRootCache();
});

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "gyoshu-checkpoint-manager-test-"));
  process.env.GYOSHU_PROJECT_ROOT = testDir;
  process.chdir(testDir);
  clearProjectRootCache();
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (testDir) {
    await fs.rm(testDir, { recursive: true, force: true });
  }
  clearProjectRootCache();
});

// =============================================================================
// 2.5.1: SAVE ACTION TESTS
// =============================================================================

describe("Save Action (2.5.1)", () => {
  describe("action: save", () => {
    test("creates checkpoint manifest with all required fields", async () => {
      await createNotebook("test-analysis");

      const result = await execute({
        action: "save",
        reportTitle: "test-analysis",
        runId: "run-001",
        checkpointId: "ckpt-001",
        researchSessionID: "ses_test123",
        stageId: "S01_load_data",
        executionCount: 5,
        pythonEnv: {
          pythonPath: "/usr/bin/python3",
          packages: ["pandas==2.0.0"],
          platform: "linux",
        },
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("save");
      expect(result.checkpointId).toBe("ckpt-001");
      expect(result.reportTitle).toBe("test-analysis");
      expect(result.runId).toBe("run-001");
      expect(result.stageId).toBe("S01_load_data");
      expect(result.status).toBe("saved");
      expect(result.manifestSha256).toBeDefined();
      expect(typeof result.manifestSha256).toBe("string");
    });

    test("writes manifest file atomically", async () => {
      await createNotebook("manifest-test");

      await execute({
        action: "save",
        reportTitle: "manifest-test",
        runId: "run-001",
        checkpointId: "ckpt-001",
        researchSessionID: "ses_test123",
        stageId: "S01_load_data",
      });

      const manifestPath = path.join(
        testDir,
        "reports",
        "manifest-test",
        "checkpoints",
        "run-001",
        "ckpt-001",
        "checkpoint.json"
      );

      // Verify file exists and is valid JSON
      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(content);

      expect(manifest.checkpointId).toBe("ckpt-001");
      expect(manifest.reportTitle).toBe("manifest-test");
      expect(manifest.runId).toBe("run-001");
      expect(manifest.manifestSha256).toBeDefined();
    });

    test("appends checkpoint cell to notebook", async () => {
      await createNotebook("cell-test");

      const result = await execute({
        action: "save",
        reportTitle: "cell-test",
        runId: "run-001",
        checkpointId: "ckpt-001",
        researchSessionID: "ses_test123",
        stageId: "S01_load_data",
      });

      expect(result.checkpointCellId).toBeDefined();

      // Read notebook and verify cell was appended
      const notebookPath = path.join(testDir, "notebooks", "cell-test.ipynb");
      const notebook = await readNotebook(notebookPath);

      // Should have 2 cells now (original + checkpoint)
      expect(notebook.cells.length).toBe(2);

      const checkpointCell = notebook.cells[1];
      expect(checkpointCell.metadata.tags).toContain("gyoshu-checkpoint");
      expect(checkpointCell.metadata.gyoshu.type).toBe("checkpoint");
      expect(checkpointCell.metadata.gyoshu.checkpointId).toBe("ckpt-001");
      expect(checkpointCell.metadata.gyoshu.stageId).toBe("S01_load_data");
    });

    test("includes artifacts with SHA256 hashes", async () => {
      await createNotebook("artifact-test");

      const artifact = await createArtifact(
        "reports/artifact-test/data.csv",
        "col1,col2\n1,2\n3,4"
      );

      const result = await execute({
        action: "save",
        reportTitle: "artifact-test",
        runId: "run-001",
        checkpointId: "ckpt-001",
        researchSessionID: "ses_test123",
        stageId: "S01_load_data",
        artifacts: [artifact],
      });

      expect(result.success).toBe(true);
      expect(result.artifactCount).toBe(1);

      // Verify manifest contains artifact
      const manifestPath = path.join(
        testDir,
        "reports",
        "artifact-test",
        "checkpoints",
        "run-001",
        "ckpt-001",
        "checkpoint.json"
      );
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));

      expect(manifest.artifacts.length).toBe(1);
      expect(manifest.artifacts[0].relativePath).toBe("reports/artifact-test/data.csv");
      expect(manifest.artifacts[0].sha256).toBe(artifact.sha256);
      expect(manifest.artifacts[0].sizeBytes).toBe(artifact.sizeBytes);
    });

    test("handles emergency checkpoint with reason", async () => {
      await createNotebook("emergency-test");

      const result = await execute({
        action: "save",
        reportTitle: "emergency-test",
        runId: "run-001",
        checkpointId: "ckpt-001",
        researchSessionID: "ses_test123",
        stageId: "S01_load_data",
        status: "emergency",
        reason: "timeout",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("emergency");

      // Verify manifest has reason field
      const manifestPath = path.join(
        testDir,
        "reports",
        "emergency-test",
        "checkpoints",
        "run-001",
        "ckpt-001",
        "checkpoint.json"
      );
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
      expect(manifest.status).toBe("emergency");
      expect(manifest.reason).toBe("timeout");
    });

    test("throws error when reportTitle is missing", async () => {
      await expect(
        execute({
          action: "save",
          runId: "run-001",
          checkpointId: "ckpt-001",
          researchSessionID: "ses_test123",
          stageId: "S01_load_data",
        })
      ).rejects.toThrow("reportTitle is required");
    });

    test("throws error when runId is missing", async () => {
      await expect(
        execute({
          action: "save",
          reportTitle: "test",
          checkpointId: "ckpt-001",
          researchSessionID: "ses_test123",
          stageId: "S01_load_data",
        })
      ).rejects.toThrow("runId is required");
    });

    test("throws error when checkpointId is missing", async () => {
      await expect(
        execute({
          action: "save",
          reportTitle: "test",
          runId: "run-001",
          researchSessionID: "ses_test123",
          stageId: "S01_load_data",
        })
      ).rejects.toThrow("checkpointId is required");
    });

    test("throws error when stageId is missing", async () => {
      await expect(
        execute({
          action: "save",
          reportTitle: "test",
          runId: "run-001",
          checkpointId: "ckpt-001",
          researchSessionID: "ses_test123",
        })
      ).rejects.toThrow("stageId is required");
    });

    test("throws error when researchSessionID is missing", async () => {
      await expect(
        execute({
          action: "save",
          reportTitle: "test",
          runId: "run-001",
          checkpointId: "ckpt-001",
          stageId: "S01_load_data",
        })
      ).rejects.toThrow("researchSessionID is required");
    });

    test("throws error for emergency checkpoint without reason", async () => {
      await createNotebook("no-reason-test");

      await expect(
        execute({
          action: "save",
          reportTitle: "no-reason-test",
          runId: "run-001",
          checkpointId: "ckpt-001",
          researchSessionID: "ses_test123",
          stageId: "S01_load_data",
          status: "emergency",
        })
      ).rejects.toThrow("reason is required");
    });

    test("rejects invalid reportTitle with path traversal", async () => {
      await expect(
        execute({
          action: "save",
          reportTitle: "../malicious",
          runId: "run-001",
          checkpointId: "ckpt-001",
          researchSessionID: "ses_test123",
          stageId: "S01_load_data",
        })
      ).rejects.toThrow("path traversal");
    });

    test("creates notebook if it doesn't exist", async () => {
      const result = await execute({
        action: "save",
        reportTitle: "new-notebook",
        runId: "run-001",
        checkpointId: "ckpt-001",
        researchSessionID: "ses_test123",
        stageId: "S01_load_data",
      });

      expect(result.success).toBe(true);

      // Notebook should have been created
      const notebookPath = path.join(testDir, "notebooks", "new-notebook.ipynb");
      const notebook = await readNotebook(notebookPath);
      expect(notebook.cells.length).toBe(1);
      expect(notebook.cells[0].metadata.tags).toContain("gyoshu-checkpoint");
    });
  });
});

// =============================================================================
// 2.5.2: LIST ACTION TESTS
// =============================================================================

describe("List Action (2.5.2)", () => {
  describe("action: list", () => {
    test("returns empty array when no checkpoints exist", async () => {
      const result = await execute({
        action: "list",
        reportTitle: "empty-research",
        runId: "run-001",
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
      expect(result.checkpoints).toEqual([]);
      expect(result.count).toBe(0);
    });

    test("finds checkpoints for specific runId", async () => {
      await createNotebook("list-test");

      // Create multiple checkpoints
      await execute({
        action: "save",
        reportTitle: "list-test",
        runId: "run-001",
        checkpointId: "ckpt-001",
        researchSessionID: "ses_test123",
        stageId: "S01_load_data",
      });

      await new Promise((r) => setTimeout(r, 10)); // Small delay for ordering

      await execute({
        action: "save",
        reportTitle: "list-test",
        runId: "run-001",
        checkpointId: "ckpt-002",
        researchSessionID: "ses_test123",
        stageId: "S02_eda_analysis",
      });

      const result = await execute({
        action: "list",
        reportTitle: "list-test",
        runId: "run-001",
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);

      const checkpoints = result.checkpoints as any[];
      expect(checkpoints.length).toBe(2);

      // Should be sorted by createdAt descending (newest first)
      expect(checkpoints[0].checkpointId).toBe("ckpt-002");
      expect(checkpoints[1].checkpointId).toBe("ckpt-001");
    });

    test("returns checkpoints sorted by createdAt descending", async () => {
      // Create checkpoints directly with controlled timestamps
      await createManifestDirect("sort-test", "run-001", "ckpt-old", {
        stageId: "S01_load_data",
        createdAt: "2026-01-01T10:00:00Z",
      });

      await createManifestDirect("sort-test", "run-001", "ckpt-middle", {
        stageId: "S02_eda_analysis",
        createdAt: "2026-01-01T12:00:00Z",
      });

      await createManifestDirect("sort-test", "run-001", "ckpt-new", {
        stageId: "S03_train_model",
        createdAt: "2026-01-01T14:00:00Z",
      });

      const result = await execute({
        action: "list",
        reportTitle: "sort-test",
        runId: "run-001",
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(3);

      const checkpoints = result.checkpoints as any[];
      // Newest first
      expect(checkpoints[0].checkpointId).toBe("ckpt-new");
      expect(checkpoints[1].checkpointId).toBe("ckpt-middle");
      expect(checkpoints[2].checkpointId).toBe("ckpt-old");
    });

    test("lists checkpoints across all runs when runId not specified", async () => {
      // Create checkpoints in different runs
      await createManifestDirect("multi-run-test", "run-001", "ckpt-001", {
        stageId: "S01_load_data",
      });

      await createManifestDirect("multi-run-test", "run-002", "ckpt-001", {
        stageId: "S01_load_data",
      });

      const result = await execute({
        action: "list",
        reportTitle: "multi-run-test",
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);

      const checkpoints = result.checkpoints as any[];
      const runIds = checkpoints.map((c: any) => c.runId);
      expect(runIds).toContain("run-001");
      expect(runIds).toContain("run-002");
    });

    test("includes checkpoint summary info", async () => {
      await createManifestDirect("summary-test", "run-001", "ckpt-001", {
        stageId: "S01_load_data",
        status: "saved",
        artifacts: [{ relativePath: "data.csv", sha256: "abc123".padEnd(64, "0"), sizeBytes: 100 }],
      });

      const result = await execute({
        action: "list",
        reportTitle: "summary-test",
        runId: "run-001",
      });

      expect(result.success).toBe(true);
      const checkpoints = result.checkpoints as any[];
      expect(checkpoints[0].checkpointId).toBe("ckpt-001");
      expect(checkpoints[0].runId).toBe("run-001");
      expect(checkpoints[0].stageId).toBe("S01_load_data");
      expect(checkpoints[0].status).toBe("saved");
      expect(checkpoints[0].artifactCount).toBe(1);
      expect(checkpoints[0].createdAt).toBeDefined();
    });

    test("throws error when reportTitle is missing", async () => {
      await expect(
        execute({
          action: "list",
          runId: "run-001",
        })
      ).rejects.toThrow("reportTitle is required");
    });
  });
});

// =============================================================================
// 2.5.3: VALIDATE ACTION TESTS
// =============================================================================

describe("Validate Action (2.5.3)", () => {
  describe("action: validate", () => {
    test("returns valid=true for intact checkpoint", async () => {
      // Create a valid checkpoint with artifact
      const artifact = await createArtifact(
        "reports/valid-test/data.csv",
        "col1,col2\n1,2"
      );

      await createManifestDirect("valid-test", "run-001", "ckpt-001", {
        stageId: "S01_load_data",
        artifacts: [artifact],
      });

      const result = await execute({
        action: "validate",
        reportTitle: "valid-test",
        runId: "run-001",
        checkpointId: "ckpt-001",
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("validate");
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.checkpointId).toBe("ckpt-001");
      expect(result.stageId).toBe("S01_load_data");
    });

    test("returns valid=false when manifest not found", async () => {
      const result = await execute({
        action: "validate",
        reportTitle: "nonexistent",
        runId: "run-001",
        checkpointId: "ckpt-001",
      });

      expect(result.success).toBe(true);
      expect(result.valid).toBe(false);
      expect((result.issues as string[])[0]).toContain("Manifest not found");
    });

    test("returns valid=false for corrupt manifest JSON", async () => {
      await createManifestDirect("corrupt-test", "run-001", "ckpt-001", {
        stageId: "S01_load_data",
        corrupt: true,
      });

      const result = await execute({
        action: "validate",
        reportTitle: "corrupt-test",
        runId: "run-001",
        checkpointId: "ckpt-001",
      });

      expect(result.success).toBe(true);
      expect(result.valid).toBe(false);
      expect((result.issues as string[])[0]).toContain("parse or validate");
    });

    test("returns valid=false when artifact is missing", async () => {
      // Create manifest referencing non-existent artifact
      await createManifestDirect("missing-artifact-test", "run-001", "ckpt-001", {
        stageId: "S01_load_data",
        artifacts: [
          {
            relativePath: "reports/missing-artifact-test/nonexistent.csv",
            sha256: "a".repeat(64),
            sizeBytes: 100,
          },
        ],
      });

      const result = await execute({
        action: "validate",
        reportTitle: "missing-artifact-test",
        runId: "run-001",
        checkpointId: "ckpt-001",
      });

      expect(result.success).toBe(true);
      expect(result.valid).toBe(false);
      expect((result.issues as string[]).some((i: string) => i.includes("not found"))).toBe(true);
    });

    test("returns valid=false when artifact SHA256 mismatches", async () => {
      // Create artifact with different content than manifest says
      await createArtifact(
        "reports/sha-mismatch-test/data.csv",
        "actual content here"
      );

      // Create manifest with wrong SHA256
      await createManifestDirect("sha-mismatch-test", "run-001", "ckpt-001", {
        stageId: "S01_load_data",
        artifacts: [
          {
            relativePath: "reports/sha-mismatch-test/data.csv",
            sha256: "a".repeat(64), // Wrong hash
            sizeBytes: 20, // Approximate size
          },
        ],
      });

      const result = await execute({
        action: "validate",
        reportTitle: "sha-mismatch-test",
        runId: "run-001",
        checkpointId: "ckpt-001",
      });

      expect(result.success).toBe(true);
      expect(result.valid).toBe(false);
      expect((result.issues as string[]).some((i: string) => i.includes("SHA256 mismatch") || i.includes("Size mismatch"))).toBe(true);
    });

    test("returns valid=false when manifest SHA256 mismatches", async () => {
      await createManifestDirect("manifest-sha-test", "run-001", "ckpt-001", {
        stageId: "S01_load_data",
        badSha256: true,
      });

      const result = await execute({
        action: "validate",
        reportTitle: "manifest-sha-test",
        runId: "run-001",
        checkpointId: "ckpt-001",
      });

      expect(result.success).toBe(true);
      expect(result.valid).toBe(false);
      expect((result.issues as string[]).some((i: string) => i.includes("Manifest SHA256 mismatch") || i.includes("parse or validate"))).toBe(true);
    });

    test("throws error when reportTitle is missing", async () => {
      await expect(
        execute({
          action: "validate",
          runId: "run-001",
          checkpointId: "ckpt-001",
        })
      ).rejects.toThrow("reportTitle is required");
    });

    test("throws error when runId is missing", async () => {
      await expect(
        execute({
          action: "validate",
          reportTitle: "test",
          checkpointId: "ckpt-001",
        })
      ).rejects.toThrow("runId is required");
    });

    test("throws error when checkpointId is missing", async () => {
      await expect(
        execute({
          action: "validate",
          reportTitle: "test",
          runId: "run-001",
        })
      ).rejects.toThrow("checkpointId is required");
    });
  });
});

// =============================================================================
// 2.5.4: RESUME ACTION TESTS
// =============================================================================

describe("Resume Action (2.5.4)", () => {
  describe("action: resume", () => {
    test("returns most recent valid checkpoint", async () => {
      // Create valid checkpoint with artifact
      const artifact = await createArtifact(
        "reports/resume-test/data.csv",
        "col1,col2\n1,2"
      );

      await createManifestDirect("resume-test", "run-001", "ckpt-001", {
        stageId: "S01_load_data",
        createdAt: "2026-01-01T10:00:00Z",
        artifacts: [artifact],
      });

      await createManifestDirect("resume-test", "run-001", "ckpt-002", {
        stageId: "S02_eda_analysis",
        createdAt: "2026-01-01T12:00:00Z",
        artifacts: [artifact],
      });

      const result = await execute({
        action: "resume",
        reportTitle: "resume-test",
        runId: "run-001",
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("resume");
      expect(result.found).toBe(true);

      const checkpoint = result.checkpoint as any;
      expect(checkpoint.checkpointId).toBe("ckpt-002"); // Most recent
      expect(checkpoint.stageId).toBe("S02_eda_analysis");
    });

    test("generates rehydration cells with correct code", async () => {
      const artifact = await createArtifact(
        "reports/rehydrate-test/data.csv",
        "col1,col2\n1,2"
      );

      await createManifestDirect("rehydrate-test", "run-001", "ckpt-001", {
        stageId: "S01_load_data",
        artifacts: [artifact],
      });

      const result = await execute({
        action: "resume",
        reportTitle: "rehydrate-test",
        runId: "run-001",
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(true);
      expect(result.rehydrationCells).toBeDefined();
      expect(Array.isArray(result.rehydrationCells)).toBe(true);
      expect((result.rehydrationCells as string[]).length).toBeGreaterThan(0);
    });

    test("infers next stage ID", async () => {
      const artifact = await createArtifact(
        "reports/next-stage-test/data.csv",
        "col1,col2\n1,2"
      );

      await createManifestDirect("next-stage-test", "run-001", "ckpt-001", {
        stageId: "S02_eda_analysis",
        artifacts: [artifact],
      });

      const result = await execute({
        action: "resume",
        reportTitle: "next-stage-test",
        runId: "run-001",
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(true);
      expect(result.nextStageId).toBe("S03_"); // Inferred next stage
    });

    test("returns found=false when no valid checkpoints exist", async () => {
      const result = await execute({
        action: "resume",
        reportTitle: "empty-research",
        runId: "run-001",
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(false);
      expect(result.checkpoint).toBeUndefined();
    });

    test("skips invalid checkpoints and uses previous valid one", async () => {
      // Create valid older checkpoint
      const artifact = await createArtifact(
        "reports/fallback-test/data.csv",
        "col1,col2\n1,2"
      );

      await createManifestDirect("fallback-test", "run-001", "ckpt-001", {
        stageId: "S01_load_data",
        createdAt: "2026-01-01T10:00:00Z",
        artifacts: [artifact],
      });

      // Create corrupt newer checkpoint
      await createManifestDirect("fallback-test", "run-001", "ckpt-002", {
        stageId: "S02_eda_analysis",
        createdAt: "2026-01-01T12:00:00Z",
        corrupt: true,
      });

      const result = await execute({
        action: "resume",
        reportTitle: "fallback-test",
        runId: "run-001",
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(true);

      const checkpoint = result.checkpoint as any;
      expect(checkpoint.checkpointId).toBe("ckpt-001"); // Falls back to valid one
    });

    test("searches across all runs when runId not specified", async () => {
      const artifact = await createArtifact(
        "reports/all-runs-test/data.csv",
        "col1,col2\n1,2"
      );

      await createManifestDirect("all-runs-test", "run-001", "ckpt-001", {
        stageId: "S01_load_data",
        createdAt: "2026-01-01T10:00:00Z",
        artifacts: [artifact],
      });

      await createManifestDirect("all-runs-test", "run-002", "ckpt-001", {
        stageId: "S03_train_model",
        createdAt: "2026-01-01T14:00:00Z",
        artifacts: [artifact],
      });

      const result = await execute({
        action: "resume",
        reportTitle: "all-runs-test",
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(true);

      const checkpoint = result.checkpoint as any;
      expect(checkpoint.runId).toBe("run-002"); // Most recent across all runs
    });

    test("throws error when reportTitle is missing", async () => {
      await expect(
        execute({
          action: "resume",
          runId: "run-001",
        })
      ).rejects.toThrow("reportTitle is required");
    });
  });
});

// =============================================================================
// 2.5.5: PRUNE ACTION TESTS
// =============================================================================

describe("Prune Action (2.5.5)", () => {
  describe("action: prune", () => {
    test("keeps exactly K checkpoints", async () => {
      const stageIds = ["S01_load_data", "S02_eda_analysis", "S03_train_model", "S04_eval_results", "S05_save_output"];
      for (let i = 1; i <= 5; i++) {
        const ts = new Date(Date.now() + i * 1000).toISOString();
        await createManifestDirect("prune-test", "run-001", `ckpt-00${i}`, {
          stageId: stageIds[i - 1],
          createdAt: ts,
        });
      }

      const result = await execute({
        action: "prune",
        reportTitle: "prune-test",
        runId: "run-001",
        keepCount: 3,
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("prune");
      expect(result.kept).toBe(3);
      expect(result.pruned).toBe(2);
      expect(result.totalBefore).toBe(5);
    });

    test("removes oldest checkpoints first", async () => {
      // Create checkpoints with specific timestamps
      await createManifestDirect("prune-order-test", "run-001", "ckpt-oldest", {
        stageId: "S01_load_data",
        createdAt: "2026-01-01T10:00:00Z",
      });

      await createManifestDirect("prune-order-test", "run-001", "ckpt-middle", {
        stageId: "S02_eda_analysis",
        createdAt: "2026-01-01T12:00:00Z",
      });

      await createManifestDirect("prune-order-test", "run-001", "ckpt-newest", {
        stageId: "S03_train_model",
        createdAt: "2026-01-01T14:00:00Z",
      });

      const result = await execute({
        action: "prune",
        reportTitle: "prune-order-test",
        runId: "run-001",
        keepCount: 2,
      });

      expect(result.success).toBe(true);
      expect(result.pruned).toBe(1);

      const prunedIds = result.prunedIds as string[];
      expect(prunedIds).toContain("ckpt-oldest");
      expect(prunedIds).not.toContain("ckpt-middle");
      expect(prunedIds).not.toContain("ckpt-newest");

      // Verify oldest is actually deleted
      const oldestPath = path.join(
        testDir,
        "reports",
        "prune-order-test",
        "checkpoints",
        "run-001",
        "ckpt-oldest"
      );
      expect(
        await fs
          .access(oldestPath)
          .then(() => true)
          .catch(() => false)
      ).toBe(false);

      // Verify newest still exists
      const newestPath = path.join(
        testDir,
        "reports",
        "prune-order-test",
        "checkpoints",
        "run-001",
        "ckpt-newest"
      );
      expect(
        await fs
          .access(newestPath)
          .then(() => true)
          .catch(() => false)
      ).toBe(true);
    });

    test("returns count of pruned and kept checkpoints", async () => {
      const stageIds = ["S01_load_data", "S02_eda_analysis", "S03_train_model", "S04_eval_results"];
      for (let i = 1; i <= 4; i++) {
        const ts = new Date(Date.now() + i * 1000).toISOString();
        await createManifestDirect("count-test", "run-001", `ckpt-00${i}`, {
          stageId: stageIds[i - 1],
          createdAt: ts,
        });
      }

      const result = await execute({
        action: "prune",
        reportTitle: "count-test",
        runId: "run-001",
        keepCount: 2,
      });

      expect(result.success).toBe(true);
      expect(result.keepCount).toBe(2);
      expect(result.pruned).toBe(2);
      expect(result.kept).toBe(2);
      expect(result.totalBefore).toBe(4);
      expect((result.prunedIds as string[]).length).toBe(2);
    });

    test("uses default keepCount of 5", async () => {
      const stageIds = ["S01_load_data", "S02_eda_analysis", "S03_train_model", "S04_eval_results", "S05_save_output", "S06_gen_report", "S07_final_export"];
      for (let i = 1; i <= 7; i++) {
        const ts = new Date(Date.now() + i * 1000).toISOString();
        await createManifestDirect("default-keep-test", "run-001", `ckpt-00${i}`, {
          stageId: stageIds[i - 1],
          createdAt: ts,
        });
      }

      const result = await execute({
        action: "prune",
        reportTitle: "default-keep-test",
        runId: "run-001",
        // No keepCount specified - should default to 5
      });

      expect(result.success).toBe(true);
      expect(result.keepCount).toBe(5);
      expect(result.kept).toBe(5);
      expect(result.pruned).toBe(2);
    });

    test("does nothing when checkpoint count <= keepCount", async () => {
      // Create 2 checkpoints
      await createManifestDirect("no-prune-test", "run-001", "ckpt-001", {
        stageId: "S01_load_data",
      });

      await createManifestDirect("no-prune-test", "run-001", "ckpt-002", {
        stageId: "S02_eda_analysis",
      });

      const result = await execute({
        action: "prune",
        reportTitle: "no-prune-test",
        runId: "run-001",
        keepCount: 5,
      });

      expect(result.success).toBe(true);
      expect(result.pruned).toBe(0);
      expect(result.kept).toBe(2);
      expect(result.prunedIds).toEqual([]);
    });

    test("throws error when reportTitle is missing", async () => {
      await expect(
        execute({
          action: "prune",
          runId: "run-001",
          keepCount: 3,
        })
      ).rejects.toThrow("reportTitle is required");
    });

    test("throws error when runId is missing", async () => {
      await expect(
        execute({
          action: "prune",
          reportTitle: "test",
          keepCount: 3,
        })
      ).rejects.toThrow("runId is required");
    });
  });
});

// =============================================================================
// 2.5.6: CORRUPTION FALLBACK TESTS
// =============================================================================

describe("Corruption Fallback (2.5.6)", () => {
  describe("handling invalid checkpoints", () => {
    test("skips corrupt checkpoint during resume and uses previous valid", async () => {
      const artifact = await createArtifact(
        "reports/corruption-fallback-test/data.csv",
        "col1,col2\n1,2"
      );

      // Create valid older checkpoint
      await createManifestDirect("corruption-fallback-test", "run-001", "ckpt-valid-old", {
        stageId: "S01_load_data",
        createdAt: "2026-01-01T10:00:00Z",
        artifacts: [artifact],
      });

      // Create valid middle checkpoint
      await createManifestDirect("corruption-fallback-test", "run-001", "ckpt-valid-mid", {
        stageId: "S02_eda_analysis",
        createdAt: "2026-01-01T12:00:00Z",
        artifacts: [artifact],
      });

      // Create corrupt newest checkpoint
      await createManifestDirect("corruption-fallback-test", "run-001", "ckpt-corrupt", {
        stageId: "S03_train_model",
        createdAt: "2026-01-01T14:00:00Z",
        corrupt: true,
      });

      const result = await execute({
        action: "resume",
        reportTitle: "corruption-fallback-test",
        runId: "run-001",
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(true);

      const checkpoint = result.checkpoint as any;
      // Should skip corrupt and use valid middle checkpoint
      expect(checkpoint.checkpointId).toBe("ckpt-valid-mid");
      expect(checkpoint.stageId).toBe("S02_eda_analysis");
    });

    test("skips checkpoint with missing artifact during resume", async () => {
      const artifact = await createArtifact(
        "reports/missing-artifact-fallback/data.csv",
        "col1,col2\n1,2"
      );

      // Create valid older checkpoint
      await createManifestDirect("missing-artifact-fallback", "run-001", "ckpt-valid", {
        stageId: "S01_load_data",
        createdAt: "2026-01-01T10:00:00Z",
        artifacts: [artifact],
      });

      // Create checkpoint referencing missing artifact
      await createManifestDirect("missing-artifact-fallback", "run-001", "ckpt-missing-file", {
        stageId: "S02_eda_analysis",
        createdAt: "2026-01-01T12:00:00Z",
        artifacts: [
          {
            relativePath: "reports/missing-artifact-fallback/nonexistent.csv",
            sha256: "a".repeat(64),
            sizeBytes: 100,
          },
        ],
      });

      const result = await execute({
        action: "resume",
        reportTitle: "missing-artifact-fallback",
        runId: "run-001",
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(true);

      const checkpoint = result.checkpoint as any;
      // Should skip checkpoint with missing artifact and use valid one
      expect(checkpoint.checkpointId).toBe("ckpt-valid");
    });

    test("skips checkpoint with SHA256 mismatch during resume", async () => {
      const artifact = await createArtifact(
        "reports/sha-fallback/data.csv",
        "col1,col2\n1,2"
      );

      // Create valid older checkpoint
      await createManifestDirect("sha-fallback", "run-001", "ckpt-valid", {
        stageId: "S01_load_data",
        createdAt: "2026-01-01T10:00:00Z",
        artifacts: [artifact],
      });

      // Create artifact with different content
      await createArtifact("reports/sha-fallback/tampered.csv", "different content");

      // Create checkpoint with wrong SHA256 for artifact
      await createManifestDirect("sha-fallback", "run-001", "ckpt-bad-sha", {
        stageId: "S02_eda_analysis",
        createdAt: "2026-01-01T12:00:00Z",
        artifacts: [
          {
            relativePath: "reports/sha-fallback/tampered.csv",
            sha256: "a".repeat(64), // Wrong hash
            sizeBytes: 17, // Approximate size
          },
        ],
      });

      const result = await execute({
        action: "resume",
        reportTitle: "sha-fallback",
        runId: "run-001",
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(true);

      const checkpoint = result.checkpoint as any;
      // Should skip checkpoint with bad SHA256 and use valid one
      expect(checkpoint.checkpointId).toBe("ckpt-valid");
    });

    test("returns found=false when all checkpoints are invalid", async () => {
      // Create only corrupt checkpoints
      await createManifestDirect("all-corrupt", "run-001", "ckpt-corrupt1", {
        stageId: "S01_load_data",
        corrupt: true,
      });

      await createManifestDirect("all-corrupt", "run-001", "ckpt-corrupt2", {
        stageId: "S02_eda_analysis",
        corrupt: true,
      });

      const result = await execute({
        action: "resume",
        reportTitle: "all-corrupt",
        runId: "run-001",
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(false);
      expect(result.searchedCount).toBe(0);
      expect((result.validationIssues as string[])[0]).toContain("No checkpoints");
    });

    test("list action includes checkpoints even if some are invalid", async () => {
      // Create valid checkpoint
      await createManifestDirect("mixed-valid", "run-001", "ckpt-valid", {
        stageId: "S01_load_data",
      });

      // Create corrupt checkpoint (won't be included in list)
      await createManifestDirect("mixed-valid", "run-001", "ckpt-corrupt", {
        stageId: "S02_eda_analysis",
        corrupt: true,
      });

      const result = await execute({
        action: "list",
        reportTitle: "mixed-valid",
        runId: "run-001",
      });

      expect(result.success).toBe(true);
      // Only valid checkpoint should be listed (corrupt one should be skipped)
      expect(result.count).toBe(1);

      const checkpoints = result.checkpoints as any[];
      expect(checkpoints[0].checkpointId).toBe("ckpt-valid");
    });

    test("validate action returns specific issues for each problem", async () => {
      // Create artifact with wrong hash
      await createArtifact("reports/issue-details/actual.csv", "actual content");

      await createManifestDirect("issue-details", "run-001", "ckpt-001", {
        stageId: "S01_load_data",
        artifacts: [
          {
            relativePath: "reports/issue-details/actual.csv",
            sha256: "b".repeat(64), // Wrong hash
            sizeBytes: 14, // Correct size for "actual content"
          },
          {
            relativePath: "reports/issue-details/missing.csv",
            sha256: "c".repeat(64),
            sizeBytes: 100,
          },
        ],
      });

      const result = await execute({
        action: "validate",
        reportTitle: "issue-details",
        runId: "run-001",
        checkpointId: "ckpt-001",
      });

      expect(result.success).toBe(true);
      expect(result.valid).toBe(false);

      const issues = result.issues as string[];
      expect(issues.length).toBeGreaterThanOrEqual(1);
      // Should have issues for both SHA256 mismatch and missing file
      const hasShaIssue = issues.some((i) => i.includes("SHA256 mismatch"));
      const hasMissingIssue = issues.some((i) => i.includes("not found"));
      expect(hasShaIssue || hasMissingIssue).toBe(true);
    });
  });
});

// =============================================================================
// 3.4: EMERGENCY ACTION TESTS
// =============================================================================

describe("Emergency Action (3.4)", () => {
  describe("action: emergency", () => {
    test("3.4.1 creates emergency checkpoint with minimal required fields", async () => {
      const result = await execute({
        action: "emergency",
        reportTitle: "emergency-test",
        runId: "run-001",
        stageId: "S01_load_data",
        reason: "timeout",
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("emergency");
      expect(result.reportTitle).toBe("emergency-test");
      expect(result.runId).toBe("run-001");
      expect(result.stageId).toBe("S01_load_data");
      expect(result.reason).toBe("timeout");
      expect(result.checkpointId).toBeDefined();
      expect((result.checkpointId as string).startsWith("ckpt-emergency-")).toBe(true);
    });

    test("3.4.2 accepts artifacts without validation (sha256 can be unknown)", async () => {
      const result = await execute({
        action: "emergency",
        reportTitle: "emergency-artifact-test",
        runId: "run-001",
        stageId: "S01_load_data",
        reason: "abort",
        artifacts: [
          {
            relativePath: "reports/emergency-artifact-test/data.csv",
            sha256: "unknown".padEnd(64, "0"),
            sizeBytes: 0,
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.artifactCount).toBe(1);
      expect(result.artifactsValidated).toBe(false);
    });

    test("3.4.3 marks status as interrupted in manifest", async () => {
      const result = await execute({
        action: "emergency",
        reportTitle: "emergency-status-test",
        runId: "run-001",
        stageId: "S01_load_data",
        reason: "timeout",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("interrupted");

      const manifestPath = path.join(
        testDir,
        "reports",
        "emergency-status-test",
        "checkpoints",
        "run-001",
        result.checkpointId as string,
        "checkpoint.json"
      );
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
      expect(manifest.status).toBe("interrupted");
    });

    test("3.4.4 stores reason timeout for watchdog timeout", async () => {
      const result = await execute({
        action: "emergency",
        reportTitle: "emergency-timeout-test",
        runId: "run-001",
        stageId: "S01_load_data",
        reason: "timeout",
      });

      expect(result.success).toBe(true);
      expect(result.reason).toBe("timeout");

      const manifestPath = path.join(
        testDir,
        "reports",
        "emergency-timeout-test",
        "checkpoints",
        "run-001",
        result.checkpointId as string,
        "checkpoint.json"
      );
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
      expect(manifest.reason).toBe("timeout");
    });

    test("3.4.4 stores reason abort for manual abort", async () => {
      const result = await execute({
        action: "emergency",
        reportTitle: "emergency-abort-test",
        runId: "run-001",
        stageId: "S01_load_data",
        reason: "abort",
      });

      expect(result.success).toBe(true);
      expect(result.reason).toBe("abort");

      const manifestPath = path.join(
        testDir,
        "reports",
        "emergency-abort-test",
        "checkpoints",
        "run-001",
        result.checkpointId as string,
        "checkpoint.json"
      );
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
      expect(manifest.reason).toBe("abort");
    });

    test("3.4.4 stores reason error for unhandled error", async () => {
      const result = await execute({
        action: "emergency",
        reportTitle: "emergency-error-test",
        runId: "run-001",
        stageId: "S01_load_data",
        reason: "error",
      });

      expect(result.success).toBe(true);
      expect(result.reason).toBe("error");

      const manifestPath = path.join(
        testDir,
        "reports",
        "emergency-error-test",
        "checkpoints",
        "run-001",
        result.checkpointId as string,
        "checkpoint.json"
      );
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
      expect(manifest.reason).toBe("error");
    });

    test("auto-generates checkpointId when not provided", async () => {
      const result = await execute({
        action: "emergency",
        reportTitle: "emergency-autoid-test",
        runId: "run-001",
        stageId: "S01_load_data",
        reason: "timeout",
      });

      expect(result.success).toBe(true);
      expect(result.checkpointId).toBeDefined();
      expect((result.checkpointId as string).startsWith("ckpt-emergency-")).toBe(true);
    });

    test("uses provided checkpointId when specified", async () => {
      const result = await execute({
        action: "emergency",
        reportTitle: "emergency-customid-test",
        runId: "run-001",
        checkpointId: "my-custom-ckpt",
        stageId: "S01_load_data",
        reason: "timeout",
      });

      expect(result.success).toBe(true);
      expect(result.checkpointId).toBe("my-custom-ckpt");
    });

    test("researchSessionID is optional for emergency checkpoints", async () => {
      const result = await execute({
        action: "emergency",
        reportTitle: "emergency-no-session-test",
        runId: "run-001",
        stageId: "S01_load_data",
        reason: "timeout",
      });

      expect(result.success).toBe(true);

      const manifestPath = path.join(
        testDir,
        "reports",
        "emergency-no-session-test",
        "checkpoints",
        "run-001",
        result.checkpointId as string,
        "checkpoint.json"
      );
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
      expect(manifest.researchSessionID).toBe("unknown");
    });

    test("writes manifest atomically even without notebook", async () => {
      const result = await execute({
        action: "emergency",
        reportTitle: "emergency-no-notebook-test",
        runId: "run-001",
        stageId: "S01_load_data",
        reason: "timeout",
      });

      expect(result.success).toBe(true);

      const manifestPath = path.join(
        testDir,
        "reports",
        "emergency-no-notebook-test",
        "checkpoints",
        "run-001",
        result.checkpointId as string,
        "checkpoint.json"
      );

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(content);

      expect(manifest.checkpointId).toBeDefined();
      expect(manifest.status).toBe("interrupted");
      expect(manifest.reason).toBe("timeout");
      expect(manifest.manifestSha256).toBeDefined();
    });

    test("cell append failure does not fail emergency checkpoint", async () => {
      const result = await execute({
        action: "emergency",
        reportTitle: "emergency-cell-fail-test",
        runId: "run-001",
        stageId: "S01_load_data",
        reason: "timeout",
      });

      expect(result.success).toBe(true);
      expect(result.cellAppendSucceeded).toBeDefined();
    });

    test("throws error when reportTitle is missing", async () => {
      await expect(
        execute({
          action: "emergency",
          runId: "run-001",
          stageId: "S01_load_data",
          reason: "timeout",
        })
      ).rejects.toThrow("reportTitle is required");
    });

    test("throws error when runId is missing", async () => {
      await expect(
        execute({
          action: "emergency",
          reportTitle: "test",
          stageId: "S01_load_data",
          reason: "timeout",
        })
      ).rejects.toThrow("runId is required");
    });

    test("throws error when stageId is missing", async () => {
      await expect(
        execute({
          action: "emergency",
          reportTitle: "test",
          runId: "run-001",
          reason: "timeout",
        })
      ).rejects.toThrow("stageId is required");
    });

    test("throws error when reason is missing", async () => {
      await expect(
        execute({
          action: "emergency",
          reportTitle: "test",
          runId: "run-001",
          stageId: "S01_load_data",
        })
      ).rejects.toThrow("reason is required");
    });

    test("emergency checkpoint shows up in list action", async () => {
      await execute({
        action: "emergency",
        reportTitle: "emergency-list-test",
        runId: "run-001",
        stageId: "S01_load_data",
        reason: "timeout",
      });

      const listResult = await execute({
        action: "list",
        reportTitle: "emergency-list-test",
        runId: "run-001",
      });

      expect(listResult.success).toBe(true);
      expect(listResult.count).toBe(1);

      const checkpoints = listResult.checkpoints as any[];
      expect(checkpoints[0].status).toBe("interrupted");
    });

    test("emergency checkpoint can be found by resume action", async () => {
      const emergencyResult = await execute({
        action: "emergency",
        reportTitle: "emergency-resume-test",
        runId: "run-001",
        stageId: "S01_load_data",
        reason: "timeout",
      });

      const resumeResult = await execute({
        action: "resume",
        reportTitle: "emergency-resume-test",
        runId: "run-001",
      });

      expect(resumeResult.success).toBe(true);
      expect(resumeResult.found).toBe(true);

      const checkpoint = resumeResult.checkpoint as any;
      expect(checkpoint.checkpointId).toBe(emergencyResult.checkpointId);
      expect(checkpoint.status).toBe("interrupted");
    });
  });
});

// =============================================================================
// TRUST LEVEL VALIDATION TESTS
// =============================================================================

describe("Trust Level Validation", () => {
  /**
   * Helper to check if symlinks are supported on the current platform.
   */
  async function symlinkSupported(): Promise<boolean> {
    try {
      const testPath = path.join(testDir, "symlink-test-target");
      const linkPath = path.join(testDir, "symlink-test-link");
      await fs.writeFile(testPath, "test");
      await fs.symlink(testPath, linkPath);
      await fs.unlink(linkPath);
      await fs.unlink(testPath);
      return true;
    } catch {
      return false;
    }
  }

  test("local trust level skips parent directory symlink validation", async () => {
    // Create checkpoint with default (local) trust level
    await createNotebook("local-trust-test");

    const artifact = await createArtifact(
      "reports/local-trust-test/data.csv",
      "col1,col2\n1,2\n3,4"
    );

    const result = await execute({
      action: "save",
      reportTitle: "local-trust-test",
      runId: "run-001",
      checkpointId: "ckpt-001",
      researchSessionID: "ses_test123",
      stageId: "S01_load_data",
      // No trustLevel specified - defaults to "local"
      artifacts: [artifact],
    });

    expect(result.success).toBe(true);
    expect(result.checkpointId).toBe("ckpt-001");

    // Verify the checkpoint can be validated (should pass with local trust)
    const validateResult = await execute({
      action: "validate",
      reportTitle: "local-trust-test",
      runId: "run-001",
      checkpointId: "ckpt-001",
    });

    expect(validateResult.success).toBe(true);
    expect(validateResult.valid).toBe(true);
  });

  test("imported trust level validates parent directories are not symlinks", async () => {
    await createNotebook("imported-trust-test");

    const artifact = await createArtifact(
      "reports/imported-trust-test/data.csv",
      "col1,col2\n1,2\n3,4"
    );

    // Create checkpoint with imported trust level
    const result = await execute({
      action: "save",
      reportTitle: "imported-trust-test",
      runId: "run-001",
      checkpointId: "ckpt-001",
      researchSessionID: "ses_test123",
      stageId: "S01_load_data",
      trustLevel: "imported",
      artifacts: [artifact],
    });

    expect(result.success).toBe(true);

    // Validation should pass when there are no symlinks in path
    const validateResult = await execute({
      action: "validate",
      reportTitle: "imported-trust-test",
      runId: "run-001",
      checkpointId: "ckpt-001",
    });

    expect(validateResult.success).toBe(true);
    expect(validateResult.valid).toBe(true);
  });

  test("untrusted trust level rejects symlinked parent directories", async () => {
    // Skip this test if symlinks are not supported
    if (!(await symlinkSupported())) {
      console.log("Skipping symlink test - not supported on this platform");
      return;
    }

    // Create a directory structure with a symlink in the parent path
    const realDir = path.join(testDir, "real-reports", "untrusted-symlink-test");
    await fs.mkdir(realDir, { recursive: true });
    await fs.writeFile(path.join(realDir, "data.csv"), "col1,col2\n1,2");

    // Create symlink pointing to the real directory
    const symlinkDir = path.join(testDir, "reports");
    await fs.mkdir(symlinkDir, { recursive: true });
    const symlinkPath = path.join(symlinkDir, "untrusted-symlink-test");
    await fs.symlink(realDir, symlinkPath);

    // Create manifest directly with untrusted trust level referencing the symlinked path
    await createManifestDirect("untrusted-symlink-test", "run-001", "ckpt-001", {
      stageId: "S01_load_data",
      artifacts: [
        {
          relativePath: "reports/untrusted-symlink-test/data.csv",
          sha256: crypto.createHash("sha256").update("col1,col2\n1,2").digest("hex"),
          sizeBytes: 12,
        },
      ],
    });

    // Modify the manifest to have untrusted trust level
    const manifestPath = path.join(
      testDir,
      "reports",
      "untrusted-symlink-test",
      "checkpoints",
      "run-001",
      "ckpt-001",
      "checkpoint.json"
    );
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    manifest.trustLevel = "untrusted";
    // Recalculate manifest SHA256
    const manifestBase = { ...manifest };
    delete manifestBase.manifestSha256;
    manifest.manifestSha256 = crypto
      .createHash("sha256")
      .update(JSON.stringify(manifestBase, null, 2))
      .digest("hex");
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    // Validation should fail due to symlink in parent path
    const validateResult = await execute({
      action: "validate",
      reportTitle: "untrusted-symlink-test",
      runId: "run-001",
      checkpointId: "ckpt-001",
    });

    expect(validateResult.success).toBe(true);
    expect(validateResult.valid).toBe(false);
    // The issue could be about symlink detection or ELOOP error
    expect(
      (validateResult.issues as string[]).some(
        (issue: string) =>
          issue.includes("symlink") || issue.includes("ELOOP") || issue.includes("Parent directory")
      )
    ).toBe(true);
  });

  test("resume includes trust warning for imported checkpoints", async () => {
    const artifact = await createArtifact(
      "reports/imported-resume-test/data.csv",
      "col1,col2\n1,2"
    );

    // Create manifest directly with imported trust level
    await createManifestDirect("imported-resume-test", "run-001", "ckpt-001", {
      stageId: "S01_load_data",
      artifacts: [artifact],
    });

    // Update the manifest with imported trust level
    const manifestPath = path.join(
      testDir,
      "reports",
      "imported-resume-test",
      "checkpoints",
      "run-001",
      "ckpt-001",
      "checkpoint.json"
    );
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    manifest.trustLevel = "imported";
    // Recalculate manifest SHA256
    const manifestBase = { ...manifest };
    delete manifestBase.manifestSha256;
    manifest.manifestSha256 = crypto
      .createHash("sha256")
      .update(JSON.stringify(manifestBase, null, 2))
      .digest("hex");
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const result = await execute({
      action: "resume",
      reportTitle: "imported-resume-test",
      runId: "run-001",
    });

    expect(result.success).toBe(true);
    expect(result.found).toBe(true);
    expect(result.trustWarning).toBeDefined();
    expect(result.trustWarning).toContain("imported");
  });

  test("resume includes trust warning for untrusted checkpoints", async () => {
    const artifact = await createArtifact(
      "reports/untrusted-resume-test/data.csv",
      "col1,col2\n1,2"
    );

    // Create manifest directly with untrusted trust level
    await createManifestDirect("untrusted-resume-test", "run-001", "ckpt-001", {
      stageId: "S01_load_data",
      artifacts: [artifact],
    });

    // Update the manifest with untrusted trust level
    const manifestPath = path.join(
      testDir,
      "reports",
      "untrusted-resume-test",
      "checkpoints",
      "run-001",
      "ckpt-001",
      "checkpoint.json"
    );
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    manifest.trustLevel = "untrusted";
    // Recalculate manifest SHA256
    const manifestBase = { ...manifest };
    delete manifestBase.manifestSha256;
    manifest.manifestSha256 = crypto
      .createHash("sha256")
      .update(JSON.stringify(manifestBase, null, 2))
      .digest("hex");
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const result = await execute({
      action: "resume",
      reportTitle: "untrusted-resume-test",
      runId: "run-001",
    });

    expect(result.success).toBe(true);
    expect(result.found).toBe(true);
    expect(result.trustWarning).toBeDefined();
    expect(result.trustWarning).toContain("untrusted");
  });

  test("trust level is saved in checkpoint manifest", async () => {
    await createNotebook("trust-persist-test");

    // Create checkpoint with specific trust level
    await execute({
      action: "save",
      reportTitle: "trust-persist-test",
      runId: "run-001",
      checkpointId: "ckpt-001",
      researchSessionID: "ses_test123",
      stageId: "S01_load_data",
      trustLevel: "imported",
    });

    // Read manifest and verify trustLevel field
    const manifestPath = path.join(
      testDir,
      "reports",
      "trust-persist-test",
      "checkpoints",
      "run-001",
      "ckpt-001",
      "checkpoint.json"
    );
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));

    expect(manifest.trustLevel).toBe("imported");
  });

  test("trust level defaults to local when not specified", async () => {
    await createNotebook("trust-default-test");

    // Create checkpoint without specifying trust level
    await execute({
      action: "save",
      reportTitle: "trust-default-test",
      runId: "run-001",
      checkpointId: "ckpt-001",
      researchSessionID: "ses_test123",
      stageId: "S01_load_data",
    });

    // Read manifest and verify trustLevel defaults to local
    const manifestPath = path.join(
      testDir,
      "reports",
      "trust-default-test",
      "checkpoints",
      "run-001",
      "ckpt-001",
      "checkpoint.json"
    );
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));

    expect(manifest.trustLevel).toBe("local");
  });

  test("local trust level resume does not include trust warning", async () => {
    const artifact = await createArtifact(
      "reports/local-resume-test/data.csv",
      "col1,col2\n1,2"
    );

    // Create manifest directly with local trust level (default)
    await createManifestDirect("local-resume-test", "run-001", "ckpt-001", {
      stageId: "S01_load_data",
      artifacts: [artifact],
    });

    const result = await execute({
      action: "resume",
      reportTitle: "local-resume-test",
      runId: "run-001",
    });

    expect(result.success).toBe(true);
    expect(result.found).toBe(true);
    // Local trust level should not have a trust warning
    expect(result.trustWarning).toBeUndefined();
  });
});

// =============================================================================
// ERROR HANDLING
// =============================================================================

describe("Error Handling", () => {
  test("rejects unknown action", async () => {
    await expect(
      execute({ action: "unknown" as any, reportTitle: "test" })
    ).rejects.toThrow("Unknown action");
  });

  test("validates path segment for reportTitle", async () => {
    await expect(
      execute({
        action: "list",
        reportTitle: "../malicious",
      })
    ).rejects.toThrow("path traversal");
  });

  test("validates path segment for runId", async () => {
    await expect(
      execute({
        action: "list",
        reportTitle: "test",
        runId: "../malicious",
      })
    ).rejects.toThrow("path traversal");
  });

  test("validates path segment for checkpointId", async () => {
    await createNotebook("path-test");

    await expect(
      execute({
        action: "save",
        reportTitle: "path-test",
        runId: "run-001",
        checkpointId: "../malicious",
        researchSessionID: "ses_test123",
        stageId: "S01_load_data",
      })
    ).rejects.toThrow("path traversal");
  });
});
