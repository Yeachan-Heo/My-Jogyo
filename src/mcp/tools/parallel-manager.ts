/**
 * Parallel Manager - MCP tool for managing parallel worker job queues
 *
 * Provides a durable, lease-based job queue for orchestrating parallel research workers.
 * All mutations are protected by QUEUE_LOCK to ensure consistency.
 *
 * Job State Machine:
 * ```
 * PENDING → CLAIMED → DONE
 *               ↓
 *           FAILED (if maxAttempts reached)
 *               ↓
 *           PENDING (if retry available)
 * ```
 *
 * Queue Storage:
 * ```
 * reports/{reportTitle}/queue/{runId}.json
 * ```
 *
 * Lock Path:
 * Uses getQueueLockPath(reportTitle, runId) from lock-paths.ts
 *
 * @module mcp/tools/parallel-manager
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { durableAtomicWrite, fileExists, readFile } from "../../lib/atomic-write.js";
import { getReportDir, validatePathSegment, ensureDirSync } from "../../lib/paths.js";
import { getQueueLockPath, DEFAULT_LOCK_TIMEOUT_MS } from "../../lib/lock-paths.js";
import { withLock } from "../../lib/session-lock.js";
import type {
  JobStatus,
  JobKind,
  QueueConfig,
  QueueStatus,
} from "../../lib/parallel-queue.js";
import { DEFAULT_QUEUE_CONFIG } from "../../lib/parallel-queue.js";

// =============================================================================
// TYPE DEFINITIONS (Extended from parallel-queue.ts schema)
// =============================================================================

/**
 * A single job in the queue.
 * Extends the schema with additional fields for tracking.
 */
interface Job {
  /** Unique job identifier */
  jobId: string;
  /** Stage identifier this job belongs to */
  stageId: string;
  /** Type of work */
  kind: JobKind;
  /** Job-specific payload (passed to worker) */
  payload: unknown;
  /** Current status */
  status: JobStatus;
  /** Current attempt number (0 = not started, 1 = first attempt, etc.) */
  attempt: number;
  /** Maximum number of attempts before marking as FAILED */
  maxAttempts: number;
  /** ISO 8601 timestamp when job was created */
  createdAt: string;
  /** ISO 8601 timestamp when job was last updated */
  updatedAt: string;
  /** Worker ID that claimed this job (only when status=CLAIMED) */
  claimedBy?: string;
  /** ISO 8601 timestamp when job was claimed */
  claimedAt?: string;
  /** ISO 8601 timestamp of last heartbeat from worker */
  heartbeatAt?: string;
  /** Result from completed job (only when status=DONE) */
  result?: unknown;
  /** Error message (only when status=FAILED) */
  error?: string;
  /** Required capabilities to run this job (optional) */
  requiredCapabilities?: string[];
}

/**
 * Worker registration info.
 * Uses field names from parallel-queue.ts schema.
 */
interface Worker {
  /** Unique worker identifier */
  workerId: string;
  /** ISO 8601 timestamp when worker registered */
  registeredAt: string;
  /** ISO 8601 timestamp of last heartbeat */
  lastHeartbeat: string;
  /** Worker's capabilities (e.g., ["gpu", "large-memory"]) */
  capabilities: string[];
  /** ID of job currently being worked on */
  currentJob?: string;
}

/**
 * Complete queue state (stored as JSON).
 * Compatible with ParallelQueueState from parallel-queue.ts.
 */
interface QueueState {
  /** Report title this queue belongs to */
  reportTitle: string;
  /** Run identifier */
  runId: string;
  /** Queue configuration */
  config: QueueConfig;
  /** ISO 8601 timestamp when queue was created */
  createdAt: string;
  /** ISO 8601 timestamp when queue was last updated */
  updatedAt: string;
  /** All jobs in the queue */
  jobs: Job[];
  /** Registered workers */
  workers: Worker[];
  /** Aggregate status of the queue */
  status: QueueStatus;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Local defaults that override schema defaults for parallel-manager */
const LOCAL_DEFAULT_CONFIG: QueueConfig = {
  ...DEFAULT_QUEUE_CONFIG,
  staleClaimMs: 120000, // 2 minutes (shorter than schema default)
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the path to the queue state file.
 */
function getQueuePath(reportTitle: string, runId: string): string {
  validatePathSegment(runId, "runId");
  return path.join(getReportDir(reportTitle), "queue", `${runId}.json`);
}

/**
 * Generate a unique job ID.
 */
function generateJobId(): string {
  return `job-${crypto.randomUUID().slice(0, 8)}`;
}

function createEmptyQueueState(
  reportTitle: string,
  runId: string,
  config?: Partial<QueueConfig>
): QueueState {
  const now = new Date().toISOString();
  return {
    reportTitle,
    runId,
    config: { ...LOCAL_DEFAULT_CONFIG, ...config },
    createdAt: now,
    updatedAt: now,
    jobs: [],
    workers: [],
    status: "ACTIVE",
  };
}

/**
 * Read queue state from disk.
 * Returns null if queue doesn't exist.
 */
async function loadQueueState(
  reportTitle: string,
  runId: string
): Promise<QueueState | null> {
  const queuePath = getQueuePath(reportTitle, runId);
  if (!(await fileExists(queuePath))) {
    return null;
  }
  return await readFile<QueueState>(queuePath, true);
}

/**
 * Save queue state to disk atomically.
 */
async function saveQueueState(state: QueueState): Promise<void> {
  const queuePath = getQueuePath(state.reportTitle, state.runId);
  const dir = path.dirname(queuePath);
  ensureDirSync(dir);
  state.updatedAt = new Date().toISOString();
  await durableAtomicWrite(queuePath, JSON.stringify(state, null, 2));
}

/**
 * Validate required parameters.
 * Uses validatePathSegment for standard security checks:
 * - NFC normalization
 * - Null-byte defense
 * - Path traversal prevention
 */
function validateRequired(
  reportTitle: string | undefined,
  runId: string | undefined,
  action: string
): void {
  // Use standard path segment validation (NFC normalization, null-byte defense, traversal check)
  // validatePathSegment handles undefined with descriptive error message
  validatePathSegment(reportTitle as string, "reportTitle");
  validatePathSegment(runId as string, "runId");
}

/**
 * Count jobs by status.
 */
function countJobsByStatus(jobs: Job[]): Record<JobStatus, number> {
  const counts: Record<JobStatus, number> = {
    PENDING: 0,
    CLAIMED: 0,
    DONE: 0,
    FAILED: 0,
  };
  for (const job of jobs) {
    counts[job.status]++;
  }
  return counts;
}

/**
 * Check if a worker has the required capabilities for a job.
 */
function workerCanRunJob(
  workerCapabilities: string[] | undefined,
  jobCapabilities: string[] | undefined
): boolean {
  if (!jobCapabilities || jobCapabilities.length === 0) {
    return true; // No capabilities required
  }
  if (!workerCapabilities || workerCapabilities.length === 0) {
    return false; // Job needs capabilities but worker has none
  }
  // Worker must have all required capabilities
  return jobCapabilities.every((cap) => workerCapabilities.includes(cap));
}

// =============================================================================
// ACTION IMPLEMENTATIONS
// =============================================================================

/**
 * Initialize a new queue.
 */
async function actionInit(
  reportTitle: string,
  runId: string,
  config?: Partial<QueueConfig>
): Promise<Record<string, unknown>> {
  const queuePath = getQueuePath(reportTitle, runId);
  const lockPath = getQueueLockPath(reportTitle, runId);

  return await withLock(
    lockPath,
    async () => {
      if (await fileExists(queuePath)) {
        throw new Error(
          `Queue already exists for ${reportTitle}/${runId}. Use 'status' to check state.`
        );
      }

      const state = createEmptyQueueState(reportTitle, runId, config);
      await saveQueueState(state);

      return {
        success: true,
        action: "init",
        reportTitle,
        runId,
        queuePath,
        config: state.config,
      };
    },
    DEFAULT_LOCK_TIMEOUT_MS
  );
}

/**
 * Add jobs to the queue.
 */
async function actionEnqueue(
  reportTitle: string,
  runId: string,
  jobs: Array<{ stageId: string; kind: JobKind; payload?: unknown; requiredCapabilities?: string[] }>
): Promise<Record<string, unknown>> {
  const lockPath = getQueueLockPath(reportTitle, runId);

  return await withLock(
    lockPath,
    async () => {
      const state = await loadQueueState(reportTitle, runId);
      if (!state) {
        throw new Error(`Queue not found for ${reportTitle}/${runId}. Use 'init' first.`);
      }

      const now = new Date().toISOString();
      const jobIds: string[] = [];

      for (const jobDef of jobs) {
        const job: Job = {
          jobId: generateJobId(),
          stageId: jobDef.stageId,
          kind: jobDef.kind,
          payload: jobDef.payload ?? {},
          status: "PENDING",
          attempt: 0,
          maxAttempts: state.config.maxJobAttempts,
          createdAt: now,
          updatedAt: now,
          requiredCapabilities: jobDef.requiredCapabilities,
        };
        state.jobs.push(job);
        jobIds.push(job.jobId);
      }

      await saveQueueState(state);

      return {
        success: true,
        action: "enqueue",
        reportTitle,
        runId,
        jobIds,
        enqueuedCount: jobIds.length,
        totalJobs: state.jobs.length,
      };
    },
    DEFAULT_LOCK_TIMEOUT_MS
  );
}

/**
 * Claim the next available job (atomic).
 */
async function actionClaim(
  reportTitle: string,
  runId: string,
  workerId: string,
  capabilities?: string[]
): Promise<Record<string, unknown>> {
  const lockPath = getQueueLockPath(reportTitle, runId);

  return await withLock(
    lockPath,
    async () => {
      const state = await loadQueueState(reportTitle, runId);
      if (!state) {
        throw new Error(`Queue not found for ${reportTitle}/${runId}. Use 'init' first.`);
      }

      const now = new Date().toISOString();

      // Register or update worker
      let worker = state.workers.find((w) => w.workerId === workerId);
      if (!worker) {
        worker = {
          workerId: workerId,
          registeredAt: now,
          lastHeartbeat: now,
          capabilities: capabilities || [],
        };
        state.workers.push(worker);
      } else {
        worker.lastHeartbeat = now;
        worker.capabilities = capabilities || worker.capabilities;
      }

      // Find first available PENDING job that worker can run
      const job = state.jobs.find(
        (j) =>
          j.status === "PENDING" &&
          workerCanRunJob(capabilities, j.requiredCapabilities)
      );

      if (!job) {
        await saveQueueState(state);
        return {
          success: false,
          action: "claim",
          reportTitle,
          runId,
          workerId,
          reason: "no_jobs",
          message: "No pending jobs available that match worker capabilities",
        };
      }

      // Claim the job
      job.status = "CLAIMED";
      job.claimedBy = workerId;
      job.claimedAt = now;
      job.heartbeatAt = now;
      job.attempt++;
      job.updatedAt = now;

      worker.currentJob = job.jobId;

      await saveQueueState(state);

      return {
        success: true,
        action: "claim",
        reportTitle,
        runId,
        workerId,
        job: {
          jobId: job.jobId,
          stageId: job.stageId,
          kind: job.kind,
          payload: job.payload,
          attempt: job.attempt,
          requiredCapabilities: job.requiredCapabilities,
        },
      };
    },
    DEFAULT_LOCK_TIMEOUT_MS
  );
}

/**
 * Send heartbeat to keep job claim alive.
 */
async function actionHeartbeat(
  reportTitle: string,
  runId: string,
  workerId: string,
  jobId?: string
): Promise<Record<string, unknown>> {
  const lockPath = getQueueLockPath(reportTitle, runId);

  return await withLock(
    lockPath,
    async () => {
      const state = await loadQueueState(reportTitle, runId);
      if (!state) {
        throw new Error(`Queue not found for ${reportTitle}/${runId}.`);
      }

      const now = new Date().toISOString();

      // Update worker heartbeat
      const worker = state.workers.find((w) => w.workerId === workerId);
      if (worker) {
        worker.lastHeartbeat = now;
      }

      // Update job heartbeat if specified
      if (jobId) {
        const job = state.jobs.find((j) => j.jobId === jobId);
        if (job && job.claimedBy === workerId && job.status === "CLAIMED") {
          job.heartbeatAt = now;
          job.updatedAt = now;
        }
      }

      await saveQueueState(state);

      return {
        success: true,
        action: "heartbeat",
        reportTitle,
        runId,
        workerId,
        jobId,
        timestamp: now,
      };
    },
    DEFAULT_LOCK_TIMEOUT_MS
  );
}

/**
 * Mark a job as completed.
 */
async function actionComplete(
  reportTitle: string,
  runId: string,
  jobId: string,
  result: unknown
): Promise<Record<string, unknown>> {
  const lockPath = getQueueLockPath(reportTitle, runId);

  return await withLock(
    lockPath,
    async () => {
      const state = await loadQueueState(reportTitle, runId);
      if (!state) {
        throw new Error(`Queue not found for ${reportTitle}/${runId}.`);
      }

      const job = state.jobs.find((j) => j.jobId === jobId);
      if (!job) {
        throw new Error(`Job '${jobId}' not found in queue.`);
      }

      if (job.status !== "CLAIMED") {
        throw new Error(
          `Job '${jobId}' is not in CLAIMED state (current: ${job.status}). Cannot complete.`
        );
      }

      const now = new Date().toISOString();
      job.status = "DONE";
      job.result = result;
      job.updatedAt = now;

      // Clear worker's current job
      const worker = state.workers.find((w) => w.workerId === job.claimedBy);
      if (worker) {
        worker.currentJob = undefined;
      }

      await saveQueueState(state);

      return {
        success: true,
        action: "complete",
        reportTitle,
        runId,
        jobId,
        stageId: job.stageId,
        completedAt: now,
      };
    },
    DEFAULT_LOCK_TIMEOUT_MS
  );
}

/**
 * Mark a job as failed.
 */
async function actionFail(
  reportTitle: string,
  runId: string,
  jobId: string,
  error: string
): Promise<Record<string, unknown>> {
  const lockPath = getQueueLockPath(reportTitle, runId);

  return await withLock(
    lockPath,
    async () => {
      const state = await loadQueueState(reportTitle, runId);
      if (!state) {
        throw new Error(`Queue not found for ${reportTitle}/${runId}.`);
      }

      const job = state.jobs.find((j) => j.jobId === jobId);
      if (!job) {
        throw new Error(`Job '${jobId}' not found in queue.`);
      }

      if (job.status !== "CLAIMED") {
        throw new Error(
          `Job '${jobId}' is not in CLAIMED state (current: ${job.status}). Cannot fail.`
        );
      }

      const now = new Date().toISOString();

      // Clear worker's current job
      const worker = state.workers.find((w) => w.workerId === job.claimedBy);
      if (worker) {
        worker.currentJob = undefined;
      }

      // Check if we should retry or mark as permanently failed
      if (job.attempt >= job.maxAttempts) {
        // Max attempts reached - permanent failure
        job.status = "FAILED";
        job.error = error;
        job.updatedAt = now;

        await saveQueueState(state);

        return {
          success: true,
          action: "fail",
          reportTitle,
          runId,
          jobId,
          stageId: job.stageId,
          finalStatus: "FAILED",
          attempt: job.attempt,
          maxAttempts: job.maxAttempts,
          message: "Job permanently failed after max attempts",
          error,
        };
      } else {
        // Reset to PENDING for retry
        job.status = "PENDING";
        job.claimedBy = undefined;
        job.claimedAt = undefined;
        job.heartbeatAt = undefined;
        job.error = error; // Keep last error for debugging
        job.updatedAt = now;

        await saveQueueState(state);

        return {
          success: true,
          action: "fail",
          reportTitle,
          runId,
          jobId,
          stageId: job.stageId,
          finalStatus: "PENDING",
          attempt: job.attempt,
          maxAttempts: job.maxAttempts,
          message: "Job reset to PENDING for retry",
          error,
        };
      }
    },
    DEFAULT_LOCK_TIMEOUT_MS
  );
}

/**
 * Get queue status.
 */
async function actionStatus(
  reportTitle: string,
  runId: string
): Promise<Record<string, unknown>> {
  // Status is a read-only operation, but we still use lock
  // to ensure we get a consistent view
  const lockPath = getQueueLockPath(reportTitle, runId);

  return await withLock(
    lockPath,
    async () => {
      const state = await loadQueueState(reportTitle, runId);
      if (!state) {
        throw new Error(`Queue not found for ${reportTitle}/${runId}.`);
      }

      const jobCounts = countJobsByStatus(state.jobs);
      const activeWorkers = state.workers.filter((w) => w.currentJob);

      return {
        success: true,
        action: "status",
        reportTitle,
        runId,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        config: state.config,
        jobCounts,
        totalJobs: state.jobs.length,
        workers: state.workers.map((w) => ({
          workerId: w.workerId,
          lastHeartbeat: w.lastHeartbeat,
          capabilities: w.capabilities,
          currentJob: w.currentJob,
        })),
        activeWorkerCount: activeWorkers.length,
        isComplete: jobCounts.PENDING === 0 && jobCounts.CLAIMED === 0,
        hasFailed: jobCounts.FAILED > 0,
      };
    },
    DEFAULT_LOCK_TIMEOUT_MS
  );
}

/**
 * Reap stale jobs (reset CLAIMED jobs that have timed out).
 */
async function actionReap(
  reportTitle: string,
  runId: string
): Promise<Record<string, unknown>> {
  const lockPath = getQueueLockPath(reportTitle, runId);

  return await withLock(
    lockPath,
    async () => {
      const state = await loadQueueState(reportTitle, runId);
      if (!state) {
        throw new Error(`Queue not found for ${reportTitle}/${runId}.`);
      }

      const now = Date.now();
      const staleThreshold = now - state.config.staleClaimMs;
      const reapedJobIds: string[] = [];

      for (const job of state.jobs) {
        if (job.status !== "CLAIMED") continue;

        const lastActivity = job.heartbeatAt || job.claimedAt;
        if (!lastActivity) continue;

        const lastActivityTime = new Date(lastActivity).getTime();
        if (lastActivityTime < staleThreshold) {
          // Job is stale - check if we should retry or fail
          if (job.attempt >= job.maxAttempts) {
            job.status = "FAILED";
            job.error = "Stale claim: no heartbeat received within timeout (max attempts reached)";
          } else {
            job.status = "PENDING";
            job.error = "Stale claim: no heartbeat received within timeout";
          }
          job.claimedBy = undefined;
          job.claimedAt = undefined;
          job.heartbeatAt = undefined;
          job.updatedAt = new Date().toISOString();
          reapedJobIds.push(job.jobId);
        }
      }

      if (reapedJobIds.length > 0) {
        await saveQueueState(state);
      }

      return {
        success: true,
        action: "reap",
        reportTitle,
        runId,
        reapedCount: reapedJobIds.length,
        reapedJobIds,
        staleThresholdMs: state.config.staleClaimMs,
      };
    },
    DEFAULT_LOCK_TIMEOUT_MS
  );
}

/**
 * Check if all jobs for a stage (or entire queue) are complete.
 */
async function actionBarrierWait(
  reportTitle: string,
  runId: string,
  stageId?: string
): Promise<Record<string, unknown>> {
  const lockPath = getQueueLockPath(reportTitle, runId);

  return await withLock(
    lockPath,
    async () => {
      const state = await loadQueueState(reportTitle, runId);
      if (!state) {
        throw new Error(`Queue not found for ${reportTitle}/${runId}.`);
      }

      // Filter jobs by stage if specified
      const jobs = stageId
        ? state.jobs.filter((j) => j.stageId === stageId)
        : state.jobs;

      const counts = countJobsByStatus(jobs);
      const complete = counts.PENDING === 0 && counts.CLAIMED === 0;

      return {
        success: true,
        action: "barrier_wait",
        reportTitle,
        runId,
        stageId: stageId || "all",
        complete,
        pending: counts.PENDING,
        claimed: counts.CLAIMED,
        done: counts.DONE,
        failed: counts.FAILED,
        totalJobs: jobs.length,
      };
    },
    DEFAULT_LOCK_TIMEOUT_MS
  );
}

// =============================================================================
// MCP TOOL DEFINITION
// =============================================================================

export const parallelManagerTool = {
  name: "parallel_manager",
  description:
    "Manage parallel worker job queue for Gyoshu research. " +
    "Provides a durable, lease-based queue with heartbeat-based stale detection. " +
    "Actions: init (create queue), enqueue (add jobs), claim (get next job), " +
    "heartbeat (keep-alive), complete (mark done), fail (mark failed), " +
    "status (get stats), reap (reclaim stale), barrier_wait (check completion).",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "init",
          "enqueue",
          "claim",
          "heartbeat",
          "complete",
          "fail",
          "status",
          "reap",
          "barrier_wait",
        ],
        description: "Operation to perform on the job queue",
      },
      reportTitle: {
        type: "string",
        description: "Report/research title (required for all actions)",
      },
      runId: {
        type: "string",
        description: "Run identifier (required for all actions)",
      },
      config: {
        type: "object",
        description:
          "Queue config for init: { maxJobAttempts?: number, staleClaimMs?: number, heartbeatIntervalMs?: number }",
        properties: {
          maxJobAttempts: { type: "number" },
          staleClaimMs: { type: "number" },
          heartbeatIntervalMs: { type: "number" },
        },
      },
      jobs: {
        type: "array",
        description:
          "Jobs to enqueue: Array<{ stageId: string, kind: string, payload?: unknown, requiredCapabilities?: string[] }>",
        items: {
          type: "object",
          properties: {
            stageId: { type: "string" },
            kind: { type: "string" },
            payload: {},
            requiredCapabilities: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["stageId", "kind"],
        },
      },
      workerId: {
        type: "string",
        description: "Worker identifier (required for claim/heartbeat)",
      },
      capabilities: {
        type: "array",
        description: "Worker capabilities for claim: string[] (e.g., ['gpu', 'large-memory'])",
        items: { type: "string" },
      },
      jobId: {
        type: "string",
        description: "Job identifier (required for complete/fail, optional for heartbeat)",
      },
      result: {
        description: "Result data for complete action",
      },
      error: {
        type: "string",
        description: "Error message for fail action",
      },
      stageId: {
        type: "string",
        description: "Stage identifier for barrier_wait (omit to check all jobs)",
      },
    },
    required: ["action"],
  },
};

// =============================================================================
// MCP HANDLER FUNCTION
// =============================================================================

export async function handleParallelManager(args: unknown): Promise<unknown> {
  const {
    action,
    reportTitle,
    runId,
    config,
    jobs,
    workerId,
    capabilities,
    jobId,
    result,
    error,
    stageId,
  } = args as {
    action: string;
    reportTitle?: string;
    runId?: string;
    config?: Partial<QueueConfig>;
    jobs?: Array<{ stageId: string; kind: JobKind; payload?: unknown; requiredCapabilities?: string[] }>;
    workerId?: string;
    capabilities?: string[];
    jobId?: string;
    result?: unknown;
    error?: string;
    stageId?: string;
  };

  // Validate required parameters for most actions
  if (action !== "init") {
    validateRequired(reportTitle, runId, action);
  } else {
    // init also requires these
    validateRequired(reportTitle, runId, action);
  }

  switch (action) {
    case "init":
      return JSON.stringify(
        await actionInit(reportTitle!, runId!, config),
        null,
        2
      );

    case "enqueue":
      if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
        throw new Error("jobs array is required for enqueue action");
      }
      return JSON.stringify(
        await actionEnqueue(reportTitle!, runId!, jobs),
        null,
        2
      );

    case "claim":
      if (!workerId) {
        throw new Error("workerId is required for claim action");
      }
      return JSON.stringify(
        await actionClaim(reportTitle!, runId!, workerId, capabilities),
        null,
        2
      );

    case "heartbeat":
      if (!workerId) {
        throw new Error("workerId is required for heartbeat action");
      }
      return JSON.stringify(
        await actionHeartbeat(reportTitle!, runId!, workerId, jobId),
        null,
        2
      );

    case "complete":
      if (!jobId) {
        throw new Error("jobId is required for complete action");
      }
      return JSON.stringify(
        await actionComplete(reportTitle!, runId!, jobId, result),
        null,
        2
      );

    case "fail":
      if (!jobId) {
        throw new Error("jobId is required for fail action");
      }
      if (!error) {
        throw new Error("error message is required for fail action");
      }
      return JSON.stringify(
        await actionFail(reportTitle!, runId!, jobId, error),
        null,
        2
      );

    case "status":
      return JSON.stringify(
        await actionStatus(reportTitle!, runId!),
        null,
        2
      );

    case "reap":
      return JSON.stringify(
        await actionReap(reportTitle!, runId!),
        null,
        2
      );

    case "barrier_wait":
      return JSON.stringify(
        await actionBarrierWait(reportTitle!, runId!, stageId),
        null,
        2
      );

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
