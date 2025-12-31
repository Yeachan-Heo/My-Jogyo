/**
 * Session Manager - OpenCode tool for managing VibeSci research sessions
 *
 * Provides CRUD operations for session manifests with:
 * - Atomic, durable writes to prevent data corruption
 * - Cell execution tracking with content hashes
 * - Environment metadata storage (Python version, packages, seeds)
 * - Privacy-aware session storage in user's home directory
 *
 * @module session-manager
 */

import { tool } from "@opencode-ai/plugin";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { durableAtomicWrite, fileExists, readFile } from "../lib/atomic-write";

/**
 * Root directory for all VibeSci session data.
 * Located in user's home directory for privacy and persistence.
 */
const SESSIONS_DIR = path.join(os.homedir(), ".vibesci", "sessions");

/**
 * Environment metadata captured for reproducibility.
 */
interface EnvironmentMetadata {
  /** Python interpreter version */
  pythonVersion: string;
  /** Operating system platform */
  platform: string;
  /** Installed package versions */
  packages: Record<string, string>;
  /** Random seeds used for reproducibility */
  randomSeeds: Record<string, number>;
}

/**
 * Tracking data for a single executed cell.
 */
interface CellExecution {
  /** Number of times this cell has been executed */
  executionCount: number;
  /** SHA-256 hash of the cell's content at execution time */
  contentHash: string;
  /** ISO 8601 timestamp of last execution */
  timestamp: string;
  /** Whether the execution completed successfully */
  success: boolean;
}

/**
 * Session orchestration mode.
 * - PLANNER: Creating/refining research plan
 * - AUTO: Autonomous execution of plan
 * - REPL: Interactive exploration mode
 */
type SessionMode = "PLANNER" | "AUTO" | "REPL";

/**
 * Status of the research goal within a session.
 */
type GoalStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED" | "ABORTED" | "FAILED";

/**
 * Budget tracking for session resource limits.
 */
interface SessionBudgets {
  /** Maximum number of cycles allowed (optional limit) */
  maxCycles?: number;
  /** Maximum number of tool calls allowed (optional limit) */
  maxToolCalls?: number;
  /** Maximum time in minutes allowed (optional limit) */
  maxTimeMinutes?: number;
  /** Current cycle number (0-indexed) */
  currentCycle: number;
  /** Total tool calls made in this session */
  totalToolCalls: number;
  /** ISO 8601 timestamp when budget tracking started */
  startedAt?: string;
}

/**
 * Complete session manifest structure.
 * Stored as JSON in ~/.vibesci/sessions/{researchSessionID}/manifest.json
 */
interface SessionManifest {
  /** Unique identifier for this research session */
  researchSessionID: string;
  /** ISO 8601 timestamp when session was created */
  created: string;
  /** ISO 8601 timestamp when session was last updated */
  updated: string;
  /** Current status of the session */
  status: "active" | "completed" | "archived";
  /** Path to the Jupyter notebook file */
  notebookPath: string;
  /** Environment metadata for reproducibility */
  environment: EnvironmentMetadata;
  /** Execution data for each cell, keyed by cell ID */
  executedCells: Record<string, CellExecution>;
  /** Ordered list of cell IDs in execution sequence */
  executionOrder: string[];
  /** Execution count of the last successful full run */
  lastSuccessfulExecution: number;
  /** Current orchestration mode */
  mode: SessionMode;
  /** High-level research goal for this session */
  goal?: string;
  /** Status of the research goal */
  goalStatus: GoalStatus;
  /** Resource budget tracking */
  budgets: SessionBudgets;
  /** Reason for abort if goalStatus is ABORTED */
  abortReason?: string;
  /** ISO 8601 timestamp of last state snapshot */
  lastSnapshotAt?: string;
}

/**
 * Ensures the sessions directory exists.
 * Creates parent directories recursively if needed.
 */
async function ensureSessionsDir(): Promise<void> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

/**
 * Gets the path to a session's manifest file.
 *
 * @param sessionId - The research session identifier
 * @returns Full path to the manifest.json file
 */
function getManifestPath(sessionId: string): string {
  return path.join(SESSIONS_DIR, sessionId, "manifest.json");
}

/**
 * Gets the path to a session's directory.
 *
 * @param sessionId - The research session identifier
 * @returns Full path to the session directory
 */
function getSessionDir(sessionId: string): string {
  return path.join(SESSIONS_DIR, sessionId);
}

/**
 * Validates that a session ID is safe to use in file paths.
 * Prevents directory traversal and other path injection attacks.
 *
 * @param sessionId - The session ID to validate
 * @throws Error if session ID is invalid
 */
function validateSessionId(sessionId: string): void {
  if (!sessionId || typeof sessionId !== "string") {
    throw new Error("researchSessionID is required and must be a string");
  }

  // Prevent path traversal attacks
  if (sessionId.includes("..") || sessionId.includes("/") || sessionId.includes("\\")) {
    throw new Error("Invalid researchSessionID: contains path traversal characters");
  }

  // Prevent empty or whitespace-only IDs
  if (sessionId.trim().length === 0) {
    throw new Error("Invalid researchSessionID: cannot be empty or whitespace");
  }

  // Limit length to prevent filesystem issues
  if (sessionId.length > 255) {
    throw new Error("Invalid researchSessionID: exceeds maximum length of 255 characters");
  }
}

/**
 * Creates a new session manifest with default values.
 *
 * @param sessionId - The research session identifier
 * @param data - Optional initial data to merge into the manifest
 * @returns A new SessionManifest object
 */
function createDefaultManifest(
  sessionId: string,
  data?: Partial<SessionManifest>
): SessionManifest {
  const now = new Date().toISOString();

  return {
    researchSessionID: sessionId,
    created: now,
    updated: now,
    status: "active",
    notebookPath: data?.notebookPath ?? "",
    environment: data?.environment ?? {
      pythonVersion: "",
      platform: process.platform,
      packages: {},
      randomSeeds: {},
    },
    executedCells: data?.executedCells ?? {},
    executionOrder: data?.executionOrder ?? [],
    lastSuccessfulExecution: data?.lastSuccessfulExecution ?? 0,
    mode: data?.mode ?? "REPL",
    goal: data?.goal,
    goalStatus: data?.goalStatus ?? "PENDING",
    budgets: data?.budgets ?? {
      currentCycle: 0,
      totalToolCalls: 0,
    },
    abortReason: data?.abortReason,
    lastSnapshotAt: data?.lastSnapshotAt,
    ...data,
  };
}

export default tool({
  description:
    "Manage VibeSci research sessions - create, read, update, delete session manifests. " +
    "Sessions track notebook paths, execution history, environment metadata, and random seeds " +
    "for scientific reproducibility.",
  args: {
    action: tool.schema
      .enum(["create", "get", "list", "update", "delete"])
      .describe("Operation to perform on sessions"),
    researchSessionID: tool.schema
      .string()
      .optional()
      .describe("Unique session identifier (required for create/get/update/delete)"),
    data: tool.schema
      .any()
      .optional()
      .describe(
        "Session data for create/update operations. Can include: notebookPath, environment, " +
          "executedCells, executionOrder, status, lastSuccessfulExecution"
      ),
  },

  async execute(args) {
    await ensureSessionsDir();

    switch (args.action) {
      case "create": {
        if (!args.researchSessionID) {
          throw new Error("researchSessionID is required for create action");
        }
        validateSessionId(args.researchSessionID);

        const sessionDir = getSessionDir(args.researchSessionID);
        const manifestPath = getManifestPath(args.researchSessionID);

        if (await fileExists(manifestPath)) {
          throw new Error(
            `Session '${args.researchSessionID}' already exists. Use 'update' to modify existing sessions.`
          );
        }

        await fs.mkdir(sessionDir, { recursive: true });

        const manifest = createDefaultManifest(
          args.researchSessionID,
          args.data as Partial<SessionManifest>
        );

        await durableAtomicWrite(manifestPath, JSON.stringify(manifest, null, 2));

        return JSON.stringify(
          {
            success: true,
            action: "create",
            researchSessionID: args.researchSessionID,
            manifest,
          },
          null,
          2
        );
      }

      case "get": {
        if (!args.researchSessionID) {
          throw new Error("researchSessionID is required for get action");
        }
        validateSessionId(args.researchSessionID);

        const manifestPath = getManifestPath(args.researchSessionID);

        if (!(await fileExists(manifestPath))) {
          throw new Error(`Session '${args.researchSessionID}' not found`);
        }

        const manifest = await readFile<SessionManifest>(manifestPath, true);

        return JSON.stringify(
          {
            success: true,
            action: "get",
            researchSessionID: args.researchSessionID,
            manifest,
          },
          null,
          2
        );
      }

      case "list": {
        let entries: Array<{ name: string; isDirectory: () => boolean }>;

        try {
          entries = await fs.readdir(SESSIONS_DIR, { withFileTypes: true });
        } catch (err: any) {
          if (err.code === "ENOENT") {
            return JSON.stringify(
              {
                success: true,
                action: "list",
                sessions: [],
                count: 0,
              },
              null,
              2
            );
          }
          throw err;
        }

        const sessions: Array<{
          researchSessionID: string;
          status: string;
          created: string;
          updated: string;
          notebookPath: string;
        }> = [];

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const manifestPath = getManifestPath(entry.name);
          const manifest = await readFile<SessionManifest>(manifestPath, true).catch(() => null);
          if (!manifest) continue;

          sessions.push({
            researchSessionID: manifest.researchSessionID,
            status: manifest.status,
            created: manifest.created,
            updated: manifest.updated,
            notebookPath: manifest.notebookPath,
          });
        }

        sessions.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());

        return JSON.stringify(
          {
            success: true,
            action: "list",
            sessions,
            count: sessions.length,
          },
          null,
          2
        );
      }

      case "update": {
        if (!args.researchSessionID) {
          throw new Error("researchSessionID is required for update action");
        }
        validateSessionId(args.researchSessionID);

        const manifestPath = getManifestPath(args.researchSessionID);

        if (!(await fileExists(manifestPath))) {
          throw new Error(`Session '${args.researchSessionID}' not found. Use 'create' first.`);
        }

        const existing = await readFile<SessionManifest>(manifestPath, true);

        const updateData = args.data as Partial<SessionManifest> | undefined;
        const updated: SessionManifest = {
          ...existing,
          ...updateData,
          updated: new Date().toISOString(),
          researchSessionID: existing.researchSessionID,
          created: existing.created,
        };

        if (updateData?.executedCells) {
          updated.executedCells = {
            ...existing.executedCells,
            ...updateData.executedCells,
          };
        }

        if (updateData?.executionOrder) {
          const existingOrder = new Set(existing.executionOrder);
          const newEntries = updateData.executionOrder.filter(
            (id: string) => !existingOrder.has(id)
          );
          updated.executionOrder = [...existing.executionOrder, ...newEntries];
        }

        if (updateData?.environment) {
          updated.environment = {
            ...existing.environment,
            ...updateData.environment,
            packages: {
              ...existing.environment.packages,
              ...updateData.environment.packages,
            },
            randomSeeds: {
              ...existing.environment.randomSeeds,
              ...updateData.environment.randomSeeds,
            },
          };
        }

        if (updateData?.budgets) {
          updated.budgets = {
            ...existing.budgets,
            ...updateData.budgets,
          };
        }

        await durableAtomicWrite(manifestPath, JSON.stringify(updated, null, 2));

        return JSON.stringify(
          {
            success: true,
            action: "update",
            researchSessionID: args.researchSessionID,
            manifest: updated,
          },
          null,
          2
        );
      }

      case "delete": {
        if (!args.researchSessionID) {
          throw new Error("researchSessionID is required for delete action");
        }
        validateSessionId(args.researchSessionID);

        const sessionDir = getSessionDir(args.researchSessionID);

        if (!(await fileExists(sessionDir))) {
          throw new Error(`Session '${args.researchSessionID}' not found`);
        }

        await fs.rm(sessionDir, { recursive: true, force: true });

        return JSON.stringify(
          {
            success: true,
            action: "delete",
            researchSessionID: args.researchSessionID,
            message: `Session '${args.researchSessionID}' and all associated data deleted`,
          },
          null,
          2
        );
      }

      default:
        throw new Error(`Unknown action: ${args.action}`);
    }
  },
});
