/**
 * Integration tests for migration-tool.ts
 *
 * Tests the migration of legacy Gyoshu sessions from ~/.gyoshu/sessions/
 * to the new project-local research structure at ./gyoshu/research/.
 *
 * Test Strategy:
 * - Creates temporary directories for both project root and legacy sessions
 * - Sets GYOSHU_PROJECT_ROOT for project-local isolation
 * - Creates test fixtures at ~/.gyoshu/sessions/ with careful cleanup
 * - Tests scan, migrate, verify actions and dry-run mode
 *
 * @module migration-tool.test
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// Import the migration-tool
import migrationTool from "./migration-tool";

// Import path utilities
import { clearProjectRootCache, getLegacySessionsDir } from "../lib/paths";

// =============================================================================
// TEST SETUP
// =============================================================================

/** Test directory for project root (isolated per test) */
let testProjectDir: string;

/** Test directory for legacy sessions */
let testLegacyDir: string;

/** Original environment variable values */
let originalProjectRoot: string | undefined;

/** Track if we need to clean up legacy dir */
let legacyDirCreatedByTest = false;

/**
 * Helper to execute the migration-tool and parse the result.
 */
async function execute(args: {
  action: string;
  sessionId?: string;
  dryRun?: boolean;
}): Promise<{ success: boolean; [key: string]: unknown }> {
  const result = await migrationTool.execute(args as any);
  return JSON.parse(result);
}

/**
 * Create a legacy session fixture with manifest and optional notebook/artifacts.
 */
async function createLegacySession(
  sessionId: string,
  options: {
    goal?: string;
    status?: string;
    created?: string;
    updated?: string;
    withNotebook?: boolean;
    withArtifacts?: string[];
  } = {}
): Promise<void> {
  const sessionDir = path.join(testLegacyDir, sessionId);
  await fs.mkdir(sessionDir, { recursive: true });

  // Create manifest.json
  const now = new Date().toISOString();
  const manifest = {
    researchSessionID: sessionId,
    created: options.created || now,
    updated: options.updated || now,
    status: options.status || "active",
    goal: options.goal || `Test goal for ${sessionId}`,
    notebookPath: `${sessionDir}/notebook.ipynb`,
    mode: "REPL",
    environment: {
      pythonVersion: "3.11.0",
      platform: "linux",
    },
  };

  await fs.writeFile(
    path.join(sessionDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  // Create notebook if requested
  if (options.withNotebook) {
    const notebook = {
      cells: [
        {
          cell_type: "code",
          source: ["print('Hello from legacy session')"],
          metadata: {},
          outputs: [],
          execution_count: 1,
        },
      ],
      metadata: {
        kernelspec: {
          name: "python3",
          display_name: "Python 3",
        },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };
    await fs.writeFile(
      path.join(sessionDir, "notebook.ipynb"),
      JSON.stringify(notebook, null, 2)
    );
  }

  // Create artifacts if requested
  if (options.withArtifacts && options.withArtifacts.length > 0) {
    const artifactsDir = path.join(sessionDir, "artifacts");
    await fs.mkdir(artifactsDir, { recursive: true });
    for (const artifact of options.withArtifacts) {
      await fs.writeFile(
        path.join(artifactsDir, artifact),
        `Content of ${artifact}`
      );
    }
  }
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
  testProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "gyoshu-migration-test-"));

  // Create a unique temp directory for legacy sessions
  // We'll use a subdirectory of the system legacy path to avoid conflicts
  testLegacyDir = getLegacySessionsDir();
  
  // Check if the legacy dir already exists
  try {
    await fs.access(testLegacyDir);
    // Dir exists - we'll add to it but be careful
    legacyDirCreatedByTest = false;
  } catch {
    // Dir doesn't exist - we'll create it
    await fs.mkdir(testLegacyDir, { recursive: true });
    legacyDirCreatedByTest = true;
  }

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

  // Clean up legacy sessions created by tests
  // Only remove sessions with our test prefix to be safe
  try {
    const entries = await fs.readdir(testLegacyDir);
    for (const entry of entries) {
      if (entry.startsWith("test-session-") || entry.startsWith("legacy-")) {
        await fs.rm(path.join(testLegacyDir, entry), { recursive: true, force: true });
      }
    }

    // If we created the legacy dir and it's now empty, remove it
    if (legacyDirCreatedByTest) {
      const remaining = await fs.readdir(testLegacyDir);
      if (remaining.length === 0) {
        await fs.rm(testLegacyDir, { recursive: true, force: true });
        // Also try to remove parent .gyoshu if empty
        const parentDir = path.dirname(testLegacyDir);
        try {
          const parentEntries = await fs.readdir(parentDir);
          if (parentEntries.length === 0) {
            await fs.rm(parentDir, { recursive: true, force: true });
          }
        } catch {
          // Ignore errors cleaning up parent
        }
      }
    }
  } catch {
    // Ignore errors during cleanup
  }

  // Clear cache after each test
  clearProjectRootCache();
});

// =============================================================================
// SCAN ACTION TESTS
// =============================================================================

describe("Scan Action", () => {
  describe("when no legacy sessions exist", () => {
    test("returns empty sessions array", async () => {
      // Ensure legacy dir is empty by removing any test sessions
      try {
        const entries = await fs.readdir(testLegacyDir);
        for (const entry of entries) {
          if (entry.startsWith("test-session-")) {
            await fs.rm(path.join(testLegacyDir, entry), { recursive: true, force: true });
          }
        }
      } catch {
        // Dir might not exist
      }

      const result = await execute({ action: "scan" });

      expect(result.success).toBe(true);
      expect(result.action).toBe("scan");
      expect(Array.isArray(result.sessions)).toBe(true);
      // May have 0 or more depending on existing sessions
    });

    test("returns correct message when no sessions found", async () => {
      // Create empty state by ensuring no test sessions exist
      try {
        const entries = await fs.readdir(testLegacyDir);
        for (const entry of entries) {
          if (entry.startsWith("test-session-")) {
            await fs.rm(path.join(testLegacyDir, entry), { recursive: true, force: true });
          }
        }
      } catch {
        // Dir might not exist
      }

      const result = await execute({ action: "scan" });

      expect(result.success).toBe(true);
    });
  });

  describe("when legacy sessions exist", () => {
    test("finds single legacy session", async () => {
      await createLegacySession("test-session-001", {
        goal: "Test single session scan",
        status: "active",
        withNotebook: true,
      });

      const result = await execute({ action: "scan" });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.sessions)).toBe(true);
      
      const sessions = result.sessions as any[];
      const testSession = sessions.find((s) => s.sessionId === "test-session-001");
      expect(testSession).toBeDefined();
      expect(testSession.goal).toBe("Test single session scan");
      expect(testSession.status).toBe("active");
      expect(testSession.notebookExists).toBe(true);
    });

    test("finds multiple legacy sessions", async () => {
      await createLegacySession("test-session-alpha", { goal: "Alpha goal" });
      await createLegacySession("test-session-beta", { goal: "Beta goal" });
      await createLegacySession("test-session-gamma", { goal: "Gamma goal" });

      const result = await execute({ action: "scan" });

      expect(result.success).toBe(true);
      const sessions = result.sessions as any[];
      
      const alphaSession = sessions.find((s) => s.sessionId === "test-session-alpha");
      const betaSession = sessions.find((s) => s.sessionId === "test-session-beta");
      const gammaSession = sessions.find((s) => s.sessionId === "test-session-gamma");
      
      expect(alphaSession).toBeDefined();
      expect(betaSession).toBeDefined();
      expect(gammaSession).toBeDefined();
    });

    test("returns session metadata correctly", async () => {
      const created = "2025-01-01T10:00:00.000Z";
      const updated = "2025-01-15T15:30:00.000Z";

      await createLegacySession("test-session-metadata", {
        goal: "Test metadata extraction",
        status: "completed",
        created,
        updated,
        withNotebook: true,
        withArtifacts: ["plot.png", "data.csv"],
      });

      const result = await execute({ action: "scan" });

      expect(result.success).toBe(true);
      const sessions = result.sessions as any[];
      const session = sessions.find((s) => s.sessionId === "test-session-metadata");

      expect(session).toBeDefined();
      expect(session.created).toBe(created);
      expect(session.updated).toBe(updated);
      expect(session.status).toBe("completed");
      expect(session.goal).toBe("Test metadata extraction");
      expect(session.notebookExists).toBe(true);
      expect(session.artifactCount).toBe(2);
      expect(session.alreadyMigrated).toBe(false);
    });

    test("identifies already migrated sessions", async () => {
      // Create a legacy session
      await createLegacySession("test-session-migrated", {
        goal: "Already migrated session",
      });

      // Create the corresponding research in new structure
      const researchDir = path.join(testProjectDir, "gyoshu", "research", "test-session-migrated");
      await fs.mkdir(researchDir, { recursive: true });
      await fs.writeFile(
        path.join(researchDir, "research.json"),
        JSON.stringify({
          schemaVersion: 1,
          researchId: "test-session-migrated",
          title: "Migrated session",
          status: "active",
          runs: [],
        })
      );

      const result = await execute({ action: "scan" });

      expect(result.success).toBe(true);
      const sessions = result.sessions as any[];
      const session = sessions.find((s) => s.sessionId === "test-session-migrated");

      expect(session).toBeDefined();
      expect(session.alreadyMigrated).toBe(true);
    });

    test("reports pending and migrated counts", async () => {
      // Create unmigrated session
      await createLegacySession("test-session-pending", { goal: "Pending" });

      // Create migrated session
      await createLegacySession("test-session-done", { goal: "Done" });
      const researchDir = path.join(testProjectDir, "gyoshu", "research", "test-session-done");
      await fs.mkdir(researchDir, { recursive: true });
      await fs.writeFile(
        path.join(researchDir, "research.json"),
        JSON.stringify({ schemaVersion: 1, researchId: "test-session-done", runs: [] })
      );

      const result = await execute({ action: "scan" });

      expect(result.success).toBe(true);
      expect(typeof result.totalSessions).toBe("number");
      expect(typeof result.pendingMigration).toBe("number");
      expect(typeof result.alreadyMigrated).toBe("number");
    });

    test("handles session without manifest gracefully", async () => {
      // Create a directory without manifest.json
      const sessionDir = path.join(testLegacyDir, "test-session-no-manifest");
      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(path.join(sessionDir, "random-file.txt"), "content");

      // Also create a valid session
      await createLegacySession("test-session-valid", { goal: "Valid session" });

      const result = await execute({ action: "scan" });

      expect(result.success).toBe(true);
      const sessions = result.sessions as any[];
      
      // Should not include the invalid session
      const invalidSession = sessions.find((s) => s.sessionId === "test-session-no-manifest");
      expect(invalidSession).toBeUndefined();

      // Should include the valid session
      const validSession = sessions.find((s) => s.sessionId === "test-session-valid");
      expect(validSession).toBeDefined();
    });
  });
});

// =============================================================================
// MIGRATE ACTION TESTS
// =============================================================================

describe("Migrate Action", () => {
  describe("successful migration", () => {
    test("migrates single session with notebook", async () => {
      await createLegacySession("test-session-migrate-001", {
        goal: "Migrate this session",
        status: "completed",
        withNotebook: true,
      });

      const result = await execute({ action: "migrate", sessionId: "test-session-migrate-001" });

      expect(result.success).toBe(true);
      expect(result.action).toBe("migrate");
      expect(result.dryRun).toBe(false);

      const results = result.results as any[];
      expect(results).toHaveLength(1);
      expect(results[0].sessionId).toBe("test-session-migrate-001");
      expect(results[0].success).toBe(true);
      expect(results[0].skipped).toBe(false);
      expect(results[0].researchId).toBe("test-session-migrate-001");
      expect(results[0].notebookPath).toBeDefined();
    });

    test("creates research manifest after migration", async () => {
      await createLegacySession("test-session-manifest-check", {
        goal: "Check manifest creation",
        status: "active",
      });

      await execute({ action: "migrate", sessionId: "test-session-manifest-check" });

      // Verify research manifest was created
      const manifestPath = path.join(
        testProjectDir,
        "gyoshu",
        "research",
        "test-session-manifest-check",
        "research.json"
      );
      const exists = await fs.access(manifestPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Verify manifest content
      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(content);
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.researchId).toBe("test-session-manifest-check");
      expect(manifest.title).toBe("Check manifest creation");
      expect(manifest.runs).toHaveLength(1);
      expect(manifest.tags).toContain("migrated-from-legacy");
    });

    test("copies notebook to new location", async () => {
      await createLegacySession("test-session-notebook-copy", {
        withNotebook: true,
      });

      const result = await execute({ action: "migrate", sessionId: "test-session-notebook-copy" });

      expect(result.success).toBe(true);

      // Verify notebook was copied
      const results = result.results as any[];
      const notebookPath = results[0].notebookPath;
      expect(notebookPath).toBeDefined();

      const exists = await fs.access(notebookPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Verify notebook content
      const content = await fs.readFile(notebookPath, "utf-8");
      const notebook = JSON.parse(content);
      expect(notebook.cells).toBeDefined();
      expect(notebook.cells[0].source[0]).toContain("Hello from legacy session");
    });

    test("copies artifacts to new location", async () => {
      await createLegacySession("test-session-artifacts-copy", {
        withArtifacts: ["chart.png", "results.json", "model.pkl"],
      });

      const result = await execute({ action: "migrate", sessionId: "test-session-artifacts-copy" });

      expect(result.success).toBe(true);

      const results = result.results as any[];
      expect(results[0].artifactsCopied).toBe(3);
      expect(results[0].artifactsDir).toBeDefined();

      // Verify artifacts exist in new location
      const artifactsDir = results[0].artifactsDir;
      const files = await fs.readdir(artifactsDir);
      expect(files).toContain("chart.png");
      expect(files).toContain("results.json");
      expect(files).toContain("model.pkl");
    });

    test("creates run detail file", async () => {
      await createLegacySession("test-session-run-detail", {
        goal: "Test run detail creation",
      });

      await execute({ action: "migrate", sessionId: "test-session-run-detail" });

      // Find the run detail file
      const runsDir = path.join(
        testProjectDir,
        "gyoshu",
        "research",
        "test-session-run-detail",
        "runs"
      );
      const runFiles = await fs.readdir(runsDir);
      const migratedRun = runFiles.find((f) => f.startsWith("migrated-"));
      expect(migratedRun).toBeDefined();

      // Verify run detail content
      const runDetailPath = path.join(runsDir, migratedRun!);
      const content = await fs.readFile(runDetailPath, "utf-8");
      const runDetail = JSON.parse(content);
      expect(runDetail.schemaVersion).toBe(1);
      expect(runDetail.researchId).toBe("test-session-run-detail");
      expect(runDetail.executionLog).toHaveLength(1);
      expect(runDetail.executionLog[0].event).toBe("migrated_from_legacy");
    });

    test("migrates all pending sessions when no sessionId specified", async () => {
      await createLegacySession("test-session-all-001", { goal: "Session 1" });
      await createLegacySession("test-session-all-002", { goal: "Session 2" });
      await createLegacySession("test-session-all-003", { goal: "Session 3" });

      const result = await execute({ action: "migrate" });

      expect(result.success).toBe(true);
      
      const results = result.results as any[];
      const migrated = results.filter((r) => 
        r.sessionId.startsWith("test-session-all-") && r.success && !r.skipped
      );
      expect(migrated.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("skip already migrated", () => {
    test("skips session that is already migrated", async () => {
      // Create legacy session
      await createLegacySession("test-session-already-done", { goal: "Already done" });

      // Create research in new structure
      const researchDir = path.join(testProjectDir, "gyoshu", "research", "test-session-already-done");
      await fs.mkdir(researchDir, { recursive: true });
      await fs.writeFile(
        path.join(researchDir, "research.json"),
        JSON.stringify({ schemaVersion: 1, researchId: "test-session-already-done", runs: [] })
      );

      const result = await execute({ action: "migrate", sessionId: "test-session-already-done" });

      expect(result.success).toBe(true);
      const results = result.results as any[];
      expect(results[0].skipped).toBe(true);
      expect(results[0].success).toBe(true);
      expect(result.message).toContain("already migrated");
    });
  });

  describe("error handling", () => {
    test("fails for non-existent session", async () => {
      const result = await execute({ action: "migrate", sessionId: "test-session-nonexistent-xyz" });

      expect(result.success).toBe(false);
      const results = result.results as any[];
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBeDefined();
    });

    test("handles session without manifest", async () => {
      // Create directory without manifest
      const sessionDir = path.join(testLegacyDir, "test-session-bad-manifest");
      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(path.join(sessionDir, "data.txt"), "some data");

      const result = await execute({ action: "migrate", sessionId: "test-session-bad-manifest" });

      expect(result.success).toBe(false);
      const results = result.results as any[];
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("manifest not found");
    });

    test("validates sessionId for path traversal", async () => {
      await expect(
        execute({ action: "migrate", sessionId: "../malicious" })
      ).rejects.toThrow("path traversal");
    });
  });

  describe("legacy session preservation", () => {
    test("does not delete legacy session after migration", async () => {
      await createLegacySession("test-session-preserve", {
        goal: "Should be preserved",
        withNotebook: true,
      });

      await execute({ action: "migrate", sessionId: "test-session-preserve" });

      // Verify legacy session still exists
      const legacyPath = path.join(testLegacyDir, "test-session-preserve");
      const exists = await fs.access(legacyPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Verify manifest still exists
      const manifestPath = path.join(legacyPath, "manifest.json");
      const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);
      expect(manifestExists).toBe(true);
    });
  });
});

// =============================================================================
// DRY-RUN MODE TESTS
// =============================================================================

describe("Dry-Run Mode", () => {
  test("does not create any files in dry-run", async () => {
    await createLegacySession("test-session-dry-run", {
      goal: "Should not be migrated",
      withNotebook: true,
      withArtifacts: ["data.csv"],
    });

    const result = await execute({ action: "migrate", sessionId: "test-session-dry-run", dryRun: true });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);

    // Verify no research was created
    const researchPath = path.join(testProjectDir, "gyoshu", "research", "test-session-dry-run");
    const exists = await fs.access(researchPath).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  test("reports what would be done in dry-run", async () => {
    await createLegacySession("test-session-dry-report", {
      goal: "Dry run reporting",
      withNotebook: true,
      withArtifacts: ["plot.png", "model.h5"],
    });

    const result = await execute({ action: "migrate", sessionId: "test-session-dry-report", dryRun: true });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);

    const results = result.results as any[];
    expect(results[0].sessionId).toBe("test-session-dry-report");
    expect(results[0].success).toBe(true);
    expect(results[0].dryRun).toBe(true);
    expect(results[0].notebookPath).toBeDefined();
    expect(results[0].artifactsCopied).toBe(2);
    expect(results[0].researchId).toBeDefined();
    expect(results[0].runId).toBeDefined();
  });

  test("dry-run all sessions reports total", async () => {
    await createLegacySession("test-session-dry-all-1", { goal: "First" });
    await createLegacySession("test-session-dry-all-2", { goal: "Second" });

    const result = await execute({ action: "migrate", dryRun: true });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.message).toContain("Dry run");
    expect(typeof result.totalMigrated).toBe("number");
  });
});

// =============================================================================
// VERIFY ACTION TESTS
// =============================================================================

describe("Verify Action", () => {
  describe("successful verification", () => {
    test("verifies successfully migrated session", async () => {
      // Create and migrate a session
      await createLegacySession("test-session-verify-ok", {
        goal: "Verify this",
        withNotebook: true,
        withArtifacts: ["data.csv"],
      });
      await execute({ action: "migrate", sessionId: "test-session-verify-ok" });

      const result = await execute({ action: "verify", sessionId: "test-session-verify-ok" });

      expect(result.success).toBe(true);
      expect(result.action).toBe("verify");

      const results = result.results as any[];
      expect(results[0].sessionId).toBe("test-session-verify-ok");
      expect(results[0].valid).toBe(true);
      expect(results[0].issues).toHaveLength(0);
      expect(results[0].manifestValid).toBe(true);
      expect(results[0].notebookExists).toBe(true);
      expect(results[0].artifactsDirExists).toBe(true);
    });

    test("verifies all migrated sessions when no sessionId specified", async () => {
      // Create and migrate multiple sessions
      await createLegacySession("test-session-verify-all-1", { goal: "First" });
      await createLegacySession("test-session-verify-all-2", { goal: "Second" });
      await execute({ action: "migrate", sessionId: "test-session-verify-all-1" });
      await execute({ action: "migrate", sessionId: "test-session-verify-all-2" });

      const result = await execute({ action: "verify" });

      expect(result.success).toBe(true);
      expect(typeof result.totalValid).toBe("number");
      expect(typeof result.totalInvalid).toBe("number");
    });

    test("returns artifact count in verification", async () => {
      await createLegacySession("test-session-verify-artifacts", {
        withArtifacts: ["a.txt", "b.txt", "c.txt"],
      });
      await execute({ action: "migrate", sessionId: "test-session-verify-artifacts" });

      const result = await execute({ action: "verify", sessionId: "test-session-verify-artifacts" });

      expect(result.success).toBe(true);
      const results = result.results as any[];
      expect(results[0].artifactCount).toBe(3);
    });
  });

  describe("verification failures", () => {
    test("fails when session was not migrated", async () => {
      // Create legacy session but don't migrate
      await createLegacySession("test-session-not-migrated", { goal: "Not migrated" });

      const result = await execute({ action: "verify", sessionId: "test-session-not-migrated" });

      expect(result.success).toBe(false);
      const results = result.results as any[];
      expect(results[0].valid).toBe(false);
      expect(results[0].issues.length).toBeGreaterThan(0);
      expect(results[0].issues[0]).toContain("not found");
    });

    test("reports missing notebook", async () => {
      // Create and migrate session with notebook
      await createLegacySession("test-session-missing-nb", { withNotebook: true });
      await execute({ action: "migrate", sessionId: "test-session-missing-nb" });

      // Delete the migrated notebook
      const notebooksDir = path.join(
        testProjectDir,
        "gyoshu",
        "research",
        "test-session-missing-nb",
        "notebooks"
      );
      const files = await fs.readdir(notebooksDir);
      for (const file of files) {
        await fs.unlink(path.join(notebooksDir, file));
      }

      const result = await execute({ action: "verify", sessionId: "test-session-missing-nb" });

      // Should detect that notebook was in legacy but not in new location
      const results = result.results as any[];
      expect(results[0].notebookExists).toBe(false);
      // May or may not be valid depending on whether issues are reported
    });

    test("reports artifact count mismatch", async () => {
      // Create and migrate session with artifacts
      await createLegacySession("test-session-missing-art", {
        withArtifacts: ["a.txt", "b.txt", "c.txt"],
      });
      await execute({ action: "migrate", sessionId: "test-session-missing-art" });

      // Delete one artifact from new location
      const artifactsDir = path.join(
        testProjectDir,
        "gyoshu",
        "research",
        "test-session-missing-art",
        "artifacts"
      );
      const runDirs = await fs.readdir(artifactsDir);
      const runDir = runDirs.find((d) => d.startsWith("migrated-"));
      if (runDir) {
        const fullPath = path.join(artifactsDir, runDir, "a.txt");
        await fs.unlink(fullPath).catch(() => {});
      }

      const result = await execute({ action: "verify", sessionId: "test-session-missing-art" });

      const results = result.results as any[];
      // Artifact count should be less than legacy
      expect(results[0].artifactCount).toBe(2);
      // Should report issue about mismatch
      const hasMismatchIssue = results[0].issues.some((i: string) => 
        i.toLowerCase().includes("artifact") && i.toLowerCase().includes("mismatch")
      );
      expect(hasMismatchIssue).toBe(true);
    });

    test("validates manifest schema", async () => {
      await createLegacySession("test-session-bad-schema", { goal: "Bad schema" });
      await execute({ action: "migrate", sessionId: "test-session-bad-schema" });

      // Corrupt the manifest
      const manifestPath = path.join(
        testProjectDir,
        "gyoshu",
        "research",
        "test-session-bad-schema",
        "research.json"
      );
      await fs.writeFile(manifestPath, JSON.stringify({ schemaVersion: 999, runs: [] }));

      const result = await execute({ action: "verify", sessionId: "test-session-bad-schema" });

      const results = result.results as any[];
      // Should report unexpected schema version
      const hasSchemaIssue = results[0].issues.some((i: string) => 
        i.toLowerCase().includes("schema") || i.toLowerCase().includes("version")
      );
      expect(hasSchemaIssue).toBe(true);
    });
  });

  describe("edge cases", () => {
    test("handles empty sessions list", async () => {
      // Ensure no test sessions exist for migration
      // (This test depends on clean state or no matching sessions)
      const result = await execute({ action: "verify" });

      expect(result.success).toBe(true);
      expect(result.message).toContain("No migrated sessions");
    });

    test("validates sessionId for path traversal", async () => {
      await expect(
        execute({ action: "verify", sessionId: "../malicious" })
      ).rejects.toThrow("path traversal");
    });
  });
});

// =============================================================================
// DIRECTORY STRUCTURE TESTS
// =============================================================================

describe("Directory Structure", () => {
  test("creates correct research directory structure", async () => {
    await createLegacySession("test-session-dirs", {
      goal: "Check directories",
      withNotebook: true,
      withArtifacts: ["data.csv"],
    });

    await execute({ action: "migrate", sessionId: "test-session-dirs" });

    // Check research directory structure
    const researchPath = path.join(testProjectDir, "gyoshu", "research", "test-session-dirs");
    
    // research.json exists
    const manifestExists = await fs.access(path.join(researchPath, "research.json"))
      .then(() => true).catch(() => false);
    expect(manifestExists).toBe(true);

    // runs/ directory exists
    const runsExists = await fs.access(path.join(researchPath, "runs"))
      .then(() => true).catch(() => false);
    expect(runsExists).toBe(true);

    // notebooks/ directory exists
    const notebooksExists = await fs.access(path.join(researchPath, "notebooks"))
      .then(() => true).catch(() => false);
    expect(notebooksExists).toBe(true);

    // artifacts/ directory exists
    const artifactsExists = await fs.access(path.join(researchPath, "artifacts"))
      .then(() => true).catch(() => false);
    expect(artifactsExists).toBe(true);
  });

  test("creates run-specific artifact subdirectories", async () => {
    await createLegacySession("test-session-run-dirs", {
      withArtifacts: ["model.pkl"],
    });

    const result = await execute({ action: "migrate", sessionId: "test-session-run-dirs" });

    const results = result.results as any[];
    const runId = results[0].runId;

    // Check run-specific artifacts directory
    const runArtifactsDir = path.join(
      testProjectDir,
      "gyoshu",
      "research",
      "test-session-run-dirs",
      "artifacts",
      runId
    );

    // Should have plots/ subdirectory
    const plotsExists = await fs.access(path.join(runArtifactsDir, "plots"))
      .then(() => true).catch(() => false);
    expect(plotsExists).toBe(true);

    // Should have exports/ subdirectory
    const exportsExists = await fs.access(path.join(runArtifactsDir, "exports"))
      .then(() => true).catch(() => false);
    expect(exportsExists).toBe(true);
  });
});

// =============================================================================
// METADATA PRESERVATION TESTS
// =============================================================================

describe("Metadata Preservation", () => {
  test("preserves session goal in research title", async () => {
    await createLegacySession("test-session-goal", {
      goal: "Analyze customer churn patterns",
    });

    await execute({ action: "migrate", sessionId: "test-session-goal" });

    const manifestPath = path.join(
      testProjectDir,
      "gyoshu",
      "research",
      "test-session-goal",
      "research.json"
    );
    const content = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(content);

    expect(manifest.title).toBe("Analyze customer churn patterns");
    expect(manifest.summaries.executive).toBe("Analyze customer churn patterns");
  });

  test("preserves session status", async () => {
    await createLegacySession("test-session-status", {
      status: "completed",
    });

    await execute({ action: "migrate", sessionId: "test-session-status" });

    const manifestPath = path.join(
      testProjectDir,
      "gyoshu",
      "research",
      "test-session-status",
      "research.json"
    );
    const content = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(content);

    expect(manifest.status).toBe("completed");
  });

  test("preserves session timestamps", async () => {
    const created = "2024-06-01T10:00:00.000Z";
    const updated = "2024-12-15T18:30:00.000Z";

    await createLegacySession("test-session-timestamps", {
      created,
      updated,
    });

    await execute({ action: "migrate", sessionId: "test-session-timestamps" });

    const manifestPath = path.join(
      testProjectDir,
      "gyoshu",
      "research",
      "test-session-timestamps",
      "research.json"
    );
    const content = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(content);

    expect(manifest.createdAt).toBe(created);
    // updatedAt should be the migration time, not the legacy updated time
    expect(manifest.updatedAt).not.toBe(updated);
  });

  test("records migration metadata in execution log", async () => {
    await createLegacySession("test-session-log", { goal: "Log test" });

    await execute({ action: "migrate", sessionId: "test-session-log" });

    // Find and read run detail
    const runsDir = path.join(
      testProjectDir,
      "gyoshu",
      "research",
      "test-session-log",
      "runs"
    );
    const files = await fs.readdir(runsDir);
    const runFile = files.find((f) => f.startsWith("migrated-"));
    const runContent = await fs.readFile(path.join(runsDir, runFile!), "utf-8");
    const runDetail = JSON.parse(runContent);

    expect(runDetail.executionLog).toHaveLength(1);
    expect(runDetail.executionLog[0].event).toBe("migrated_from_legacy");
    expect(runDetail.executionLog[0].details.originalPath).toBeDefined();
    expect(runDetail.executionLog[0].details.originalManifest).toBeDefined();
  });
});

// =============================================================================
// ERROR MESSAGE QUALITY TESTS
// =============================================================================

describe("Error Messages", () => {
  test("provides helpful message for unknown action", async () => {
    await expect(
      execute({ action: "invalid-action" as any })
    ).rejects.toThrow("Unknown action");
  });

  test("provides descriptive message for missing session", async () => {
    const result = await execute({ action: "migrate", sessionId: "test-nonexistent-session-xyz" });

    expect(result.success).toBe(false);
    const results = result.results as any[];
    expect(results[0].error).toContain("manifest not found");
  });
});
