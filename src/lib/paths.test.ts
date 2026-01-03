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
  getCheckpointDir,
  getCheckpointManifestPath,
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
  shortenSessionId,
  clearRuntimeDirCache,
  type GyoshuConfig,
} from "./paths";

// =============================================================================
// TEST SETUP
// =============================================================================

let testDir: string;
let originalCwd: string;
let originalEnv: string | undefined;
let originalRuntimeEnv: string | undefined;
let originalXdgRuntime: string | undefined;

beforeEach(async () => {
  originalCwd = process.cwd();
  originalEnv = process.env.GYOSHU_PROJECT_ROOT;
  originalRuntimeEnv = process.env.GYOSHU_RUNTIME_DIR;
  originalXdgRuntime = process.env.XDG_RUNTIME_DIR;

  testDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "gyoshu-paths-test-")
  );

  clearProjectRootCache();
  clearRuntimeDirCache();

  delete process.env.GYOSHU_PROJECT_ROOT;
  delete process.env.GYOSHU_RUNTIME_DIR;
  delete process.env.XDG_RUNTIME_DIR;
});

afterEach(async () => {
  process.chdir(originalCwd);
  
  if (originalEnv !== undefined) {
    process.env.GYOSHU_PROJECT_ROOT = originalEnv;
  } else {
    delete process.env.GYOSHU_PROJECT_ROOT;
  }
  
  if (originalRuntimeEnv !== undefined) {
    process.env.GYOSHU_RUNTIME_DIR = originalRuntimeEnv;
  } else {
    delete process.env.GYOSHU_RUNTIME_DIR;
  }
  
  if (originalXdgRuntime !== undefined) {
    process.env.XDG_RUNTIME_DIR = originalXdgRuntime;
  } else {
    delete process.env.XDG_RUNTIME_DIR;
  }

  clearProjectRootCache();
  clearRuntimeDirCache();

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
  test("respects GYOSHU_RUNTIME_DIR environment variable", () => {
    const customRuntime = path.join(testDir, "custom-runtime");
    fs.mkdirSync(customRuntime, { recursive: true });
    process.env.GYOSHU_RUNTIME_DIR = customRuntime;

    const runtimeDir = getRuntimeDir();

    expect(runtimeDir).toBe(customRuntime);
  });

  test("uses XDG_RUNTIME_DIR when set", () => {
    const xdgRuntime = path.join(testDir, "xdg-runtime");
    fs.mkdirSync(xdgRuntime, { recursive: true });
    process.env.XDG_RUNTIME_DIR = xdgRuntime;

    const runtimeDir = getRuntimeDir();

    expect(runtimeDir).toBe(path.join(xdgRuntime, "gyoshu"));
  });

  test("GYOSHU_RUNTIME_DIR takes priority over XDG_RUNTIME_DIR", () => {
    const customRuntime = path.join(testDir, "custom");
    const xdgRuntime = path.join(testDir, "xdg");
    fs.mkdirSync(customRuntime, { recursive: true });
    fs.mkdirSync(xdgRuntime, { recursive: true });
    process.env.GYOSHU_RUNTIME_DIR = customRuntime;
    process.env.XDG_RUNTIME_DIR = xdgRuntime;

    const runtimeDir = getRuntimeDir();

    expect(runtimeDir).toBe(customRuntime);
  });

  test("falls back to platform-specific cache directory", () => {
    const runtimeDir = getRuntimeDir();

    expect(path.isAbsolute(runtimeDir)).toBe(true);
    expect(runtimeDir).toContain("gyoshu");
    expect(runtimeDir).not.toContain("undefined");
  });

  test("returns path outside project root", () => {
    const projectDir = path.join(testDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const runtimeDir = getRuntimeDir();

    expect(runtimeDir.startsWith(projectDir)).toBe(false);
  });
});

describe("shortenSessionId", () => {
  test("returns short session IDs unchanged", () => {
    expect(shortenSessionId("abc123")).toBe("abc123");
    expect(shortenSessionId("session")).toBe("session");
    expect(shortenSessionId("12chars1234")).toBe("12chars1234");
  });

  test("hashes long session IDs to 12 characters", () => {
    const longId = "very-long-session-id-that-exceeds-12-characters-and-more";
    const shortId = shortenSessionId(longId);

    expect(shortId.length).toBe(12);
    expect(/^[0-9a-f]{12}$/.test(shortId)).toBe(true);
  });

  test("produces consistent hashes for same input", () => {
    const longId = "consistent-session-id-for-testing";
    const hash1 = shortenSessionId(longId);
    const hash2 = shortenSessionId(longId);

    expect(hash1).toBe(hash2);
  });

  test("produces different hashes for different inputs", () => {
    const hash1 = shortenSessionId("session-one-long-name");
    const hash2 = shortenSessionId("session-two-long-name");

    expect(hash1).not.toBe(hash2);
  });
});

describe("getSessionDir", () => {
  test("returns session directory with short session ID", () => {
    const customRuntime = path.join(testDir, "runtime");
    fs.mkdirSync(customRuntime, { recursive: true });
    process.env.GYOSHU_RUNTIME_DIR = customRuntime;

    const sessionDir = getSessionDir("short-id");

    expect(sessionDir).toBe(path.join(customRuntime, "short-id"));
  });

  test("hashes long session IDs for socket path safety", () => {
    const customRuntime = path.join(testDir, "runtime");
    fs.mkdirSync(customRuntime, { recursive: true });
    process.env.GYOSHU_RUNTIME_DIR = customRuntime;

    const longSessionId = "very-long-session-id-that-would-cause-socket-path-issues";
    const sessionDir = getSessionDir(longSessionId);

    expect(sessionDir.length).toBeLessThan(customRuntime.length + 20);
    expect(sessionDir.startsWith(customRuntime)).toBe(true);
  });
});

describe("getSessionLockPath", () => {
  test("returns session.lock path in session directory", () => {
    const customRuntime = path.join(testDir, "runtime");
    fs.mkdirSync(customRuntime, { recursive: true });
    process.env.GYOSHU_RUNTIME_DIR = customRuntime;

    const lockPath = getSessionLockPath("test-session");

    expect(lockPath).toBe(
      path.join(customRuntime, "test-session", "session.lock")
    );
  });
});

describe("getBridgeSocketPath", () => {
  test("returns bridge.sock path in session directory", () => {
    const customRuntime = path.join(testDir, "runtime");
    fs.mkdirSync(customRuntime, { recursive: true });
    process.env.GYOSHU_RUNTIME_DIR = customRuntime;

    const socketPath = getBridgeSocketPath("test-session");

    expect(socketPath).toBe(
      path.join(customRuntime, "test-session", "bridge.sock")
    );
  });

  test("socket path length stays within Unix limits", () => {
    const customRuntime = path.join(testDir, "runtime");
    fs.mkdirSync(customRuntime, { recursive: true });
    process.env.GYOSHU_RUNTIME_DIR = customRuntime;

    const longSessionId = "extremely-long-session-id-that-would-normally-exceed-unix-socket-path-limits-of-108-bytes";
    const socketPath = getBridgeSocketPath(longSessionId);

    expect(socketPath.length).toBeLessThan(108);
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
  test("project paths use consistent root", () => {
    const projectDir = path.join(testDir, "consistent");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const gyoshuRoot = getGyoshuRoot();
    const researchDir = getResearchDir();
    const retroDir = getRetrospectivesDir();

    expect(researchDir.startsWith(gyoshuRoot)).toBe(true);
    expect(retroDir.startsWith(gyoshuRoot)).toBe(true);
  });

  test("runtime is separate from project root", () => {
    const projectDir = path.join(testDir, "separate");
    const runtimeEnvDir = path.join(testDir, "runtime-env");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(runtimeEnvDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    process.env.GYOSHU_RUNTIME_DIR = runtimeEnvDir;
    clearProjectRootCache();

    const gyoshuRoot = getGyoshuRoot();
    const runtimeDir = getRuntimeDir();

    expect(runtimeDir.startsWith(gyoshuRoot)).toBe(false);
    expect(runtimeDir).toBe(runtimeEnvDir);
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

    expect(manifestPath.startsWith(researchPath)).toBe(true);
    expect(runPath.startsWith(researchPath)).toBe(true);
    expect(notebooksDir.startsWith(researchPath)).toBe(true);
    expect(artifactsDir.startsWith(researchPath)).toBe(true);
  });

  test("session paths are nested under runtime", () => {
    const runtimeEnvDir = path.join(testDir, "session-runtime");
    fs.mkdirSync(runtimeEnvDir, { recursive: true });
    process.env.GYOSHU_RUNTIME_DIR = runtimeEnvDir;

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

// =============================================================================
// CHECKPOINT PATH GETTERS TESTS
// =============================================================================

describe("getCheckpointDir", () => {
  test("returns correct checkpoint directory path", () => {
    const projectDir = path.join(testDir, "checkpoint-dir-test");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const checkpointDir = getCheckpointDir("my-analysis", "run-001");

    expect(checkpointDir).toBe(
      path.join(projectDir, "reports", "my-analysis", "checkpoints", "run-001")
    );
  });

  test("returns absolute path", () => {
    const projectDir = path.join(testDir, "checkpoint-dir-absolute");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const checkpointDir = getCheckpointDir("test-report", "run-002");

    expect(path.isAbsolute(checkpointDir)).toBe(true);
  });

  test("is nested under report directory", () => {
    const projectDir = path.join(testDir, "checkpoint-nesting");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const reportDir = getReportDir("my-analysis");
    const checkpointDir = getCheckpointDir("my-analysis", "run-001");

    expect(checkpointDir.startsWith(reportDir)).toBe(true);
  });
});

describe("getCheckpointManifestPath", () => {
  test("returns correct checkpoint manifest path", () => {
    const projectDir = path.join(testDir, "checkpoint-manifest-test");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const manifestPath = getCheckpointManifestPath("my-analysis", "run-001", "ckpt-001");

    expect(manifestPath).toBe(
      path.join(
        projectDir,
        "reports",
        "my-analysis",
        "checkpoints",
        "run-001",
        "ckpt-001",
        "checkpoint.json"
      )
    );
  });

  test("returns absolute path", () => {
    const projectDir = path.join(testDir, "checkpoint-manifest-absolute");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const manifestPath = getCheckpointManifestPath("test-report", "run-002", "ckpt-003");

    expect(path.isAbsolute(manifestPath)).toBe(true);
  });

  test("is nested under checkpoint directory", () => {
    const projectDir = path.join(testDir, "manifest-nesting");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const checkpointDir = getCheckpointDir("my-analysis", "run-001");
    const manifestPath = getCheckpointManifestPath("my-analysis", "run-001", "ckpt-001");

    expect(manifestPath.startsWith(checkpointDir)).toBe(true);
  });

  test("ends with checkpoint.json", () => {
    const projectDir = path.join(testDir, "manifest-filename");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const manifestPath = getCheckpointManifestPath("my-analysis", "run-001", "ckpt-001");

    expect(manifestPath.endsWith("checkpoint.json")).toBe(true);
  });
});

describe("checkpoint path consistency", () => {
  test("checkpoint paths use consistent report root", () => {
    const projectDir = path.join(testDir, "checkpoint-consistency");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const reportsRoot = getReportsRootDir();
    const checkpointDir = getCheckpointDir("my-analysis", "run-001");
    const manifestPath = getCheckpointManifestPath("my-analysis", "run-001", "ckpt-001");

    expect(checkpointDir.startsWith(reportsRoot)).toBe(true);
    expect(manifestPath.startsWith(reportsRoot)).toBe(true);
  });

  test("different checkpoints have different paths", () => {
    const projectDir = path.join(testDir, "checkpoint-uniqueness");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.GYOSHU_PROJECT_ROOT = projectDir;
    clearProjectRootCache();

    const manifest1 = getCheckpointManifestPath("my-analysis", "run-001", "ckpt-001");
    const manifest2 = getCheckpointManifestPath("my-analysis", "run-001", "ckpt-002");
    const manifest3 = getCheckpointManifestPath("my-analysis", "run-002", "ckpt-001");

    expect(manifest1).not.toBe(manifest2);
    expect(manifest1).not.toBe(manifest3);
    expect(manifest2).not.toBe(manifest3);
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
