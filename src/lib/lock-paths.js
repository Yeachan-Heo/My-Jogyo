"use strict";
/**
 * Lock Path Helpers for Gyoshu Parallel Workers
 *
 * Provides consistent lock file paths for notebook/report/queue operations.
 * Uses the runtime directory (OS temp) to avoid cluttering the project.
 *
 * ## Lock Ordering (MUST follow to avoid deadlocks):
 *
 * 1. QUEUE_LOCK - Held briefly, protects job queue mutations
 * 2. NOTEBOOK_LOCK - Held briefly, protects notebook file writes
 * 3. REPORT_LOCK - Held briefly, protects report file writes
 *
 * Always acquire locks in this order. Release in reverse order.
 *
 * ## CRITICAL RULES:
 *
 * - NEVER hold locks during Python execution (long-running operations)
 * - Lock timeout should be 30 seconds (fail-fast, not infinite wait)
 * - Always use `withLock()` from session-lock.ts for automatic cleanup
 * - If you need multiple locks, acquire QUEUE first, then NOTEBOOK, then REPORT
 *
 * ## Lock File Locations:
 *
 * ```
 * ${getRuntimeDir()}/locks/
 * ├── queue/
 * │   └── {shortId}.lock         # Queue mutations for a specific run
 * ├── notebook/
 * │   └── {shortId}.lock         # Notebook writes for a specific research
 * └── report/
 *     └── {shortId}.lock         # Report writes for a specific research
 * ```
 *
 * Note: Lock IDs are hashed to 12 chars using shortenSessionId() to respect
 * Unix socket path limits and ensure consistent path lengths.
 *
 * @module lock-paths
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
exports.LOCK_ORDER = exports.DEFAULT_LOCK_TIMEOUT_MS = void 0;
exports.getLocksDir = getLocksDir;
exports.getNotebookLockPath = getNotebookLockPath;
exports.getReportLockPath = getReportLockPath;
exports.getQueueLockPath = getQueueLockPath;
exports.getBridgeMetaLockPath = getBridgeMetaLockPath;
exports.getBridgeMetaLockPathByShortId = getBridgeMetaLockPathByShortId;
const path = __importStar(require("path"));
const paths_1 = require("./paths");
// =============================================================================
// CONSTANTS
// =============================================================================
/**
 * Default lock acquisition timeout in milliseconds.
 * Fail-fast behavior to prevent deadlocks - 30 seconds is enough
 * for brief file operations.
 */
exports.DEFAULT_LOCK_TIMEOUT_MS = 30000;
/**
 * Lock type subdirectories within the locks directory.
 */
const LOCK_TYPE_QUEUE = "queue";
const LOCK_TYPE_NOTEBOOK = "notebook";
const LOCK_TYPE_REPORT = "report";
// =============================================================================
// LOCK PATH GETTERS
// =============================================================================
/**
 * Get the base locks directory within the runtime directory.
 *
 * @returns Path to `${getRuntimeDir()}/locks/`
 *
 * @example
 * getLocksDir();
 * // Returns: '/run/user/1000/gyoshu/locks' (Linux)
 * // Returns: '~/Library/Caches/gyoshu/runtime/locks' (macOS)
 */
function getLocksDir() {
    return path.join((0, paths_1.getRuntimeDir)(), "locks");
}
/**
 * Get the path to a notebook lock file.
 *
 * This lock should be held briefly around notebook file writes only.
 * NEVER hold this lock during Python code execution.
 *
 * @param reportTitle - The report/research title (e.g., "customer-churn-analysis")
 * @returns Path to `${getRuntimeDir()}/locks/notebook/{shortId}.lock`
 *
 * @example
 * getNotebookLockPath('customer-churn-analysis');
 * // Returns: '/run/user/1000/gyoshu/locks/notebook/abc123def456.lock'
 *
 * getNotebookLockPath('very-long-research-title-that-exceeds-normal-length');
 * // Returns: '/run/user/1000/gyoshu/locks/notebook/7f3c2d1e9a8b.lock'
 */
function getNotebookLockPath(reportTitle) {
    const lockId = createLockId("nb", reportTitle);
    return path.join(getLocksDir(), LOCK_TYPE_NOTEBOOK, `${lockId}.lock`);
}
/**
 * Get the path to a report lock file.
 *
 * This lock should be held briefly around report file writes only.
 * NEVER hold this lock during Python code execution.
 *
 * @param reportTitle - The report/research title (e.g., "customer-churn-analysis")
 * @returns Path to `${getRuntimeDir()}/locks/report/{shortId}.lock`
 *
 * @example
 * getReportLockPath('customer-churn-analysis');
 * // Returns: '/run/user/1000/gyoshu/locks/report/f1e2d3c4b5a6.lock'
 */
function getReportLockPath(reportTitle) {
    const lockId = createLockId("rpt", reportTitle);
    return path.join(getLocksDir(), LOCK_TYPE_REPORT, `${lockId}.lock`);
}
/**
 * Get the path to a queue lock file.
 *
 * This lock should be held briefly around job queue mutations only.
 * The queue lock should always be acquired FIRST if multiple locks are needed.
 *
 * @param reportTitle - The report/research title (e.g., "customer-churn-analysis")
 * @param runId - The run identifier (e.g., "run-001")
 * @returns Path to `${getRuntimeDir()}/locks/queue/{shortId}.lock`
 *
 * @example
 * getQueueLockPath('customer-churn-analysis', 'run-001');
 * // Returns: '/run/user/1000/gyoshu/locks/queue/9a8b7c6d5e4f.lock'
 */
function getQueueLockPath(reportTitle, runId) {
    const lockId = createLockId("q", `${reportTitle}:${runId}`);
    return path.join(getLocksDir(), LOCK_TYPE_QUEUE, `${lockId}.lock`);
}
/**
 * Get the path to a bridge metadata lock file.
 *
 * This lock synchronizes writes to bridge_meta.json across all tools
 * (python-repl and session-manager). Must be held briefly during:
 * - Reading existing metadata
 * - Merging with new data
 * - Writing atomically
 *
 * NEVER hold this lock during Python code execution.
 *
 * @param sessionId - The session identifier (e.g., "my-research-session")
 * @returns Path to `${getSessionDir(sessionId)}/bridge_meta.lock`
 *
 * @example
 * getBridgeMetaLockPath('my-research-session');
 * // Returns: '/run/user/1000/gyoshu/abc123def456/bridge_meta.lock'
 */
function getBridgeMetaLockPath(sessionId) {
    return path.join((0, paths_1.getSessionDir)(sessionId), "bridge_meta.lock");
}
/**
 * Get the path to a bridge metadata lock file by short ID.
 *
 * Same as getBridgeMetaLockPath but accepts a pre-shortened session ID.
 * Used when operating on session directories by their 12-char hash names.
 *
 * @param shortId - The shortened session ID (12-char hex hash)
 * @returns Path to `${getSessionDirByShortId(shortId)}/bridge_meta.lock`
 *
 * @example
 * getBridgeMetaLockPathByShortId('abc123def456');
 * // Returns: '/run/user/1000/gyoshu/abc123def456/bridge_meta.lock'
 */
function getBridgeMetaLockPathByShortId(shortId) {
    return path.join((0, paths_1.getSessionDirByShortId)(shortId), "bridge_meta.lock");
}
// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
/**
 * Create a short lock ID from a prefix and identifier.
 *
 * Uses shortenSessionId() to create a 12-char hash that:
 * - Stays within Unix socket path limits
 * - Is consistent for the same input
 * - Avoids collisions (281 trillion possible values)
 *
 * @param prefix - Lock type prefix (e.g., "nb", "rpt", "q")
 * @param identifier - The identifier to hash (e.g., reportTitle)
 * @returns A 12-character hex string
 */
function createLockId(prefix, identifier) {
    const combined = `${prefix}:${identifier}`;
    return (0, paths_1.shortenSessionId)(combined);
}
// =============================================================================
// LOCK ORDERING DOCUMENTATION
// =============================================================================
/**
 * Lock ordering enum for documentation and type safety.
 *
 * When acquiring multiple locks, ALWAYS acquire in this order:
 * 1. QUEUE (lowest number = acquired first)
 * 2. NOTEBOOK
 * 3. REPORT (highest number = acquired last)
 *
 * Release in reverse order (REPORT, then NOTEBOOK, then QUEUE).
 */
exports.LOCK_ORDER = {
    /** Acquire first (priority 1) - protects job queue mutations */
    QUEUE: 1,
    /** Acquire second (priority 2) - protects notebook file writes */
    NOTEBOOK: 2,
    /** Acquire third (priority 3) - protects report file writes */
    REPORT: 3,
};
