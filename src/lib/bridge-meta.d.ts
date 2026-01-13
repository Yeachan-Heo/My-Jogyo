/**
 * Bridge metadata types and validation.
 * Centralized to avoid duplication across python-repl.ts and gyoshu-hooks.ts.
 *
 * @module bridge-meta
 */
/**
 * Python environment info for runtime tracking
 */
export interface PythonEnvInfo {
    type: string;
    pythonPath: string;
}
/**
 * Bridge metadata - lightweight runtime state.
 * Stored in bridge_meta.json in session directory.
 *
 * NOTE: python-repl.ts writes `startedAt`, but session-manager.ts writes `bridgeStarted`.
 * Both fields are accepted for backward compatibility.
 */
export interface BridgeMeta {
    pid: number;
    socketPath: string;
    /** @deprecated Use bridgeStarted. python-repl.ts uses this field */
    startedAt?: string;
    /** Preferred field. session-manager.ts uses this field */
    bridgeStarted?: string;
    sessionId: string;
    pythonEnv?: PythonEnvInfo;
    /** Process start time for PID identity verification (prevents PID reuse attacks) */
    processStartTime?: number;
    /** Extended fields that may be present in some versions */
    notebookPath?: string;
    reportTitle?: string;
    /** Adversarial verification state for challenge loops (optional, runtime only) */
    verification?: VerificationState;
}
/**
 * A single verification round in the adversarial challenge loop.
 * Tracks the outcome of each verification attempt by Baksa (critic agent).
 */
export interface VerificationRound {
    /** Round number (1, 2, 3, ...) */
    round: number;
    /** ISO 8601 timestamp of verification attempt */
    timestamp: string;
    /** Trust score from 0-100 calculated by Baksa (critic agent) */
    trustScore: number;
    /** Outcome of this verification round */
    outcome: "passed" | "failed" | "rework_requested";
}
/**
 * Verification state for adversarial challenge loops.
 * Tracks the current verification round and history of all attempts.
 */
export interface VerificationState {
    /** Current verification round. 0 = not started, 1+ = active rounds */
    currentRound: number;
    /** Maximum allowed verification rounds before escalation (default: 3) */
    maxRounds: number;
    /** History of verification rounds (rounds are 1-indexed) */
    history: VerificationRound[];
}
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
export declare function isValidBridgeMeta(meta: unknown): meta is BridgeMeta;
