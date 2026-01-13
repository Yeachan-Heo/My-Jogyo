"use strict";
/**
 * Session Lock - Cross-platform file-based session locking
 *
 * Provides single-writer enforcement per session with:
 * - PID-reuse safety via process start time verification
 * - Cross-platform support (Linux, macOS, Windows)
 * - Stale lock detection and safe breaking
 * - Request queuing with timeout
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
exports.SessionLock = void 0;
exports.getProcessStartTimeLinux = getProcessStartTimeLinux;
exports.getProcessStartTimeMacOS = getProcessStartTimeMacOS;
exports.getCurrentProcessStartTime = getCurrentProcessStartTime;
exports.isProcessAlive = isProcessAlive;
exports.canBreakLock = canBreakLock;
exports.readLockFile = readLockFile;
exports.acquireLock = acquireLock;
exports.releaseLock = releaseLock;
exports.getLockStatus = getLockStatus;
exports.withLock = withLock;
const fs = __importStar(require("fs/promises"));
const fsSync = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const atomic_write_1 = require("./atomic-write");
const paths_1 = require("./paths");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/**
 * Validate that a PID is a positive integer.
 * Defense in depth against command injection via poisoned lock files.
 */
function isValidPid(pid) {
    return typeof pid === 'number' && Number.isInteger(pid) && pid > 0;
}
const STALE_LOCK_AGE_MS = 60000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30000;
const LOCK_RETRY_INTERVAL_MS = 100;
/**
 * Get process start time on Linux via /proc/{pid}/stat field 21.
 * The stat format is: pid (comm) state ppid... with field 21 being starttime.
 * Command names can contain spaces/parens, so we parse from the last ')'.
 */
async function getProcessStartTimeLinux(pid) {
    try {
        const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
        const closeParen = stat.lastIndexOf(')');
        if (closeParen === -1)
            return null;
        const fieldsAfterComm = stat.substring(closeParen + 2).split(' ');
        // starttime is at index 19 after removing pid and comm fields
        const startTimeField = fieldsAfterComm[19];
        if (!startTimeField)
            return null;
        return parseInt(startTimeField, 10);
    }
    catch {
        return null;
    }
}
/**
 * Get process start time on macOS via `ps -p {pid} -o lstart=`.
 * Returns Unix timestamp in ms, or null if unavailable.
 */
async function getProcessStartTimeMacOS(pid) {
    if (!isValidPid(pid))
        return null;
    try {
        const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'lstart='], {
            env: { ...process.env, LC_ALL: 'C' }
        });
        const lstart = stdout.trim();
        if (!lstart)
            return null;
        const date = new Date(lstart);
        if (isNaN(date.getTime()))
            return null;
        return date.getTime();
    }
    catch {
        return null;
    }
}
async function getCurrentProcessStartTime() {
    const pid = process.pid;
    if (process.platform === 'linux') {
        const startTime = await getProcessStartTimeLinux(pid);
        return startTime ?? undefined;
    }
    else if (process.platform === 'darwin') {
        const startTime = await getProcessStartTimeMacOS(pid);
        return startTime ?? undefined;
    }
    return undefined;
}
/**
 * Check if a process is alive with PID-reuse detection via start time comparison.
 * On Windows, only checks process existence (no start time verification).
 */
async function isProcessAlive(pid, recordedStartTime) {
    if (process.platform === 'linux') {
        const currentStartTime = await getProcessStartTimeLinux(pid);
        if (currentStartTime === null)
            return false;
        if (recordedStartTime !== undefined && currentStartTime !== recordedStartTime) {
            return false;
        }
        return true;
    }
    else if (process.platform === 'darwin') {
        if (!isValidPid(pid))
            return false;
        try {
            const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'pid='], {
                env: { ...process.env, LC_ALL: 'C' }
            });
            if (stdout.trim() === '')
                return false;
            if (recordedStartTime !== undefined) {
                const currentStartTime = await getProcessStartTimeMacOS(pid);
                // Fail-closed: if we can't get current start time but we have a recorded one,
                // assume PID reuse has occurred (safer than assuming same process)
                if (currentStartTime === null) {
                    return false;
                }
                if (currentStartTime !== recordedStartTime) {
                    return false;
                }
            }
            return true;
        }
        catch {
            return false;
        }
    }
    else if (process.platform === 'win32') {
        try {
            const { stdout } = await execFileAsync('tasklist', ['/FI', `PID eq ${pid}`, '/NH']);
            return !stdout.includes('No tasks');
        }
        catch {
            return true; // Conservative: assume alive if tasklist fails
        }
    }
    return true; // Unknown platform: assume alive
}
/**
 * Check if a lock can be safely broken. A lock is breakable if:
 * - Age > 60 seconds AND
 * - Owning process is dead OR start time differs (PID reuse)
 *
 * Windows: Never auto-breaks locks (requires manual intervention).
 * Remote hosts: Only breaks if age > 5 minutes.
 */
async function canBreakLock(lockInfo) {
    const age = Date.now() - new Date(lockInfo.acquiredAt).getTime();
    if (age < STALE_LOCK_AGE_MS) {
        return false;
    }
    if (process.platform === 'win32') {
        return false;
    }
    if (lockInfo.hostname !== os.hostname()) {
        return age > 300000; // 5 minutes for remote locks
    }
    const alive = await isProcessAlive(lockInfo.pid, lockInfo.processStartTime);
    return !alive;
}
async function readLockFile(lockPath) {
    try {
        // Security: Use O_NOFOLLOW to atomically reject symlinks (no TOCTOU race)
        const content = await (0, atomic_write_1.readFileNoFollow)(lockPath);
        const lockInfo = JSON.parse(content);
        if (!lockInfo.lockId || !isValidPid(lockInfo.pid) || !lockInfo.hostname || !lockInfo.acquiredAt) {
            return null;
        }
        return lockInfo;
    }
    catch {
        // ENOENT = doesn't exist, ELOOP = symlink rejected, or parse error
        return null;
    }
}
async function createLockInfo() {
    return {
        lockId: crypto.randomUUID(),
        pid: process.pid,
        processStartTime: await getCurrentProcessStartTime(),
        hostname: os.hostname(),
        acquiredAt: new Date().toISOString(),
    };
}
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
class SessionLock {
    lockPath;
    lockInfo = null;
    released = false;
    constructor(lockPath) {
        this.lockPath = lockPath;
    }
    getLockInfo() {
        return this.lockInfo;
    }
    isLocked() {
        return this.lockInfo !== null && !this.released;
    }
    async acquire(timeout = DEFAULT_ACQUIRE_TIMEOUT_MS) {
        if (this.lockInfo && !this.released) {
            throw new Error('Lock already held by this instance');
        }
        const startTime = Date.now();
        let lastError = '';
        while (Date.now() - startTime < timeout) {
            const result = await this.tryAcquire();
            if (result.success) {
                this.lockInfo = result.lockInfo;
                this.released = false;
                return;
            }
            lastError = result.error || 'Unknown error';
            await sleep(LOCK_RETRY_INTERVAL_MS);
        }
        throw new Error(`Failed to acquire lock within ${timeout}ms: ${lastError}. ` +
            `Lock path: ${this.lockPath}`);
    }
    async tryAcquire() {
        try {
            const existingLock = await readLockFile(this.lockPath);
            if (existingLock) {
                if (await canBreakLock(existingLock)) {
                    try {
                        await fs.unlink(this.lockPath);
                    }
                    catch {
                        // Lock might have been removed by another process
                    }
                }
                else {
                    return {
                        success: false,
                        error: `Lock held by PID ${existingLock.pid} on ${existingLock.hostname} since ${existingLock.acquiredAt}`,
                    };
                }
            }
            const newLockInfo = await createLockInfo();
            try {
                (0, paths_1.ensureDirSync)(path.dirname(this.lockPath));
                const flags = fsSync.constants.O_WRONLY |
                    fsSync.constants.O_CREAT |
                    fsSync.constants.O_EXCL;
                const lockFile = await (0, atomic_write_1.openNoFollow)(this.lockPath, flags, 0o600);
                try {
                    await lockFile.writeFile(JSON.stringify(newLockInfo, null, 2), { encoding: 'utf8' });
                    await lockFile.sync();
                }
                finally {
                    await lockFile.close();
                }
            }
            catch (err) {
                if (err.code === 'EEXIST') {
                    return {
                        success: false,
                        error: 'Lock file created by another process',
                    };
                }
                throw err;
            }
            // Race condition check: verify our lock wasn't overwritten
            const verifyLock = await readLockFile(this.lockPath);
            if (!verifyLock || verifyLock.lockId !== newLockInfo.lockId) {
                return {
                    success: false,
                    error: 'Lock verification failed - another process may have overwritten',
                };
            }
            return {
                success: true,
                lockInfo: newLockInfo,
            };
        }
        catch (err) {
            return {
                success: false,
                error: `Lock acquisition error: ${err.message}`,
            };
        }
    }
    async release() {
        if (!this.lockInfo || this.released) {
            return;
        }
        try {
            const currentLock = await readLockFile(this.lockPath);
            if (currentLock && currentLock.lockId === this.lockInfo.lockId) {
                await fs.unlink(this.lockPath);
            }
        }
        catch (err) {
            // Ignore errors (lock might be already gone)
        }
        finally {
            this.released = true;
        }
    }
    async forceBreak() {
        try {
            await fs.unlink(this.lockPath);
        }
        catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }
        this.lockInfo = null;
        this.released = true;
    }
}
exports.SessionLock = SessionLock;
async function acquireLock(lockPath, timeout = DEFAULT_ACQUIRE_TIMEOUT_MS) {
    const lock = new SessionLock(lockPath);
    await lock.acquire(timeout);
    return lock;
}
async function releaseLock(lock) {
    await lock.release();
}
async function getLockStatus(lockPath) {
    const lockInfo = await readLockFile(lockPath);
    if (!lockInfo) {
        return {
            locked: false,
            lockInfo: null,
            canBreak: false,
            ownedByUs: false,
        };
    }
    const canBreakResult = await canBreakLock(lockInfo);
    const ownedByUs = lockInfo.pid === process.pid && lockInfo.hostname === os.hostname();
    return {
        locked: true,
        lockInfo,
        canBreak: canBreakResult,
        ownedByUs,
    };
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Execute a function while holding a lock, releasing automatically on completion.
 */
async function withLock(lockPath, fn, timeout = DEFAULT_ACQUIRE_TIMEOUT_MS) {
    const lock = await acquireLock(lockPath, timeout);
    try {
        return await fn();
    }
    finally {
        await lock.release();
    }
}
