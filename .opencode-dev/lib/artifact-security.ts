/**
 * Artifact Security Module
 * 
 * Provides TOCTOU-resistant file operations with symlink protection.
 * 
 * Security features:
 * - O_NOFOLLOW: Prevents following symlinks on POSIX systems
 * - Path validation: Rejects absolute paths, path traversal (../), symlinks
 * - TOCTOU mitigation: Validates paths at open time, not just pre-check
 * - Safe mkdir: Checks each path component with lstat before creation
 */

import * as fs from 'fs/promises';
import { constants } from 'fs';
import * as path from 'path';

/**
 * Validates that an artifact path is safe and within the artifact root.
 * 
 * @param artifactPath - Relative path to the artifact
 * @param artifactRoot - Root directory for artifacts
 * @returns Resolved absolute path if valid
 * @throws Error if path is absolute, contains traversal, or escapes root
 */
export function validateArtifactPath(artifactPath: string, artifactRoot: string): string {
  // Reject absolute paths
  if (path.isAbsolute(artifactPath)) {
    throw new Error(`Absolute paths not allowed: ${artifactPath}`);
  }
  
  // Normalize and resolve
  const normalized = path.normalize(artifactPath);
  
  // Reject path traversal
  if (normalized.includes('..')) {
    throw new Error(`Path traversal detected: ${artifactPath}`);
  }
  
  const resolved = path.resolve(artifactRoot, normalized);
  
  // Must be under artifact root
  if (!resolved.startsWith(path.resolve(artifactRoot) + path.sep)) {
    throw new Error(`Path escaped artifact root: ${artifactPath}`);
  }
  
  return resolved;
}

/**
 * Creates a directory path safely without following symlinks.
 * 
 * Walks through each path component, checking with lstat to ensure
 * no symlinks exist in the path that could lead to directory escape.
 * 
 * @param dirPath - Target directory path to create
 * @param root - Root directory that must contain the path
 * @throws Error if symlink or non-directory found in path
 */
export async function mkdirSafe(dirPath: string, root: string): Promise<void> {
  const relative = path.relative(root, dirPath);
  const parts = relative.split(path.sep).filter(Boolean);
  let current = root;
  
  for (const part of parts) {
    current = path.join(current, part);
    
    try {
      const stat = await fs.lstat(current);  // lstat doesn't follow symlinks
      if (stat.isSymbolicLink()) {
        throw new Error(`Symlink in path: ${current}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`Not a directory: ${current}`);
      }
    } catch (e: unknown) {
      const error = e as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        await fs.mkdir(current);
      } else {
        throw e;
      }
    }
  }
}

/**
 * Opens a file without following symlinks (POSIX O_NOFOLLOW).
 * 
 * Uses O_NOFOLLOW flag to prevent symlink following on POSIX systems.
 * For write operations, also uses O_EXCL to ensure exclusive creation.
 * 
 * @param filePath - Path to the file to open
 * @param flags - Open mode: 'r' for read, 'w' or 'wx' for exclusive write
 * @returns FileHandle if successful
 * @throws Error if path is a symlink or not a regular file
 */
export async function openNoFollow(filePath: string, flags: string): Promise<fs.FileHandle> {
  // POSIX: O_NOFOLLOW prevents following symlinks
  const numericFlags = flags.includes('w') 
    ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
    : constants.O_RDONLY | constants.O_NOFOLLOW;
  
  const fd = await fs.open(filePath, numericFlags);
  
  // Verify it's a regular file
  const stat = await fd.stat();
  if (!stat.isFile()) {
    await fd.close();
    throw new Error(`Not a regular file: ${filePath}`);
  }
  
  return fd;
}

/**
 * Safely writes an artifact with full TOCTOU protection.
 * 
 * Combines all security measures:
 * 1. Validates the path doesn't escape artifact root
 * 2. Creates parent directories safely (no symlink following)
 * 3. Opens file exclusively with O_NOFOLLOW
 * 4. Re-validates via realpath after open (TOCTOU mitigation)
 * 5. Writes data and syncs to disk
 * 
 * @param artifactRoot - Root directory for artifacts
 * @param relativePath - Relative path within artifact root
 * @param data - Data to write
 * @returns Absolute path where file was written
 * @throws Error if any security check fails
 */
export async function safeWriteArtifact(
  artifactRoot: string,
  relativePath: string,
  data: Buffer
): Promise<string> {
  const targetPath = validateArtifactPath(relativePath, artifactRoot);
  
  // Create directories safely
  await mkdirSafe(path.dirname(targetPath), artifactRoot);
  
  // Open without following symlinks, create exclusively
  const fd = await openNoFollow(targetPath, 'wx');
  
  try {
    // Re-validate via realpath after file is created
    const realPath = await fs.realpath(targetPath);
    if (!realPath.startsWith(path.resolve(artifactRoot) + path.sep)) {
      throw new Error('TOCTOU attack detected: file escaped artifact root');
    }
    
    await fd.write(data);
    await fd.sync();
  } finally {
    await fd.close();
  }
  
  return targetPath;
}
