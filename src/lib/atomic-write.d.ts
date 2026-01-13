/**
 * Atomic, durable file writes. Guarantees: same-dir temp (same filesystem),
 * fsync before rename, directory fsync (best-effort), Windows PowerShell fallback.
 */
import * as fs from 'fs/promises';
/**
 * Open a file without following symlinks (async).
 * On Unix: uses O_NOFOLLOW flag - fails with ELOOP if target is a symlink.
 * On Windows: uses lstat check before open (has small race window but best effort).
 *
 * @param filePath Path to the file to open
 * @param flags File open flags (e.g., fsSync.constants.O_RDONLY)
 * @param mode File mode for creation (optional)
 * @returns FileHandle to the opened file
 * @throws ELOOP on Unix if path is a symlink, or Error on Windows if symlink detected
 */
export declare function openNoFollow(filePath: string, flags: number, mode?: number): Promise<fs.FileHandle>;
/**
 * Synchronous version of openNoFollow.
 * On Unix: uses O_NOFOLLOW flag - fails with ELOOP if target is a symlink.
 * On Windows: uses lstat check before open (has small race window but best effort).
 *
 * @param filePath Path to the file to open
 * @param flags File open flags (e.g., fsSync.constants.O_WRONLY | fsSync.constants.O_APPEND)
 * @param mode File mode for creation (optional)
 * @returns File descriptor number
 * @throws ELOOP on Unix if path is a symlink, or Error on Windows if symlink detected
 */
export declare function openNoFollowSync(filePath: string, flags: number, mode?: number): number;
/**
 * Read file contents without following symlinks.
 * Uses O_NOFOLLOW to atomically reject symlinks at open time.
 *
 * @param filePath Path to file to read
 * @param parseJson If true, parse content as JSON
 * @returns File contents as string or parsed JSON
 * @throws ELOOP if path is a symlink (Unix), or Error (Windows)
 */
export declare function readFileNoFollow<T = string>(filePath: string, parseJson?: boolean): Promise<T>;
/**
 * Synchronous version of readFileNoFollow.
 * Reads file contents without following symlinks.
 * Uses O_NOFOLLOW to atomically reject symlinks at open time.
 *
 * @param filePath Path to file to read
 * @param parseJson If true, parse content as JSON
 * @returns File contents as string or parsed JSON
 * @throws ELOOP if path is a symlink (Unix), or Error (Windows)
 */
export declare function readFileNoFollowSync<T = string>(filePath: string, parseJson?: boolean): T;
export declare function durableAtomicWrite(targetPath: string, data: string): Promise<void>;
export declare function atomicReplaceWindows(tempPath: string, targetPath: string): Promise<void>;
export declare function fileExists(filePath: string): Promise<boolean>;
export declare function readFile<T = string>(filePath: string, parseJson?: boolean): Promise<T>;
/**
 * Copy a file without following symlinks (TOCTOU-safe).
 *
 * Uses O_NOFOLLOW on source to atomically reject symlinks at open time,
 * then verifies via fstat that it's a regular file before reading.
 * Writes to destination atomically via temp file + rename.
 *
 * Handles both text and binary files safely.
 *
 * @param srcPath Source file path
 * @param destPath Destination file path
 * @throws ELOOP if source is a symlink, Error if not a regular file
 */
export declare function copyFileNoFollow(srcPath: string, destPath: string): Promise<void>;
