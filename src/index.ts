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

// Strict filename regex: alphanumeric, dots, dashes, underscores only
// Also allows forward slashes for nested paths (e.g., "skill/gyoshu/file.md")
const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9._/-]+$/;
const SAFE_DIRNAME_REGEX = /^[a-zA-Z0-9._-]+$/;

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

function getPackageRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.dirname(path.dirname(currentFile));
}

/**
 * Strict path validation with allowlist regex
 */
function isValidPath(category: string, file: string): boolean {
  if (!ALLOWED_CATEGORIES.has(category)) return false;
  if (file.includes("..") || path.isAbsolute(file)) return false;
  if (file.includes("\0")) return false;
  
  // Strict regex validation for filenames
  if (!SAFE_FILENAME_REGEX.test(file)) return false;
  
  const normalized = path.normalize(file);
  if (normalized.startsWith("..")) return false;
  
  return true;
}

/**
 * Strict skill name validation
 */
function isValidSkillName(name: string): boolean {
  if (name.includes("..") || name.includes("/") || name.includes("\\")) return false;
  if (name.includes("\0")) return false;
  if (!SAFE_DIRNAME_REGEX.test(name)) return false;
  return true;
}

/**
 * Check if a path component is a symlink using lstat
 */
function isSymlink(targetPath: string): boolean {
  try {
    const stat = fs.lstatSync(targetPath);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Validate that a path does not traverse through any symlinks
 */
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
      // Path doesn't exist yet - OK for directories we'll create
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        return { valid: false, error: `Cannot stat ${current}: ${(err as Error).message}` };
      }
      break; // Stop checking - rest doesn't exist
    }
  }
  return { valid: true };
}

/**
 * Create directory safely, ensuring no symlinks in path and config confinement
 */
function ensureConfigDir(errors: string[]): string | null {
  try {
    // Create config directory
    fs.mkdirSync(OPENCODE_CONFIG, { recursive: true });
    
    // Validate no symlinks in the path
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

/**
 * Create state directory safely with symlink validation
 */
function ensureStateDir(configRealPath: string, errors: string[]): boolean {
  try {
    fs.mkdirSync(GYOSHU_STATE_DIR, { recursive: true });
    
    // Validate state dir is not a symlink and is confined
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

/**
 * Verify path confinement with real path resolution
 */
function isPathConfined(targetPath: string, configRealPath: string, errors: string[]): boolean {
  try {
    // Validate no symlinks in the path before we create directories
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

/**
 * Re-verify confinement immediately before rename (TOCTOU mitigation)
 */
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

/**
 * fsync a directory for durability
 */
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

/**
 * Acquire installation lock (inter-process safety)
 * Returns lock fd on success, null on failure
 */
function acquireLock(errors: string[]): number | null {
  try {
    fs.mkdirSync(GYOSHU_STATE_DIR, { recursive: true });
    // O_CREAT | O_EXCL | O_WRONLY - fails if file exists
    const fd = fs.openSync(INSTALL_LOCK_FILE, "wx", 0o644);
    fs.writeSync(fd, `${process.pid}\n${Date.now()}`);
    fs.fsyncSync(fd);
    return fd;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "EEXIST") {
      // Lock exists - check if stale (older than 5 minutes)
      try {
        const stat = fs.statSync(INSTALL_LOCK_FILE);
        const age = Date.now() - stat.mtimeMs;
        if (age > 5 * 60 * 1000) {
          // Stale lock - remove and retry
          fs.unlinkSync(INSTALL_LOCK_FILE);
          return acquireLock(errors);
        }
        errors.push("Another installation in progress (lock file exists)");
      } catch {
        errors.push("Lock file check failed");
      }
    } else {
      errors.push(`Failed to acquire lock: ${error.message}`);
    }
    return null;
  }
}

/**
 * Release installation lock
 */
function releaseLock(fd: number | null, errors: string[]): void {
  if (fd === null) return;
  try {
    fs.closeSync(fd);
    fs.unlinkSync(INSTALL_LOCK_FILE);
  } catch (err) {
    errors.push(`Failed to release lock: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Recover from interrupted skill directory swaps
 * Cleans up .backup.* and .tmp.* directories
 */
function recoverInterruptedSwaps(configRealPath: string, errors: string[]): void {
  const skillDir = path.join(OPENCODE_CONFIG, "skill");
  
  if (!fs.existsSync(skillDir)) return;
  
  try {
    const entries = fs.readdirSync(skillDir);
    
    for (const entry of entries) {
      const fullPath = path.join(skillDir, entry);
      
      // Clean up orphaned temp directories
      if (entry.includes(".tmp.")) {
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          errors.push(`Recovered: removed orphaned temp dir ${entry}`);
        } catch (err) {
          errors.push(`Warning: could not clean ${entry}: ${err instanceof Error ? err.message : String(err)}`);
        }
        continue;
      }
      
      // Handle backup directories - restore if main is missing
      if (entry.includes(".backup.")) {
        const mainName = entry.split(".backup.")[0];
        const mainPath = path.join(skillDir, mainName);
        
        try {
          if (!fs.existsSync(mainPath)) {
            // Main directory missing - restore from backup
            fs.renameSync(fullPath, mainPath);
            errors.push(`Recovered: restored ${mainName} from backup`);
          } else {
            // Main exists - remove orphaned backup
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
      // Verify state file is not a symlink
      if (isSymlink(INSTALL_STATE_FILE)) {
        return { state: null, error: "Install state file is a symlink - refusing to read" };
      }
      
      const content = fs.readFileSync(INSTALL_STATE_FILE, "utf-8");
      const parsed = JSON.parse(content);
      
      // Basic schema validation
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
    // Verify state dir confinement before write
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
    
    // Re-verify confinement before rename (TOCTOU mitigation)
    if (!reVerifyConfinement(INSTALL_STATE_FILE, configRealPath)) {
      fs.unlinkSync(tempPath);
      return { success: false, error: "Confinement check failed before state file rename" };
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
  const tempPath = `${destPath}.tmp.${crypto.randomUUID()}`;
  const fd = fs.openSync(tempPath, "wx", 0o644);
  try {
    const content = fs.readFileSync(srcPath);
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    
    // Re-verify confinement before rename (TOCTOU mitigation)
    if (!reVerifyConfinement(destPath, configRealPath)) {
      fs.unlinkSync(tempPath);
      throw new Error("Confinement check failed before file rename");
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
    
    // Re-verify confinement before copy (TOCTOU mitigation)
    if (!reVerifyConfinement(destPath, configRealPath)) {
      return { installed: false, skipped: false, updated: false, error: "Confinement check failed before copy" };
    }
    
    fs.copyFileSync(srcPath, destPath, fs.constants.COPYFILE_EXCL);
    fsyncDir(path.dirname(destPath));
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
  // Use strict skill name validation
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
      const tempDir = `${destDir}.tmp.${crypto.randomUUID()}`;
      const backupDir = `${destDir}.backup.${crypto.randomUUID()}`;
      
      try {
        // Stage to temp
        fs.cpSync(srcDir, tempDir, { recursive: true });
        
        // Re-verify confinement before swap (TOCTOU mitigation)
        if (!reVerifyConfinement(destDir, configRealPath)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          return { installed: false, skipped: false, updated: false, error: "Confinement check failed before swap" };
        }
        
        // Atomic swap: dest -> backup, temp -> dest
        fs.renameSync(destDir, backupDir);
        fs.renameSync(tempDir, destDir);
        
        // Clean up backup
        fs.rmSync(backupDir, { recursive: true, force: true });
        fsyncDir(path.dirname(destDir));
        
        return { installed: false, skipped: false, updated: true };
      } catch (err) {
        // Cleanup temp
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (cleanupErr) {
          errors.push(`Temp cleanup failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
        }
        
        // Restore from backup if main is missing
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

  // New installation
  try {
    const tempDir = `${destDir}.tmp.${crypto.randomUUID()}`;
    fs.cpSync(srcDir, tempDir, { recursive: true });
    
    // Re-verify confinement before rename (TOCTOU mitigation)
    if (!reVerifyConfinement(destDir, configRealPath)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      return { installed: false, skipped: false, updated: false, error: "Confinement check failed before install" };
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

  // Step 1: Ensure config directory exists and is safe
  const configRealPath = ensureConfigDir(result.errors);
  if (!configRealPath) {
    result.fatal = true;
    return result;
  }

  // Step 2: Ensure state directory exists and is safe
  if (!ensureStateDir(configRealPath, result.errors)) {
    result.fatal = true;
    return result;
  }

  // Step 3: Acquire installation lock
  const lockFd = acquireLock(result.errors);
  if (lockFd === null) {
    // Not fatal - just skip installation this time
    return result;
  }

  try {
    // Step 4: Recover from any interrupted swaps
    recoverInterruptedSwaps(configRealPath, result.errors);

    // Step 5: Load existing state
    const { state: existingState, error: stateError } = loadInstallState();
    if (stateError) {
      result.errors.push(stateError);
    }

    // Step 6: Install files
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

    // Step 7: Save updated state
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
    // Always release lock
    releaseLock(lockFd, result.errors);
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
