/**
 * Centralized Path Resolver for Gyoshu Research System
 *
 * Provides consistent path resolution across all Gyoshu tools and components.
 * Uses a flat notebook + reports architecture for simplicity.
 *
 * Storage Structure:
 * ```
 * ./notebooks/                       # Flat notebook storage
 * └── {reportTitle}.ipynb            # One notebook per analysis
 *
 * ./reports/                         # Report outputs (mirrors notebooks)
 * └── {reportTitle}/
 *     ├── README.md                  # The markdown report
 *     └── {assets}                   # Figures, exports, etc.
 *
 * ./gyoshu/                          # Runtime only (gitignored)
 * ├── .gitignore                     # Ignores everything below
 * └── runtime/{sessionId}/           # Ephemeral session data
 *     ├── bridge.sock                # Python REPL socket
 *     ├── session.lock               # Session lock
 *     └── bridge_meta.json           # Runtime state
 * ```
 *
 * Root Detection Strategy (in order):
 * 1. GYOSHU_PROJECT_ROOT environment variable (explicit override)
 * 2. Walk up directories looking for ./gyoshu/config.json (legacy marker)
 * 3. Walk up directories looking for .git
 * 4. Fall back to current working directory
 *
 * Note: Research metadata is stored in notebook YAML frontmatter, not separate
 * JSON files. The gyoshu/ directory contains only ephemeral runtime data.
 * Legacy research at ./gyoshu/research/ or ~/.gyoshu/sessions/ is still
 * readable; use /gyoshu migrate to move to the notebook-centric structure.
 *
 * @module paths
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Name of the Gyoshu storage directory.
 * Located in the project root, contains all Gyoshu data.
 */
const GYOSHU_DIR_NAME = "gyoshu";

/**
 * Name of the config file that serves as a marker for root detection.
 */
const CONFIG_FILE_NAME = "config.json";

/**
 * Environment variable for explicit project root override.
 */
const ENV_PROJECT_ROOT = "GYOSHU_PROJECT_ROOT";

/**
 * Current Gyoshu version string.
 */
const CURRENT_VERSION = "1.0.0";

// =============================================================================
// CONFIG TYPES
// =============================================================================

/**
 * Gyoshu project configuration stored in ./gyoshu/config.json.
 * This file serves as both configuration and marker for root detection.
 */
export interface GyoshuConfig {
  /** Gyoshu version that created this config (e.g., "1.0.0") */
  version: string;
  /** Schema version for future migrations */
  schemaVersion: number;
  /** ISO 8601 timestamp of when gyoshu was initialized */
  createdAt: string;
  /** Optional project name for display purposes */
  projectName?: string;
}

/**
 * Legacy sessions directory in user's home.
 * Used for migration support from older versions.
 */
const LEGACY_SESSIONS_DIR = path.join(os.homedir(), ".gyoshu", "sessions");

// =============================================================================
// NOTEBOOK AND REPORT PATH GETTERS
// =============================================================================

export function getNotebookRootDir(): string {
  return path.join(detectProjectRoot(), "notebooks");
}

export function getReportsRootDir(): string {
  return path.join(detectProjectRoot(), "reports");
}

export function getNotebookPath(reportTitle: string): string {
  return path.join(getNotebookRootDir(), `${reportTitle}.ipynb`);
}

export function getReportDir(reportTitle: string): string {
  return path.join(getReportsRootDir(), reportTitle);
}

export function getReportReadmePath(reportTitle: string): string {
  return path.join(getReportDir(reportTitle), "README.md");
}

// =============================================================================
// ROOT DETECTION (SYNC)
// =============================================================================

/** Cached project root to avoid repeated filesystem walks */
let cachedProjectRoot: string | null = null;

/**
 * Detect the project root directory using a multi-strategy approach.
 *
 * Strategy (in order of priority):
 * 1. `GYOSHU_PROJECT_ROOT` environment variable (explicit override)
 * 2. Walk up from cwd looking for `./gyoshu/config.json` (marker file)
 * 3. Walk up from cwd looking for `.git` directory (git repo root)
 * 4. Fall back to current working directory
 *
 * The result is cached after first call. Use `clearProjectRootCache()` to reset.
 *
 * @returns The detected project root directory (absolute path)
 *
 * @example
 * const root = detectProjectRoot();
 * // Returns: '/home/user/my-project' (absolute path)
 */
export function detectProjectRoot(): string {
  // Return cached value if available
  if (cachedProjectRoot !== null) {
    return cachedProjectRoot;
  }

  // Strategy 1: Environment variable override
  const envRoot = process.env[ENV_PROJECT_ROOT];
  if (envRoot && fs.existsSync(envRoot)) {
    cachedProjectRoot = path.resolve(envRoot);
    return cachedProjectRoot;
  }

  const startDir = process.cwd();

  // Strategy 2: Walk up looking for gyoshu/config.json
  const configRoot = walkUpForMarker(startDir, path.join(GYOSHU_DIR_NAME, CONFIG_FILE_NAME));
  if (configRoot) {
    cachedProjectRoot = configRoot;
    return cachedProjectRoot;
  }

  // Strategy 3: Walk up looking for .git
  const gitRoot = walkUpForMarker(startDir, ".git");
  if (gitRoot) {
    cachedProjectRoot = gitRoot;
    return cachedProjectRoot;
  }

  // Strategy 4: Fall back to current working directory
  cachedProjectRoot = startDir;
  return cachedProjectRoot;
}

/**
 * Walk up the directory tree looking for a marker file or directory.
 *
 * @param startDir - Directory to start searching from
 * @param marker - Relative path to the marker (file or directory)
 * @returns The directory containing the marker, or null if not found
 */
function walkUpForMarker(startDir: string, marker: string): string | null {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current !== root) {
    const markerPath = path.join(current, marker);
    if (fs.existsSync(markerPath)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break; // Reached filesystem root
    current = parent;
  }

  // Check root directory as well
  const rootMarkerPath = path.join(root, marker);
  if (fs.existsSync(rootMarkerPath)) {
    return root;
  }

  return null;
}

/**
 * Clear the cached project root.
 * Useful for testing or when the project root may have changed.
 */
export function clearProjectRootCache(): void {
  cachedProjectRoot = null;
}

// =============================================================================
// PRIMARY PATH GETTERS
// =============================================================================

/**
 * Get the path to the Gyoshu root directory.
 * This is the main storage directory for all Gyoshu data.
 *
 * @returns Path to `./gyoshu/` directory
 *
 * @example
 * getGyoshuRoot();
 * // Returns: '/home/user/my-project/gyoshu'
 */
export function getGyoshuRoot(): string {
  return path.join(detectProjectRoot(), GYOSHU_DIR_NAME);
}

/**
 * Get the path to the Gyoshu config file.
 * This file serves as both configuration and root marker.
 *
 * @returns Path to `./gyoshu/config.json`
 *
 * @example
 * getConfigPath();
 * // Returns: '/home/user/my-project/gyoshu/config.json'
 */
export function getConfigPath(): string {
  return path.join(getGyoshuRoot(), CONFIG_FILE_NAME);
}

// =============================================================================
// RESEARCH PATH GETTERS
// =============================================================================

/**
 * Get the path to the research directory.
 * Contains all research projects.
 *
 * @returns Path to `./gyoshu/research/`
 *
 * @example
 * getResearchDir();
 * // Returns: '/home/user/my-project/gyoshu/research'
 */
export function getResearchDir(): string {
  return path.join(getGyoshuRoot(), "research");
}

/**
 * Get the path to a specific research project directory.
 *
 * @param researchId - Unique identifier for the research project
 * @returns Path to `./gyoshu/research/{researchId}/`
 *
 * @example
 * getResearchPath('iris-clustering-2024');
 * // Returns: '/home/user/my-project/gyoshu/research/iris-clustering-2024'
 */
export function getResearchPath(researchId: string): string {
  return path.join(getResearchDir(), researchId);
}

/**
 * Get the path to a specific run within a research project.
 *
 * @param researchId - Unique identifier for the research project
 * @param runId - Unique identifier for the run
 * @returns Path to `./gyoshu/research/{researchId}/runs/{runId}.json`
 *
 * @example
 * getRunPath('iris-clustering-2024', 'run-001');
 * // Returns: '/home/user/my-project/gyoshu/research/iris-clustering-2024/runs/run-001.json'
 */
export function getRunPath(researchId: string, runId: string): string {
  return path.join(getResearchPath(researchId), "runs", `${runId}.json`);
}

/**
 * Get the path to the research manifest file.
 *
 * @param researchId - Unique identifier for the research project
 * @returns Path to `./gyoshu/research/{researchId}/research.json`
 *
 * @example
 * getResearchManifestPath('iris-clustering-2024');
 * // Returns: '/home/user/my-project/gyoshu/research/iris-clustering-2024/research.json'
 */
export function getResearchManifestPath(researchId: string): string {
  return path.join(getResearchPath(researchId), "research.json");
}

/**
 * Get the path to the notebooks directory for a research project.
 *
 * @param researchId - Unique identifier for the research project
 * @returns Path to `./gyoshu/research/{researchId}/notebooks/`
 *
 * @example
 * getResearchNotebooksDir('iris-clustering-2024');
 * // Returns: '/home/user/my-project/gyoshu/research/iris-clustering-2024/notebooks'
 */
export function getResearchNotebooksDir(researchId: string): string {
  return path.join(getResearchPath(researchId), "notebooks");
}

/**
 * Get the path to the artifacts directory for a research project.
 *
 * @param researchId - Unique identifier for the research project
 * @returns Path to `./gyoshu/research/{researchId}/artifacts/`
 *
 * @example
 * getResearchArtifactsDir('iris-clustering-2024');
 * // Returns: '/home/user/my-project/gyoshu/research/iris-clustering-2024/artifacts'
 */
export function getResearchArtifactsDir(researchId: string): string {
  return path.join(getResearchPath(researchId), "artifacts");
}

// =============================================================================
// RUNTIME PATH GETTERS (EPHEMERAL - GITIGNORED)
// =============================================================================

/**
 * Get the path to the runtime directory.
 * Contains ephemeral session data like locks and sockets.
 * This directory should be gitignored.
 *
 * @returns Path to `./gyoshu/runtime/`
 *
 * @example
 * getRuntimeDir();
 * // Returns: '/home/user/my-project/gyoshu/runtime'
 */
export function getRuntimeDir(): string {
  return path.join(getGyoshuRoot(), "runtime");
}

/**
 * Get the path to a specific session's runtime directory.
 * Contains session-specific ephemeral files.
 *
 * @param sessionId - Unique identifier for the session
 * @returns Path to `./gyoshu/runtime/{sessionId}/`
 *
 * @example
 * getSessionDir('session-abc123');
 * // Returns: '/home/user/my-project/gyoshu/runtime/session-abc123'
 */
export function getSessionDir(sessionId: string): string {
  return path.join(getRuntimeDir(), sessionId);
}

/**
 * Get the path to a session's lock file.
 *
 * @param sessionId - Unique identifier for the session
 * @returns Path to `./gyoshu/runtime/{sessionId}/session.lock`
 *
 * @example
 * getSessionLockPath('session-abc123');
 * // Returns: '/home/user/my-project/gyoshu/runtime/session-abc123/session.lock'
 */
export function getSessionLockPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), "session.lock");
}

/**
 * Get the path to a session's bridge socket.
 *
 * @param sessionId - Unique identifier for the session
 * @returns Path to `./gyoshu/runtime/{sessionId}/bridge.sock`
 *
 * @example
 * getBridgeSocketPath('session-abc123');
 * // Returns: '/home/user/my-project/gyoshu/runtime/session-abc123/bridge.sock'
 */
export function getBridgeSocketPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), "bridge.sock");
}

// =============================================================================
// SHARED RESOURCE PATH GETTERS
// =============================================================================

/**
 * Get the path to the retrospectives directory.
 * Contains feedback and learning data.
 *
 * @returns Path to `./gyoshu/retrospectives/`
 *
 * @example
 * getRetrospectivesDir();
 * // Returns: '/home/user/my-project/gyoshu/retrospectives'
 */
export function getRetrospectivesDir(): string {
  return path.join(getGyoshuRoot(), "retrospectives");
}

/**
 * Get the path to the retrospectives feedback file.
 *
 * @returns Path to `./gyoshu/retrospectives/feedback.jsonl`
 *
 * @example
 * getRetrospectivesFeedbackPath();
 * // Returns: '/home/user/my-project/gyoshu/retrospectives/feedback.jsonl'
 */
export function getRetrospectivesFeedbackPath(): string {
  return path.join(getRetrospectivesDir(), "feedback.jsonl");
}

/**
 * Get the path to the lib directory.
 * Contains promoted/generated code from research.
 *
 * @returns Path to `./gyoshu/lib/`
 *
 * @example
 * getLibDir();
 * // Returns: '/home/user/my-project/gyoshu/lib'
 */
export function getLibDir(): string {
  return path.join(getGyoshuRoot(), "lib");
}

/**
 * Get the path to the assets directory.
 * Contains content-addressed artifacts and resources.
 *
 * @returns Path to `./gyoshu/assets/`
 *
 * @example
 * getAssetsDir();
 * // Returns: '/home/user/my-project/gyoshu/assets'
 */
export function getAssetsDir(): string {
  return path.join(getGyoshuRoot(), "assets");
}

/**
 * Get the path to the external directory.
 * Contains downloaded knowledge, documentation, and datasets.
 *
 * @returns Path to `./gyoshu/external/`
 *
 * @example
 * getExternalDir();
 * // Returns: '/home/user/my-project/gyoshu/external'
 */
export function getExternalDir(): string {
  return path.join(getGyoshuRoot(), "external");
}

// =============================================================================
// LEGACY SUPPORT
// =============================================================================

/**
 * Get the path to the legacy sessions directory.
 * Located in user's home directory (~/.gyoshu/sessions/).
 * Used for migration from older versions.
 *
 * @returns Path to `~/.gyoshu/sessions/`
 *
 * @example
 * getLegacySessionsDir();
 * // Returns: '/home/user/.gyoshu/sessions'
 */
export function getLegacySessionsDir(): string {
  return LEGACY_SESSIONS_DIR;
}

/**
 * Check if legacy sessions exist.
 * Useful for triggering migration workflows.
 *
 * @returns true if legacy sessions directory exists and is not empty
 *
 * @example
 * if (hasLegacySessions()) {
 *   console.log('Migration available from legacy sessions');
 * }
 */
export function hasLegacySessions(): boolean {
  try {
    if (!fs.existsSync(LEGACY_SESSIONS_DIR)) {
      return false;
    }
    const entries = fs.readdirSync(LEGACY_SESSIONS_DIR);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get path to a specific legacy session directory.
 *
 * @param sessionId - Session identifier
 * @returns Path to `~/.gyoshu/sessions/{sessionId}/`
 */
export function getLegacySessionPath(sessionId: string): string {
  return path.join(LEGACY_SESSIONS_DIR, sessionId);
}

/**
 * Get path to a legacy session's manifest file.
 *
 * @param sessionId - Session identifier
 * @returns Path to `~/.gyoshu/sessions/{sessionId}/manifest.json`
 */
export function getLegacyManifestPath(sessionId: string): string {
  return path.join(getLegacySessionPath(sessionId), "manifest.json");
}

/**
 * Get path to a legacy session's artifacts directory.
 *
 * @param sessionId - Session identifier
 * @returns Path to `~/.gyoshu/sessions/{sessionId}/artifacts/`
 */
export function getLegacyArtifactsDir(sessionId: string): string {
  return path.join(getLegacySessionPath(sessionId), "artifacts");
}

// =============================================================================
// CONFIG MANAGEMENT
// =============================================================================

/**
 * Read the Gyoshu config file.
 * Returns null if config doesn't exist or is invalid.
 *
 * @returns The config object or null if not found/invalid
 */
export function getConfig(): GyoshuConfig | null {
  const configPath = getConfigPath();
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content) as GyoshuConfig;
  } catch {
    return null;
  }
}

/**
 * Create a default Gyoshu config object.
 *
 * @param projectName - Optional project name
 * @returns A new GyoshuConfig with current version and timestamp
 */
function createDefaultConfig(projectName?: string): GyoshuConfig {
  return {
    version: CURRENT_VERSION,
    schemaVersion: getSchemaVersion(),
    createdAt: new Date().toISOString(),
    ...(projectName && { projectName }),
  };
}

/**
 * Check for legacy sessions and emit warning if found.
 * Called during initialization to notify users about migration.
 */
function emitLegacyWarning(): void {
  if (hasLegacySessions()) {
    console.warn(
      "[Gyoshu] Legacy sessions found at ~/.gyoshu/sessions/\n" +
        "         Run /gyoshu-migrate to move them to project-local storage."
    );
  }
}

/**
 * Ensure Gyoshu is initialized for the current project.
 * Creates the gyoshu directory and config.json if they don't exist.
 * Emits warning if legacy sessions are detected.
 *
 * @param projectName - Optional project name to store in config
 * @returns The Gyoshu config (existing or newly created)
 */
export function ensureGyoshuInitialized(projectName?: string): GyoshuConfig {
  const gyoshuRoot = getGyoshuRoot();
  const configPath = getConfigPath();

  const existingConfig = getConfig();
  if (existingConfig) {
    emitLegacyWarning();
    return existingConfig;
  }

  ensureDirSync(gyoshuRoot);

  const config = createDefaultConfig(projectName);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

  emitLegacyWarning();

  return config;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Ensure a directory exists, creating it if necessary.
 * Uses synchronous operations for simplicity in path setup.
 *
 * @param dirPath - Path to the directory to ensure
 */
export function ensureDirSync(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Check if a file or directory exists.
 *
 * @param filePath - Path to check
 * @returns true if the path exists
 */
export function existsSync(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Get the current schema version for the storage structure.
 * Used for future migrations when the storage layout changes.
 *
 * @returns Current schema version number
 */
export function getSchemaVersion(): number {
  return 1;
}

// =============================================================================
// PATH VALIDATION
// =============================================================================

/**
 * Validates that a path segment is safe to use in file paths.
 * Prevents directory traversal and path injection attacks.
 *
 * @param segment - The path segment to validate (e.g., workspace name, slug)
 * @param name - Name of the parameter for error messages (e.g., "workspace", "slug")
 * @throws Error if segment is invalid
 *
 * @example
 * validatePathSegment("my-workspace", "workspace"); // OK
 * validatePathSegment("../evil", "workspace"); // throws Error
 */
export function validatePathSegment(segment: string, name: string): void {
  if (!segment || typeof segment !== "string") {
    throw new Error(`${name} is required and must be a string`);
  }

  if (segment.trim().length === 0) {
    throw new Error(`Invalid ${name}: cannot be empty or whitespace`);
  }

  // Normalize Unicode to prevent bypass via alternative representations
  const normalized = segment.normalize("NFC");

  // Prevent path traversal attacks
  if (normalized.includes("..") || normalized.includes("/") || normalized.includes("\\")) {
    throw new Error(`Invalid ${name}: contains path traversal characters`);
  }

  // Prevent null bytes
  if (normalized.includes("\0")) {
    throw new Error(`Invalid ${name}: contains null byte`);
  }

  // Limit byte length (filesystems typically limit to 255 bytes, not chars)
  if (Buffer.byteLength(normalized, "utf8") > 255) {
    throw new Error(`Invalid ${name}: exceeds maximum length of 255 bytes`);
  }
}