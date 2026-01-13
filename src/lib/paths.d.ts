/**
 * Centralized Path Resolver for Gyoshu Research System
 *
 * Provides consistent path resolution across all Gyoshu tools and components.
 * Uses a flat notebook + reports architecture for simplicity.
 *
 * Storage Structure:
 * ```
 * Project Root (durable, tracked):
 * ./notebooks/                       # Flat notebook storage
 * └── {reportTitle}.ipynb            # One notebook per analysis
 * ./reports/                         # Report outputs (mirrors notebooks)
 * └── {reportTitle}/
 *     ├── README.md                  # The markdown report
 *     └── {assets}                   # Figures, exports, etc.
 *
 * OS Temp Directory (ephemeral, not in project):
 * $XDG_RUNTIME_DIR/gyoshu/           # Linux: /run/user/{uid}/gyoshu
 * ~/Library/Caches/gyoshu/runtime/   # macOS
 * ~/.cache/gyoshu/runtime/           # Linux fallback
 * └── {shortSessionId}/              # Ephemeral session data
 *     ├── bridge.sock                # Python REPL socket
 *     ├── session.lock               # Session lock
 *     └── bridge_meta.json           # Runtime state
 * ```
 *
 * Runtime Directory Resolution (in order):
 * 1. GYOSHU_RUNTIME_DIR environment variable (explicit override)
 * 2. XDG_RUNTIME_DIR/gyoshu (Linux standard)
 * 3. Platform-specific cache directory
 * 4. os.tmpdir()/gyoshu/runtime fallback
 *
 * Project Root Detection (in order):
 * 1. GYOSHU_PROJECT_ROOT environment variable (explicit override)
 * 2. Walk up directories looking for ./gyoshu/config.json (legacy marker)
 * 3. Walk up directories looking for .git
 * 4. Fall back to current working directory
 *
 * Note: Session IDs are hashed to short 12-char IDs to respect Unix socket
 * path length limits (UNIX_PATH_MAX is 108 on Linux, 104 on macOS).
 *
 * @module paths
 */
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
export declare function getNotebookRootDir(): string;
export declare function getReportsRootDir(): string;
export declare function getNotebookPath(reportTitle: string): string;
export declare function getReportDir(reportTitle: string): string;
export declare function getReportReadmePath(reportTitle: string): string;
/**
 * Get the checkpoints directory for a research run.
 * Contains all checkpoints created during this run.
 *
 * @param reportTitle - The report/research title (e.g., "customer-churn-analysis")
 * @param runId - The run identifier (e.g., "run-001")
 * @returns Path to reports/{reportTitle}/checkpoints/{runId}/
 *
 * @example
 * getCheckpointDir('customer-churn', 'run-001');
 * // Returns: '/home/user/my-project/reports/customer-churn/checkpoints/run-001'
 */
export declare function getCheckpointDir(reportTitle: string, runId: string): string;
/**
 * Get the path to a specific checkpoint's manifest file.
 *
 * @param reportTitle - The report/research title
 * @param runId - The run identifier
 * @param checkpointId - The checkpoint identifier (e.g., "ckpt-001")
 * @returns Path to reports/{reportTitle}/checkpoints/{runId}/{checkpointId}/checkpoint.json
 *
 * @example
 * getCheckpointManifestPath('customer-churn', 'run-001', 'ckpt-001');
 * // Returns: '/home/user/my-project/reports/customer-churn/checkpoints/run-001/ckpt-001/checkpoint.json'
 */
export declare function getCheckpointManifestPath(reportTitle: string, runId: string, checkpointId: string): string;
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
export declare function detectProjectRoot(): string;
/**
 * Clear the cached project root.
 * Useful for testing or when the project root may have changed.
 */
export declare function clearProjectRootCache(): void;
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
export declare function getGyoshuRoot(): string;
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
export declare function getConfigPath(): string;
/**
 * Get the path to the research directory.
 * Contains all research projects.
 *
 * @deprecated Use `getNotebookRootDir()` and `getReportsRootDir()` instead.
 * Legacy structure is deprecated. Use:
 * - Notebooks: `getNotebookPath(reportTitle)` → `./notebooks/{reportTitle}.ipynb`
 * - Reports: `getReportDir(reportTitle)` → `./reports/{reportTitle}/`
 * This function is retained only for migration tool support.
 *
 * @returns Path to `./gyoshu/research/`
 *
 * @example
 * getResearchDir();
 * // Returns: '/home/user/my-project/gyoshu/research'
 */
export declare function getResearchDir(): string;
/**
 * Get the path to a specific research project directory.
 *
 * @deprecated Use `getNotebookPath(reportTitle)` and `getReportDir(reportTitle)` instead.
 * Legacy structure is deprecated. Use:
 * - Notebooks: `getNotebookPath(reportTitle)` → `./notebooks/{reportTitle}.ipynb`
 * - Reports: `getReportDir(reportTitle)` → `./reports/{reportTitle}/`
 * This function is retained only for migration tool support.
 *
 * @param researchId - Unique identifier for the research project
 * @returns Path to `./gyoshu/research/{researchId}/`
 *
 * @example
 * getResearchPath('iris-clustering-2024');
 * // Returns: '/home/user/my-project/gyoshu/research/iris-clustering-2024'
 */
export declare function getResearchPath(researchId: string): string;
/**
 * Get the path to a specific run within a research project.
 *
 * @deprecated Use notebook frontmatter to track runs instead.
 * Legacy structure is deprecated. Runs are now tracked in notebook YAML frontmatter
 * under `gyoshu.runs`. Use `getNotebookPath(reportTitle)` to access the notebook.
 * This function is retained only for migration tool support.
 *
 * @param researchId - Unique identifier for the research project
 * @param runId - Unique identifier for the run
 * @returns Path to `./gyoshu/research/{researchId}/runs/{runId}.json`
 *
 * @example
 * getRunPath('iris-clustering-2024', 'run-001');
 * // Returns: '/home/user/my-project/gyoshu/research/iris-clustering-2024/runs/run-001.json'
 */
export declare function getRunPath(researchId: string, runId: string): string;
/**
 * Get the path to the research manifest file.
 *
 * @deprecated Use notebook frontmatter instead.
 * Legacy structure is deprecated. Research metadata is now stored in notebook YAML
 * frontmatter under the `gyoshu` key. Use `getNotebookPath(reportTitle)` to access
 * the notebook and read/write frontmatter with the notebook-frontmatter module.
 * This function is retained only for migration tool support.
 *
 * @param researchId - Unique identifier for the research project
 * @returns Path to `./gyoshu/research/{researchId}/research.json`
 *
 * @example
 * getResearchManifestPath('iris-clustering-2024');
 * // Returns: '/home/user/my-project/gyoshu/research/iris-clustering-2024/research.json'
 */
export declare function getResearchManifestPath(researchId: string): string;
/**
 * Get the path to the notebooks directory for a research project.
 *
 * @deprecated Use `getNotebookPath(reportTitle)` instead.
 * Legacy structure is deprecated. Notebooks are now stored in a flat structure:
 * `./notebooks/{reportTitle}.ipynb`. Use `getNotebookPath(reportTitle)` for the
 * canonical path. This function is retained only for migration tool support.
 *
 * @param researchId - Unique identifier for the research project
 * @returns Path to `./gyoshu/research/{researchId}/notebooks/`
 *
 * @example
 * getResearchNotebooksDir('iris-clustering-2024');
 * // Returns: '/home/user/my-project/gyoshu/research/iris-clustering-2024/notebooks'
 */
export declare function getResearchNotebooksDir(researchId: string): string;
/**
 * Get the path to the artifacts directory for a research project.
 *
 * @deprecated Use `getReportDir(reportTitle)` instead.
 * Legacy structure is deprecated. Artifacts are now stored in the reports directory:
 * `./reports/{reportTitle}/`. Use `getReportDir(reportTitle)` for figures, models,
 * exports, etc. This function is retained only for migration tool support.
 *
 * @param researchId - Unique identifier for the research project
 * @returns Path to `./gyoshu/research/{researchId}/artifacts/`
 *
 * @example
 * getResearchArtifactsDir('iris-clustering-2024');
 * // Returns: '/home/user/my-project/gyoshu/research/iris-clustering-2024/artifacts'
 */
export declare function getResearchArtifactsDir(researchId: string): string;
/**
 * Get the path to the runtime directory.
 * Contains ephemeral session data like locks and sockets.
 * Uses OS-appropriate temp directories instead of project root.
 *
 * Priority:
 * 1. GYOSHU_RUNTIME_DIR environment variable (explicit override)
 * 2. XDG_RUNTIME_DIR (Linux standard, usually /run/user/{uid})
 * 3. Platform-specific user cache directory
 * 4. os.tmpdir() fallback
 *
 * @returns Path to runtime directory (outside project root)
 *
 * @example
 * getRuntimeDir();
 * // Linux with XDG: '/run/user/1000/gyoshu'
 * // macOS: '/Users/name/Library/Caches/gyoshu/runtime'
 * // Fallback: '/tmp/gyoshu/runtime'
 */
export declare function getRuntimeDir(): string;
/**
 * Shorten a session ID to fit within Unix socket path constraints.
 * Uses SHA256 hash truncated to 12 hex chars (48 bits).
 *
 * Unix sockets have path length limits (UNIX_PATH_MAX):
 * - Linux: 108 bytes
 * - macOS: 104 bytes
 *
 * SECURITY: Always hashes the input, even for short IDs.
 * This prevents path traversal attacks via malicious short IDs like ".." or "../x".
 *
 * @param sessionId - Original session identifier (can be any length)
 * @returns Short identifier (12 hex chars) suitable for socket paths
 */
export declare function shortenSessionId(sessionId: string): string;
/**
 * Clear any runtime directory cache (no-op currently, env vars are read dynamically).
 * Provided for test compatibility with clearProjectRootCache().
 */
export declare function clearRuntimeDirCache(): void;
/**
 * Get the path to a specific session's runtime directory.
 * Uses shortened session ID to ensure socket paths stay within limits.
 *
 * @param sessionId - Unique identifier for the session
 * @returns Path to runtime/{shortId}/ in OS temp directory
 */
export declare function getSessionDir(sessionId: string): string;
/**
 * Get session directory path from an already-shortened session ID.
 * Use this when you already have the 12-char hash (e.g., from readdirSync on runtime dir).
 *
 * SECURITY NOTE: This function does NOT hash the input - it must already be a valid
 * 12-char hex short ID. Use getSessionDir() for untrusted/original session IDs.
 *
 * @param shortId - Already-shortened 12-char hex session identifier (from directory name)
 * @returns Path to runtime/{shortId}/ in OS temp directory
 *
 * @example
 * // When iterating runtime directories (names are already hashed):
 * const shortIds = fs.readdirSync(getRuntimeDir());
 * for (const shortId of shortIds) {
 *   const sessionDir = getSessionDirByShortId(shortId);
 *   // ...
 * }
 */
export declare function getSessionDirByShortId(shortId: string): string;
/**
 * Get the path to a session's lock file.
 *
 * @param sessionId - Unique identifier for the session
 * @returns Path to session.lock in session's runtime directory
 */
export declare function getSessionLockPath(sessionId: string): string;
/**
 * Get the path to a session's bridge socket.
 * Path is kept short to respect Unix socket path limits (~108 bytes).
 *
 * @param sessionId - Unique identifier for the session
 * @returns Path to bridge.sock in session's runtime directory
 */
export declare function getBridgeSocketPath(sessionId: string): string;
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
export declare function getRetrospectivesDir(): string;
/**
 * Get the path to the retrospectives feedback file.
 *
 * @returns Path to `./gyoshu/retrospectives/feedback.jsonl`
 *
 * @example
 * getRetrospectivesFeedbackPath();
 * // Returns: '/home/user/my-project/gyoshu/retrospectives/feedback.jsonl'
 */
export declare function getRetrospectivesFeedbackPath(): string;
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
export declare function getLibDir(): string;
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
export declare function getAssetsDir(): string;
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
export declare function getExternalDir(): string;
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
export declare function getLegacySessionsDir(): string;
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
export declare function hasLegacySessions(): boolean;
/**
 * Get path to a specific legacy session directory.
 *
 * @param sessionId - Session identifier
 * @returns Path to `~/.gyoshu/sessions/{sessionId}/`
 */
export declare function getLegacySessionPath(sessionId: string): string;
/**
 * Get path to a legacy session's manifest file.
 *
 * @param sessionId - Session identifier
 * @returns Path to `~/.gyoshu/sessions/{sessionId}/manifest.json`
 */
export declare function getLegacyManifestPath(sessionId: string): string;
/**
 * Get path to a legacy session's artifacts directory.
 *
 * @param sessionId - Session identifier
 * @returns Path to `~/.gyoshu/sessions/{sessionId}/artifacts/`
 */
export declare function getLegacyArtifactsDir(sessionId: string): string;
/**
 * Read the Gyoshu config file.
 * Returns null if config doesn't exist or is invalid.
 *
 * @returns The config object or null if not found/invalid
 */
export declare function getConfig(): GyoshuConfig | null;
/**
 * Ensure Gyoshu is initialized for the current project.
 * Creates the gyoshu directory and config.json if they don't exist.
 *
 * @param projectName - Optional project name to store in config
 * @returns The Gyoshu config (existing or newly created)
 */
export declare function ensureGyoshuInitialized(projectName?: string): GyoshuConfig;
/**
 * Ensure a directory exists, creating it if necessary.
 * Uses synchronous operations for simplicity in path setup.
 *
 * Security: Creates directories with mode 0700 (owner-only access) by default.
 * This is important for runtime directories containing sockets and session data.
 *
 * Security: Creates directories one segment at a time, verifying each after creation.
 * This prevents TOCTOU race conditions where an attacker creates a symlink at an
 * intermediate path between a check and mkdir. Each segment is lstat-verified
 * immediately after creation to detect race condition attacks.
 *
 * @param dirPath - Path to the directory to ensure
 * @param mode - Optional permissions mode (default: 0o700)
 * @throws Error if any path component is a symlink or race condition detected
 */
export declare function ensureDirSync(dirPath: string, mode?: number): void;
/**
 * Check if a file or directory exists.
 *
 * @param filePath - Path to check
 * @returns true if the path exists
 */
export declare function existsSync(filePath: string): boolean;
/**
 * Get the current schema version for the storage structure.
 * Used for future migrations when the storage layout changes.
 *
 * @returns Current schema version number
 */
export declare function getSchemaVersion(): number;
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
export declare function validatePathSegment(segment: string, name: string): void;
