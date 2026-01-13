"use strict";
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
exports.validateArtifactPath = validateArtifactPath;
exports.mkdirSafe = mkdirSafe;
exports.safeWriteArtifact = safeWriteArtifact;
const fs = __importStar(require("fs/promises"));
const fs_1 = require("fs");
const path = __importStar(require("path"));
const atomic_write_1 = require("./atomic-write");
const paths_1 = require("./paths");
/**
 * Validates that an artifact path is safe and within the artifact root.
 *
 * @param artifactPath - Relative path to the artifact
 * @param artifactRoot - Root directory for artifacts
 * @returns Resolved absolute path if valid
 * @throws Error if path is absolute, contains traversal, or escapes root
 */
function validateArtifactPath(artifactPath, artifactRoot) {
    if (path.isAbsolute(artifactPath)) {
        throw new Error(`Absolute paths not allowed: ${artifactPath}`);
    }
    const rawSegments = artifactPath.split(/[/\\]/);
    for (const segment of rawSegments) {
        if (!segment)
            continue;
        if (segment === '..' || segment === '.') {
            throw new Error(`Path traversal detected: ${artifactPath}`);
        }
        (0, paths_1.validatePathSegment)(segment, 'artifactPathSegment');
    }
    const normalized = path.normalize(artifactPath);
    const resolved = path.resolve(artifactRoot, normalized);
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
async function mkdirSafe(dirPath, root) {
    const relative = path.relative(root, dirPath);
    const parts = relative.split(path.sep).filter(Boolean);
    let current = root;
    for (const part of parts) {
        current = path.join(current, part);
        try {
            const stat = await fs.lstat(current); // lstat doesn't follow symlinks
            if (stat.isSymbolicLink()) {
                throw new Error(`Symlink in path: ${current}`);
            }
            if (!stat.isDirectory()) {
                throw new Error(`Not a directory: ${current}`);
            }
        }
        catch (e) {
            const error = e;
            if (error.code === 'ENOENT') {
                await fs.mkdir(current);
            }
            else {
                throw e;
            }
        }
    }
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
async function safeWriteArtifact(artifactRoot, relativePath, data) {
    const targetPath = validateArtifactPath(relativePath, artifactRoot);
    // Create directories safely
    await mkdirSafe(path.dirname(targetPath), artifactRoot);
    // Open without following symlinks, create exclusively
    // Using numeric flags for atomic-write's openNoFollow (has win32 fallback)
    const fd = await (0, atomic_write_1.openNoFollow)(targetPath, fs_1.constants.O_WRONLY | fs_1.constants.O_CREAT | fs_1.constants.O_EXCL);
    try {
        // Re-validate via realpath after file is created
        const realPath = await fs.realpath(targetPath);
        if (!realPath.startsWith(path.resolve(artifactRoot) + path.sep)) {
            throw new Error('TOCTOU attack detected: file escaped artifact root');
        }
        await fd.write(data);
        await fd.sync();
    }
    finally {
        await fd.close();
    }
    return targetPath;
}
