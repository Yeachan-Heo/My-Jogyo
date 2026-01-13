/**
 * Session Manager MCP Tool
 *
 * MCP-compatible implementation of the session manager for Gyoshu runtime sessions.
 * Provides runtime-only session management with:
 * - Session locking (acquire/release)
 * - Bridge socket paths
 * - Bridge metadata storage (runtime state only)
 *
 * Note: Durable research data is now stored in notebook frontmatter.
 * This tool only manages ephemeral runtime state in OS temp directories.
 *
 * @module mcp/tools/session-manager
 */

import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { durableAtomicWrite, fileExists, readFile } from "../../lib/atomic-write.js";
import {
  getRuntimeDir,
  getSessionDir,
  ensureDirSync,
  existsSync,
  shortenSessionId,
  validatePathSegment,
} from "../../lib/paths.js";
import { getBridgeMetaLockPath, DEFAULT_LOCK_TIMEOUT_MS } from "../../lib/lock-paths.js";
import { withLock } from "../../lib/session-lock.js";
import {
  BridgeMeta,
  PythonEnvInfo,
  VerificationRound,
  VerificationState,
  isValidBridgeMeta,
} from "../../lib/bridge-meta.js";
import { isPathContainedIn } from "../../lib/path-security.js";

// ===== CONSTANTS =====

/**
 * Name of the bridge metadata file (runtime state only)
 */
const BRIDGE_META_FILE = "bridge_meta.json";

/**
 * Name of the session lock file
 */
const SESSION_LOCK_FILE = "session.lock";

/**
 * Regex pattern for valid session directory names.
 * Session directories are 12-char hex hashes from shortenSessionId().
 * Used to filter out non-session directories like "locks/".
 */
const SESSION_DIR_PATTERN = /^[0-9a-f]{12}$/;

/** Maximum number of verification history entries to keep */
const MAX_VERIFICATION_HISTORY = 10;

/** Valid outcomes for verification rounds */
const VALID_OUTCOMES = ["passed", "failed", "rework_requested"] as const;

// ===== MCP TOOL DEFINITION =====

export const sessionManagerTool = {
  name: "session_manager",
  description:
    "Manage Gyoshu runtime sessions - create, read, update, delete session state. " +
    "Sessions track bridge metadata, notebook paths, and runtime state. " +
    "Research data is now stored in notebook frontmatter (not session manifests).",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "get", "list", "update", "delete"],
        description: "Operation to perform on runtime sessions",
      },
      researchSessionID: {
        type: "string",
        description: "Unique session identifier (required for create/get/update/delete)",
      },
      data: {
        type: "object",
        description:
          "Bridge metadata for create/update operations. Can include: " +
          "pythonEnv (type, pythonPath), notebookPath, reportTitle, " +
          "verification (currentRound, maxRounds, history)",
        properties: {
          pythonEnv: {
            type: "object",
            properties: {
              type: { type: "string" },
              pythonPath: { type: "string" },
            },
          },
          notebookPath: { type: "string" },
          reportTitle: { type: "string" },
          verification: {
            type: "object",
            properties: {
              currentRound: { type: "number" },
              maxRounds: { type: "number" },
              history: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    round: { type: "number" },
                    timestamp: { type: "string" },
                    trustScore: { type: "number" },
                    outcome: {
                      type: "string",
                      enum: ["passed", "failed", "rework_requested"],
                    },
                  },
                  required: ["round", "timestamp", "trustScore", "outcome"],
                },
              },
            },
            required: ["currentRound", "maxRounds", "history"],
          },
        },
      },
    },
    required: ["action"],
  },
};

// ===== TYPES =====

interface SessionManagerArgs {
  action: "create" | "get" | "list" | "update" | "delete";
  researchSessionID?: string;
  data?: Partial<BridgeMeta>;
}

// ===== RUNTIME INITIALIZATION =====

/**
 * Synchronous runtime initialization
 */
function ensureGyoshuRuntimeSync(): void {
  const runtimeDir = getRuntimeDir();
  ensureDirSync(runtimeDir, 0o700);
}

// ===== PATH HELPERS =====

/**
 * Gets the path to a session's bridge metadata file.
 */
function getBridgeMetaPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), BRIDGE_META_FILE);
}

/**
 * Gets the path to a session's lock file.
 */
function getSessionLockFilePath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), SESSION_LOCK_FILE);
}

// ===== VALIDATION =====

/**
 * Validates a VerificationRound object.
 */
function validateVerificationRound(
  round: unknown,
  index: number
): string | null {
  if (!round || typeof round !== "object") {
    return `history[${index}] is not an object`;
  }

  const r = round as Record<string, unknown>;

  if (typeof r.round !== "number" || !Number.isInteger(r.round) || r.round < 1) {
    return `history[${index}].round must be a positive integer`;
  }

  if (typeof r.timestamp !== "string" || r.timestamp.trim() === "") {
    return `history[${index}].timestamp must be a non-empty string`;
  }

  if (
    typeof r.trustScore !== "number" ||
    r.trustScore < 0 ||
    r.trustScore > 100
  ) {
    return `history[${index}].trustScore must be a number between 0 and 100`;
  }

  if (!VALID_OUTCOMES.includes(r.outcome as typeof VALID_OUTCOMES[number])) {
    return `history[${index}].outcome must be one of: ${VALID_OUTCOMES.join(", ")}`;
  }

  return null;
}

/**
 * Validates a VerificationState object.
 */
function validateVerificationState(state: unknown): string | null {
  if (!state || typeof state !== "object") {
    return "verification must be an object";
  }

  const s = state as Record<string, unknown>;

  if (
    typeof s.currentRound !== "number" ||
    !Number.isInteger(s.currentRound) ||
    s.currentRound < 0
  ) {
    return "currentRound must be a non-negative integer";
  }

  if (
    typeof s.maxRounds !== "number" ||
    !Number.isInteger(s.maxRounds) ||
    s.maxRounds < 1
  ) {
    return "maxRounds must be a positive integer >= 1";
  }

  if (s.currentRound > s.maxRounds) {
    return `currentRound (${s.currentRound}) cannot exceed maxRounds (${s.maxRounds})`;
  }

  if (!Array.isArray(s.history)) {
    return "history must be an array";
  }

  for (let i = 0; i < s.history.length; i++) {
    const error = validateVerificationRound(s.history[i], i);
    if (error) {
      return error;
    }
  }

  return null;
}

function validateSessionId(sessionId: string): void {
  validatePathSegment(sessionId, "researchSessionID");
}

// ===== DEFAULT BRIDGE META =====

function createDefaultBridgeMeta(
  sessionId: string,
  data?: Partial<BridgeMeta>
): BridgeMeta {
  const now = new Date().toISOString();
  const sessionDir = getSessionDir(sessionId);
  const socketPath = path.join(sessionDir, "bridge.sock");

  return {
    pid: 1,
    socketPath,
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

// ===== MCP HANDLER =====

export async function handleSessionManager(args: unknown): Promise<unknown> {
  ensureGyoshuRuntimeSync();

  const typedArgs = args as SessionManagerArgs;
  const { action, researchSessionID, data } = typedArgs;

  switch (action) {
    // ===== CREATE =====
    case "create": {
      if (!researchSessionID) {
        throw new Error("researchSessionID is required for create action");
      }
      validateSessionId(researchSessionID);

      const sessionDir = getSessionDir(researchSessionID);
      const bridgeMetaPath = getBridgeMetaPath(researchSessionID);

      if (await fileExists(bridgeMetaPath)) {
        throw new Error(
          `Session '${researchSessionID}' already exists. Use 'update' to modify existing sessions.`
        );
      }

      ensureDirSync(sessionDir, 0o700);

      const bridgeMeta = createDefaultBridgeMeta(
        researchSessionID,
        data as Partial<BridgeMeta>
      );

      await withLock(
        getBridgeMetaLockPath(researchSessionID),
        async () => {
          await durableAtomicWrite(bridgeMetaPath, JSON.stringify(bridgeMeta, null, 2));
        },
        DEFAULT_LOCK_TIMEOUT_MS
      );

      return JSON.stringify(
        {
          success: true,
          action: "create",
          researchSessionID,
          bridgeMeta,
          sessionDir,
        },
        null,
        2
      );
    }

    // ===== GET =====
    case "get": {
      if (!researchSessionID) {
        throw new Error("researchSessionID is required for get action");
      }
      validateSessionId(researchSessionID);

      const bridgeMetaPath = getBridgeMetaPath(researchSessionID);
      const sessionDir = getSessionDir(researchSessionID);
      const lockPath = getSessionLockFilePath(researchSessionID);

      if (!(await fileExists(bridgeMetaPath))) {
        throw new Error(`Session '${researchSessionID}' not found`);
      }

      const rawMeta = await readFile<unknown>(bridgeMetaPath, true);
      if (!isValidBridgeMeta(rawMeta)) {
        throw new Error(`Session '${researchSessionID}' has invalid or corrupted metadata`);
      }
      const bridgeMeta = rawMeta as BridgeMeta;
      const isLocked = await fileExists(lockPath);

      return JSON.stringify(
        {
          success: true,
          action: "get",
          researchSessionID,
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

      // Filter to valid session directories only (12-char hex hashes)
      const validEntries = entries.filter(
        (entry) => entry.isDirectory() && SESSION_DIR_PATTERN.test(entry.name)
      );

      for (const entry of validEntries) {
        const bridgeMetaPath = path.join(runtimeDir, entry.name, BRIDGE_META_FILE);
        const lockPath = path.join(runtimeDir, entry.name, SESSION_LOCK_FILE);

        try {
          const rawMeta = await readFile<unknown>(bridgeMetaPath, true);

          if (!isValidBridgeMeta(rawMeta)) {
            process.env.GYOSHU_DEBUG &&
              console.error(`[session-manager] Invalid metadata for ${entry.name}, skipping`);
            continue;
          }
          const bridgeMeta = rawMeta as BridgeMeta;

          // Verify anti-poisoning binding: shortId must match hashed sessionId
          if (shortenSessionId(bridgeMeta.sessionId) !== entry.name) {
            process.env.GYOSHU_DEBUG &&
              console.error(`[session-manager] Binding mismatch for ${entry.name}, skipping`);
            continue;
          }

          const isLocked = existsSync(lockPath);

          sessions.push({
            researchSessionID: bridgeMeta.sessionId,
            bridgeStarted: bridgeMeta.bridgeStarted ?? bridgeMeta.startedAt ?? "",
            notebookPath: bridgeMeta.notebookPath ?? "",
            reportTitle: bridgeMeta.reportTitle ?? "",
            isLocked,
          });
        } catch (error) {
          process.env.GYOSHU_DEBUG &&
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
      if (!researchSessionID) {
        throw new Error("researchSessionID is required for update action");
      }
      validateSessionId(researchSessionID);

      const bridgeMetaPath = getBridgeMetaPath(researchSessionID);

      if (!(await fileExists(bridgeMetaPath))) {
        throw new Error(
          `Session '${researchSessionID}' not found. Use 'create' first.`
        );
      }

      const updateData = data as Partial<BridgeMeta> | undefined;

      let sanitizedVerification: VerificationState | undefined = undefined;
      if (updateData?.verification !== undefined) {
        const validationError = validateVerificationState(updateData.verification);
        if (validationError) {
          throw new Error(`Invalid verification state: ${validationError}`);
        }
        const verif = updateData.verification as VerificationState;
        sanitizedVerification = {
          ...verif,
          history: verif.history.slice(-MAX_VERIFICATION_HISTORY),
        };
      }

      const updated = await withLock(
        getBridgeMetaLockPath(researchSessionID),
        async () => {
          const existing = await readFile<BridgeMeta>(bridgeMetaPath, true);

          const result: BridgeMeta = {
            ...existing,
            ...(updateData?.notebookPath !== undefined && {
              notebookPath: updateData.notebookPath,
            }),
            ...(updateData?.reportTitle !== undefined && {
              reportTitle: updateData.reportTitle,
            }),
            ...(sanitizedVerification !== undefined && {
              verification: sanitizedVerification,
            }),
            sessionId: existing.sessionId,
            bridgeStarted: existing.bridgeStarted,
          };

          if (updateData?.pythonEnv) {
            result.pythonEnv = {
              ...existing.pythonEnv,
              ...updateData.pythonEnv,
            };
          }

          await durableAtomicWrite(bridgeMetaPath, JSON.stringify(result, null, 2));
          return result;
        },
        DEFAULT_LOCK_TIMEOUT_MS
      );

      return JSON.stringify(
        {
          success: true,
          action: "update",
          researchSessionID,
          bridgeMeta: updated,
        },
        null,
        2
      );
    }

    // ===== DELETE =====
    case "delete": {
      if (!researchSessionID) {
        throw new Error("researchSessionID is required for delete action");
      }
      validateSessionId(researchSessionID);

      const sessionDir = getSessionDir(researchSessionID);

      if (!(await fileExists(sessionDir))) {
        throw new Error(`Session '${researchSessionID}' not found`);
      }

      // Security: Verify path is contained within runtime directory before deletion
      if (!isPathContainedIn(sessionDir, getRuntimeDir(), { useRealpath: true })) {
        throw new Error(`Security: ${sessionDir} escapes containment`);
      }

      await fs.rm(sessionDir, { recursive: true, force: true });

      return JSON.stringify(
        {
          success: true,
          action: "delete",
          researchSessionID,
          message: `Session '${researchSessionID}' and all runtime data deleted`,
        },
        null,
        2
      );
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
