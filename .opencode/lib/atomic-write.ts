/**
 * Atomic, durable file writes. Guarantees: same-dir temp (same filesystem),
 * fsync before rename, directory fsync (best-effort), Windows PowerShell fallback.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function durableAtomicWrite(targetPath: string, data: string): Promise<void> {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const tempPath = path.join(dir, `.${base}.tmp.${crypto.randomUUID()}`);
  
  let success = false;
  
  try {
    await fs.mkdir(dir, { recursive: true });
    
    const fd = await fs.open(tempPath, 'w');
    try {
      await fd.write(data);
      await fd.sync();
    } finally {
      await fd.close();
    }
    
    if (targetPath.endsWith('.json')) {
      JSON.parse(data);
    }
    
    if (process.platform === 'win32') {
      await atomicReplaceWindows(tempPath, targetPath);
    } else {
      await fs.rename(tempPath, targetPath);
    }
    
    success = true;
    
    // Directory fsync - best-effort, some platforms don't support it
    try {
      const dirFd = await fs.open(dir, 'r');
      try {
        await dirFd.sync();
      } finally {
        await dirFd.close();
      }
    } catch (e) {
      console.warn(`[atomic-write] Directory fsync failed for ${dir}: ${(e as Error).message}`);
    }
  } finally {
    if (!success) {
      await fs.unlink(tempPath).catch(() => {});
    }
  }
}

export async function atomicReplaceWindows(tempPath: string, targetPath: string): Promise<void> {
  if (process.platform !== 'win32') {
    await fs.rename(tempPath, targetPath);
    return;
  }
  
  try {
    const escapedTemp = tempPath.replace(/'/g, "''");
    const escapedTarget = targetPath.replace(/'/g, "''");
    
    await execAsync(
      `Move-Item -Force -Path '${escapedTemp}' -Destination '${escapedTarget}'`,
      { shell: 'powershell.exe' }
    );
  } catch (psError) {
    try {
      await fs.rename(tempPath, targetPath);
    } catch (renameError) {
      throw new Error(
        `Windows atomic replace failed. ` +
        `PowerShell: ${(psError as Error).message}. ` +
        `Rename fallback: ${(renameError as Error).message}`
      );
    }
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readFile<T = string>(
  filePath: string, 
  parseJson: boolean = false
): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  if (parseJson) {
    return JSON.parse(content) as T;
  }
  return content as T;
}
