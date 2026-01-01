import type { Plugin } from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";

import { getRuntimeDir, getSessionDir } from "../lib/paths";

interface BridgeMeta {
  pid: number;
  socketPath: string;
  startedAt: string;
  sessionId: string;
}

interface REPLSession {
  sessionId: string;
  pid: number;
  lastActivity: number;
  status: "active" | "idle" | "terminated";
}

const activeSessions = new Map<string, REPLSession>();
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

function getBridgeMetaPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), "bridge_meta.json");
}

function readBridgeMeta(sessionId: string): BridgeMeta | null {
  try {
    const metaPath = getBridgeMetaPath(sessionId);
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, "utf-8")) as BridgeMeta;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killBridge(sessionId: string): void {
  const meta = readBridgeMeta(sessionId);
  if (!meta) return;
  
  if (isProcessAlive(meta.pid)) {
    console.log(`[Gyoshu] Killing bridge for session ${sessionId}: PID=${meta.pid}`);
    try {
      process.kill(meta.pid, "SIGTERM");
    } catch {}
  }
  
  try {
    const metaPath = getBridgeMetaPath(sessionId);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
    if (fs.existsSync(meta.socketPath)) fs.unlinkSync(meta.socketPath);
  } catch {}
}

function cleanupAllBridges(): void {
  const runtimeDir = getRuntimeDir();
  if (!fs.existsSync(runtimeDir)) return;
  
  try {
    const sessions = fs.readdirSync(runtimeDir);
    for (const sessionId of sessions) {
      killBridge(sessionId);
    }
  } catch (e) {
    console.error("[Gyoshu] Error cleaning up bridges:", e);
  }
}

function killIdleBridges(): void {
  const now = Date.now();
  
  for (const [sessionId, session] of activeSessions) {
    if (now - session.lastActivity > IDLE_TIMEOUT_MS) {
      const meta = readBridgeMeta(sessionId);
      if (meta && isProcessAlive(meta.pid)) {
        console.log(`[Gyoshu] Session ${sessionId} idle for 30+ minutes, killing bridge`);
        killBridge(sessionId);
        session.status = "terminated";
      }
    }
  }
}

let idleCheckInterval: NodeJS.Timeout | null = null;

export const GyoshuPlugin: Plugin = async ({ project, client, $, directory }) => {
  console.log("[Gyoshu] Plugin initialized");
  
  idleCheckInterval = setInterval(killIdleBridges, IDLE_CHECK_INTERVAL_MS);
  
  return {
    "tool.execute.after": async (input, output) => {
      if (input.tool === "python-repl") {
        const sessionId = input.args?.researchSessionID;
        if (sessionId) {
          const meta = readBridgeMeta(sessionId);
          const existing = activeSessions.get(sessionId);
          
          if (existing) {
            existing.lastActivity = Date.now();
            existing.status = "active";
            if (meta) existing.pid = meta.pid;
          } else {
            activeSessions.set(sessionId, {
              sessionId,
              pid: meta?.pid || 0,
              lastActivity: Date.now(),
              status: "active",
            });
          }
        }
      }
    },
    
    event: async ({ event }) => {
      if (event.type === "session.end") {
        console.log("[Gyoshu] OpenCode session ending, cleaning up bridges...");
        cleanupAllBridges();
      }
    },
    
    cleanup: async () => {
      console.log("[Gyoshu] Plugin cleanup - stopping idle checker and killing bridges");
      
      if (idleCheckInterval) {
        clearInterval(idleCheckInterval);
        idleCheckInterval = null;
      }
      
      cleanupAllBridges();
      activeSessions.clear();
    },
  };
};

export default GyoshuPlugin;
