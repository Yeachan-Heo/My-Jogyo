/**
 * Integration Tests for Checkpoint/Resume System
 *
 * Tests the complete checkpoint/resume workflow including:
 * - Creating checkpoints and resuming after simulated crashes
 * - Multiple checkpoint handling and selecting latest valid
 * - Corruption fallback behavior
 * - Correct stage ID continuation after resume
 * - Artifact rehydration code generation
 *
 * @see docs/stage-protocol.md for checkpoint protocol specification
 * @see src/tool/checkpoint-manager.ts for checkpoint tool implementation
 * @module checkpoint-resume.test
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

// Import the checkpoint-manager tool
import checkpointManager from "../src/tool/checkpoint-manager";

// Import path utilities for cache clearing
import { clearProjectRootCache, getCheckpointDir, getCheckpointManifestPath, getNotebookPath } from "../src/lib/paths";

// =============================================================================
// TEST SETUP
// =============================================================================

/** Test directory for isolated tests */
let testDir: string;

/** Original environment variable value */
let originalProjectRoot: string | undefined;

/** Original working directory */
let originalCwd: string;

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
    randomSeeds?: Record<string, number>;
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
    rehydrationCellSource?: string[];
    randomSeeds?: Record<string, number>;
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
  const rehydrationCellSource = options.rehydrationCellSource || [
    "# Rehydration code",
    "print('Rehydrating...')",
  ];

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
      ...(options.randomSeeds && { randomSeeds: options.randomSeeds }),
    },
    artifacts,
    rehydration: {
      mode: "artifacts_only",
      rehydrationCellSource,
    },
  };

  // Calculate SHA256
  const content = JSON.stringify(manifestBase, null, 2);
  const manifestSha256 = crypto.createHash("sha256").update(content, "utf8").digest("hex");

  const manifest = {
    ...manifestBase,
    manifestSha256: options.badSha256
      ? "0000000000000000000000000000000000000000000000000000000000000000"
      : manifestSha256,
  };

  if (options.corrupt) {
    // Write corrupt JSON
    await fs.writeFile(manifestPath, "{ invalid json }}}");
  } else {
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  return manifestPath;
}

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
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "gyoshu-resume-test-"));
  process.env.GYOSHU_PROJECT_ROOT = testDir;
  process.chdir(testDir);
  clearProjectRootCache();

  // Create required directories
  await fs.mkdir(path.join(testDir, "notebooks"), { recursive: true });
  await fs.mkdir(path.join(testDir, "reports"), { recursive: true });
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (testDir) {
    await fs.rm(testDir, { recursive: true, force: true });
  }
  clearProjectRootCache();
});

// =============================================================================
// 4.4 CHECKPOINT RESUME INTEGRATION TESTS
// =============================================================================

describe("Checkpoint Resume Integration", () => {
  // ===========================================================================
  // 4.4.1: Test create checkpoint, "crash" bridge, resume, verify rehydration
  // ===========================================================================
  test("4.4.1: resume from checkpoint after simulated crash", async () => {
    // 1. Create a checkpoint with artifacts
    await createNotebook("crash-test");

    // Create an artifact file
    const artifact = await createArtifact(
      "reports/crash-test/data.parquet",
      "mock parquet content for testing"
    );

    // Save a checkpoint
    const saveResult = await execute({
      action: "save",
      reportTitle: "crash-test",
      runId: "run-001",
      checkpointId: "ckpt-001",
      researchSessionID: "ses_crash_test",
      stageId: "S02_eda_analysis",
      executionCount: 10,
      pythonEnv: {
        pythonPath: "/usr/bin/python3",
        packages: ["pandas==2.0.0", "numpy==1.24.0"],
        platform: "linux",
      },
      artifacts: [artifact],
    });

    expect(saveResult.success).toBe(true);
    expect(saveResult.checkpointId).toBe("ckpt-001");

    // 2. Simulate bridge crash by clearing REPL state
    // In a real scenario, the Python REPL would lose all variables.
    // We don't have access to the actual REPL here, but the checkpoint
    // system is designed to work independently of REPL state.
    // The "crash" is simulated by treating this as a fresh session.

    // 3. Call resume action
    const resumeResult = await execute({
      action: "resume",
      reportTitle: "crash-test",
      runId: "run-001",
    });

    // 4. Verify rehydration cells are generated correctly
    expect(resumeResult.success).toBe(true);
    expect(resumeResult.found).toBe(true);

    const checkpoint = resumeResult.checkpoint as any;
    expect(checkpoint.checkpointId).toBe("ckpt-001");
    expect(checkpoint.stageId).toBe("S02_eda_analysis");

    // Verify rehydration cells exist
    expect(resumeResult.rehydrationCells).toBeDefined();
    expect(Array.isArray(resumeResult.rehydrationCells)).toBe(true);

    const rehydrationCells = resumeResult.rehydrationCells as string[];
    expect(rehydrationCells.length).toBeGreaterThan(0);

    // The rehydration code should contain REHYDRATED marker
    const rehydrationCode = rehydrationCells.join("\n");
    expect(rehydrationCode).toContain("[REHYDRATED:from=ckpt-001]");

    // Should contain pandas import for parquet files
    expect(rehydrationCode).toContain("import pandas as pd");
  });

  // ===========================================================================
  // 4.4.2: Test multiple checkpoints, resume from latest valid
  // ===========================================================================
  test("4.4.2: resume selects latest valid checkpoint when multiple exist", async () => {
    // 1. Create 3 checkpoints in sequence with increasing timestamps
    const artifact = await createArtifact(
      "reports/multi-ckpt-test/data.csv",
      "col1,col2\n1,2\n3,4"
    );

    await createManifestDirect("multi-ckpt-test", "run-001", "ckpt-001", {
      stageId: "S01_load_data",
      createdAt: "2026-01-01T10:00:00Z",
      artifacts: [artifact],
    });

    await createManifestDirect("multi-ckpt-test", "run-001", "ckpt-002", {
      stageId: "S02_eda_analysis",
      createdAt: "2026-01-01T12:00:00Z",
      artifacts: [artifact],
    });

    await createManifestDirect("multi-ckpt-test", "run-001", "ckpt-003", {
      stageId: "S03_train_model",
      createdAt: "2026-01-01T14:00:00Z",
      artifacts: [artifact],
    });

    // 2. Corrupt the latest one (modify SHA256)
    await createManifestDirect("multi-ckpt-test", "run-001", "ckpt-003-corrupt", {
      stageId: "S04_eval_results",
      createdAt: "2026-01-01T16:00:00Z", // Latest timestamp
      badSha256: true,
    });

    // 3. Call resume
    const resumeResult = await execute({
      action: "resume",
      reportTitle: "multi-ckpt-test",
      runId: "run-001",
    });

    // 4. Verify it returns the second-latest valid checkpoint (ckpt-003)
    expect(resumeResult.success).toBe(true);
    expect(resumeResult.found).toBe(true);

    const checkpoint = resumeResult.checkpoint as any;
    expect(checkpoint.checkpointId).toBe("ckpt-003");
    expect(checkpoint.stageId).toBe("S03_train_model");
  });

  // ===========================================================================
  // 4.4.3: Test corrupt checkpoint, fallback to previous
  // ===========================================================================
  test("4.4.3: falls back to previous checkpoint when latest is corrupt", async () => {
    // 1. Create valid checkpoint
    const artifact = await createArtifact(
      "reports/corrupt-fallback-test/data.csv",
      "col1,col2\n1,2"
    );

    await createManifestDirect("corrupt-fallback-test", "run-001", "ckpt-valid", {
      stageId: "S01_load_data",
      createdAt: "2026-01-01T10:00:00Z",
      artifacts: [artifact],
    });

    // 2. Create another checkpoint with invalid artifact hash
    // First, create the artifact file with different content than manifest claims
    await createArtifact(
      "reports/corrupt-fallback-test/tampered.csv",
      "actual content here that differs from hash"
    );

    await createManifestDirect("corrupt-fallback-test", "run-001", "ckpt-bad-artifact", {
      stageId: "S02_eda_analysis",
      createdAt: "2026-01-01T12:00:00Z",
      artifacts: [
        {
          relativePath: "reports/corrupt-fallback-test/tampered.csv",
          sha256: "a".repeat(64), // Wrong hash
          sizeBytes: 42, // Wrong size
        },
      ],
    });

    // 3. Resume should return the first valid one
    const resumeResult = await execute({
      action: "resume",
      reportTitle: "corrupt-fallback-test",
      runId: "run-001",
    });

    expect(resumeResult.success).toBe(true);
    expect(resumeResult.found).toBe(true);

    const checkpoint = resumeResult.checkpoint as any;
    expect(checkpoint.checkpointId).toBe("ckpt-valid");
    expect(checkpoint.stageId).toBe("S01_load_data");
  });

  // ===========================================================================
  // 4.4.4: Test resume continues from correct next stage
  // ===========================================================================
  test("4.4.4: resume provides correct next stage ID", async () => {
    // Test various stage IDs and verify correct next stage inference

    // Test case 1: S02_eda -> S03_*
    const artifact = await createArtifact(
      "reports/next-stage-test/data.csv",
      "col1,col2\n1,2"
    );

    await createManifestDirect("next-stage-test", "run-001", "ckpt-002", {
      stageId: "S02_eda_analysis",
      createdAt: "2026-01-01T12:00:00Z",
      artifacts: [artifact],
    });

    let resumeResult = await execute({
      action: "resume",
      reportTitle: "next-stage-test",
      runId: "run-001",
    });

    expect(resumeResult.success).toBe(true);
    expect(resumeResult.found).toBe(true);
    expect(resumeResult.nextStageId).toBe("S03_");

    // Test case 2: S05_save_results -> S06_*
    await createManifestDirect("next-stage-test", "run-002", "ckpt-005", {
      stageId: "S05_save_results",
      createdAt: "2026-01-01T14:00:00Z",
      artifacts: [artifact],
    });

    resumeResult = await execute({
      action: "resume",
      reportTitle: "next-stage-test",
      runId: "run-002",
    });

    expect(resumeResult.success).toBe(true);
    expect(resumeResult.found).toBe(true);
    expect(resumeResult.nextStageId).toBe("S06_");

    // Test case 3: S09_final_step -> S10_*
    await createManifestDirect("next-stage-test", "run-003", "ckpt-009", {
      stageId: "S09_final_step",
      createdAt: "2026-01-01T16:00:00Z",
      artifacts: [artifact],
    });

    resumeResult = await execute({
      action: "resume",
      reportTitle: "next-stage-test",
      runId: "run-003",
    });

    expect(resumeResult.success).toBe(true);
    expect(resumeResult.found).toBe(true);
    expect(resumeResult.nextStageId).toBe("S10_");
  });

  // ===========================================================================
  // 4.4.5: Test artifacts load correctly after rehydration
  // ===========================================================================
  test("4.4.5: rehydration code loads artifacts correctly", async () => {
    // 1. Create checkpoint with various artifact types
    const parquetArtifact = await createArtifact(
      "reports/artifact-types-test/data.parquet",
      "mock parquet content"
    );

    const pickleArtifact = await createArtifact(
      "reports/artifact-types-test/model.pkl",
      "mock pickle content"
    );

    const joblibArtifact = await createArtifact(
      "reports/artifact-types-test/pipeline.joblib",
      "mock joblib content"
    );

    const csvArtifact = await createArtifact(
      "reports/artifact-types-test/results.csv",
      "col1,col2,col3\n1,2,3"
    );

    const jsonArtifact = await createArtifact(
      "reports/artifact-types-test/config.json",
      '{"key": "value"}'
    );

    await createNotebook("artifact-types-test");

    // Save checkpoint with all artifact types
    const saveResult = await execute({
      action: "save",
      reportTitle: "artifact-types-test",
      runId: "run-001",
      checkpointId: "ckpt-artifacts",
      researchSessionID: "ses_artifact_test",
      stageId: "S03_train_model",
      executionCount: 15,
      pythonEnv: {
        pythonPath: "/usr/bin/python3",
        packages: ["pandas==2.0.0", "numpy==1.24.0", "joblib==1.3.0"],
        platform: "linux",
        randomSeeds: { random: 42, numpy: 123 },
      },
      artifacts: [
        parquetArtifact,
        pickleArtifact,
        joblibArtifact,
        csvArtifact,
        jsonArtifact,
      ],
    });

    expect(saveResult.success).toBe(true);

    // 2. Get rehydration cells
    const resumeResult = await execute({
      action: "resume",
      reportTitle: "artifact-types-test",
      runId: "run-001",
    });

    expect(resumeResult.success).toBe(true);
    expect(resumeResult.found).toBe(true);

    // 3. Verify correct import statements
    const rehydrationCells = resumeResult.rehydrationCells as string[];
    const rehydrationCode = rehydrationCells.join("\n");

    // Check imports
    expect(rehydrationCode).toContain("import pandas as pd");
    expect(rehydrationCode).toContain("import pickle");
    expect(rehydrationCode).toContain("import joblib");
    expect(rehydrationCode).toContain("import json");

    // 4. Verify correct load code for each artifact type
    // Parquet: pd.read_parquet
    expect(rehydrationCode).toContain('pd.read_parquet("reports/artifact-types-test/data.parquet")');

    // Pickle: pickle.load
    expect(rehydrationCode).toContain('open("reports/artifact-types-test/model.pkl", "rb")');
    expect(rehydrationCode).toContain("pickle.load(f)");

    // Joblib: joblib.load
    expect(rehydrationCode).toContain('joblib.load("reports/artifact-types-test/pipeline.joblib")');

    // CSV: pd.read_csv
    expect(rehydrationCode).toContain('pd.read_csv("reports/artifact-types-test/results.csv")');

    // JSON: json.load
    expect(rehydrationCode).toContain('open("reports/artifact-types-test/config.json", "r")');
    expect(rehydrationCode).toContain("json.load(f)");

    // Verify REHYDRATED marker
    expect(rehydrationCode).toContain("[REHYDRATED:from=ckpt-artifacts]");
  });

  // ===========================================================================
  // Additional edge case tests
  // ===========================================================================
  test("resume handles empty checkpoint directory gracefully", async () => {
    // Create the checkpoint directory but no checkpoints
    await fs.mkdir(
      path.join(testDir, "reports", "empty-test", "checkpoints", "run-001"),
      { recursive: true }
    );

    const resumeResult = await execute({
      action: "resume",
      reportTitle: "empty-test",
      runId: "run-001",
    });

    expect(resumeResult.success).toBe(true);
    expect(resumeResult.found).toBe(false);
    expect(resumeResult.searchedCount).toBe(0);
  });

  test("resume works across multiple runs when runId not specified", async () => {
    // Create checkpoints in different runs with different timestamps
    const artifact = await createArtifact(
      "reports/multi-run-resume/data.csv",
      "col1,col2\n1,2"
    );

    await createManifestDirect("multi-run-resume", "run-001", "ckpt-001", {
      stageId: "S01_load_data",
      createdAt: "2026-01-01T10:00:00Z",
      artifacts: [artifact],
    });

    await createManifestDirect("multi-run-resume", "run-002", "ckpt-001", {
      stageId: "S03_train_model",
      createdAt: "2026-01-01T14:00:00Z", // Latest across all runs
      artifacts: [artifact],
    });

    // Resume without specifying runId
    const resumeResult = await execute({
      action: "resume",
      reportTitle: "multi-run-resume",
    });

    expect(resumeResult.success).toBe(true);
    expect(resumeResult.found).toBe(true);

    const checkpoint = resumeResult.checkpoint as any;
    // Should return the most recent checkpoint across ALL runs
    expect(checkpoint.runId).toBe("run-002");
    expect(checkpoint.stageId).toBe("S03_train_model");
  });

  test("resume with random seed restoration generates correct code", async () => {
    // Create checkpoint with random seeds
    await createManifestDirect("random-seed-test", "run-001", "ckpt-seeds", {
      stageId: "S02_eda_analysis",
      createdAt: "2026-01-01T12:00:00Z",
      artifacts: [],
      randomSeeds: { random: 42, numpy: 123 },
      rehydrationCellSource: [
        "# Rehydration cell - auto-generated by checkpoint-manager",
        "# Load artifacts from checkpoint",
        "",
        "import random",
        "import numpy as np",
        "",
        "# Restore random seeds for reproducibility",
        "random.seed(42)",
        "np.random.seed(123)",
        "",
        'print("[REHYDRATED:from=ckpt-seeds]")',
      ],
    });

    const resumeResult = await execute({
      action: "resume",
      reportTitle: "random-seed-test",
      runId: "run-001",
    });

    expect(resumeResult.success).toBe(true);
    expect(resumeResult.found).toBe(true);

    const rehydrationCells = resumeResult.rehydrationCells as string[];
    const rehydrationCode = rehydrationCells.join("\n");

    // Verify random seed restoration
    expect(rehydrationCode).toContain("import random");
    expect(rehydrationCode).toContain("import numpy as np");
    expect(rehydrationCode).toContain("random.seed(42)");
    expect(rehydrationCode).toContain("np.random.seed(123)");
  });

  test("emergency checkpoint can be resumed from", async () => {
    // Create an emergency checkpoint (simulating watchdog timeout)
    const emergencyResult = await execute({
      action: "emergency",
      reportTitle: "emergency-resume-test",
      runId: "run-001",
      stageId: "S02_eda_analysis",
      reason: "timeout",
    });

    expect(emergencyResult.success).toBe(true);
    expect(emergencyResult.status).toBe("interrupted");

    // Resume should find the emergency checkpoint
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
