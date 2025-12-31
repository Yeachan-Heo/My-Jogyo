/**
 * Tests for session-lock.ts library
 *
 * Tests file-based session locking with PID-reuse safety,
 * stale lock detection, and cross-platform support.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import {
  SessionLock,
  acquireLock,
  releaseLock,
  getLockStatus,
  withLock,
  isProcessAlive,
  canBreakLock,
  readLockFile,
  getCurrentProcessStartTime,
  type LockInfo,
} from '../.opencode/lib/session-lock';

// Test directory for all lock tests
let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibesci-session-lock-test-'));
});

afterEach(async () => {
  if (testDir) {
    await fs.rm(testDir, { recursive: true, force: true });
  }
});

describe('SessionLock class', () => {
  test('acquires lock successfully', async () => {
    const lockPath = path.join(testDir, 'test.lock');
    const lock = new SessionLock(lockPath);

    await lock.acquire();

    expect(lock.isLocked()).toBe(true);
    expect(lock.getLockInfo()).not.toBeNull();
    expect(lock.getLockInfo()?.pid).toBe(process.pid);
    expect(lock.getLockInfo()?.hostname).toBe(os.hostname());

    await lock.release();
  });

  test('creates lock file on acquire', async () => {
    const lockPath = path.join(testDir, 'file-created.lock');
    const lock = new SessionLock(lockPath);

    await lock.acquire();

    const exists = await fs.access(lockPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    await lock.release();
  });

  test('removes lock file on release', async () => {
    const lockPath = path.join(testDir, 'file-removed.lock');
    const lock = new SessionLock(lockPath);

    await lock.acquire();
    await lock.release();

    const exists = await fs.access(lockPath).then(() => true).catch(() => false);
    expect(exists).toBe(false);
    expect(lock.isLocked()).toBe(false);
  });

  test('throws when re-acquiring held lock', async () => {
    const lockPath = path.join(testDir, 're-acquire.lock');
    const lock = new SessionLock(lockPath);

    await lock.acquire();

    await expect(lock.acquire()).rejects.toThrow('Lock already held');

    await lock.release();
  });

  test('release is idempotent', async () => {
    const lockPath = path.join(testDir, 'idempotent.lock');
    const lock = new SessionLock(lockPath);

    await lock.acquire();
    await lock.release();
    await lock.release(); // Should not throw
    await lock.release(); // Still should not throw

    expect(lock.isLocked()).toBe(false);
  });

  test('tryAcquire returns success on available lock', async () => {
    const lockPath = path.join(testDir, 'try-acquire.lock');
    const lock = new SessionLock(lockPath);

    const result = await lock.tryAcquire();

    expect(result.success).toBe(true);
    expect(result.lockInfo).toBeDefined();
    expect(result.lockInfo?.pid).toBe(process.pid);

    await lock.release();
  });

  test('tryAcquire returns failure when lock is held', async () => {
    const lockPath = path.join(testDir, 'try-fail.lock');
    const lock1 = new SessionLock(lockPath);
    const lock2 = new SessionLock(lockPath);

    await lock1.acquire();

    const result = await lock2.tryAcquire();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Lock held by PID');

    await lock1.release();
  });

  test('acquire times out when lock is held', async () => {
    const lockPath = path.join(testDir, 'timeout.lock');
    const lock1 = new SessionLock(lockPath);
    const lock2 = new SessionLock(lockPath);

    await lock1.acquire();

    // Try to acquire with short timeout
    await expect(lock2.acquire(200)).rejects.toThrow('Failed to acquire lock within');

    await lock1.release();
  });

  test('forceBreak removes lock', async () => {
    const lockPath = path.join(testDir, 'force-break.lock');
    const lock = new SessionLock(lockPath);

    await lock.acquire();
    await lock.forceBreak();

    const exists = await fs.access(lockPath).then(() => true).catch(() => false);
    expect(exists).toBe(false);
    expect(lock.isLocked()).toBe(false);
  });

  test('getLockInfo returns null when not locked', () => {
    const lockPath = path.join(testDir, 'not-locked.lock');
    const lock = new SessionLock(lockPath);

    expect(lock.getLockInfo()).toBeNull();
    expect(lock.isLocked()).toBe(false);
  });

  test('creates parent directories for lock file', async () => {
    const lockPath = path.join(testDir, 'nested', 'deep', 'test.lock');
    const lock = new SessionLock(lockPath);

    await lock.acquire(5000);

    const exists = await fs.access(lockPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    await lock.release();
  }, 10000); // Allow 10s for this test
});

describe('acquireLock and releaseLock helpers', () => {
  test('acquireLock returns SessionLock instance', async () => {
    const lockPath = path.join(testDir, 'helper.lock');

    const lock = await acquireLock(lockPath);

    expect(lock).toBeInstanceOf(SessionLock);
    expect(lock.isLocked()).toBe(true);

    await releaseLock(lock);
    expect(lock.isLocked()).toBe(false);
  });

  test('acquireLock respects timeout', async () => {
    const lockPath = path.join(testDir, 'helper-timeout.lock');

    const lock1 = await acquireLock(lockPath);

    await expect(acquireLock(lockPath, 200)).rejects.toThrow('Failed to acquire lock');

    await releaseLock(lock1);
  });
});

describe('getLockStatus', () => {
  test('returns unlocked status when no lock exists', async () => {
    const lockPath = path.join(testDir, 'no-lock.lock');

    const status = await getLockStatus(lockPath);

    expect(status.locked).toBe(false);
    expect(status.lockInfo).toBeNull();
    expect(status.canBreak).toBe(false);
    expect(status.ownedByUs).toBe(false);
  });

  test('returns locked status with lock info', async () => {
    const lockPath = path.join(testDir, 'locked.lock');
    const lock = new SessionLock(lockPath);
    await lock.acquire();

    const status = await getLockStatus(lockPath);

    expect(status.locked).toBe(true);
    expect(status.lockInfo).not.toBeNull();
    expect(status.lockInfo?.pid).toBe(process.pid);
    expect(status.ownedByUs).toBe(true);

    await lock.release();
  });
});

describe('withLock', () => {
  test('executes function while holding lock', async () => {
    const lockPath = path.join(testDir, 'with-lock.lock');
    let executed = false;

    const result = await withLock(lockPath, async () => {
      executed = true;
      // Verify lock is held during execution
      const status = await getLockStatus(lockPath);
      expect(status.locked).toBe(true);
      return 'result';
    });

    expect(executed).toBe(true);
    expect(result).toBe('result');

    // Lock should be released after
    const status = await getLockStatus(lockPath);
    expect(status.locked).toBe(false);
  });

  test('releases lock even on function error', async () => {
    const lockPath = path.join(testDir, 'with-lock-error.lock');

    await expect(
      withLock(lockPath, async () => {
        throw new Error('Test error');
      })
    ).rejects.toThrow('Test error');

    // Lock should be released after error
    const status = await getLockStatus(lockPath);
    expect(status.locked).toBe(false);
  });

  test('respects timeout parameter', async () => {
    const lockPath = path.join(testDir, 'with-lock-timeout.lock');
    const lock = await acquireLock(lockPath);

    await expect(
      withLock(lockPath, async () => 'never executed', 200)
    ).rejects.toThrow('Failed to acquire lock');

    await lock.release();
  });

  test('returns async function result', async () => {
    const lockPath = path.join(testDir, 'async-result.lock');

    const result = await withLock(lockPath, async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { value: 42 };
    });

    expect(result).toEqual({ value: 42 });
  });
});

describe('isProcessAlive', () => {
  test('returns true for current process', async () => {
    const alive = await isProcessAlive(process.pid);
    expect(alive).toBe(true);
  });

  test('returns true for current process with matching start time', async () => {
    const startTime = await getCurrentProcessStartTime();
    if (startTime !== undefined) {
      const alive = await isProcessAlive(process.pid, startTime);
      expect(alive).toBe(true);
    }
  });

  test('returns false for non-existent process', async () => {
    // Use a very high PID that's unlikely to exist
    const alive = await isProcessAlive(999999);
    expect(alive).toBe(false);
  });

  test.skipIf(process.platform === 'win32')('detects PID reuse with wrong start time', async () => {
    // Only works on Linux/macOS where we can get process start time
    const startTime = await getCurrentProcessStartTime();
    if (startTime !== undefined) {
      // Use wrong start time (should indicate PID reuse)
      const alive = await isProcessAlive(process.pid, startTime + 100000);
      expect(alive).toBe(false);
    }
  });
});

describe('canBreakLock', () => {
  test('cannot break fresh lock', async () => {
    const lockInfo: LockInfo = {
      lockId: 'test-lock-id',
      pid: process.pid,
      hostname: os.hostname(),
      acquiredAt: new Date().toISOString(),
    };

    const canBreak = await canBreakLock(lockInfo);
    expect(canBreak).toBe(false);
  });

  test('cannot break lock from different host (unless very old)', async () => {
    const lockInfo: LockInfo = {
      lockId: 'remote-lock-id',
      pid: 12345,
      hostname: 'other-host',
      acquiredAt: new Date(Date.now() - 120000).toISOString(), // 2 minutes old
    };

    const canBreak = await canBreakLock(lockInfo);
    // Should not break remote lock unless > 5 minutes old
    expect(canBreak).toBe(false);
  });

  test.skipIf(process.platform === 'win32')('can break lock from dead process', async () => {
    const lockInfo: LockInfo = {
      lockId: 'dead-process-lock',
      pid: 999999, // Non-existent process
      hostname: os.hostname(),
      acquiredAt: new Date(Date.now() - 120000).toISOString(), // 2 minutes old
    };

    const canBreak = await canBreakLock(lockInfo);
    expect(canBreak).toBe(true);
  });
});

describe('readLockFile', () => {
  test('returns null for non-existent file', async () => {
    const lockPath = path.join(testDir, 'missing.lock');

    const lockInfo = await readLockFile(lockPath);
    expect(lockInfo).toBeNull();
  });

  test('returns null for invalid JSON', async () => {
    const lockPath = path.join(testDir, 'invalid.lock');
    await fs.writeFile(lockPath, 'not json');

    const lockInfo = await readLockFile(lockPath);
    expect(lockInfo).toBeNull();
  });

  test('returns null for incomplete lock info', async () => {
    const lockPath = path.join(testDir, 'incomplete.lock');
    await fs.writeFile(lockPath, JSON.stringify({ pid: 123 })); // Missing required fields

    const lockInfo = await readLockFile(lockPath);
    expect(lockInfo).toBeNull();
  });

  test('returns lock info for valid lock file', async () => {
    const lockPath = path.join(testDir, 'valid.lock');
    const expectedInfo: LockInfo = {
      lockId: 'test-id',
      pid: 12345,
      hostname: 'test-host',
      acquiredAt: '2025-01-01T00:00:00.000Z',
    };
    await fs.writeFile(lockPath, JSON.stringify(expectedInfo));

    const lockInfo = await readLockFile(lockPath);
    expect(lockInfo).toEqual(expectedInfo);
  });
});

describe('getCurrentProcessStartTime', () => {
  test.skipIf(process.platform === 'win32')('returns a number on Linux/macOS', async () => {
    const startTime = await getCurrentProcessStartTime();
    if (process.platform === 'linux' || process.platform === 'darwin') {
      expect(startTime).toBeDefined();
      expect(typeof startTime).toBe('number');
    }
  });

  test('returns undefined on Windows', async () => {
    if (process.platform === 'win32') {
      const startTime = await getCurrentProcessStartTime();
      expect(startTime).toBeUndefined();
    }
  });
});

describe('concurrent lock acquisition', () => {
  test('only one of multiple concurrent acquires succeeds immediately', async () => {
    const lockPath = path.join(testDir, 'concurrent.lock');

    const lock1 = new SessionLock(lockPath);
    const lock2 = new SessionLock(lockPath);
    const lock3 = new SessionLock(lockPath);

    // Try to acquire all three concurrently with short timeout
    const results = await Promise.allSettled([
      lock1.acquire(100),
      lock2.acquire(100),
      lock3.acquire(100),
    ]);

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');

    // Exactly one should succeed
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(2);

    // Clean up whichever lock succeeded
    for (const lock of [lock1, lock2, lock3]) {
      if (lock.isLocked()) {
        await lock.release();
      }
    }
  });
});
