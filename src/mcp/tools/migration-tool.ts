/**
 * Migration Tool - MCP tool for migrating legacy Gyoshu sessions
 *
 * Provides migration utilities to move legacy sessions from ~/.gyoshu/sessions/
 * to the new project-local research structure at ./gyoshu/research/.
 *
 * Migration Process:
 * 1. Scan: Discover all legacy sessions and report their status
 * 2. Migrate: Copy (never move/delete!) notebooks and artifacts to new structure
 * 3. Verify: Check that migration was successful (files exist, manifests valid)
 *
 * CRITICAL: This tool NEVER auto-deletes legacy sessions. Users must manually
 * clean up ~/.gyoshu/sessions/ after verifying the migration was successful.
 *
 * @module mcp/tools/migration-tool
 */

import * as fs from "fs/promises";
import * as path from "path";
import { durableAtomicWrite, fileExists, readFile, readFileNoFollow, copyFileNoFollow } from "../../lib/atomic-write.js";
import {
  getLegacySessionsDir,
  hasLegacySessions,
  getLegacySessionPath,
  getLegacyManifestPath,
  getLegacyArtifactsDir,
  getResearchDir,
  getResearchPath,
  getResearchManifestPath,
  getResearchNotebooksDir,
  getResearchArtifactsDir,
  getRunPath,
  ensureDirSync,
  getNotebookRootDir,
  getReportsRootDir,
  getNotebookPath,
  getReportDir,
  validatePathSegment,
} from "../../lib/paths.js";
import {
  GyoshuFrontmatter,
  ensureFrontmatterCell,
  RunEntry,
} from "../../lib/notebook-frontmatter.js";
import type { Notebook } from "../../lib/cell-identity.js";

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/**
 * Legacy session manifest structure from ~/.gyoshu/sessions/{sessionId}/manifest.json
 * This matches the old storage format.
 */
interface LegacySessionManifest {
  /** Unique identifier for this research session */
  researchSessionID: string;
  /** Optional link to parent research project */
  researchId?: string;
  /** ISO 8601 timestamp when session was created */
  created: string;
  /** ISO 8601 timestamp when session was last updated */
  updated: string;
  /** Current status of the session */
  status: "active" | "completed" | "archived";
  /** Path to the Jupyter notebook file */
  notebookPath: string;
  /** Research goal for this session */
  goal?: string;
  /** Goal status */
  goalStatus?: string;
  /** Orchestration mode */
  mode?: string;
  /** Environment metadata */
  environment?: {
    pythonVersion?: string;
    platform?: string;
    packages?: Record<string, string>;
    randomSeeds?: Record<string, number>;
  };
  /** Executed cells tracking */
  executedCells?: Record<string, unknown>;
  /** Execution order */
  executionOrder?: string[];
  /** Last successful execution count */
  lastSuccessfulExecution?: number;
  /** Budget tracking */
  budgets?: unknown;
  /** Abort reason if aborted */
  abortReason?: string;
  /** Last snapshot timestamp */
  lastSnapshotAt?: string;
}

/**
 * Information about a scanned legacy session.
 */
interface ScannedSession {
  /** Session identifier */
  sessionId: string;
  /** ISO 8601 timestamp when session was created */
  created: string;
  /** ISO 8601 timestamp when session was last updated */
  updated: string;
  /** Session status */
  status: string;
  /** Research goal if available */
  goal?: string;
  /** Whether a notebook file exists */
  notebookExists: boolean;
  /** Path to the notebook file (if exists) */
  notebookPath?: string;
  /** Number of artifacts found */
  artifactCount: number;
  /** Whether this session has already been migrated */
  alreadyMigrated: boolean;
}

/**
 * Result of migrating a single session.
 */
interface MigrationResult {
  /** Session identifier */
  sessionId: string;
  /** Whether migration was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** ID of the created research project */
  researchId?: string;
  /** ID of the created run */
  runId?: string;
  /** Path to the new notebook file */
  notebookPath?: string;
  /** Path to the new artifacts directory */
  artifactsDir?: string;
  /** Number of artifacts copied */
  artifactsCopied: number;
  /** Whether this was a dry run */
  dryRun: boolean;
  /** Whether session was skipped (already migrated) */
  skipped: boolean;
}

/**
 * Result of verifying a migration.
 */
interface VerifyResult {
  /** Session identifier */
  sessionId: string;
  /** Whether verification passed */
  valid: boolean;
  /** List of issues found */
  issues: string[];
  /** ID of the research project (if found) */
  researchId?: string;
  /** Whether the research manifest exists and is valid */
  manifestValid: boolean;
  /** Whether the notebook file exists */
  notebookExists: boolean;
  /** Whether the artifacts directory exists */
  artifactsDirExists: boolean;
  /** Number of artifacts in new location */
  artifactCount: number;
}

/**
 * Run summary for research manifest.
 */
interface RunSummary {
  runId: string;
  startedAt: string;
  endedAt?: string;
  mode: "PLANNER" | "AUTO" | "REPL";
  goal: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED" | "ABORTED" | "FAILED";
  notebookPath: string;
  artifactsDir: string;
}

/**
 * Type alias for run status values.
 */
type RunStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED" | "ABORTED" | "FAILED";

/**
 * Research manifest structure.
 */
interface ResearchManifest {
  schemaVersion: 1;
  researchId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "completed" | "archived";
  tags: string[];
  parentResearchId?: string;
  derivedFrom?: Array<{ researchId: string; note?: string }>;
  runs: RunSummary[];
  summaries: {
    executive: string;
    methods: string[];
    pitfalls: string[];
  };
}

/**
 * Run detail structure.
 */
interface RunDetail {
  schemaVersion: 1;
  runId: string;
  researchId: string;
  keyResults: Array<{
    type: "finding" | "metric" | "conclusion" | "observation";
    name?: string;
    text: string;
    value?: string;
  }>;
  artifacts: Array<{
    path: string;
    type: string;
    createdAt: string;
  }>;
  sessionId?: string;
  contextBundle?: unknown;
  executionLog?: Array<{
    timestamp: string;
    event: string;
    details?: unknown;
  }>;
}

// =============================================================================
// NOTEBOOK MIGRATION TYPES
// =============================================================================

/**
 * Information about a scanned research project.
 */
interface ScannedResearch {
  /** Research identifier (folder name) */
  researchId: string;
  /** Title from research manifest */
  title: string;
  /** ISO 8601 timestamp when created */
  createdAt: string;
  /** ISO 8601 timestamp when last updated */
  updatedAt: string;
  /** Research status */
  status: string;
  /** Tags from manifest */
  tags: string[];
  /** Number of runs */
  runCount: number;
  /** Whether notebooks exist */
  hasNotebooks: boolean;
  /** Path to first notebook (if exists) */
  firstNotebookPath?: string;
  /** Number of artifacts */
  artifactCount: number;
  /** Whether already migrated to notebooks/ */
  alreadyMigratedToNotebooks: boolean;
}

/**
 * Result of migrating a single research to notebook structure.
 */
interface NotebookMigrationResult {
  /** Research identifier */
  researchId: string;
  /** Whether migration was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Target slug (same as researchId) */
  slug: string;
  /** Path to the new notebook file */
  notebookPath?: string;
  /** Path to the new outputs directory */
  outputsDir?: string;
  /** Number of artifacts copied */
  artifactsCopied: number;
  /** Whether this was a dry run */
  dryRun: boolean;
  /** Whether research was skipped (already migrated) */
  skipped: boolean;
}

/**
 * Tool arguments interface.
 */
interface MigrationToolArgs {
  action: "scan" | "migrate" | "verify" | "scan-research" | "migrate-to-notebooks";
  sessionId?: string;
  dryRun?: boolean;
}

// =============================================================================
// VALIDATION
// =============================================================================

// validateId removed - use validatePathSegment from ../../lib/paths instead
// validatePathSegment provides stronger security: NFC Unicode normalization, null byte check

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Ensures the research directory exists.
 */
function ensureResearchRootDir(): void {
  ensureDirSync(getResearchDir());
}

/**
 * Ensures all directories for a research project exist.
 */
async function ensureResearchDirs(researchId: string): Promise<void> {
  const researchPath = getResearchPath(researchId);
  const runsDir = path.join(researchPath, "runs");
  const notebooksDir = getResearchNotebooksDir(researchId);
  const artifactsDir = getResearchArtifactsDir(researchId);

  ensureDirSync(researchPath);
  ensureDirSync(runsDir);
  ensureDirSync(notebooksDir);
  ensureDirSync(artifactsDir);
}

/**
 * Ensures run-specific directories exist.
 */
async function ensureRunDirs(researchId: string, runId: string): Promise<void> {
  const runArtifactsDir = path.join(getResearchArtifactsDir(researchId), runId);
  const plotsDir = path.join(runArtifactsDir, "plots");
  const exportsDir = path.join(runArtifactsDir, "exports");

  ensureDirSync(runArtifactsDir);
  ensureDirSync(plotsDir);
  ensureDirSync(exportsDir);
}

/**
 * Count files in a directory (non-recursive).
 */
async function countFilesInDir(dirPath: string): Promise<number> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).length;
  } catch {
    return 0;
  }
}

async function copyDirectory(src: string, dest: string): Promise<number> {
  let copiedCount = 0;

  const srcStat = await fs.lstat(src);
  if (srcStat.isSymbolicLink()) {
    throw new Error(`Security: ${src} is a symlink, not a directory`);
  }

  ensureDirSync(dest, 0o700);

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    const entryStat = await fs.lstat(srcPath);

    if (entryStat.isSymbolicLink()) {
      throw new Error(`Security: ${srcPath} is a symlink, refusing to follow`);
    }

    if (entryStat.isDirectory()) {
      copiedCount += await copyDirectory(srcPath, destPath);
    } else if (entryStat.isFile()) {
      await copyFileNoFollow(srcPath, destPath);
      copiedCount++;
    }
  }

  return copiedCount;
}

/**
 * Check if a research already exists for a given session.
 */
async function researchExistsForSession(sessionId: string): Promise<boolean> {
  const manifestPath = getResearchManifestPath(sessionId);
  return await fileExists(manifestPath);
}

/**
 * Load a Jupyter notebook from disk.
 */
async function loadNotebook(notebookPath: string): Promise<Notebook | null> {
  try {
    const content = await readFileNoFollow(notebookPath);
    return JSON.parse(content) as Notebook;
  } catch {
    return null;
  }
}

/**
 * Save a notebook with atomic writes.
 */
async function writeNotebook(notebookPath: string, notebook: Notebook): Promise<void> {
  ensureDirSync(path.dirname(notebookPath));
  await durableAtomicWrite(notebookPath, JSON.stringify(notebook, null, 2));
}

/**
 * Check if a notebook already exists in the notebooks/ directory.
 */
async function notebookExistsInNewLocation(slug: string): Promise<boolean> {
  const targetPath = getNotebookPath(slug);
  return await fileExists(targetPath);
}

/**
 * Scan for research projects in gyoshu/research/.
 */
async function scanResearchProjects(): Promise<ScannedResearch[]> {
  const researches: ScannedResearch[] = [];
  const researchDir = getResearchDir();

  if (!(await fileExists(researchDir))) {
    return researches;
  }

  const entries = await fs.readdir(researchDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const researchId = entry.name;
    const manifestPath = getResearchManifestPath(researchId);

    if (!(await fileExists(manifestPath))) continue;

    try {
      const manifest = await readFile<ResearchManifest>(manifestPath, true);

      // Count notebooks
      const notebooksDir = getResearchNotebooksDir(researchId);
      let hasNotebooks = false;
      let firstNotebookPath: string | undefined;
      if (await fileExists(notebooksDir)) {
        const notebooks = await fs.readdir(notebooksDir);
        const ipynbFiles = notebooks.filter((f) => f.endsWith(".ipynb"));
        hasNotebooks = ipynbFiles.length > 0;
        if (ipynbFiles.length > 0) {
          firstNotebookPath = path.join(notebooksDir, ipynbFiles[0]);
        }
      }

      // Count artifacts
      const artifactsDir = getResearchArtifactsDir(researchId);
      let artifactCount = 0;
      if (await fileExists(artifactsDir)) {
        artifactCount = await countFilesRecursive(artifactsDir);
      }

      // Check if already migrated to notebooks/
      const alreadyMigratedToNotebooks = await notebookExistsInNewLocation(researchId);

      researches.push({
        researchId,
        title: manifest.title,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt,
        status: manifest.status,
        tags: manifest.tags || [],
        runCount: manifest.runs?.length || 0,
        hasNotebooks,
        firstNotebookPath,
        artifactCount,
        alreadyMigratedToNotebooks,
      });
    } catch {
      // Skip invalid manifests
      continue;
    }
  }

  // Sort by updated date descending
  researches.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return researches;
}

/**
 * Count files recursively in a directory.
 */
async function countFilesRecursive(dirPath: string): Promise<number> {
  let count = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += await countFilesRecursive(path.join(dirPath, entry.name));
      } else {
        count++;
      }
    }
  } catch {
    return 0;
  }
  return count;
}

/**
 * Migrate a single research to the notebook-centric structure.
 */
async function migrateResearchToNotebook(
  researchId: string,
  dryRun: boolean
): Promise<NotebookMigrationResult> {
  const slug = researchId;

  const result: NotebookMigrationResult = {
    researchId,
    success: false,
    slug,
    artifactsCopied: 0,
    dryRun,
    skipped: false,
  };

  try {
    validatePathSegment(researchId, "researchId");

    // Check if already migrated
    if (await notebookExistsInNewLocation(slug)) {
      result.skipped = true;
      result.success = true;
      result.notebookPath = getNotebookPath(slug);
      return result;
    }

    // Read the research manifest
    const manifestPath = getResearchManifestPath(researchId);
    if (!(await fileExists(manifestPath))) {
      result.error = `Research manifest not found: ${manifestPath}`;
      return result;
    }

    const manifest = await readFile<ResearchManifest>(manifestPath, true);
    const legacyNotebooksDir = getResearchNotebooksDir(researchId);
    const legacyArtifactsDir = getResearchArtifactsDir(researchId);

    // Target paths (flat structure)
    const targetNotebookPath = getNotebookPath(slug);
    const targetOutputsDir = getReportDir(slug);

    result.notebookPath = targetNotebookPath;
    result.outputsDir = targetOutputsDir;

    if (!dryRun) {
      // Create directories
      ensureDirSync(path.dirname(targetNotebookPath));
      ensureDirSync(targetOutputsDir);

      // Find and copy/update notebook
      let notebook: Notebook | null = null;

      // Try to find an existing notebook
      if (await fileExists(legacyNotebooksDir)) {
        const notebooks = await fs.readdir(legacyNotebooksDir);
        const ipynbFiles = notebooks.filter((f) => f.endsWith(".ipynb"));
        if (ipynbFiles.length > 0) {
          const sourceNotebook = path.join(legacyNotebooksDir, ipynbFiles[0]);
          notebook = await loadNotebook(sourceNotebook);
        }
      }

      // Create new notebook if none found
      if (!notebook) {
        notebook = createEmptyNotebookForMigration(researchId);
      }

      // Create frontmatter from manifest
      const runs: RunEntry[] = (manifest.runs || []).map((r) => ({
        id: r.runId,
        started: r.startedAt,
        ended: r.endedAt,
        status: mapRunStatus(r.status),
        notes: r.goal,
      }));

      const frontmatter: GyoshuFrontmatter = {
        schema_version: 1,
        reportTitle: slug,
        status: manifest.status || "archived",
        created: manifest.createdAt || new Date().toISOString(),
        updated: manifest.updatedAt || new Date().toISOString(),
        tags: [...(manifest.tags || []), "migrated-from-legacy-research"],
        outputs_dir: path.relative(process.cwd(), targetOutputsDir),
        runs: runs.length > 0 ? runs.slice(-10) : undefined,
      };

      // Ensure frontmatter in notebook
      const migratedNotebook = ensureFrontmatterCell(notebook, frontmatter);
      await writeNotebook(targetNotebookPath, migratedNotebook);

      // Copy artifacts if they exist
      if (await fileExists(legacyArtifactsDir)) {
        result.artifactsCopied = await copyDirectory(legacyArtifactsDir, targetOutputsDir);
      }
    } else {
      // Dry run - just count what would be copied
      if (await fileExists(legacyArtifactsDir)) {
        result.artifactsCopied = await countFilesRecursive(legacyArtifactsDir);
      }
    }

    result.success = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

/**
 * Map research run status to frontmatter run status.
 */
function mapRunStatus(status: RunStatus): "in_progress" | "completed" | "failed" {
  switch (status) {
    case "COMPLETED":
      return "completed";
    case "IN_PROGRESS":
    case "PENDING":
      return "in_progress";
    case "BLOCKED":
    case "ABORTED":
    case "FAILED":
      return "failed";
    default:
      return "completed";
  }
}

/**
 * Create an empty notebook for migration when no notebook exists.
 */
function createEmptyNotebookForMigration(researchId: string): Notebook {
  return {
    cells: [],
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: {
        name: "python",
        version: "3.11",
        mimetype: "text/x-python",
        file_extension: ".py",
      },
      gyoshu: {
        researchSessionID: researchId,
        migratedAt: new Date().toISOString(),
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

/**
 * Find the notebook file in a legacy session directory.
 * Looks for notebook.ipynb or *.ipynb in the session directory.
 */
async function findLegacyNotebook(sessionDir: string): Promise<string | null> {
  // First try the standard notebook.ipynb
  const standardPath = path.join(sessionDir, "notebook.ipynb");
  if (await fileExists(standardPath)) {
    return standardPath;
  }

  // Look for any .ipynb file
  try {
    const entries = await fs.readdir(sessionDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".ipynb")) {
        return path.join(sessionDir, entry.name);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return null;
}

// =============================================================================
// ACTION IMPLEMENTATIONS
// =============================================================================

/**
 * Scan for legacy sessions.
 */
async function scanLegacySessions(): Promise<ScannedSession[]> {
  const sessions: ScannedSession[] = [];

  if (!hasLegacySessions()) {
    return sessions;
  }

  const legacyDir = getLegacySessionsDir();
  const entries = await fs.readdir(legacyDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const sessionId = entry.name;
    const sessionDir = getLegacySessionPath(sessionId);
    const manifestPath = getLegacyManifestPath(sessionId);
    const artifactsDir = getLegacyArtifactsDir(sessionId);

    // Try to read the manifest
    let manifest: LegacySessionManifest | null = null;
    try {
      manifest = await readFile<LegacySessionManifest>(manifestPath, true);
    } catch {
      // Manifest doesn't exist or is invalid - skip this session
      continue;
    }

    // Find notebook
    const notebookPath = await findLegacyNotebook(sessionDir);

    // Count artifacts
    const artifactCount = await countFilesInDir(artifactsDir);

    // Check if already migrated
    const alreadyMigrated = await researchExistsForSession(sessionId);

    sessions.push({
      sessionId,
      created: manifest.created,
      updated: manifest.updated,
      status: manifest.status,
      goal: manifest.goal,
      notebookExists: notebookPath !== null,
      notebookPath: notebookPath ?? undefined,
      artifactCount,
      alreadyMigrated,
    });
  }

  // Sort by updated date descending
  sessions.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());

  return sessions;
}

/**
 * Migrate a single legacy session to the new structure.
 */
async function migrateSingleSession(
  sessionId: string,
  dryRun: boolean
): Promise<MigrationResult> {
  const result: MigrationResult = {
    sessionId,
    success: false,
    artifactsCopied: 0,
    dryRun,
    skipped: false,
  };

  try {
    validatePathSegment(sessionId, "sessionId");

    // Check if already migrated
    if (await researchExistsForSession(sessionId)) {
      result.skipped = true;
      result.success = true;
      result.researchId = sessionId;
      return result;
    }

    // Read the legacy manifest
    const manifestPath = getLegacyManifestPath(sessionId);
    if (!(await fileExists(manifestPath))) {
      result.error = `Legacy session manifest not found: ${manifestPath}`;
      return result;
    }

    const legacyManifest = await readFile<LegacySessionManifest>(manifestPath, true);
    const sessionDir = getLegacySessionPath(sessionId);
    const legacyArtifactsDir = getLegacyArtifactsDir(sessionId);

    // Use sessionId as researchId for simplicity
    const researchId = sessionId;
    const runId = `migrated-${Date.now()}`;

    result.researchId = researchId;
    result.runId = runId;

    if (!dryRun) {
      // Create research directories
      await ensureResearchDirs(researchId);
      await ensureRunDirs(researchId, runId);

      // Create research manifest
      const now = new Date().toISOString();
      const researchManifest: ResearchManifest = {
        schemaVersion: 1,
        researchId,
        title: legacyManifest.goal || researchId,
        createdAt: legacyManifest.created,
        updatedAt: now,
        status: legacyManifest.status,
        tags: ["migrated-from-legacy"],
        runs: [],
        summaries: {
          executive: legacyManifest.goal || "",
          methods: [],
          pitfalls: [],
        },
      };

      // Determine run status from legacy goalStatus
      let runStatus: RunSummary["status"] = "COMPLETED";
      if (legacyManifest.goalStatus) {
        const validStatuses = ["PENDING", "IN_PROGRESS", "COMPLETED", "BLOCKED", "ABORTED", "FAILED"];
        if (validStatuses.includes(legacyManifest.goalStatus)) {
          runStatus = legacyManifest.goalStatus as RunSummary["status"];
        }
      }

      // Determine run mode from legacy mode
      let runMode: RunSummary["mode"] = "REPL";
      if (legacyManifest.mode && ["PLANNER", "AUTO", "REPL"].includes(legacyManifest.mode)) {
        runMode = legacyManifest.mode as RunSummary["mode"];
      }

      // Create run summary
      const runSummary: RunSummary = {
        runId,
        startedAt: legacyManifest.created,
        endedAt: legacyManifest.updated,
        mode: runMode,
        goal: legacyManifest.goal || "",
        status: runStatus,
        notebookPath: `notebooks/${runId}.ipynb`,
        artifactsDir: `artifacts/${runId}/`,
      };

      researchManifest.runs.push(runSummary);

      // Create run detail
      const runDetail: RunDetail = {
        schemaVersion: 1,
        runId,
        researchId,
        keyResults: [],
        artifacts: [],
        sessionId: legacyManifest.researchSessionID,
        executionLog: [
          {
            timestamp: now,
            event: "migrated_from_legacy",
            details: {
              originalPath: sessionDir,
              originalManifest: manifestPath,
            },
          },
        ],
      };

      const legacyNotebookPath = await findLegacyNotebook(sessionDir);
      if (legacyNotebookPath) {
        const newNotebookDir = getResearchNotebooksDir(researchId);
        const newNotebookPath = path.join(newNotebookDir, `${runId}.ipynb`);
        await copyFileNoFollow(legacyNotebookPath, newNotebookPath);
        result.notebookPath = newNotebookPath;
      }

      // Copy artifacts if they exist
      if (await fileExists(legacyArtifactsDir)) {
        const newArtifactsDir = path.join(getResearchArtifactsDir(researchId), runId);
        result.artifactsCopied = await copyDirectory(legacyArtifactsDir, newArtifactsDir);
        result.artifactsDir = newArtifactsDir;

        // Add artifacts to run detail
        if (result.artifactsCopied > 0) {
          try {
            const entries = await fs.readdir(newArtifactsDir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isFile()) {
                runDetail.artifacts.push({
                  path: entry.name,
                  type: path.extname(entry.name).slice(1) || "unknown",
                  createdAt: now,
                });
              }
            }
          } catch {
            // Ignore errors listing artifacts
          }
        }
      }

      // Write the manifests
      await durableAtomicWrite(
        getResearchManifestPath(researchId),
        JSON.stringify(researchManifest, null, 2)
      );

      await durableAtomicWrite(
        getRunPath(researchId, runId),
        JSON.stringify(runDetail, null, 2)
      );
    } else {
      // Dry run - just check what would be copied
      const legacyNotebookPath = await findLegacyNotebook(sessionDir);
      if (legacyNotebookPath) {
        result.notebookPath = path.join(
          getResearchNotebooksDir(researchId),
          `${runId}.ipynb`
        );
      }

      if (await fileExists(legacyArtifactsDir)) {
        result.artifactsCopied = await countFilesInDir(legacyArtifactsDir);
        result.artifactsDir = path.join(getResearchArtifactsDir(researchId), runId);
      }
    }

    result.success = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

/**
 * Verify that a session was migrated correctly.
 */
async function verifySingleMigration(sessionId: string): Promise<VerifyResult> {
  const result: VerifyResult = {
    sessionId,
    valid: true,
    issues: [],
    manifestValid: false,
    notebookExists: false,
    artifactsDirExists: false,
    artifactCount: 0,
  };

  try {
    validatePathSegment(sessionId, "sessionId");

    // Check if research exists
    const researchId = sessionId;
    const manifestPath = getResearchManifestPath(researchId);

    if (!(await fileExists(manifestPath))) {
      result.valid = false;
      result.issues.push("Research manifest not found - migration may not have been run");
      return result;
    }

    result.researchId = researchId;

    // Validate manifest
    try {
      const manifest = await readFile<ResearchManifest>(manifestPath, true);

      // Check required fields
      if (manifest.schemaVersion !== 1) {
        result.issues.push(`Unexpected schema version: ${manifest.schemaVersion}`);
      }
      if (manifest.researchId !== researchId) {
        result.issues.push(`Research ID mismatch: expected ${researchId}, got ${manifest.researchId}`);
      }
      if (!manifest.runs || manifest.runs.length === 0) {
        result.issues.push("No runs found in research manifest");
      } else {
        // Check the migrated run
        const migratedRun = manifest.runs.find((r) => r.runId.startsWith("migrated-"));
        if (!migratedRun) {
          result.issues.push("No migrated run found in research manifest");
        } else {
          // Check run detail exists
          const runDetailPath = getRunPath(researchId, migratedRun.runId);
          if (!(await fileExists(runDetailPath))) {
            result.issues.push(`Run detail file not found: ${runDetailPath}`);
          }

          // Check notebook exists
          const notebookPath = path.join(
            getResearchNotebooksDir(researchId),
            `${migratedRun.runId}.ipynb`
          );
          result.notebookExists = await fileExists(notebookPath);

          // Check artifacts directory exists
          const artifactsDir = path.join(
            getResearchArtifactsDir(researchId),
            migratedRun.runId
          );
          result.artifactsDirExists = await fileExists(artifactsDir);

          if (result.artifactsDirExists) {
            result.artifactCount = await countFilesInDir(artifactsDir);
          }
        }
      }

      result.manifestValid = true;
    } catch (err) {
      result.valid = false;
      result.issues.push(`Failed to parse manifest: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Compare with legacy session
    const legacyManifestPath = getLegacyManifestPath(sessionId);
    if (await fileExists(legacyManifestPath)) {
      const legacyManifest = await readFile<LegacySessionManifest>(legacyManifestPath, true);
      const legacySessionDir = getLegacySessionPath(sessionId);
      const legacyArtifactsDir = getLegacyArtifactsDir(sessionId);

      // Check if notebook was in legacy but not in new
      const legacyNotebookPath = await findLegacyNotebook(legacySessionDir);
      if (legacyNotebookPath && !result.notebookExists) {
        result.issues.push("Notebook exists in legacy session but not in migrated research");
      }

      // Check artifact count matches
      const legacyArtifactCount = await countFilesInDir(legacyArtifactsDir);
      if (legacyArtifactCount > 0 && result.artifactCount < legacyArtifactCount) {
        result.issues.push(
          `Artifact count mismatch: legacy has ${legacyArtifactCount}, migrated has ${result.artifactCount}`
        );
      }
    }

    // Set overall validity
    result.valid = result.issues.length === 0;
  } catch (err) {
    result.valid = false;
    result.issues.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}

// =============================================================================
// MCP TOOL DEFINITION
// =============================================================================

/**
 * MCP tool definition for migration tool.
 */
export const migrationTool = {
  name: "migration_tool",
  description:
    "Migrate Gyoshu data between storage formats. Actions: scan (list legacy sessions), " +
    "migrate (copy legacy sessions to research structure), verify (check legacy migration), " +
    "scan-research (list research projects), migrate-to-notebooks (migrate research to notebooks/). " +
    "IMPORTANT: This tool NEVER auto-deletes source data.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["scan", "migrate", "verify", "scan-research", "migrate-to-notebooks"],
        description:
          "Operation: 'scan' lists legacy sessions, 'migrate' copies them to research structure, " +
          "'verify' checks legacy migration, 'scan-research' lists research projects, " +
          "'migrate-to-notebooks' migrates research to notebooks/ with frontmatter",
      },
      sessionId: {
        type: "string",
        description:
          "Specific session ID to migrate or verify. If not provided, operates on all sessions.",
      },
      dryRun: {
        type: "boolean",
        description:
          "If true, show what would be done without making changes (for migrate action). Default: false",
      },
    },
    required: ["action"],
  },
};

// =============================================================================
// MCP HANDLER FUNCTION
// =============================================================================

/**
 * Handle migration tool invocation.
 *
 * @param args - Tool arguments (unknown, validated internally)
 * @returns Migration results as JSON string
 */
export async function handleMigration(args: unknown): Promise<string> {
  const params = args as MigrationToolArgs;

  ensureResearchRootDir();

  switch (params.action) {
    // =========================================================================
    // SCAN ACTION
    // =========================================================================

    case "scan": {
      const sessions = await scanLegacySessions();

      const notMigrated = sessions.filter((s) => !s.alreadyMigrated);
      const alreadyMigrated = sessions.filter((s) => s.alreadyMigrated);

      return JSON.stringify(
        {
          success: true,
          action: "scan",
          legacySessionsDir: getLegacySessionsDir(),
          totalSessions: sessions.length,
          pendingMigration: notMigrated.length,
          alreadyMigrated: alreadyMigrated.length,
          sessions,
          message: sessions.length === 0
            ? "No legacy sessions found at ~/.gyoshu/sessions/"
            : `Found ${sessions.length} legacy sessions: ${notMigrated.length} pending migration, ${alreadyMigrated.length} already migrated`,
        },
        null,
        2
      );
    }

    // =========================================================================
    // MIGRATE ACTION
    // =========================================================================

    case "migrate": {
      const dryRun = params.dryRun === true;

      // If specific session requested, migrate just that one
      if (params.sessionId) {
        validatePathSegment(params.sessionId, "sessionId");
        const result = await migrateSingleSession(params.sessionId, dryRun);

        return JSON.stringify(
          {
            success: result.success,
            action: "migrate",
            dryRun,
            results: [result],
            totalMigrated: result.success && !result.skipped ? 1 : 0,
            totalSkipped: result.skipped ? 1 : 0,
            totalFailed: result.success ? 0 : 1,
            message: result.skipped
              ? `Session '${params.sessionId}' was already migrated`
              : result.success
                ? `Session '${params.sessionId}' migrated successfully${dryRun ? " (dry run)" : ""}`
                : `Failed to migrate session '${params.sessionId}': ${result.error}`,
          },
          null,
          2
        );
      }

      // Migrate all pending sessions
      const sessions = await scanLegacySessions();
      const pendingSessions = sessions.filter((s) => !s.alreadyMigrated);

      if (pendingSessions.length === 0) {
        return JSON.stringify(
          {
            success: true,
            action: "migrate",
            dryRun,
            results: [],
            totalMigrated: 0,
            totalSkipped: 0,
            totalFailed: 0,
            message: "No legacy sessions pending migration",
          },
          null,
          2
        );
      }

      const results: MigrationResult[] = [];
      for (const session of pendingSessions) {
        const result = await migrateSingleSession(session.sessionId, dryRun);
        results.push(result);
      }

      const totalMigrated = results.filter((r) => r.success && !r.skipped).length;
      const totalSkipped = results.filter((r) => r.skipped).length;
      const totalFailed = results.filter((r) => !r.success).length;

      return JSON.stringify(
        {
          success: totalFailed === 0,
          action: "migrate",
          dryRun,
          results,
          totalMigrated,
          totalSkipped,
          totalFailed,
          message: dryRun
            ? `Dry run complete: ${totalMigrated} sessions would be migrated`
            : `Migration complete: ${totalMigrated} sessions migrated, ${totalSkipped} skipped, ${totalFailed} failed`,
          warning:
            "IMPORTANT: Legacy sessions at ~/.gyoshu/sessions/ have NOT been deleted. " +
            "After verifying the migration, you may manually delete them.",
        },
        null,
        2
      );
    }

    // =========================================================================
    // VERIFY ACTION
    // =========================================================================

    case "verify": {
      // If specific session requested, verify just that one
      if (params.sessionId) {
        validatePathSegment(params.sessionId, "sessionId");
        const result = await verifySingleMigration(params.sessionId);

        return JSON.stringify(
          {
            success: result.valid,
            action: "verify",
            results: [result],
            totalValid: result.valid ? 1 : 0,
            totalInvalid: result.valid ? 0 : 1,
            message: result.valid
              ? `Migration verified successfully for session '${params.sessionId}'`
              : `Verification failed for session '${params.sessionId}': ${result.issues.join(", ")}`,
          },
          null,
          2
        );
      }

      // Verify all sessions that were migrated
      const sessions = await scanLegacySessions();
      const migratedSessions = sessions.filter((s) => s.alreadyMigrated);

      if (migratedSessions.length === 0) {
        return JSON.stringify(
          {
            success: true,
            action: "verify",
            results: [],
            totalValid: 0,
            totalInvalid: 0,
            message: "No migrated sessions to verify",
          },
          null,
          2
        );
      }

      const results: VerifyResult[] = [];
      for (const session of migratedSessions) {
        const result = await verifySingleMigration(session.sessionId);
        results.push(result);
      }

      const totalValid = results.filter((r) => r.valid).length;
      const totalInvalid = results.filter((r) => !r.valid).length;

      return JSON.stringify(
        {
          success: totalInvalid === 0,
          action: "verify",
          results,
          totalValid,
          totalInvalid,
          message:
            totalInvalid === 0
              ? `All ${totalValid} migrated sessions verified successfully`
              : `Verification complete: ${totalValid} valid, ${totalInvalid} with issues`,
        },
        null,
        2
      );
    }

    // =========================================================================
    // SCAN-RESEARCH ACTION
    // =========================================================================

    case "scan-research": {
      const researches = await scanResearchProjects();

      const notMigrated = researches.filter((r) => !r.alreadyMigratedToNotebooks);
      const alreadyMigrated = researches.filter((r) => r.alreadyMigratedToNotebooks);

      return JSON.stringify(
        {
          success: true,
          action: "scan-research",
          researchDir: getResearchDir(),
          notebookDir: getNotebookRootDir(),
          totalResearch: researches.length,
          pendingMigration: notMigrated.length,
          alreadyMigrated: alreadyMigrated.length,
          researches,
          message: researches.length === 0
            ? "No research projects found at gyoshu/research/"
            : `Found ${researches.length} research projects: ${notMigrated.length} pending migration to notebooks/, ${alreadyMigrated.length} already migrated`,
        },
        null,
        2
      );
    }

    // =========================================================================
    // MIGRATE-TO-NOTEBOOKS ACTION
    // =========================================================================

    case "migrate-to-notebooks": {
      const dryRun = params.dryRun === true;

      // If specific research requested, migrate just that one
      if (params.sessionId) {
        validatePathSegment(params.sessionId, "researchId");
        const result = await migrateResearchToNotebook(params.sessionId, dryRun);

        return JSON.stringify(
          {
            success: result.success,
            action: "migrate-to-notebooks",
            dryRun,
            results: [result],
            totalMigrated: result.success && !result.skipped ? 1 : 0,
            totalSkipped: result.skipped ? 1 : 0,
            totalFailed: result.success ? 0 : 1,
            message: result.skipped
              ? `Research '${params.sessionId}' was already migrated to notebooks/`
              : result.success
                ? `Research '${params.sessionId}' migrated successfully to notebooks/${dryRun ? " (dry run)" : ""}`
                : `Failed to migrate research '${params.sessionId}': ${result.error}`,
          },
          null,
          2
        );
      }

      // Migrate all pending research projects
      const researches = await scanResearchProjects();
      const pendingResearches = researches.filter((r) => !r.alreadyMigratedToNotebooks);

      if (pendingResearches.length === 0) {
        return JSON.stringify(
          {
            success: true,
            action: "migrate-to-notebooks",
            dryRun,
            results: [],
            totalMigrated: 0,
            totalSkipped: 0,
            totalFailed: 0,
            message: "No research projects pending migration to notebooks/",
          },
          null,
          2
        );
      }

      const results: NotebookMigrationResult[] = [];
      for (const research of pendingResearches) {
        const result = await migrateResearchToNotebook(research.researchId, dryRun);
        results.push(result);
      }

      const totalMigrated = results.filter((r) => r.success && !r.skipped).length;
      const totalSkipped = results.filter((r) => r.skipped).length;
      const totalFailed = results.filter((r) => !r.success).length;

      return JSON.stringify(
        {
          success: totalFailed === 0,
          action: "migrate-to-notebooks",
          dryRun,
          notebookDir: getNotebookRootDir(),
          reportsDir: getReportsRootDir(),
          results,
          totalMigrated,
          totalSkipped,
          totalFailed,
          message: dryRun
            ? `Dry run complete: ${totalMigrated} research projects would be migrated to notebooks/`
            : `Migration complete: ${totalMigrated} research projects migrated to notebooks/, ${totalSkipped} skipped, ${totalFailed} failed`,
          warning:
            "IMPORTANT: Original research at gyoshu/research/ has NOT been deleted. " +
            "After verifying the migration, you may manually archive or delete it.",
        },
        null,
        2
      );
    }

    default:
      throw new Error(`Unknown action: ${params.action}`);
  }
}
