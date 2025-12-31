/**
 * Session Lock - Cross-platform file-based session locking
 * 
 * Provides single-writer enforcement per session with:
 * - PID-reuse safety via process start time verification
 * - Cross-platform support (Linux, macOS, Windows)
 * - Stale lock detection and safe breaking
 * - Request queuing with timeout
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

const STALE_LOCK_AGE_MS = 60000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30000;
const LOCK_RETRY_INTERVAL_MS = 100;

/**
 * Get process start time on Linux via /proc/{pid}/stat field 21.
 * The stat format is: pid (comm) state ppid... with field 21 being starttime.
 * Command names can contain spaces/parens, so we parse from the last ')'.
 */
export async function getProcessStartTimeLinux(pid: number): Promise<number | null> {
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const closeParen = stat.lastIndexOf(')');
    if (closeParen === -1) return null;
    
    const fieldsAfterComm = stat.substring(closeParen + 2).split(' ');
    // starttime is at index 19 after removing pid and comm fields
    const startTimeField = fieldsAfterComm[19];
    if (!startTimeField) return null;
    
    return parseInt(startTimeField, 10);
  } catch {
    return null;
  }
}

/**
 * Get process start time on macOS via `ps -p {pid} -o lstart=`.
 * Returns Unix timestamp in ms, or null if unavailable.
 */
export async function getProcessStartTimeMacOS(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execAsync(`ps -p ${pid} -o lstart=`);
    const lstart = stdout.trim();
    if (!lstart) return null;
    
    const date = new Date(lstart);
    if (isNaN(date.getTime())) return null;
    
    return date.getTime();
  } catch {
    return null;
  }
}

export async function getCurrentProcessStartTime(): Promise<number | undefined> {
  const pid = process.pid;
  
  if (process.platform === 'linux') {
    const startTime = await getProcessStartTimeLinux(pid);
    return startTime ?? undefined;
  } else if (process.platform === 'darwin') {
    const startTime = await getProcessStartTimeMacOS(pid);
    return startTime ?? undefined;
  }
  
  return undefined;
}

/**
 * Check if a process is alive with PID-reuse detection via start time comparison.
 * On Windows, only checks process existence (no start time verification).
 */
export async function isProcessAlive(pid: number, recordedStartTime?: number): Promise<boolean> {
  if (process.platform === 'linux') {
    const currentStartTime = await getProcessStartTimeLinux(pid);
    if (currentStartTime === null) return false;
    
    if (recordedStartTime !== undefined && currentStartTime !== recordedStartTime) {
      return false;
    }
    
    return true;
  } else if (process.platform === 'darwin') {
    try {
      const { stdout } = await execAsync(`ps -p ${pid} -o pid=`);
      if (stdout.trim() === '') return false;
      
      if (recordedStartTime !== undefined) {
        const currentStartTime = await getProcessStartTimeMacOS(pid);
        if (currentStartTime !== null && currentStartTime !== recordedStartTime) {
          return false;
        }
      }
      
      return true;
    } catch {
      return false;
    }
  } else if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync(`tasklist /FI "PID eq ${pid}" /NH`);
      return !stdout.includes('No tasks');
    } catch {
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
export async function canBreakLock(lockInfo: LockInfo): Promise<boolean> {
  const age = Date.now() - new Date(lockInfo.acquiredAt).getTime();
  
  if (age < STALE_LOCK_AGE_MS) {
    return false;
  }
  
  if (process.platform === 'win32') {
    console.warn(
      `[SessionLock] Lock held by PID ${lockInfo.pid} on ${lockInfo.hostname}. ` +
      `Manual unlock required on Windows. Lock age: ${Math.round(age / 1000)}s`
    );
    return false;
  }
  
  if (lockInfo.hostname !== os.hostname()) {
    console.warn(
      `[SessionLock] Lock held by different host: ${lockInfo.hostname}. ` +
      `Cannot verify process status remotely. Lock age: ${Math.round(age / 1000)}s`
    );
    return age > 300000; // 5 minutes for remote locks
  }
  
  const alive = await isProcessAlive(lockInfo.pid, lockInfo.processStartTime);
  
  if (!alive) {
    console.log(
      `[SessionLock] Breaking stale lock from dead process PID ${lockInfo.pid}. ` +
      `Lock age: ${Math.round(age / 1000)}s`
    );
  }
  
  return !alive;
}

export async function readLockFile(lockPath: string): Promise<LockInfo | null> {
  try {
    const content = await fs.readFile(lockPath, 'utf8');
    const lockInfo = JSON.parse(content) as LockInfo;
    
    if (!lockInfo.lockId || !lockInfo.pid || !lockInfo.hostname || !lockInfo.acquiredAt) {
      return null;
    }
    
    return lockInfo;
  } catch {
    return null;
  }
}

async function writeLockFile(lockPath: string, lockInfo: LockInfo): Promise<void> {
  const content = JSON.stringify(lockInfo, null, 2);
  const tempPath = `${lockPath}.${process.pid}.tmp`;
  
  try {
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(tempPath, content, { mode: 0o644 });
    await fs.rename(tempPath, lockPath);
  } finally {
    try {
      await fs.unlink(tempPath);
    } catch {
      // Temp file may already be renamed or deleted
    }
  }
}

async function createLockInfo(): Promise<LockInfo> {
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
export class SessionLock {
  private lockPath: string;
  private lockInfo: LockInfo | null = null;
  private released: boolean = false;

  constructor(lockPath: string) {
    this.lockPath = lockPath;
  }

  getLockInfo(): LockInfo | null {
    return this.lockInfo;
  }

  isLocked(): boolean {
    return this.lockInfo !== null && !this.released;
  }

  async acquire(timeout: number = DEFAULT_ACQUIRE_TIMEOUT_MS): Promise<void> {
    if (this.lockInfo && !this.released) {
      throw new Error('Lock already held by this instance');
    }

    const startTime = Date.now();
    let lastError: string = '';

    while (Date.now() - startTime < timeout) {
      const result = await this.tryAcquire();
      
      if (result.success) {
        this.lockInfo = result.lockInfo!;
        this.released = false;
        return;
      }

      lastError = result.error || 'Unknown error';
      await sleep(LOCK_RETRY_INTERVAL_MS);
    }

    throw new Error(
      `Failed to acquire lock within ${timeout}ms: ${lastError}. ` +
      `Lock path: ${this.lockPath}`
    );
  }

  async tryAcquire(): Promise<LockResult> {
    try {
      const existingLock = await readLockFile(this.lockPath);
      
      if (existingLock) {
        if (await canBreakLock(existingLock)) {
          try {
            await fs.unlink(this.lockPath);
          } catch {
            // Lock might have been removed by another process
          }
        } else {
          return {
            success: false,
            error: `Lock held by PID ${existingLock.pid} on ${existingLock.hostname} since ${existingLock.acquiredAt}`,
          };
        }
      }

      const newLockInfo = await createLockInfo();

      try {
        await fs.mkdir(path.dirname(this.lockPath), { recursive: true });
        await fs.writeFile(this.lockPath, JSON.stringify(newLockInfo, null, 2), {
          flag: 'wx',
          mode: 0o644,
        });
      } catch (err: any) {
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
    } catch (err: any) {
      return {
        success: false,
        error: `Lock acquisition error: ${err.message}`,
      };
    }
  }

  async release(): Promise<void> {
    if (!this.lockInfo || this.released) {
      return;
    }

    try {
      const currentLock = await readLockFile(this.lockPath);
      
      if (currentLock && currentLock.lockId === this.lockInfo.lockId) {
        await fs.unlink(this.lockPath);
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.warn(`[SessionLock] Error releasing lock: ${err.message}`);
      }
    } finally {
      this.released = true;
    }
  }

  async forceBreak(): Promise<void> {
    try {
      await fs.unlink(this.lockPath);
      console.warn(`[SessionLock] Force-broke lock at ${this.lockPath}`);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
    this.lockInfo = null;
    this.released = true;
  }
}

export async function acquireLock(
  lockPath: string,
  timeout: number = DEFAULT_ACQUIRE_TIMEOUT_MS
): Promise<SessionLock> {
  const lock = new SessionLock(lockPath);
  await lock.acquire(timeout);
  return lock;
}

export async function releaseLock(lock: SessionLock): Promise<void> {
  await lock.release();
}

export async function getLockStatus(lockPath: string): Promise<{
  locked: boolean;
  lockInfo: LockInfo | null;
  canBreak: boolean;
  ownedByUs: boolean;
}> {
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function while holding a lock, releasing automatically on completion.
 */
export async function withLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  timeout: number = DEFAULT_ACQUIRE_TIMEOUT_MS
): Promise<T> {
  const lock = await acquireLock(lockPath, timeout);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
