"use strict";
/**
 * Path Security Module
 *
 * Provides security utilities for path containment verification.
 * Used to prevent path traversal attacks when performing file operations.
 *
 * @module path-security
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
exports.isPathContainedIn = isPathContainedIn;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// =============================================================================
// PATH CONTAINMENT VERIFICATION
// =============================================================================
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
function isPathContainedIn(childPath, parentDir, options) {
    // Handle empty strings - return false for safety
    if (!childPath || !parentDir) {
        return false;
    }
    const useRealpath = options?.useRealpath ?? false;
    let normalizedChild;
    let normalizedParent;
    if (useRealpath) {
        // Resolve symlinks for existing paths
        try {
            normalizedChild = fs.realpathSync(childPath);
            normalizedParent = fs.realpathSync(parentDir);
        }
        catch {
            // If either path doesn't exist or realpath fails, return false for safety
            // This prevents potential TOCTOU attacks where a path could be replaced
            // with a symlink between check and use
            return false;
        }
    }
    else {
        // Use path.resolve only (suitable for paths that may not exist)
        normalizedChild = path.resolve(childPath);
        normalizedParent = path.resolve(parentDir);
    }
    // Check if child equals parent (same directory)
    if (normalizedChild === normalizedParent) {
        return true;
    }
    // Check if child is under parent (starts with parent + separator)
    return normalizedChild.startsWith(normalizedParent + path.sep);
}
