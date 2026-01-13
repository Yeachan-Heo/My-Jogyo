"use strict";
/**
 * Bridge metadata types and validation.
 * Centralized to avoid duplication across python-repl.ts and gyoshu-hooks.ts.
 *
 * @module bridge-meta
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidBridgeMeta = isValidBridgeMeta;
/**
 * Validate bridge metadata to prevent poisoned meta attacks.
 * Returns true only if all required fields have valid types and values.
 *
 * Security checks:
 * - pid must be positive integer (prevents process-group kills with pid=0/-1)
 * - sessionId must be non-empty string (prevents path traversal)
 * - socketPath must be non-empty absolute path (prevents path injection)
 * - processStartTime, if present, must be positive number (prevents time confusion)
 * - startedAt OR bridgeStarted must be string (prevents type confusion)
 */
function isValidBridgeMeta(meta) {
    if (!meta || typeof meta !== "object")
        return false;
    const m = meta;
    // pid must be a positive integer (prevents process group kills with pid=0/-1)
    if (typeof m.pid !== "number" || !Number.isInteger(m.pid) || m.pid <= 0)
        return false;
    // sessionId must be a non-empty string
    if (typeof m.sessionId !== "string" || m.sessionId.length === 0)
        return false;
    // socketPath must be a non-empty absolute path
    if (typeof m.socketPath !== "string" || m.socketPath.length === 0)
        return false;
    // Check for absolute path (starts with / on Unix, or drive letter on Windows)
    const isAbsolute = m.socketPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(m.socketPath);
    if (!isAbsolute)
        return false;
    // processStartTime, if present, must be positive number
    if (m.processStartTime !== undefined) {
        if (typeof m.processStartTime !== "number" || m.processStartTime <= 0)
            return false;
    }
    // At least one of startedAt or bridgeStarted must be a string (ISO date)
    const hasStartedAt = typeof m.startedAt === "string";
    const hasBridgeStarted = typeof m.bridgeStarted === "string";
    if (!hasStartedAt && !hasBridgeStarted)
        return false;
    return true;
}
