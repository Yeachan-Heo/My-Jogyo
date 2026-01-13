"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNotebookRootDir = getNotebookRootDir;
exports.getReportsRootDir = getReportsRootDir;
exports.getNotebookPath = getNotebookPath;
exports.getReportDir = getReportDir;
exports.getReportReadmePath = getReportReadmePath;
exports.getCheckpointDir = getCheckpointDir;
exports.getCheckpointManifestPath = getCheckpointManifestPath;
exports.detectProjectRoot = detectProjectRoot;
exports.clearProjectRootCache = clearProjectRootCache;
exports.getGyoshuRoot = getGyoshuRoot;
exports.getConfigPath = getConfigPath;
exports.getResearchDir = getResearchDir;
exports.getResearchPath = getResearchPath;
exports.getRunPath = getRunPath;
exports.getResearchManifestPath = getResearchManifestPath;
exports.getResearchNotebooksDir = getResearchNotebooksDir;
exports.getResearchArtifactsDir = getResearchArtifactsDir;
exports.getRuntimeDir = getRuntimeDir;
exports.shortenSessionId = shortenSessionId;
exports.clearRuntimeDirCache = clearRuntimeDirCache;
exports.getSessionDir = getSessionDir;
exports.getSessionDirByShortId = getSessionDirByShortId;
exports.getSessionLockPath = getSessionLockPath;
exports.getBridgeSocketPath = getBridgeSocketPath;
exports.getRetrospectivesDir = getRetrospectivesDir;
exports.getRetrospectivesFeedbackPath = getRetrospectivesFeedbackPath;
exports.getLibDir = getLibDir;
exports.getAssetsDir = getAssetsDir;
exports.getExternalDir = getExternalDir;
exports.getLegacySessionsDir = getLegacySessionsDir;
exports.hasLegacySessions = hasLegacySessions;
exports.getLegacySessionPath = getLegacySessionPath;
exports.getLegacyManifestPath = getLegacyManifestPath;
exports.getLegacyArtifactsDir = getLegacyArtifactsDir;
exports.getConfig = getConfig;
exports.ensureGyoshuInitialized = ensureGyoshuInitialized;
exports.ensureDirSync = ensureDirSync;
exports.existsSync = existsSync;
exports.getSchemaVersion = getSchemaVersion;
exports.validatePathSegment = validatePathSegment;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
function readFileNoFollowSyncLocal(filePath) {
    const fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        return fs.readFileSync(fd, "utf-8");
    }
    finally {
        fs.closeSync(fd);
    }
}
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
 * Environment variable for explicit runtime directory override.
 * Takes highest priority for runtime directory location.
 */
const ENV_RUNTIME_DIR = "GYOSHU_RUNTIME_DIR";
/**
 * Maximum length for Unix socket paths (Linux: 108, macOS: 104).
 * We use a conservative value that works on both platforms.
 */
const MAX_SOCKET_PATH_LENGTH = 100;
/**
 * Length of the short session ID hash used for socket paths.
 * 12 hex chars = 6 bytes = 281 trillion possible values, negligible collision risk.
 */
const SHORT_SESSION_ID_LENGTH = 12;
/**
 * Current Gyoshu version string.
 */
const CURRENT_VERSION = "1.0.0";
/**
 * Windows reserved device names that cannot be used as file names.
 * These names cause issues on Windows regardless of file extension.
 * Applied unconditionally (portable-safe) to prevent cross-platform issues.
 */
const WINDOWS_RESERVED_NAMES = new Set([
    // Standard reserved device names
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
    // Extended reserved names (FIX-130)
    'CONIN$', 'CONOUT$', 'CLOCK$',
    // Superscript digit variants (Windows treats ¹²³ as 1 2 3)
    'COM\u00b9', 'COM\u00b2', 'COM\u00b3',
    'LPT\u00b9', 'LPT\u00b2', 'LPT\u00b3',
]);
/**
 * Legacy sessions directory in user's home.
 * Used for migration support from older versions.
 */
const LEGACY_SESSIONS_DIR = path.join(os.homedir(), ".gyoshu", "sessions");
// =============================================================================
// NOTEBOOK AND REPORT PATH GETTERS
// =============================================================================
function getNotebookRootDir() {
    return path.join(detectProjectRoot(), "notebooks");
}
function getReportsRootDir() {
    return path.join(detectProjectRoot(), "reports");
}
function getNotebookPath(reportTitle) {
    validatePathSegment(reportTitle, "reportTitle");
    return path.join(getNotebookRootDir(), `${reportTitle}.ipynb`);
}
function getReportDir(reportTitle) {
    validatePathSegment(reportTitle, "reportTitle");
    return path.join(getReportsRootDir(), reportTitle);
}
function getReportReadmePath(reportTitle) {
    validatePathSegment(reportTitle, "reportTitle");
    return path.join(getReportDir(reportTitle), "README.md");
}
// =============================================================================
// CHECKPOINT PATH GETTERS
// =============================================================================
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
function getCheckpointDir(reportTitle, runId) {
    validatePathSegment(reportTitle, "reportTitle");
    validatePathSegment(runId, "runId");
    return path.join(getReportDir(reportTitle), "checkpoints", runId);
}
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
function getCheckpointManifestPath(reportTitle, runId, checkpointId) {
    validatePathSegment(reportTitle, "reportTitle");
    validatePathSegment(runId, "runId");
    validatePathSegment(checkpointId, "checkpointId");
    return path.join(getCheckpointDir(reportTitle, runId), checkpointId, "checkpoint.json");
}
// =============================================================================
// ROOT DETECTION (SYNC)
// =============================================================================
/**
 * FIX-165: Validate that a project root path is safe to use.
 * @param dir - Path to validate
 * @returns true if the path is a real directory (not a symlink)
 */
function isValidProjectRoot(dir) {
    try {
        const stat = fs.lstatSync(dir);
        if (!stat.isDirectory())
            return false;
        if (stat.isSymbolicLink())
            return false;
        return true;
    }
    catch {
        return false;
    }
}
/** Cached project root to avoid repeated filesystem walks */
let cachedProjectRoot = null;
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
function detectProjectRoot() {
    // Return cached value if available
    if (cachedProjectRoot !== null) {
        return cachedProjectRoot;
    }
    // Strategy 1: Environment variable override
    // FIX-165: Validate GYOSHU_PROJECT_ROOT is a real directory, not symlink
    const envRoot = process.env[ENV_PROJECT_ROOT];
    if (envRoot && isValidProjectRoot(envRoot)) {
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
function walkUpForMarker(startDir, marker) {
    let current = path.resolve(startDir);
    const root = path.parse(current).root;
    while (current !== root) {
        const markerPath = path.join(current, marker);
        if (fs.existsSync(markerPath)) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current)
            break; // Reached filesystem root
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
function clearProjectRootCache() {
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
function getGyoshuRoot() {
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
function getConfigPath() {
    return path.join(getGyoshuRoot(), CONFIG_FILE_NAME);
}
// =============================================================================
// RESEARCH PATH GETTERS (LEGACY - DEPRECATED)
// =============================================================================
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
function getResearchDir() {
    return path.join(getGyoshuRoot(), "research");
}
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
function getResearchPath(researchId) {
    return path.join(getResearchDir(), researchId);
}
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
function getRunPath(researchId, runId) {
    validatePathSegment(researchId, "researchId");
    validatePathSegment(runId, "runId");
    return path.join(getResearchPath(researchId), "runs", `${runId}.json`);
}
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
function getResearchManifestPath(researchId) {
    return path.join(getResearchPath(researchId), "research.json");
}
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
function getResearchNotebooksDir(researchId) {
    return path.join(getResearchPath(researchId), "notebooks");
}
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
function getResearchArtifactsDir(researchId) {
    return path.join(getResearchPath(researchId), "artifacts");
}
// =============================================================================
// RUNTIME PATH GETTERS (EPHEMERAL - OS TEMP DIRECTORIES)
// =============================================================================
/**
 * FIX-164: Validate XDG_RUNTIME_DIR security properties.
 * On multi-user systems, XDG_RUNTIME_DIR can be poisoned if not validated.
 * @param dir - XDG_RUNTIME_DIR path to validate
 * @returns true if the directory is secure (exists, not symlink, owned by uid, mode 0700)
 */
function isSecureRuntimeDir(dir) {
    // FIX-169: Must be absolute path (prevents XDG_RUNTIME_DIR="." exploits)
    if (!path.isAbsolute(dir))
        return false;
    try {
        const stat = fs.lstatSync(dir);
        if (!stat.isDirectory() || stat.isSymbolicLink())
            return false;
        if (stat.uid !== process.getuid?.())
            return false;
        if ((stat.mode & 0o777) !== 0o700)
            return false;
        return true;
    }
    catch {
        return false;
    }
}
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
function getRuntimeDir() {
    // FIX-182: Never throw - always fall through to platform defaults on validation failure
    const envRuntime = process.env[ENV_RUNTIME_DIR];
    if (envRuntime && path.isAbsolute(envRuntime)) {
        try {
            const stat = fs.lstatSync(envRuntime);
            if (stat.isDirectory() && !stat.isSymbolicLink() &&
                stat.uid === process.getuid?.() &&
                (stat.mode & 0o777) === 0o700) {
                return envRuntime;
            }
        }
        catch (e) {
            if (e.code === "ENOENT") {
                try {
                    ensureDirSync(envRuntime, 0o700);
                    const postStat = fs.lstatSync(envRuntime);
                    if (postStat.isDirectory() && !postStat.isSymbolicLink() &&
                        postStat.uid === process.getuid?.() &&
                        (postStat.mode & 0o777) === 0o700) {
                        return envRuntime;
                    }
                }
                catch {
                }
            }
        }
    }
    // Priority 2: XDG_RUNTIME_DIR (Linux standard, usually /run/user/{uid})
    // FIX-164: Validate XDG_RUNTIME_DIR security properties before use
    const xdgRuntime = process.env.XDG_RUNTIME_DIR;
    if (xdgRuntime && isSecureRuntimeDir(xdgRuntime)) {
        return path.join(xdgRuntime, "gyoshu");
    }
    // Priority 3: Platform-specific user cache directory
    const platform = process.platform;
    if (platform === "darwin") {
        return path.join(os.homedir(), "Library", "Caches", "gyoshu", "runtime");
    }
    else if (platform === "win32") {
        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
        return path.join(localAppData, "gyoshu", "runtime");
    }
    else if (platform === "linux") {
        // Linux - use ~/.cache/gyoshu/runtime
        return path.join(os.homedir(), ".cache", "gyoshu", "runtime");
    }
    // Priority 4: Final fallback to os.tmpdir() for any other platform
    return path.join(os.tmpdir(), "gyoshu", "runtime");
}
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
function shortenSessionId(sessionId) {
    // SECURITY: Always hash - do not return raw input even for short IDs
    // This prevents traversal attacks like "../.." which is only 5 chars
    return crypto
        .createHash("sha256")
        .update(sessionId)
        .digest("hex")
        .slice(0, SHORT_SESSION_ID_LENGTH);
}
/**
 * Clear any runtime directory cache (no-op currently, env vars are read dynamically).
 * Provided for test compatibility with clearProjectRootCache().
 */
function clearRuntimeDirCache() {
    // No-op: getRuntimeDir reads env vars dynamically, no caching needed
}
/**
 * Get the path to a specific session's runtime directory.
 * Uses shortened session ID to ensure socket paths stay within limits.
 *
 * @param sessionId - Unique identifier for the session
 * @returns Path to runtime/{shortId}/ in OS temp directory
 */
function getSessionDir(sessionId) {
    const shortId = shortenSessionId(sessionId);
    return path.join(getRuntimeDir(), shortId);
}
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
function getSessionDirByShortId(shortId) {
    return path.join(getRuntimeDir(), shortId);
}
/**
 * Get the path to a session's lock file.
 *
 * @param sessionId - Unique identifier for the session
 * @returns Path to session.lock in session's runtime directory
 */
function getSessionLockPath(sessionId) {
    return path.join(getSessionDir(sessionId), "session.lock");
}
/**
 * Get the path to a session's bridge socket.
 * Path is kept short to respect Unix socket path limits (~108 bytes).
 *
 * @param sessionId - Unique identifier for the session
 * @returns Path to bridge.sock in session's runtime directory
 */
function getBridgeSocketPath(sessionId) {
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
function getRetrospectivesDir() {
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
function getRetrospectivesFeedbackPath() {
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
function getLibDir() {
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
function getAssetsDir() {
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
function getExternalDir() {
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
function getLegacySessionsDir() {
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
function hasLegacySessions() {
    try {
        if (!fs.existsSync(LEGACY_SESSIONS_DIR)) {
            return false;
        }
        const entries = fs.readdirSync(LEGACY_SESSIONS_DIR);
        return entries.length > 0;
    }
    catch {
        return false;
    }
}
/**
 * Get path to a specific legacy session directory.
 *
 * @param sessionId - Session identifier
 * @returns Path to `~/.gyoshu/sessions/{sessionId}/`
 */
function getLegacySessionPath(sessionId) {
    return path.join(LEGACY_SESSIONS_DIR, sessionId);
}
/**
 * Get path to a legacy session's manifest file.
 *
 * @param sessionId - Session identifier
 * @returns Path to `~/.gyoshu/sessions/{sessionId}/manifest.json`
 */
function getLegacyManifestPath(sessionId) {
    return path.join(getLegacySessionPath(sessionId), "manifest.json");
}
/**
 * Get path to a legacy session's artifacts directory.
 *
 * @param sessionId - Session identifier
 * @returns Path to `~/.gyoshu/sessions/{sessionId}/artifacts/`
 */
function getLegacyArtifactsDir(sessionId) {
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
function getConfig() {
    const configPath = getConfigPath();
    try {
        const content = readFileNoFollowSyncLocal(configPath);
        return JSON.parse(content);
    }
    catch (err) {
        // ENOENT = doesn't exist, ELOOP = symlink rejected by O_NOFOLLOW
        const code = err.code;
        if (code === "ENOENT" || code === "ELOOP") {
            return null;
        }
        // Other errors (parse errors, permission issues) - return null for robustness
        return null;
    }
}
/**
 * Create a default Gyoshu config object.
 *
 * @param projectName - Optional project name
 * @returns A new GyoshuConfig with current version and timestamp
 */
function createDefaultConfig(projectName) {
    return {
        version: CURRENT_VERSION,
        schemaVersion: getSchemaVersion(),
        createdAt: new Date().toISOString(),
        ...(projectName && { projectName }),
    };
}
/**
 * Ensure Gyoshu is initialized for the current project.
 * Creates the gyoshu directory and config.json if they don't exist.
 *
 * @param projectName - Optional project name to store in config
 * @returns The Gyoshu config (existing or newly created)
 */
function ensureGyoshuInitialized(projectName) {
    const gyoshuRoot = getGyoshuRoot();
    const configPath = getConfigPath();
    const existingConfig = getConfig();
    if (existingConfig) {
        return existingConfig;
    }
    ensureDirSync(gyoshuRoot);
    const config = createDefaultConfig(projectName);
    atomicWriteSync(configPath, JSON.stringify(config, null, 2));
    return config;
}
// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================
/**
 * Synchronous atomic write - writes to temp file then renames.
 * Security: Does not follow symlinks (rename replaces symlinks).
 *
 * @param targetPath - Path to the target file
 * @param data - String data to write
 * @param mode - File permissions (default: 0o600)
 */
function atomicWriteSync(targetPath, data, mode = 0o600) {
    const dir = path.dirname(targetPath);
    const base = path.basename(targetPath);
    const tempPath = path.join(dir, `.${base}.tmp.${process.pid}`);
    try {
        // Use 'wx' for exclusive creation (won't follow symlinks)
        fs.writeFileSync(tempPath, data, { flag: "wx", mode });
        fs.renameSync(tempPath, targetPath);
    }
    finally {
        try {
            fs.unlinkSync(tempPath);
        }
        catch {
            // Temp file may already be renamed
        }
    }
}
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
function ensureDirSync(dirPath, mode = 0o700) {
    const resolved = path.resolve(dirPath);
    const parts = resolved.split(path.sep).filter(Boolean);
    // Build path segment by segment
    let currentPath = resolved.startsWith(path.sep) ? path.sep : '';
    for (const part of parts) {
        currentPath = path.join(currentPath, part);
        try {
            const stat = fs.lstatSync(currentPath);
            // If exists, verify it's a directory (not symlink)
            if (stat.isSymbolicLink()) {
                throw new Error(`Security: path component ${currentPath} is a symlink`);
            }
            if (!stat.isDirectory()) {
                throw new Error(`Security: path component ${currentPath} is not a directory`);
            }
            // Exists and is a real directory - continue to next segment
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                // Doesn't exist - create it (no recursive flag!)
                fs.mkdirSync(currentPath, { mode });
                // Immediately verify what we created (defense against race)
                const createdStat = fs.lstatSync(currentPath);
                if (createdStat.isSymbolicLink()) {
                    try {
                        fs.rmdirSync(currentPath);
                    }
                    catch { }
                    throw new Error(`Security: race detected - ${currentPath} became a symlink`);
                }
                if (!createdStat.isDirectory()) {
                    try {
                        fs.unlinkSync(currentPath);
                    }
                    catch { }
                    throw new Error(`Security: race detected - ${currentPath} is not a directory`);
                }
            }
            else {
                throw err; // Re-throw other errors (including security errors)
            }
        }
    }
}
/**
 * Check if a file or directory exists.
 *
 * @param filePath - Path to check
 * @returns true if the path exists
 */
function existsSync(filePath) {
    return fs.existsSync(filePath);
}
/**
 * Get the current schema version for the storage structure.
 * Used for future migrations when the storage layout changes.
 *
 * @returns Current schema version number
 */
function getSchemaVersion() {
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
function validatePathSegment(segment, name) {
    if (!segment || typeof segment !== "string") {
        throw new Error(`${name} is required and must be a string`);
    }
    if (segment.trim().length === 0) {
        throw new Error(`Invalid ${name}: cannot be empty or whitespace`);
    }
    // Normalize Unicode to prevent bypass via alternative representations
    const normalized = segment.normalize("NFC");
    // Prevent path traversal attacks
    // Block both ".." (parent directory) and "." (current directory collapse)
    if (normalized === "." || normalized.includes("..") || normalized.includes("/") || normalized.includes("\\")) {
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
    // Reject Windows reserved device names (portable-safe)
    // Also handle COM1.txt, NUL.txt etc (anything starting with reserved name + optional extension)
    // FIX-135: Trim trailing spaces/dots from baseName to prevent bypass via "CON .txt" or "NUL..txt"
    const upperSegment = normalized.toUpperCase();
    const baseName = upperSegment.split('.')[0].replace(/[ .]+$/u, "");
    if (WINDOWS_RESERVED_NAMES.has(baseName)) {
        throw new Error(`${name} contains Windows reserved name: ${segment}`);
    }
    // Reject trailing dots or spaces (Windows path confusion)
    if (normalized.endsWith('.') || normalized.endsWith(' ')) {
        throw new Error(`${name} has trailing dot or space: ${segment}`);
    }
}
