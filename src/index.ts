import type { Plugin } from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { homedir } from "os";
import { fileURLToPath } from "url";

import manifest from "./gyoshu-manifest.json";
import { GyoshuPlugin as GyoshuHooks } from "./plugin/gyoshu-hooks";

const OPENCODE_CONFIG = path.join(homedir(), ".config", "opencode");
const GYOSHU_STATE_DIR = path.join(OPENCODE_CONFIG, ".gyoshu");
const INSTALL_STATE_FILE = path.join(GYOSHU_STATE_DIR, "install.json");
const INSTALL_LOCK_FILE = path.join(GYOSHU_STATE_DIR, "install.lock");

const ALLOWED_CATEGORIES = new Set([
  "agent",
  "command",
  "tool",
  "skill",
  "lib",
  "bridge",
  "plugin",
]);

const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9._/-]+$/;
const SAFE_DIRNAME_REGEX = /^[a-zA-Z0-9._-]+$/;
const LOCK_STALE_MS = 5 * 60 * 1000;
const LOCK_MAX_RETRIES = 3;

interface InstallState {
  version: string;
  installedAt: string;
  files: string[];
}

interface InstallResult {
  installed: number;
  skipped: number;
  updated: number;
  errors: string[];
  installedFiles: string[];
  fatal: boolean;
}

interface LockInfo {
  pid: number;
  timestamp: number;
  lockId: string;
}

function getPackageRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.dirname(path.dirname(currentFile));
}

function isValidPath(category: string, file: string): boolean {
  if (!ALLOWED_CATEGORIES.has(category)) return false;
  if (file.includes("..") || path.isAbsolute(file)) return false;
  if (file.includes("\0")) return false;
  if (!SAFE_FILENAME_REGEX.test(file)) return false;
  const normalized = path.normalize(file);
  if (normalized.startsWith("..")) return false;
  return true;
}

function isValidSkillName(name: string): boolean {
  if (name.includes("..") || name.includes("/") || name.includes("\\")) return false;
  if (name.includes("\0")) return false;
  if (!SAFE_DIRNAME_REGEX.test(name)) return false;
  return true;
}

function isSymlink(targetPath: string): boolean {
  try {
    const stat = fs.lstatSync(targetPath);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function parseLockFile(): LockInfo | null {
  try {
    if (isSymlink(INSTALL_LOCK_FILE)) {
      return null;
    }
    const content = fs.readFileSync(INSTALL_LOCK_FILE, "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length < 3) return null;
    const pid = parseInt(lines[0], 10);
    const timestamp = parseInt(lines[1], 10);
    const lockId = lines[2];
    if (isNaN(pid) || isNaN(timestamp) || !lockId) return null;
    return { pid, timestamp, lockId };
  } catch {
    return null;
  }
}

function validateNoSymlinksInPath(targetPath: string): { valid: boolean; error?: string } {
  const parts = targetPath.split(path.sep);
  let current = parts[0] === "" ? path.sep : parts[0];

  for (let i = 1; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        return { valid: false, error: `Symlink detected at ${current}` };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        return { valid: false, error: `Cannot stat ${current}: ${(err as Error).message}` };
      }
      break;
    }
  }
  return { valid: true };
}

function ensureConfigDir(errors: string[]): string | null {
  try {
    fs.mkdirSync(OPENCODE_CONFIG, { recursive: true });
    const validation = validateNoSymlinksInPath(OPENCODE_CONFIG);
    if (!validation.valid) {
      errors.push(validation.error || "Symlink in config path");
      return null;
    }
    return fs.realpathSync(OPENCODE_CONFIG);
  } catch (err) {
    errors.push(`Failed to create config dir: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function ensureStateDir(configRealPath: string, errors: string[]): boolean {
  try {
    fs.mkdirSync(GYOSHU_STATE_DIR, { recursive: true });
    if (isSymlink(GYOSHU_STATE_DIR)) {
      errors.push("State directory is a symlink - refusing to use");
      return false;
    }
    const stateRealPath = fs.realpathSync(GYOSHU_STATE_DIR);
    if (!stateRealPath.startsWith(configRealPath + path.sep) && stateRealPath !== configRealPath) {
      errors.push("State directory escapes config directory");
      return false;
    }
    return true;
  } catch (err) {
    errors.push(`Failed to create state dir: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function isPathConfined(targetPath: string, configRealPath: string, errors: string[]): boolean {
  try {
    const validation = validateNoSymlinksInPath(path.dirname(targetPath));
    if (!validation.valid) {
      errors.push(validation.error || "Symlink in target path");
      return false;
    }
    const parentDir = path.dirname(targetPath);
    fs.mkdirSync(parentDir, { recursive: true });
    const parentReal = fs.realpathSync(parentDir);
    return parentReal.startsWith(configRealPath + path.sep) || parentReal === configRealPath;
  } catch (err) {
    errors.push(`Path confinement check failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function reVerifyConfinement(targetPath: string, configRealPath: string): boolean {
  try {
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) return false;
    const parentReal = fs.realpathSync(parentDir);
    return parentReal.startsWith(configRealPath + path.sep) || parentReal === configRealPath;
  } catch {
    return false;
  }
}

function fsyncDir(dirPath: string): void {
  try {
    const fd = fs.openSync(dirPath, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Best effort - some platforms don't support fsync on directories
  }
}

function acquireLock(configRealPath: string, errors: string[]): { fd: number; lockId: string } | null {
  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    if (isSymlink(GYOSHU_STATE_DIR)) {
      errors.push("State directory is a symlink - refusing to acquire lock");
      return null;
    }

    try {
      const stateRealPath = fs.realpathSync(GYOSHU_STATE_DIR);
      if (!stateRealPath.startsWith(configRealPath + path.sep) && stateRealPath !== configRealPath) {
        errors.push("State directory escapes config - refusing to acquire lock");
        return null;
      }
    } catch {
      errors.push("Cannot verify state directory confinement for lock");
      return null;
    }

    try {
      if (isSymlink(INSTALL_LOCK_FILE)) {
        errors.push("Lock file is a symlink - refusing to use");
        return null;
      }

      const lockId = crypto.randomUUID();
      const fd = fs.openSync(INSTALL_LOCK_FILE, "wx", 0o644);
      const content = `${process.pid}\n${Date.now()}\n${lockId}`;
      fs.writeSync(fd, content);
      fs.fsyncSync(fd);

      const verifyInfo = parseLockFile();
      if (!verifyInfo || verifyInfo.lockId !== lockId) {
        try { fs.closeSync(fd); } catch {}
        try { fs.unlinkSync(INSTALL_LOCK_FILE); } catch {}
        errors.push("Lock file verification failed - lock was overwritten");
        return null;
      }

      return { fd, lockId };
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "EEXIST") {
        const lockInfo = parseLockFile();
        if (!lockInfo) {
          errors.push("Lock file exists but cannot be parsed - waiting for next attempt");
          continue;
        }

        const age = Date.now() - lockInfo.timestamp;
        const ownerDead = !isProcessAlive(lockInfo.pid);

        if (age > LOCK_STALE_MS && ownerDead) {
          try {
            if (isSymlink(INSTALL_LOCK_FILE)) {
              errors.push("Stale lock file is a symlink - refusing to remove");
              return null;
            }
            fs.unlinkSync(INSTALL_LOCK_FILE);
            continue;
          } catch {
            errors.push("Failed to remove stale lock file");
          }
        } else if (ownerDead) {
          errors.push(`Lock owner (PID ${lockInfo.pid}) is dead but lock is recent - waiting`);
        } else {
          errors.push("Another installation in progress (lock file exists, owner alive)");
        }
      } else {
        errors.push(`Failed to acquire lock: ${error.message}`);
      }
    }
  }

  return null;
}

function releaseLock(lock: { fd: number; lockId: string } | null, errors: string[]): void {
  if (lock === null) return;
  try {
    fs.closeSync(lock.fd);
    if (isSymlink(INSTALL_LOCK_FILE)) {
      errors.push("Lock file became a symlink - not unlinking");
      return;
    }
    const currentInfo = parseLockFile();
    if (currentInfo && currentInfo.lockId === lock.lockId) {
      fs.unlinkSync(INSTALL_LOCK_FILE);
    } else {
      errors.push("Lock file was replaced by another process - not unlinking");
    }
  } catch (err) {
    errors.push(`Failed to release lock: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function recoverInterruptedSwaps(configRealPath: string, errors: string[]): void {
  const skillDir = path.join(OPENCODE_CONFIG, "skill");
  if (!fs.existsSync(skillDir)) return;

  if (isSymlink(skillDir)) {
    errors.push("Skill directory is a symlink - skipping recovery");
    return;
  }

  try {
    const skillRealPath = fs.realpathSync(skillDir);
    if (!skillRealPath.startsWith(configRealPath + path.sep) && skillRealPath !== configRealPath) {
      errors.push("Skill directory escapes config - skipping recovery");
      return;
    }
  } catch (err) {
    errors.push(`Cannot verify skill directory confinement: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  try {
    const entries = fs.readdirSync(skillDir);
    for (const entry of entries) {
      const fullPath = path.join(skillDir, entry);

      if (isSymlink(fullPath)) {
        errors.push(`Skipping symlink during recovery: ${entry}`);
        continue;
      }

      if (entry.includes(".tmp.")) {
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          errors.push(`Recovered: removed orphaned temp dir ${entry}`);
        } catch (err) {
          errors.push(`Warning: could not clean ${entry}: ${err instanceof Error ? err.message : String(err)}`);
        }
        continue;
      }

      if (entry.includes(".backup.")) {
        const mainName = entry.split(".backup.")[0];
        const mainPath = path.join(skillDir, mainName);
        try {
          if (!fs.existsSync(mainPath)) {
            fs.renameSync(fullPath, mainPath);
            errors.push(`Recovered: restored ${mainName} from backup`);
          } else {
            fs.rmSync(fullPath, { recursive: true, force: true });
            errors.push(`Recovered: removed orphaned backup ${entry}`);
          }
        } catch (err) {
          errors.push(`Warning: recovery of ${entry} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } catch (err) {
    errors.push(`Warning: swap recovery scan failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function loadInstallState(): { state: InstallState | null; error?: string } {
  try {
    if (fs.existsSync(INSTALL_STATE_FILE)) {
      if (isSymlink(INSTALL_STATE_FILE)) {
        return { state: null, error: "Install state file is a symlink - refusing to read" };
      }
      const content = fs.readFileSync(INSTALL_STATE_FILE, "utf-8");
      const parsed = JSON.parse(content);
      if (typeof parsed !== "object" || !parsed.version || !Array.isArray(parsed.files)) {
        return { state: null, error: "Install state file has invalid schema" };
      }
      return { state: parsed };
    }
    return { state: null };
  } catch (err) {
    return {
      state: null,
      error: `Failed to load install state: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function saveInstallState(
  state: InstallState,
  configRealPath: string,
  errors: string[]
): { success: boolean; error?: string } {
  const tempPath = path.join(GYOSHU_STATE_DIR, `.install.json.tmp.${crypto.randomUUID()}`);

  try {
    const stateRealPath = fs.realpathSync(GYOSHU_STATE_DIR);
    if (!stateRealPath.startsWith(configRealPath + path.sep) && stateRealPath !== configRealPath) {
      return { success: false, error: "State directory escapes config - refusing to write" };
    }

    const data = JSON.stringify(state, null, 2);
    const fd = fs.openSync(tempPath, "wx", 0o644);
    try {
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    if (!reVerifyConfinement(INSTALL_STATE_FILE, configRealPath)) {
      fs.unlinkSync(tempPath);
      return { success: false, error: "Confinement check failed before state file rename" };
    }

    if (fs.existsSync(INSTALL_STATE_FILE) && isSymlink(INSTALL_STATE_FILE)) {
      fs.unlinkSync(tempPath);
      return { success: false, error: "Target state file is a symlink - refusing to overwrite" };
    }

    fs.renameSync(tempPath, INSTALL_STATE_FILE);
    fsyncDir(GYOSHU_STATE_DIR);
    return { success: true };
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (cleanupErr) {
      errors.push(`Cleanup failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
    }
    return {
      success: false,
      error: `Failed to save install state: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function isGyoshuOwned(filePath: string, state: InstallState | null): boolean {
  if (!state) return false;
  return state.files.includes(filePath);
}

function atomicCopyFile(srcPath: string, destPath: string, configRealPath: string): void {
  const parentDir = path.dirname(destPath);
  const symlinkCheck = validateNoSymlinksInPath(parentDir);
  if (!symlinkCheck.valid) {
    throw new Error(symlinkCheck.error || "Symlink in path before write");
  }
  if (!reVerifyConfinement(destPath, configRealPath)) {
    throw new Error("Confinement check failed before write");
  }

  const tempPath = `${destPath}.tmp.${crypto.randomUUID()}`;
  const fd = fs.openSync(tempPath, "wx", 0o644);
  try {
    const content = fs.readFileSync(srcPath);
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
    fs.closeSync(fd);

    if (!reVerifyConfinement(destPath, configRealPath)) {
      fs.unlinkSync(tempPath);
      throw new Error("Confinement check failed before file rename");
    }

    if (fs.existsSync(destPath) && isSymlink(destPath)) {
      fs.unlinkSync(tempPath);
      throw new Error("Target file is a symlink - refusing to overwrite");
    }

    fs.renameSync(tempPath, destPath);
    fsyncDir(path.dirname(destPath));
  } catch (err) {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(tempPath); } catch {}
    throw err;
  }
}

function atomicCreateFile(srcPath: string, destPath: string, configRealPath: string): void {
  const parentDir = path.dirname(destPath);
  const symlinkCheck = validateNoSymlinksInPath(parentDir);
  if (!symlinkCheck.valid) {
    throw new Error(symlinkCheck.error || "Symlink in path before write");
  }
  if (!reVerifyConfinement(destPath, configRealPath)) {
    throw new Error("Confinement check failed before write");
  }

  const tempPath = `${destPath}.tmp.${crypto.randomUUID()}`;
  const fd = fs.openSync(tempPath, "wx", 0o644);
  try {
    const content = fs.readFileSync(srcPath);
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
    fs.closeSync(fd);

    if (!reVerifyConfinement(destPath, configRealPath)) {
      fs.unlinkSync(tempPath);
      throw new Error("Confinement check failed before file create");
    }

    if (fs.existsSync(destPath)) {
      fs.unlinkSync(tempPath);
      const err = new Error("File already exists") as NodeJS.ErrnoException;
      err.code = "EEXIST";
      throw err;
    }

    if (isSymlink(destPath)) {
      fs.unlinkSync(tempPath);
      throw new Error("Target is a symlink - refusing to create");
    }

    fs.renameSync(tempPath, destPath);
    fsyncDir(path.dirname(destPath));
  } catch (err) {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(tempPath); } catch {}
    throw err;
  }
}

function installFile(
  packageRoot: string,
  category: string,
  file: string,
  state: InstallState | null,
  configRealPath: string,
  errors: string[]
): { installed: boolean; skipped: boolean; updated: boolean; error?: string } {
  if (!isValidPath(category, file)) {
    return { installed: false, skipped: false, updated: false, error: "Invalid path (failed validation)" };
  }

  const srcPath = path.join(packageRoot, "src", category, file);
  const destPath = path.join(OPENCODE_CONFIG, category, file);

  if (!isPathConfined(destPath, configRealPath, errors)) {
    return { installed: false, skipped: false, updated: false, error: "Path escapes config (symlink or traversal)" };
  }

  const relativePath = `${category}/${file}`;
  const fileExists = fs.existsSync(destPath);

  if (fileExists) {
    if (isGyoshuOwned(relativePath, state)) {
      try {
        atomicCopyFile(srcPath, destPath, configRealPath);
        return { installed: false, skipped: false, updated: true };
      } catch (err) {
        return {
          installed: false,
          skipped: false,
          updated: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    return { installed: false, skipped: true, updated: false };
  }

  try {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    atomicCreateFile(srcPath, destPath, configRealPath);
    return { installed: true, skipped: false, updated: false };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "EEXIST") {
      return { installed: false, skipped: true, updated: false };
    }
    return { installed: false, skipped: false, updated: false, error: error.message };
  }
}

function installSkill(
  packageRoot: string,
  skillName: string,
  state: InstallState | null,
  configRealPath: string,
  errors: string[]
): { installed: boolean; skipped: boolean; updated: boolean; error?: string } {
  if (!isValidSkillName(skillName)) {
    return { installed: false, skipped: false, updated: false, error: "Invalid skill name (failed validation)" };
  }

  const srcDir = path.join(packageRoot, "src", "skill", skillName);
  const destDir = path.join(OPENCODE_CONFIG, "skill", skillName);

  if (!isPathConfined(destDir, configRealPath, errors)) {
    return { installed: false, skipped: false, updated: false, error: "Path escapes config (symlink or traversal)" };
  }

  const relativePath = `skill/${skillName}`;
  const dirExists = fs.existsSync(destDir);

  if (dirExists) {
    if (isGyoshuOwned(relativePath, state)) {
      const parentDir = path.dirname(destDir);
      const symlinkCheck = validateNoSymlinksInPath(parentDir);
      if (!symlinkCheck.valid) {
        return { installed: false, skipped: false, updated: false, error: symlinkCheck.error || "Symlink in path before write" };
      }
      if (!reVerifyConfinement(destDir, configRealPath)) {
        return { installed: false, skipped: false, updated: false, error: "Confinement check failed before write" };
      }

      const tempDir = `${destDir}.tmp.${crypto.randomUUID()}`;
      const backupDir = `${destDir}.backup.${crypto.randomUUID()}`;

      try {
        fs.cpSync(srcDir, tempDir, { recursive: true, dereference: false, force: false, errorOnExist: true });

        if (!reVerifyConfinement(destDir, configRealPath)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          return { installed: false, skipped: false, updated: false, error: "Confinement check failed before swap" };
        }

        if (isSymlink(destDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          return { installed: false, skipped: false, updated: false, error: "Target directory is a symlink" };
        }

        fs.renameSync(destDir, backupDir);

        if (!reVerifyConfinement(destDir, configRealPath)) {
          fs.renameSync(backupDir, destDir);
          fs.rmSync(tempDir, { recursive: true, force: true });
          return { installed: false, skipped: false, updated: false, error: "Confinement changed after backup" };
        }

        fs.renameSync(tempDir, destDir);
        fs.rmSync(backupDir, { recursive: true, force: true });
        fsyncDir(path.dirname(destDir));

        return { installed: false, skipped: false, updated: true };
      } catch (err) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (cleanupErr) {
          errors.push(`Temp cleanup failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
        }
        try {
          if (fs.existsSync(backupDir) && !fs.existsSync(destDir)) {
            fs.renameSync(backupDir, destDir);
            errors.push(`Restored ${skillName} from backup after failed update`);
          }
        } catch (restoreErr) {
          errors.push(`Backup restore failed: ${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}`);
        }
        return { installed: false, skipped: false, updated: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return { installed: false, skipped: true, updated: false };
  }

  const parentDir = path.dirname(destDir);
  const symlinkCheck = validateNoSymlinksInPath(parentDir);
  if (!symlinkCheck.valid) {
    return { installed: false, skipped: false, updated: false, error: symlinkCheck.error || "Symlink in path before write" };
  }
  if (!reVerifyConfinement(destDir, configRealPath)) {
    return { installed: false, skipped: false, updated: false, error: "Confinement check failed before write" };
  }

  try {
    const tempDir = `${destDir}.tmp.${crypto.randomUUID()}`;
    fs.cpSync(srcDir, tempDir, { recursive: true, dereference: false, force: false, errorOnExist: true });

    if (!reVerifyConfinement(destDir, configRealPath)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      return { installed: false, skipped: false, updated: false, error: "Confinement check failed before install" };
    }

    if (fs.existsSync(destDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      return { installed: false, skipped: true, updated: false };
    }

    fs.renameSync(tempDir, destDir);
    fsyncDir(path.dirname(destDir));
    return { installed: true, skipped: false, updated: false };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "EEXIST") {
      return { installed: false, skipped: true, updated: false };
    }
    return { installed: false, skipped: false, updated: false, error: error.message };
  }
}

function autoInstall(): InstallResult {
  const packageRoot = getPackageRoot();
  const result: InstallResult = {
    installed: 0,
    skipped: 0,
    updated: 0,
    errors: [],
    installedFiles: [],
    fatal: false,
  };

  const configRealPath = ensureConfigDir(result.errors);
  if (!configRealPath) {
    result.fatal = true;
    return result;
  }

  if (!ensureStateDir(configRealPath, result.errors)) {
    result.fatal = true;
    return result;
  }

  const lock = acquireLock(configRealPath, result.errors);
  if (lock === null) {
    return result;
  }

  try {
    recoverInterruptedSwaps(configRealPath, result.errors);

    const { state: existingState, error: stateError } = loadInstallState();
    if (stateError) {
      result.errors.push(stateError);
    }

    for (const [category, files] of Object.entries(manifest.files)) {
      if (category === "skill") {
        for (const skillName of files as string[]) {
          const { installed, skipped, updated, error } = installSkill(
            packageRoot,
            skillName,
            existingState,
            configRealPath,
            result.errors
          );
          const relativePath = `skill/${skillName}`;
          if (installed || updated) result.installedFiles.push(relativePath);
          if (installed) result.installed++;
          if (skipped) result.skipped++;
          if (updated) result.updated++;
          if (error) result.errors.push(`${relativePath}: ${error}`);
        }
      } else {
        for (const file of files as string[]) {
          const { installed, skipped, updated, error } = installFile(
            packageRoot,
            category,
            file,
            existingState,
            configRealPath,
            result.errors
          );
          const relativePath = `${category}/${file}`;
          if (installed || updated) result.installedFiles.push(relativePath);
          if (installed) result.installed++;
          if (skipped) result.skipped++;
          if (updated) result.updated++;
          if (error) result.errors.push(`${relativePath}: ${error}`);
        }
      }
    }

    if (result.installed > 0 || result.updated > 0) {
      const allFiles = existingState?.files || [];
      const newFiles = new Set([...allFiles, ...result.installedFiles]);
      const { success, error: saveError } = saveInstallState(
        {
          version: manifest.version,
          installedAt: new Date().toISOString(),
          files: Array.from(newFiles),
        },
        configRealPath,
        result.errors
      );
      if (!success && saveError) {
        result.errors.push(saveError);
      }
    }
  } finally {
    releaseLock(lock, result.errors);
  }

  return result;
}

export const GyoshuPlugin: Plugin = async (ctx) => {
  const installResult = autoInstall();

  if (installResult.fatal) {
    console.error(`❌ Gyoshu: Fatal installation error`);
    for (const error of installResult.errors) {
      console.error(`   - ${error}`);
    }
    return GyoshuHooks(ctx);
  }

  if (installResult.installed > 0) {
    console.log(`🎓 Gyoshu: Installed ${installResult.installed} files to ~/.config/opencode/`);
  }

  if (installResult.updated > 0) {
    console.log(`🎓 Gyoshu: Updated ${installResult.updated} files`);
  }

  if (installResult.errors.length > 0) {
    console.warn(`⚠️  Gyoshu: Some issues occurred:`);
    for (const error of installResult.errors) {
      console.warn(`   - ${error}`);
    }
  }

  return GyoshuHooks(ctx);
};

export default GyoshuPlugin;
