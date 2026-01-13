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
/**
 * Validates that an artifact path is safe and within the artifact root.
 *
 * @param artifactPath - Relative path to the artifact
 * @param artifactRoot - Root directory for artifacts
 * @returns Resolved absolute path if valid
 * @throws Error if path is absolute, contains traversal, or escapes root
 */
export declare function validateArtifactPath(artifactPath: string, artifactRoot: string): string;
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
export declare function mkdirSafe(dirPath: string, root: string): Promise<void>;
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
export declare function safeWriteArtifact(artifactRoot: string, relativePath: string, data: Buffer): Promise<string>;
