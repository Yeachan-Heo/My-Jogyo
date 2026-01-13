/**
 * Session Lock - Cross-platform file-based session locking
 *
 * Provides single-writer enforcement per session with:
 * - PID-reuse safety via process start time verification
 * - Cross-platform support (Linux, macOS, Windows)
 * - Stale lock detection and safe breaking
 * - Request queuing with timeout
 */
export interface LockInfo {
    lockId: string;
    pid: number;
    processStartTime?: number;
    hostname: string;
    acquiredAt: string;
}
export interface LockResult {
    success: boolean;
    error?: string;
    lockInfo?: LockInfo;
}
/**
 * Get process start time on Linux via /proc/{pid}/stat field 21.
 * The stat format is: pid (comm) state ppid... with field 21 being starttime.
 * Command names can contain spaces/parens, so we parse from the last ')'.
 */
export declare function getProcessStartTimeLinux(pid: number): Promise<number | null>;
/**
 * Get process start time on macOS via `ps -p {pid} -o lstart=`.
 * Returns Unix timestamp in ms, or null if unavailable.
 */
export declare function getProcessStartTimeMacOS(pid: number): Promise<number | null>;
export declare function getCurrentProcessStartTime(): Promise<number | undefined>;
/**
 * Check if a process is alive with PID-reuse detection via start time comparison.
 * On Windows, only checks process existence (no start time verification).
 */
export declare function isProcessAlive(pid: number, recordedStartTime?: number): Promise<boolean>;
/**
 * Check if a lock can be safely broken. A lock is breakable if:
 * - Age > 60 seconds AND
 * - Owning process is dead OR start time differs (PID reuse)
 *
 * Windows: Never auto-breaks locks (requires manual intervention).
 * Remote hosts: Only breaks if age > 5 minutes.
 */
export declare function canBreakLock(lockInfo: LockInfo): Promise<boolean>;
export declare function readLockFile(lockPath: string): Promise<LockInfo | null>;
/**
 * SessionLock manages a single lock file for session coordination.
 *
 * @example
 * const lock = new SessionLock('/path/to/session.lock');
 * try {
 *   await lock.acquire();
 *   // ... do work ...
 * } finally {
 *   await lock.release();
 * }
 */
export declare class SessionLock {
    private lockPath;
    private lockInfo;
    private released;
    constructor(lockPath: string);
    getLockInfo(): LockInfo | null;
    isLocked(): boolean;
    acquire(timeout?: number): Promise<void>;
    tryAcquire(): Promise<LockResult>;
    release(): Promise<void>;
    forceBreak(): Promise<void>;
}
export declare function acquireLock(lockPath: string, timeout?: number): Promise<SessionLock>;
export declare function releaseLock(lock: SessionLock): Promise<void>;
export declare function getLockStatus(lockPath: string): Promise<{
    locked: boolean;
    lockInfo: LockInfo | null;
    canBreak: boolean;
    ownedByUs: boolean;
}>;
/**
 * Execute a function while holding a lock, releasing automatically on completion.
 */
export declare function withLock<T>(lockPath: string, fn: () => Promise<T>, timeout?: number): Promise<T>;
