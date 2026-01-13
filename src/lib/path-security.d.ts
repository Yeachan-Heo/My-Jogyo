/**
 * Path Security Module
 *
 * Provides security utilities for path containment verification.
 * Used to prevent path traversal attacks when performing file operations.
 *
 * @module path-security
 */
/**
 * Options for path containment verification.
 */
export interface PathContainmentOptions {
    /**
     * Whether to resolve symlinks before comparison using fs.realpathSync.
     *
     * - `false` (default): Uses path.resolve only. Suitable for paths that may not exist yet.
     * - `true`: Uses fs.realpathSync to resolve symlinks. Recommended for existing paths
     *   to prevent symlink-based directory escape attacks.
     *
     * When `true`, if either path doesn't exist or realpathSync fails,
     * the function returns `false` for safety.
     *
     * @default false
     */
    useRealpath?: boolean;
}
/**
 * Verify that a path is contained within a parent directory.
 *
 * This function is used to prevent path traversal attacks when performing
 * operations like unlinking sockets, deleting files, or accessing artifacts.
 *
 * Security considerations:
 * - Always normalizes both paths before comparison
 * - Checks for exact match (child === parent) and containment (child starts with parent + sep)
 * - Optional symlink resolution via `useRealpath` for defense against symlink-based escapes
 *
 * @param childPath - The path to verify (potential child)
 * @param parentDir - The directory that should contain the child
 * @param options - Optional configuration for the verification
 * @returns `true` if childPath is contained within parentDir, `false` otherwise
 *
 * @example
 * // Basic usage (no symlink resolution)
 * isPathContainedIn('/home/user/project/file.txt', '/home/user/project'); // true
 * isPathContainedIn('/etc/passwd', '/home/user/project'); // false
 *
 * @example
 * // With symlink resolution (recommended for existing paths)
 * isPathContainedIn('/tmp/symlink-to-etc/passwd', '/tmp/data', { useRealpath: true }); // false
 *
 * @example
 * // Same path returns true
 * isPathContainedIn('/home/user/project', '/home/user/project'); // true
 */
export declare function isPathContainedIn(childPath: string, parentDir: string, options?: PathContainmentOptions): boolean;
