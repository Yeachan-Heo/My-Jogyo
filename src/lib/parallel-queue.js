"use strict";
/**
 * Parallel Queue State Schema for Gyoshu Workers
 *
 * Defines TypeScript interfaces and helper functions for the durable job queue
 * that coordinates parallel worker execution in Gyoshu AUTO mode.
 *
 * Storage Path: `reports/{reportTitle}/queue/{runId}.json`
 *
 * ## Job State Machine:
 * ```
 * PENDING → CLAIMED → DONE
 *                  → FAILED (after maxAttempts or unrecoverable error)
 * ```
 *
 * ## Stale Claim Handling:
 * Jobs that have been CLAIMED but haven't received a heartbeat in `staleClaimMs`
 * are considered abandoned and can be reclaimed by other workers.
 *
 * ## Lock Integration:
 * All queue mutations MUST be performed while holding the queue lock.
 * Use `getQueueLockPath()` from `./lock-paths.ts` and `withLock()` from `./session-lock.ts`.
 *
 * @see lock-paths.ts for queue lock path helpers
 * @see session-lock.ts for lock primitives
 * @module parallel-queue
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
exports.DEFAULT_QUEUE_CONFIG = void 0;
exports.getQueueStatePath = getQueueStatePath;
exports.createEmptyQueue = createEmptyQueue;
exports.createJob = createJob;
exports.isJobStale = isJobStale;
exports.getJobsByStatus = getJobsByStatus;
exports.getActiveWorkers = getActiveWorkers;
exports.getStaleJobs = getStaleJobs;
exports.countJobsByStatus = countJobsByStatus;
exports.isJobStatus = isJobStatus;
exports.isJobKind = isJobKind;
exports.isQueueStatus = isQueueStatus;
exports.isJob = isJob;
exports.isParallelQueueState = isParallelQueueState;
const path = __importStar(require("path"));
const paths_1 = require("./paths");
// =============================================================================
// CONSTANTS
// =============================================================================
/**
 * Default queue configuration with sensible values.
 *
 * - `staleClaimMs`: 5 minutes (300000ms) - enough time for long-running stages
 * - `maxJobAttempts`: 3 - retry twice before failing permanently
 * - `heartbeatIntervalMs`: 30 seconds (30000ms) - frequent enough to detect failures
 */
exports.DEFAULT_QUEUE_CONFIG = {
    staleClaimMs: 300000, // 5 minutes
    maxJobAttempts: 3,
    heartbeatIntervalMs: 30000, // 30 seconds
};
// =============================================================================
// PATH HELPERS
// =============================================================================
/**
 * Get the path to the queue state file for a given report and run.
 *
 * @param reportTitle - The report/research title (e.g., "customer-churn-analysis")
 * @param runId - The run identifier (e.g., "run-001")
 * @returns Absolute path to `reports/{reportTitle}/queue/{runId}.json`
 *
 * @example
 * ```typescript
 * getQueueStatePath("customer-churn", "run-001");
 * // Returns: "/home/user/my-project/reports/customer-churn/queue/run-001.json"
 * ```
 */
function getQueueStatePath(reportTitle, runId) {
    (0, paths_1.validatePathSegment)(runId, "runId");
    return path.join((0, paths_1.getReportDir)(reportTitle), "queue", `${runId}.json`);
}
// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================
/**
 * Create an empty queue state with default configuration.
 *
 * Use this to initialize a new queue for a research run.
 *
 * @param reportTitle - The report/research title
 * @param runId - The run identifier
 * @param config - Optional configuration overrides (merged with DEFAULT_QUEUE_CONFIG)
 * @returns A new ParallelQueueState with empty jobs and workers arrays
 *
 * @example
 * ```typescript
 * const queue = createEmptyQueue("customer-churn", "run-001");
 * // {
 * //   reportTitle: "customer-churn",
 * //   runId: "run-001",
 * //   createdAt: "2026-01-06T10:00:00Z",
 * //   updatedAt: "2026-01-06T10:00:00Z",
 * //   jobs: [],
 * //   workers: [],
 * //   config: { staleClaimMs: 300000, maxJobAttempts: 3, heartbeatIntervalMs: 30000 },
 * //   status: "ACTIVE",
 * // }
 *
 * // With custom config:
 * const customQueue = createEmptyQueue("analysis", "run-002", {
 *   staleClaimMs: 600000, // 10 minutes
 *   maxJobAttempts: 5,
 * });
 * ```
 */
function createEmptyQueue(reportTitle, runId, config) {
    const now = new Date().toISOString();
    return {
        reportTitle,
        runId,
        createdAt: now,
        updatedAt: now,
        jobs: [],
        workers: [],
        config: {
            ...exports.DEFAULT_QUEUE_CONFIG,
            ...config,
        },
        status: "ACTIVE",
    };
}
/**
 * Create a new job with default values.
 *
 * @param jobId - Unique job identifier
 * @param stageId - Stage ID this job belongs to
 * @param kind - Kind of job (determines worker type)
 * @param payload - Optional job payload
 * @param maxAttempts - Optional max attempts override (default: 3)
 * @returns A new Job in PENDING status
 *
 * @example
 * ```typescript
 * const job = createJob("job-001", "S01_load_data", "jogyo_stage", {
 *   objective: "Load customer data",
 * });
 * // {
 * //   jobId: "job-001",
 * //   stageId: "S01_load_data",
 * //   kind: "jogyo_stage",
 * //   status: "PENDING",
 * //   attempt: 0,
 * //   maxAttempts: 3,
 * //   payload: { objective: "Load customer data" },
 * // }
 * ```
 */
function createJob(jobId, stageId, kind, payload, maxAttempts = exports.DEFAULT_QUEUE_CONFIG.maxJobAttempts) {
    return {
        jobId,
        stageId,
        kind,
        status: "PENDING",
        attempt: 0,
        maxAttempts,
        payload,
    };
}
// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
/**
 * Check if a job's claim is stale (timed out).
 *
 * A claimed job is considered stale if:
 * - It has a heartbeat timestamp AND the time since last heartbeat exceeds staleClaimMs
 * - OR it has no heartbeat but the time since claim exceeds staleClaimMs
 *
 * Only applies to jobs with status "CLAIMED".
 *
 * @param job - The job to check
 * @param config - Queue configuration with staleClaimMs
 * @returns True if the job's claim is stale and can be reclaimed
 *
 * @example
 * ```typescript
 * const job: Job = {
 *   status: "CLAIMED",
 *   claimedAt: "2026-01-06T10:00:00Z",
 *   heartbeatAt: "2026-01-06T10:01:00Z",
 *   // ... other fields
 * };
 * const config = { staleClaimMs: 300000 }; // 5 minutes
 *
 * // If current time is 10:10, heartbeat was 9 minutes ago:
 * isJobStale(job, config); // true
 * ```
 */
function isJobStale(job, config) {
    if (job.status !== "CLAIMED") {
        return false;
    }
    const now = Date.now();
    const lastActivity = job.heartbeatAt || job.claimedAt;
    if (!lastActivity) {
        // No timestamp available, cannot determine staleness
        return false;
    }
    const lastActivityTime = new Date(lastActivity).getTime();
    const elapsed = now - lastActivityTime;
    return elapsed >= config.staleClaimMs;
}
/**
 * Get all jobs with a specific status.
 *
 * @param state - The queue state
 * @param status - The status to filter by
 * @returns Array of jobs matching the status
 *
 * @example
 * ```typescript
 * const pendingJobs = getJobsByStatus(state, "PENDING");
 * const claimedJobs = getJobsByStatus(state, "CLAIMED");
 * const failedJobs = getJobsByStatus(state, "FAILED");
 * ```
 */
function getJobsByStatus(state, status) {
    return state.jobs.filter((job) => job.status === status);
}
/**
 * Get all active (non-stale) workers.
 *
 * A worker is considered active if its last heartbeat is within staleClaimMs.
 *
 * @param state - The queue state
 * @param config - Queue configuration (optional, defaults to state.config)
 * @returns Array of workers that have sent recent heartbeats
 *
 * @example
 * ```typescript
 * const activeWorkers = getActiveWorkers(state);
 * console.log(`${activeWorkers.length} workers currently active`);
 * ```
 */
function getActiveWorkers(state, config) {
    const effectiveConfig = config || state.config;
    const now = Date.now();
    return state.workers.filter((worker) => {
        const lastHeartbeat = new Date(worker.lastHeartbeat).getTime();
        const elapsed = now - lastHeartbeat;
        return elapsed < effectiveConfig.staleClaimMs;
    });
}
/**
 * Get stale jobs that can be reclaimed.
 *
 * Returns all CLAIMED jobs whose claims have timed out.
 *
 * @param state - The queue state
 * @returns Array of stale jobs eligible for reclaim
 *
 * @example
 * ```typescript
 * const staleJobs = getStaleJobs(state);
 * for (const job of staleJobs) {
 *   // Reset to PENDING for reclaim
 *   job.status = "PENDING";
 *   job.claimedBy = undefined;
 *   job.claimedAt = undefined;
 *   job.heartbeatAt = undefined;
 * }
 * ```
 */
function getStaleJobs(state) {
    return state.jobs.filter((job) => isJobStale(job, state.config));
}
/**
 * Count jobs by status.
 *
 * @param state - The queue state
 * @returns Object with count for each status
 *
 * @example
 * ```typescript
 * const counts = countJobsByStatus(state);
 * // { PENDING: 5, CLAIMED: 2, DONE: 10, FAILED: 1 }
 * ```
 */
function countJobsByStatus(state) {
    const counts = {
        PENDING: 0,
        CLAIMED: 0,
        DONE: 0,
        FAILED: 0,
    };
    for (const job of state.jobs) {
        counts[job.status]++;
    }
    return counts;
}
// =============================================================================
// TYPE GUARDS
// =============================================================================
/**
 * Type guard to check if a value is a valid JobStatus.
 *
 * @param value - The value to check
 * @returns True if value is a valid JobStatus
 *
 * @example
 * ```typescript
 * const status: unknown = "PENDING";
 * if (isJobStatus(status)) {
 *   // status is now typed as JobStatus
 * }
 * ```
 */
function isJobStatus(value) {
    return (typeof value === "string" &&
        ["PENDING", "CLAIMED", "DONE", "FAILED"].includes(value));
}
/**
 * Type guard to check if a value is a valid JobKind.
 *
 * @param value - The value to check
 * @returns True if value is a valid JobKind
 *
 * @example
 * ```typescript
 * const kind: unknown = "jogyo_stage";
 * if (isJobKind(kind)) {
 *   // kind is now typed as JobKind
 * }
 * ```
 */
function isJobKind(value) {
    return (typeof value === "string" &&
        [
            "jogyo_stage",
            "baksa_verify",
            "execute_stage",
            "verify_stage",
            "generate_report",
            "custom",
        ].includes(value));
}
/**
 * Type guard to check if a value is a valid QueueStatus.
 *
 * @param value - The value to check
 * @returns True if value is a valid QueueStatus
 */
function isQueueStatus(value) {
    return (typeof value === "string" &&
        ["ACTIVE", "COMPLETED", "FAILED"].includes(value));
}
/**
 * Type guard to check if an object is a valid Job.
 *
 * Performs structural validation of required fields.
 *
 * @param obj - The object to check
 * @returns True if obj has the shape of a Job
 */
function isJob(obj) {
    if (typeof obj !== "object" || obj === null) {
        return false;
    }
    const job = obj;
    return (typeof job.jobId === "string" &&
        typeof job.stageId === "string" &&
        isJobKind(job.kind) &&
        isJobStatus(job.status) &&
        typeof job.attempt === "number" &&
        typeof job.maxAttempts === "number");
}
/**
 * Type guard to check if an object is a valid ParallelQueueState.
 *
 * Performs structural validation of required fields.
 *
 * @param obj - The object to check
 * @returns True if obj has the shape of a ParallelQueueState
 */
function isParallelQueueState(obj) {
    if (typeof obj !== "object" || obj === null) {
        return false;
    }
    const state = obj;
    return (typeof state.reportTitle === "string" &&
        typeof state.runId === "string" &&
        typeof state.createdAt === "string" &&
        typeof state.updatedAt === "string" &&
        Array.isArray(state.jobs) &&
        Array.isArray(state.workers) &&
        typeof state.config === "object" &&
        state.config !== null &&
        isQueueStatus(state.status));
}
