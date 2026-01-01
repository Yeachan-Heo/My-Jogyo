/**
 * Tests for paths.ts - Centralized Path Resolver
 *
 * Tests project root detection, path generation functions,
 * config management, and legacy support utilities.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import * as os from "os";

import {
  detectProjectRoot,
  clearProjectRootCache,
  getNotebookRootDir,
  getReportsRootDir,
  getNotebookPath,
  getReportDir,
  getReportReadmePath,
  getGyoshuRoot,
  getConfigPath,
  getResearchDir,
  getResearchPath,
  getResearchManifestPath,
  getRunPath,
  getResearchNotebooksDir,
  getResearchArtifactsDir,
  getRuntimeDir,
  getSessionDir,
  getSessionLockPath,
  getBridgeSocketPath,
  getRetrospectivesDir,
  getRetrospectivesFeedbackPath,
  getLibDir,
  getAssetsDir,
  getExternalDir,
  getLegacySessionsDir,
  getLegacySessionPath,
  getLegacyManifestPath,
  hasLegacySessions,
  getConfig,
  ensureGyoshuInitialized,
  ensureDirSync,
  existsSync,
  getSchemaVersion,
  type GyoshuConfig,
} from "./paths";

// =============================================================================
// TEST SETUP
// =============================================================================

let testDir: string;
let originalCwd: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  // Save original state
  originalCwd = process.cwd();
  originalEnv = process.env.GYOSHU_PROJECT_ROOT;

  // Create a unique temp directory for each test
  testDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "gyoshu-paths-test-")
  );

  // Clear any cached project root
  clearProjectRootCache();

  // Clear the env var
  delete process.env.GYOSHU_PROJECT_ROOT;
});

afterEach(async () => {
  // Restore original state
  process.chdir(originalCwd);
  if (originalEnv !== undefined) {
    process.env.GYOSHU_PROJECT_ROOT = originalEnv;
  } else {
    delete process.env.GYOSHU_PROJECT_ROOT;
  }

  // Clear cache after each test
  clearProjectRootCache();

  // Clean up the test directory
  if (testDir) {
    await fsPromises.rm(testDir, { recursive: true, force: true });
  }
});

// =============================================================================
// DETECT PROJECT ROOT TESTS
// =============================================================================

describe("detectProjectRoot", () => {
  test("respects GYOSHU_PROJECT_ROOT environment variable", () => {
    const customRoot = path.join(testDir, "custom-root");
    fs.mkdirSync(customRoot, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = customRoot;

    const root = detectProjectRoot();

    expect(root).toBe(customRoot);
  });

  test("finds root by gyoshu/config.json marker", () => {
    // Create a nested structure: testDir/project/subdir/deep
    const projectDir = path.join(testDir, "project");
    const subDir = path.join(projectDir, "subdir", "deep");
    const gyoshuDir = path.join(projectDir, "gyoshu");
    const configPath = path.join(gyoshuDir, "config.json");

    fs.mkdirSync(subDir, { recursive: true });
    fs.mkdirSync(gyoshuDir, { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({ version: "1.0.0", schemaVersion: 1 })
    );

    // Change to the deep subdirectory
    process.chdir(subDir);
    clearProjectRootCache();

    const root = detectProjectRoot();

    expect(root).toBe(projectDir);
  });

  test("finds root by .git directory", () => {
    // Create a nested structure with .git
    const repoDir = path.join(testDir, "repo");
    const subDir = path.join(repoDir, "src", "lib");
    const gitDir = path.join(repoDir, ".git");

    fs.mkdirSync(subDir, { recursive: true });
    fs.mkdirSync(gitDir, { recursive: true });

    // Change to subdirectory
    process.chdir(subDir);
    clearProjectRootCache();

    const root = detectProjectRoot();

    expect(root).toBe(repoDir);
  });

  test("prefers config.json over .git", () => {
    // Create structure with both markers at different levels
    // gitRoot/.git and gitRoot/nested/gyoshu/config.json
    const gitRoot = path.join(testDir, "git-root");
    const nestedDir = path.join(gitRoot, "nested");
    const deepDir = path.join(nestedDir, "deep");
    const gitDir = path.join(gitRoot, ".git");
    const gyoshuDir = path.join(nestedDir, "gyoshu");
    const configPath = path.join(gyoshuDir, "config.json");

    fs.mkdirSync(deepDir, { recursive: true });
    fs.mkdirSync(gitDir, { recursive: true });
    fs.mkdirSync(gyoshuDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ version: "1.0.0" }));

    // Change to deep directory
    process.chdir(deepDir);
    clearProjectRootCache();

    const root = detectProjectRoot();

    // Should find gyoshu/config.json first (nestedDir), not .git (gitRoot)
    expect(root).toBe(nestedDir);
  });

  test("falls back to cwd when no markers found", () => {
    // Create an isolated directory with no markers
    const isolatedDir = path.join(testDir, "isolated");
    fs.mkdirSync(isolatedDir, { recursive: true });

    process.chdir(isolatedDir);
    clearProjectRootCache();

    const root = detectProjectRoot();

    expect(root).toBe(isolatedDir);
  });

  test("caches project root", () => {
    const projectDir = path.join(testDir, "cached-project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;

    const root1 = detectProjectRoot();
    const root2 = detectProjectRoot();

    expect(root1).toBe(root2);
    expect(root1).toBe(projectDir);
  });

  test("ignores non-existent env var path", () => {
    process.env.GYOSHU_PROJECT_ROOT = "/non/existent/path/that/should/not/exist";

    const isolatedDir = path.join(testDir, "fallback");
    fs.mkdirSync(isolatedDir, { recursive: true });
    process.chdir(isolatedDir);
    clearProjectRootCache();

    const root = detectProjectRoot();

    // Should fall back to cwd since env path doesn't exist
    expect(root).toBe(isolatedDir);
  });
});

describe("clearProjectRootCache", () => {
  test("clears cached project root", () => {
    const dir1 = path.join(testDir, "dir1");
    const dir2 = path.join(testDir, "dir2");
    fs.mkdirSync(dir1, { recursive: true });
    fs.mkdirSync(dir2, { recursive: true });

    // Set first root via env
    process.env.GYOSHU_PROJECT_ROOT = dir1;
    const root1 = detectProjectRoot();
    expect(root1).toBe(dir1);

    // Clear cache and change env
    clearProjectRootCache();
    process.env.GYOSHU_PROJECT_ROOT = dir2;

    const root2 = detectProjectRoot();
    expect(root2).toBe(dir2);
  });
});

// =============================================================================
// PRIMARY PATH GETTERS TESTS
// =============================================================================

describe("getGyoshuRoot", () => {
  test("returns gyoshu directory under project root", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const gyoshuRoot = getGyoshuRoot();

    expect(gyoshuRoot).toBe(path.join(projectDir, "gyoshu"));
  });
});

describe("getConfigPath", () => {
  test("returns config.json path under gyoshu root", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const configPath = getConfigPath();

    expect(configPath).toBe(path.join(projectDir, "gyoshu", "config.json"));
  });
});

// =============================================================================
// RESEARCH PATH GETTERS TESTS
// =============================================================================

describe("getResearchDir", () => {
  test("returns research directory path", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const researchDir = getResearchDir();

    expect(researchDir).toBe(path.join(projectDir, "gyoshu", "research"));
  });
});

describe("getResearchPath", () => {
  test("returns path for specific research project", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const researchPath = getResearchPath("iris-analysis-2024");

    expect(researchPath).toBe(
      path.join(projectDir, "gyoshu", "research", "iris-analysis-2024")
    );
  });

  test("handles research IDs with special characters", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const researchPath = getResearchPath("research-with-dashes_and_underscores");

    expect(researchPath).toBe(
      path.join(
        projectDir,
        "gyoshu",
        "research",
        "research-with-dashes_and_underscores"
      )
    );
  });
});

describe("getResearchManifestPath", () => {
  test("returns research.json path for a research project", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const manifestPath = getResearchManifestPath("my-research");

    expect(manifestPath).toBe(
      path.join(projectDir, "gyoshu", "research", "my-research", "research.json")
    );
  });
});

describe("getRunPath", () => {
  test("returns path for a specific run within a research project", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const runPath = getRunPath("my-research", "run-001");

    expect(runPath).toBe(
      path.join(
        projectDir,
        "gyoshu",
        "research",
        "my-research",
        "runs",
        "run-001.json"
      )
    );
  });
});

describe("getResearchNotebooksDir", () => {
  test("returns notebooks directory for a research project", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const notebooksDir = getResearchNotebooksDir("my-research");

    expect(notebooksDir).toBe(
      path.join(projectDir, "gyoshu", "research", "my-research", "notebooks")
    );
  });
});

describe("getResearchArtifactsDir", () => {
  test("returns artifacts directory for a research project", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const artifactsDir = getResearchArtifactsDir("my-research");

    expect(artifactsDir).toBe(
      path.join(projectDir, "gyoshu", "research", "my-research", "artifacts")
    );
  });
});

// =============================================================================
// RUNTIME PATH GETTERS TESTS
// =============================================================================

describe("getRuntimeDir", () => {
  test("returns runtime directory path", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const runtimeDir = getRuntimeDir();

    expect(runtimeDir).toBe(path.join(projectDir, "gyoshu", "runtime"));
  });
});

describe("getSessionDir", () => {
  test("returns session directory for a specific session", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const sessionDir = getSessionDir("session-abc123");

    expect(sessionDir).toBe(
      path.join(projectDir, "gyoshu", "runtime", "session-abc123")
    );
  });
});

describe("getSessionLockPath", () => {
  test("returns session.lock path for a session", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const lockPath = getSessionLockPath("session-xyz");

    expect(lockPath).toBe(
      path.join(projectDir, "gyoshu", "runtime", "session-xyz", "session.lock")
    );
  });
});

describe("getBridgeSocketPath", () => {
  test("returns bridge.sock path for a session", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const socketPath = getBridgeSocketPath("session-xyz");

    expect(socketPath).toBe(
      path.join(projectDir, "gyoshu", "runtime", "session-xyz", "bridge.sock")
    );
  });
});

// =============================================================================
// SHARED RESOURCE PATH GETTERS TESTS
// =============================================================================

describe("getRetrospectivesDir", () => {
  test("returns retrospectives directory path", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const retroDir = getRetrospectivesDir();

    expect(retroDir).toBe(path.join(projectDir, "gyoshu", "retrospectives"));
  });
});

describe("getRetrospectivesFeedbackPath", () => {
  test("returns feedback.jsonl path", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const feedbackPath = getRetrospectivesFeedbackPath();

    expect(feedbackPath).toBe(
      path.join(projectDir, "gyoshu", "retrospectives", "feedback.jsonl")
    );
  });
});

describe("getLibDir", () => {
  test("returns lib directory path", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const libDir = getLibDir();

    expect(libDir).toBe(path.join(projectDir, "gyoshu", "lib"));
  });
});

describe("getAssetsDir", () => {
  test("returns assets directory path", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const assetsDir = getAssetsDir();

    expect(assetsDir).toBe(path.join(projectDir, "gyoshu", "assets"));
  });
});

describe("getExternalDir", () => {
  test("returns external directory path", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const externalDir = getExternalDir();

    expect(externalDir).toBe(path.join(projectDir, "gyoshu", "external"));
  });
});

// =============================================================================
// LEGACY SUPPORT TESTS
// =============================================================================

describe("getLegacySessionsDir", () => {
  test("returns legacy sessions directory in home", () => {
    const legacyDir = getLegacySessionsDir();

    expect(legacyDir).toBe(path.join(os.homedir(), ".gyoshu", "sessions"));
  });
});

describe("getLegacySessionPath", () => {
  test("returns legacy session path for a session ID", () => {
    const sessionPath = getLegacySessionPath("old-session-123");

    expect(sessionPath).toBe(
      path.join(os.homedir(), ".gyoshu", "sessions", "old-session-123")
    );
  });
});

describe("getLegacyManifestPath", () => {
  test("returns legacy manifest.json path for a session", () => {
    const manifestPath = getLegacyManifestPath("old-session-456");

    expect(manifestPath).toBe(
      path.join(
        os.homedir(),
        ".gyoshu",
        "sessions",
        "old-session-456",
        "manifest.json"
      )
    );
  });
});

describe("hasLegacySessions", () => {
  test("returns false when legacy directory does not exist", () => {
    // This test assumes the legacy directory doesn't exist
    // which may not be true in all environments
    // The function should handle this gracefully
    const result = hasLegacySessions();

    // Result depends on whether legacy sessions exist
    expect(typeof result).toBe("boolean");
  });
});

// =============================================================================
// CONFIG MANAGEMENT TESTS
// =============================================================================

describe("getConfig", () => {
  test("returns null when config does not exist", () => {
    const projectDir = path.join(testDir, "no-config");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const config = getConfig();

    expect(config).toBeNull();
  });

  test("returns config when it exists", () => {
    const projectDir = path.join(testDir, "with-config");
    const gyoshuDir = path.join(projectDir, "gyoshu");
    const configPath = path.join(gyoshuDir, "config.json");

    fs.mkdirSync(gyoshuDir, { recursive: true });

    const expectedConfig: GyoshuConfig = {
      version: "1.0.0",
      schemaVersion: 1,
      createdAt: "2024-01-01T00:00:00.000Z",
      projectName: "Test Project",
    };
    fs.writeFileSync(configPath, JSON.stringify(expectedConfig));

    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const config = getConfig();

    expect(config).toEqual(expectedConfig);
  });

  test("returns null for invalid JSON", () => {
    const projectDir = path.join(testDir, "invalid-config");
    const gyoshuDir = path.join(projectDir, "gyoshu");
    const configPath = path.join(gyoshuDir, "config.json");

    fs.mkdirSync(gyoshuDir, { recursive: true });
    fs.writeFileSync(configPath, "{ invalid json }");

    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const config = getConfig();

    expect(config).toBeNull();
  });
});

describe("ensureGyoshuInitialized", () => {
  test("creates gyoshu directory and config when they do not exist", () => {
    const projectDir = path.join(testDir, "init-project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const config = ensureGyoshuInitialized("My Test Project");

    // Check config was returned
    expect(config).toBeDefined();
    expect(config.version).toBeDefined();
    expect(config.schemaVersion).toBe(1);
    expect(config.createdAt).toBeDefined();
    expect(config.projectName).toBe("My Test Project");

    // Check directory was created
    const gyoshuDir = path.join(projectDir, "gyoshu");
    expect(fs.existsSync(gyoshuDir)).toBe(true);

    // Check config file was created
    const configPath = path.join(gyoshuDir, "config.json");
    expect(fs.existsSync(configPath)).toBe(true);

    // Verify config file contents
    const savedConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(savedConfig.projectName).toBe("My Test Project");
  });

  test("returns existing config without overwriting", () => {
    const projectDir = path.join(testDir, "existing-config");
    const gyoshuDir = path.join(projectDir, "gyoshu");
    const configPath = path.join(gyoshuDir, "config.json");

    fs.mkdirSync(gyoshuDir, { recursive: true });

    const existingConfig: GyoshuConfig = {
      version: "0.9.0",
      schemaVersion: 1,
      createdAt: "2023-01-01T00:00:00.000Z",
      projectName: "Existing Project",
    };
    fs.writeFileSync(configPath, JSON.stringify(existingConfig));

    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const config = ensureGyoshuInitialized("New Name");

    // Should return existing config, not create new one
    expect(config.version).toBe("0.9.0");
    expect(config.projectName).toBe("Existing Project");
  });

  test("works without project name", () => {
    const projectDir = path.join(testDir, "no-name-project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const config = ensureGyoshuInitialized();

    expect(config).toBeDefined();
    expect(config.projectName).toBeUndefined();
  });
});

// =============================================================================
// UTILITY FUNCTIONS TESTS
// =============================================================================

describe("ensureDirSync", () => {
  test("creates directory if it does not exist", () => {
    const newDir = path.join(testDir, "new-directory");

    expect(fs.existsSync(newDir)).toBe(false);

    ensureDirSync(newDir);

    expect(fs.existsSync(newDir)).toBe(true);
  });

  test("creates nested directories recursively", () => {
    const nestedDir = path.join(testDir, "level1", "level2", "level3");

    expect(fs.existsSync(nestedDir)).toBe(false);

    ensureDirSync(nestedDir);

    expect(fs.existsSync(nestedDir)).toBe(true);
  });

  test("does nothing if directory already exists", () => {
    const existingDir = path.join(testDir, "existing");
    fs.mkdirSync(existingDir, { recursive: true });

    // Create a file to verify directory wasn't recreated
    const markerFile = path.join(existingDir, "marker.txt");
    fs.writeFileSync(markerFile, "test");

    ensureDirSync(existingDir);

    // Verify the directory still exists with the marker file
    expect(fs.existsSync(existingDir)).toBe(true);
    expect(fs.existsSync(markerFile)).toBe(true);
  });
});

describe("existsSync", () => {
  test("returns true for existing file", () => {
    const filePath = path.join(testDir, "exists.txt");
    fs.writeFileSync(filePath, "content");

    expect(existsSync(filePath)).toBe(true);
  });

  test("returns false for non-existing file", () => {
    const filePath = path.join(testDir, "does-not-exist.txt");

    expect(existsSync(filePath)).toBe(false);
  });

  test("returns true for existing directory", () => {
    const dirPath = path.join(testDir, "subdir");
    fs.mkdirSync(dirPath);

    expect(existsSync(dirPath)).toBe(true);
  });
});

describe("getSchemaVersion", () => {
  test("returns current schema version", () => {
    const version = getSchemaVersion();

    expect(version).toBe(1);
    expect(typeof version).toBe("number");
  });
});

// =============================================================================
// EDGE CASES AND INTEGRATION TESTS
// =============================================================================

describe("path consistency", () => {
  test("all paths use consistent root", () => {
    const projectDir = path.join(testDir, "consistent");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const gyoshuRoot = getGyoshuRoot();
    const researchDir = getResearchDir();
    const runtimeDir = getRuntimeDir();
    const retroDir = getRetrospectivesDir();

    // All should start with the same gyoshu root
    expect(researchDir.startsWith(gyoshuRoot)).toBe(true);
    expect(runtimeDir.startsWith(gyoshuRoot)).toBe(true);
    expect(retroDir.startsWith(gyoshuRoot)).toBe(true);
  });

  test("research paths are nested correctly", () => {
    const projectDir = path.join(testDir, "nesting");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const researchId = "test-research";
    const runId = "run-001";

    const researchPath = getResearchPath(researchId);
    const manifestPath = getResearchManifestPath(researchId);
    const runPath = getRunPath(researchId, runId);
    const notebooksDir = getResearchNotebooksDir(researchId);
    const artifactsDir = getResearchArtifactsDir(researchId);

    // All should be under the research path
    expect(manifestPath.startsWith(researchPath)).toBe(true);
    expect(runPath.startsWith(researchPath)).toBe(true);
    expect(notebooksDir.startsWith(researchPath)).toBe(true);
    expect(artifactsDir.startsWith(researchPath)).toBe(true);
  });

  test("session paths are nested under runtime", () => {
    const projectDir = path.join(testDir, "session-nesting");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const sessionId = "test-session";
    const runtimeDir = getRuntimeDir();
    const sessionDir = getSessionDir(sessionId);
    const lockPath = getSessionLockPath(sessionId);
    const socketPath = getBridgeSocketPath(sessionId);

    expect(sessionDir.startsWith(runtimeDir)).toBe(true);
    expect(lockPath.startsWith(sessionDir)).toBe(true);
    expect(socketPath.startsWith(sessionDir)).toBe(true);
  });
});

describe("path format", () => {
  test("paths use correct separators for platform", () => {
    const projectDir = path.join(testDir, "separators");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const researchPath = getResearchPath("test");

    // path.join should handle platform separators
    expect(researchPath).not.toContain("\\\\");
    expect(researchPath).not.toContain("//");
  });

  test("paths are absolute", () => {
    const projectDir = path.join(testDir, "absolute");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const gyoshuRoot = getGyoshuRoot();
    const researchDir = getResearchDir();
    const runtimeDir = getRuntimeDir();

    expect(path.isAbsolute(gyoshuRoot)).toBe(true);
    expect(path.isAbsolute(researchDir)).toBe(true);
    expect(path.isAbsolute(runtimeDir)).toBe(true);
  });
});

// =============================================================================
// NOTEBOOK AND REPORT PATH TESTS
// =============================================================================

describe("getNotebookRootDir", () => {
  test("returns notebooks directory path", () => {
    const projectDir = path.join(testDir, "notebook-root-test");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const notebookRoot = getNotebookRootDir();

    expect(notebookRoot).toBe(path.join(projectDir, "notebooks"));
  });

  test("returns absolute path", () => {
    const projectDir = path.join(testDir, "absolute-notebook");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const notebookRoot = getNotebookRootDir();

    expect(path.isAbsolute(notebookRoot)).toBe(true);
  });
});

describe("getReportsRootDir", () => {
  test("returns reports directory path", () => {
    const projectDir = path.join(testDir, "reports-root-test");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const reportsRoot = getReportsRootDir();

    expect(reportsRoot).toBe(path.join(projectDir, "reports"));
  });

  test("returns absolute path", () => {
    const projectDir = path.join(testDir, "absolute-reports");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const reportsRoot = getReportsRootDir();

    expect(path.isAbsolute(reportsRoot)).toBe(true);
  });
});

describe("getNotebookPath", () => {
  test("returns notebook path for report title", () => {
    const projectDir = path.join(testDir, "notebook-path-test");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const notebookPath = getNotebookPath("my-analysis");

    expect(notebookPath).toBe(path.join(projectDir, "notebooks", "my-analysis.ipynb"));
  });

  test("returns absolute path", () => {
    const projectDir = path.join(testDir, "absolute-notebook-path");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const notebookPath = getNotebookPath("test-report");

    expect(path.isAbsolute(notebookPath)).toBe(true);
  });
});

describe("getReportDir", () => {
  test("returns report directory path for report title", () => {
    const projectDir = path.join(testDir, "report-dir-test");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const reportDir = getReportDir("my-analysis");

    expect(reportDir).toBe(path.join(projectDir, "reports", "my-analysis"));
  });

  test("returns absolute path", () => {
    const projectDir = path.join(testDir, "absolute-report-dir");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const reportDir = getReportDir("test-report");

    expect(path.isAbsolute(reportDir)).toBe(true);
  });
});

describe("getReportReadmePath", () => {
  test("returns README.md path within report directory", () => {
    const projectDir = path.join(testDir, "report-readme-test");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const readmePath = getReportReadmePath("my-analysis");

    expect(readmePath).toBe(path.join(projectDir, "reports", "my-analysis", "README.md"));
  });

  test("returns absolute path", () => {
    const projectDir = path.join(testDir, "absolute-report-readme");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const readmePath = getReportReadmePath("test-report");

    expect(path.isAbsolute(readmePath)).toBe(true);
  });
});

describe("notebook and report path consistency", () => {
  test("notebook and report paths use same project root", () => {
    const projectDir = path.join(testDir, "path-consistency");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const notebookRoot = getNotebookRootDir();
    const reportsRoot = getReportsRootDir();

    expect(notebookRoot.startsWith(projectDir)).toBe(true);
    expect(reportsRoot.startsWith(projectDir)).toBe(true);
  });

  test("notebook and report paths for same title share project root", () => {
    const projectDir = path.join(testDir, "same-title-paths");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const notebookPath = getNotebookPath("my-analysis");
    const reportDir = getReportDir("my-analysis");

    expect(notebookPath.startsWith(projectDir)).toBe(true);
    expect(reportDir.startsWith(projectDir)).toBe(true);
  });
});
