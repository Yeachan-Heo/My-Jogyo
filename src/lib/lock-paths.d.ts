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
/**
 * Default lock acquisition timeout in milliseconds.
 * Fail-fast behavior to prevent deadlocks - 30 seconds is enough
 * for brief file operations.
 */
export declare const DEFAULT_LOCK_TIMEOUT_MS = 30000;
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
export declare function getLocksDir(): string;
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
export declare function getNotebookLockPath(reportTitle: string): string;
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
export declare function getReportLockPath(reportTitle: string): string;
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
export declare function getQueueLockPath(reportTitle: string, runId: string): string;
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
export declare function getBridgeMetaLockPath(sessionId: string): string;
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
export declare function getBridgeMetaLockPathByShortId(shortId: string): string;
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
export declare const LOCK_ORDER: {
    /** Acquire first (priority 1) - protects job queue mutations */
    readonly QUEUE: 1;
    /** Acquire second (priority 2) - protects notebook file writes */
    readonly NOTEBOOK: 2;
    /** Acquire third (priority 3) - protects report file writes */
    readonly REPORT: 3;
};
/**
 * Type for lock ordering values.
 */
export type LockOrder = (typeof LOCK_ORDER)[keyof typeof LOCK_ORDER];
