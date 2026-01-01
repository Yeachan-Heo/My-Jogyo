/**
 * Session Manager - OpenCode tool for managing Gyoshu runtime sessions
 *
 * Provides runtime-only session management with:
 * - Session locking (acquire/release)
 * - Bridge socket paths
 * - Bridge metadata storage (runtime state only)
 *
 * Note: Durable research data is now stored in notebook frontmatter.
 * This tool only manages ephemeral runtime state in gyoshu/runtime/.
 *
 * @module session-manager
 */

import { tool } from "@opencode-ai/plugin";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { durableAtomicWrite, fileExists, readFile } from "../lib/atomic-write";
import {
  getRuntimeDir,
  getSessionDir,
  getGyoshuRoot,
  ensureDirSync,
  existsSync,
} from "../lib/paths";

// ===== CONSTANTS =====

/**
 * Name of the bridge metadata file (runtime state only)
 */
const BRIDGE_META_FILE = "bridge_meta.json";

/**
 * Name of the session lock file
 */
const SESSION_LOCK_FILE = "session.lock";

// ===== INTERFACES =====

/**
 * Python environment info for runtime tracking
 */
interface PythonEnvInfo {
  /** Environment type (venv, uv, poetry, conda, etc.) */
  type: string;
  /** Path to Python interpreter */
  pythonPath: string;
}

/**
 * Bridge metadata - lightweight runtime state only.
 * This is NOT durable research data - just ephemeral session state.
 */
interface BridgeMeta {
  /** Unique session identifier */
  sessionId: string;
  /** ISO 8601 timestamp when bridge was started */
  bridgeStarted: string;
  /** Python environment information */
  pythonEnv: PythonEnvInfo;
  /** Path to the notebook being edited */
  notebookPath: string;
  /** Human-readable report title for display purposes */
  reportTitle?: string;
}

// ===== RUNTIME INITIALIZATION =====

/**
 * Ensures the gyoshu runtime directory exists with proper .gitignore.
 * Creates the minimal structure:
 *
 * gyoshu/
 * ├── .gitignore           # Ignores everything
 * └── runtime/             # Ephemeral session data
 */
async function ensureGyoshuRuntime(): Promise<void> {
  const gyoshuRoot = getGyoshuRoot();
  const runtimeDir = getRuntimeDir();

  await fs.mkdir(runtimeDir, { recursive: true });

  const gitignorePath = path.join(gyoshuRoot, ".gitignore");
  if (!existsSync(gitignorePath)) {
    await fs.writeFile(
      gitignorePath,
      "# Gyoshu runtime - always gitignored\n*\n",
      "utf-8"
    );
  }
}

/**
 * Synchronous version for initialization in execute()
 */
function ensureGyoshuRuntimeSync(): void {
  const gyoshuRoot = getGyoshuRoot();
  const runtimeDir = getRuntimeDir();

  ensureDirSync(runtimeDir);

  const gitignorePath = path.join(gyoshuRoot, ".gitignore");
  if (!existsSync(gitignorePath)) {
    fsSync.writeFileSync(
      gitignorePath,
      "# Gyoshu runtime - always gitignored\n*\n",
      "utf-8"
    );
  }
}

// ===== PATH HELPERS =====

/**
 * Gets the path to a session's bridge metadata file.
 *
 * @param sessionId - The session identifier
 * @returns Full path to bridge_meta.json
 */
function getBridgeMetaPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), BRIDGE_META_FILE);
}

/**
 * Gets the path to a session's lock file.
 *
 * @param sessionId - The session identifier
 * @returns Full path to session.lock
 */
function getSessionLockFilePath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), SESSION_LOCK_FILE);
}

// ===== VALIDATION =====

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

  if (sessionId.includes("..") || sessionId.includes("/") || sessionId.includes("\\")) {
    throw new Error("Invalid researchSessionID: contains path traversal characters");
  }

  if (sessionId.trim().length === 0) {
    throw new Error("Invalid researchSessionID: cannot be empty or whitespace");
  }

  if (sessionId.length > 255) {
    throw new Error("Invalid researchSessionID: exceeds maximum length of 255 characters");
  }
}

// ===== DEFAULT BRIDGE META =====

/**
 * Creates a new bridge metadata object with default values.
 *
 * @param sessionId - The session identifier
 * @param data - Optional initial data to merge
 * @returns A new BridgeMeta object
 */
function createDefaultBridgeMeta(
  sessionId: string,
  data?: Partial<BridgeMeta>
): BridgeMeta {
  const now = new Date().toISOString();

  return {
    sessionId,
    bridgeStarted: now,
    pythonEnv: {
      type: "unknown",
      pythonPath: "",
    },
    notebookPath: "",
    reportTitle: "",
    ...data,
  };
}

// ===== TOOL DEFINITION =====

export default tool({
  description:
    "Manage Gyoshu runtime sessions - create, read, update, delete session state. " +
    "Sessions track bridge metadata, notebook paths, and runtime state. " +
    "Research data is now stored in notebook frontmatter (not session manifests).",
  args: {
    action: tool.schema
      .enum(["create", "get", "list", "update", "delete"])
      .describe("Operation to perform on runtime sessions"),
    researchSessionID: tool.schema
      .string()
      .optional()
      .describe("Unique session identifier (required for create/get/update/delete)"),
    data: tool.schema
      .any()
      .optional()
      .describe(
        "Bridge metadata for create/update operations. Can include: " +
        "pythonEnv (type, pythonPath), notebookPath, reportTitle"
      ),
  },

  async execute(args) {
    ensureGyoshuRuntimeSync();

    switch (args.action) {
      // ===== CREATE =====
      case "create": {
        if (!args.researchSessionID) {
          throw new Error("researchSessionID is required for create action");
        }
        validateSessionId(args.researchSessionID);

        const sessionDir = getSessionDir(args.researchSessionID);
        const bridgeMetaPath = getBridgeMetaPath(args.researchSessionID);

        if (await fileExists(bridgeMetaPath)) {
          throw new Error(
            `Session '${args.researchSessionID}' already exists. Use 'update' to modify existing sessions.`
          );
        }

        await fs.mkdir(sessionDir, { recursive: true });

        const bridgeMeta = createDefaultBridgeMeta(
          args.researchSessionID,
          args.data as Partial<BridgeMeta>
        );

        await durableAtomicWrite(bridgeMetaPath, JSON.stringify(bridgeMeta, null, 2));

        return JSON.stringify(
          {
            success: true,
            action: "create",
            researchSessionID: args.researchSessionID,
            bridgeMeta,
            sessionDir,
          },
          null,
          2
        );
      }

      // ===== GET =====
      case "get": {
        if (!args.researchSessionID) {
          throw new Error("researchSessionID is required for get action");
        }
        validateSessionId(args.researchSessionID);

        const bridgeMetaPath = getBridgeMetaPath(args.researchSessionID);
        const sessionDir = getSessionDir(args.researchSessionID);
        const lockPath = getSessionLockFilePath(args.researchSessionID);

        if (!(await fileExists(bridgeMetaPath))) {
          throw new Error(`Session '${args.researchSessionID}' not found`);
        }

        const bridgeMeta = await readFile<BridgeMeta>(bridgeMetaPath, true);
        const isLocked = await fileExists(lockPath);

        return JSON.stringify(
          {
            success: true,
            action: "get",
            researchSessionID: args.researchSessionID,
            bridgeMeta,
            sessionDir,
            isLocked,
          },
          null,
          2
        );
      }

      // ===== LIST =====
      case "list": {
        const sessions: Array<{
          researchSessionID: string;
          bridgeStarted: string;
          notebookPath: string;
          reportTitle: string;
          isLocked: boolean;
        }> = [];

        const runtimeDir = getRuntimeDir();

        let entries: Array<{ name: string; isDirectory: () => boolean }>;
        try {
          entries = await fs.readdir(runtimeDir, { withFileTypes: true });
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

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const bridgeMetaPath = path.join(runtimeDir, entry.name, BRIDGE_META_FILE);
          const lockPath = path.join(runtimeDir, entry.name, SESSION_LOCK_FILE);

          try {
            const bridgeMeta = await readFile<BridgeMeta>(bridgeMetaPath, true);
            const isLocked = existsSync(lockPath);

            sessions.push({
              researchSessionID: bridgeMeta.sessionId,
              bridgeStarted: bridgeMeta.bridgeStarted,
              notebookPath: bridgeMeta.notebookPath,
              reportTitle: bridgeMeta.reportTitle || "",
              isLocked,
            });
          } catch (error) {
            // Log error but continue listing other sessions
            console.error(`[session-manager] Failed to read session ${entry.name}:`, error);
          }
        }

        sessions.sort(
          (a, b) =>
            new Date(b.bridgeStarted).getTime() - new Date(a.bridgeStarted).getTime()
        );

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

      // ===== UPDATE =====
      case "update": {
        if (!args.researchSessionID) {
          throw new Error("researchSessionID is required for update action");
        }
        validateSessionId(args.researchSessionID);

        const bridgeMetaPath = getBridgeMetaPath(args.researchSessionID);

        if (!(await fileExists(bridgeMetaPath))) {
          throw new Error(
            `Session '${args.researchSessionID}' not found. Use 'create' first.`
          );
        }

        const existing = await readFile<BridgeMeta>(bridgeMetaPath, true);
        const updateData = args.data as Partial<BridgeMeta> | undefined;

        const updated: BridgeMeta = {
          ...existing,
          ...(updateData?.notebookPath !== undefined && {
            notebookPath: updateData.notebookPath,
          }),
          ...(updateData?.reportTitle !== undefined && {
            reportTitle: updateData.reportTitle,
          }),
          sessionId: existing.sessionId,
          bridgeStarted: existing.bridgeStarted,
        };

        if (updateData?.pythonEnv) {
          updated.pythonEnv = {
            ...existing.pythonEnv,
            ...updateData.pythonEnv,
          };
        }

        await durableAtomicWrite(bridgeMetaPath, JSON.stringify(updated, null, 2));

        return JSON.stringify(
          {
            success: true,
            action: "update",
            researchSessionID: args.researchSessionID,
            bridgeMeta: updated,
          },
          null,
          2
        );
      }

      // ===== DELETE =====
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
            message: `Session '${args.researchSessionID}' and all runtime data deleted`,
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
