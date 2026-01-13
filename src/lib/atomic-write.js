"use strict";
/**
 * Atomic, durable file writes. Guarantees: same-dir temp (same filesystem),
 * fsync before rename, directory fsync (best-effort), Windows PowerShell fallback.
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
exports.openNoFollow = openNoFollow;
exports.openNoFollowSync = openNoFollowSync;
exports.readFileNoFollow = readFileNoFollow;
exports.readFileNoFollowSync = readFileNoFollowSync;
exports.durableAtomicWrite = durableAtomicWrite;
exports.atomicReplaceWindows = atomicReplaceWindows;
exports.fileExists = fileExists;
exports.readFile = readFile;
exports.copyFileNoFollow = copyFileNoFollow;
const fs = __importStar(require("fs/promises"));
const fsSync = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const paths_1 = require("./paths");
// O_NOFOLLOW prevents following symlinks on open
// Not directly exposed by Node.js, so we use platform-specific values
// Linux: 0o400000 (0x20000), macOS: 0x0100
// Windows: not supported natively - use lstat fallback
const O_NOFOLLOW = process.platform === 'darwin' ? 0x0100 : 0o400000;
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
async function openNoFollow(filePath, flags, mode) {
    // On Windows, O_NOFOLLOW isn't supported - use lstat fallback
    if (process.platform === 'win32') {
        try {
            const stat = await fs.lstat(filePath);
            if (stat.isSymbolicLink()) {
                throw new Error(`Security: ${filePath} is a symlink`);
            }
        }
        catch (err) {
            // ENOENT is fine - file doesn't exist yet (for creation flags)
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }
        return fs.open(filePath, flags, mode);
    }
    // On Unix, use O_NOFOLLOW - kernel will reject symlinks atomically
    return fs.open(filePath, flags | O_NOFOLLOW, mode);
}
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
function openNoFollowSync(filePath, flags, mode) {
    // On Windows, O_NOFOLLOW isn't supported - use lstat fallback
    if (process.platform === 'win32') {
        try {
            const stat = fsSync.lstatSync(filePath);
            if (stat.isSymbolicLink()) {
                throw new Error(`Security: ${filePath} is a symlink`);
            }
        }
        catch (err) {
            // ENOENT is fine - file doesn't exist yet (for creation flags)
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }
        return fsSync.openSync(filePath, flags, mode);
    }
    // On Unix, use O_NOFOLLOW - kernel will reject symlinks atomically
    return fsSync.openSync(filePath, flags | O_NOFOLLOW, mode);
}
/**
 * Read file contents without following symlinks.
 * Uses O_NOFOLLOW to atomically reject symlinks at open time.
 *
 * @param filePath Path to file to read
 * @param parseJson If true, parse content as JSON
 * @returns File contents as string or parsed JSON
 * @throws ELOOP if path is a symlink (Unix), or Error (Windows)
 */
async function readFileNoFollow(filePath, parseJson = false) {
    const flags = fsSync.constants.O_RDONLY;
    const fileHandle = await openNoFollow(filePath, flags);
    try {
        // Verify opened fd is a regular file (not FIFO/device/socket)
        const stat = await fileHandle.stat();
        if (!stat.isFile()) {
            throw new Error(`Security: ${filePath} is not a regular file`);
        }
        const content = await fileHandle.readFile('utf-8');
        if (parseJson) {
            return JSON.parse(content);
        }
        return content;
    }
    finally {
        await fileHandle.close();
    }
}
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
function readFileNoFollowSync(filePath, parseJson = false) {
    const flags = fsSync.constants.O_RDONLY;
    const fd = openNoFollowSync(filePath, flags);
    try {
        // Verify opened fd is a regular file (not FIFO/device/socket)
        const stat = fsSync.fstatSync(fd);
        if (!stat.isFile()) {
            throw new Error(`Security: ${filePath} is not a regular file`);
        }
        const content = fsSync.readFileSync(fd, 'utf-8');
        if (parseJson) {
            return JSON.parse(content);
        }
        return content;
    }
    finally {
        fsSync.closeSync(fd);
    }
}
async function durableAtomicWrite(targetPath, data) {
    const dir = path.dirname(targetPath);
    const base = path.basename(targetPath);
    const tempPath = path.join(dir, `.${base}.tmp.${crypto.randomUUID()}`);
    let success = false;
    try {
        (0, paths_1.ensureDirSync)(dir);
        const fd = await fs.open(tempPath, 'wx', 0o600); // 'wx' = write + exclusive (O_CREAT | O_EXCL)
        try {
            await fd.write(data);
            await fd.sync();
        }
        finally {
            await fd.close();
        }
        if (targetPath.endsWith('.json')) {
            JSON.parse(data);
        }
        if (process.platform === 'win32') {
            await atomicReplaceWindows(tempPath, targetPath);
        }
        else {
            await fs.rename(tempPath, targetPath);
        }
        success = true;
        // Directory fsync - best-effort, some platforms don't support it
        try {
            const dirFd = await fs.open(dir, 'r');
            try {
                await dirFd.sync();
            }
            finally {
                await dirFd.close();
            }
        }
        catch (e) {
            process.env.GYOSHU_DEBUG && console.warn(`[atomic-write] Directory fsync failed for ${dir}: ${e.message}`);
        }
    }
    finally {
        if (!success) {
            await fs.unlink(tempPath).catch(() => { });
        }
    }
}
async function atomicReplaceWindows(tempPath, targetPath) {
    // fs.rename() works atomically on both Unix and Windows.
    // On Windows, it uses MoveFileExW with MOVEFILE_REPLACE_EXISTING flag,
    // which atomically replaces the target file if it exists.
    //
    // SECURITY: We avoid cmd.exe and PowerShell entirely because:
    // - cmd.exe parses metacharacters (&, %, !, ^, |, <, >) even with execFile
    // - PowerShell's -Command flag treats paths as code
    // These shell invocations are vulnerable to injection when paths contain
    // special characters. fs.rename() is a direct syscall with no parsing.
    await fs.rename(tempPath, targetPath);
}
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function readFile(filePath, parseJson = false) {
    // Use O_NOFOLLOW to atomically reject symlinks at open time (no TOCTOU race)
    const fileHandle = await openNoFollow(filePath, fsSync.constants.O_RDONLY);
    try {
        // Double-check via fd that we opened a regular file
        const stat = await fileHandle.stat();
        if (!stat.isFile()) {
            throw new Error(`Security: ${filePath} is not a regular file`);
        }
        const content = await fileHandle.readFile('utf-8');
        if (parseJson) {
            return JSON.parse(content);
        }
        return content;
    }
    finally {
        await fileHandle.close();
    }
}
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
async function copyFileNoFollow(srcPath, destPath) {
    // Open source with O_NOFOLLOW - kernel rejects symlinks atomically (no TOCTOU)
    const srcHandle = await openNoFollow(srcPath, fsSync.constants.O_RDONLY);
    try {
        // Verify via fd that we opened a regular file (not FIFO/device/socket)
        const stat = await srcHandle.stat();
        if (!stat.isFile()) {
            throw new Error(`Security: ${srcPath} is not a regular file`);
        }
        // Read content as Buffer (handles both text and binary)
        const content = await srcHandle.readFile();
        // Write atomically to destination
        // durableAtomicWrite creates exclusive temp file, so destination symlinks are safe
        // (rename onto symlink replaces the symlink, doesn't follow it)
        const dir = path.dirname(destPath);
        const base = path.basename(destPath);
        const tempPath = path.join(dir, `.${base}.tmp.${crypto.randomUUID()}`);
        let success = false;
        try {
            (0, paths_1.ensureDirSync)(dir);
            // 'wx' = write + exclusive (O_CREAT | O_EXCL) - fails if temp exists
            const destFd = await fs.open(tempPath, 'wx', 0o600);
            try {
                await destFd.write(content);
                await destFd.sync();
            }
            finally {
                await destFd.close();
            }
            // Rename is atomic - if destPath is a symlink, it replaces the symlink
            if (process.platform === 'win32') {
                await atomicReplaceWindows(tempPath, destPath);
            }
            else {
                await fs.rename(tempPath, destPath);
            }
            success = true;
            // Directory fsync - best-effort
            try {
                const dirFd = await fs.open(dir, 'r');
                try {
                    await dirFd.sync();
                }
                finally {
                    await dirFd.close();
                }
            }
            catch {
                // Some platforms don't support directory fsync
            }
        }
        finally {
            if (!success) {
                await fs.unlink(tempPath).catch(() => { });
            }
        }
    }
    finally {
        await srcHandle.close();
    }
}
