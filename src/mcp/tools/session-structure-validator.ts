/**
 * Session Structure Validator - MCP tool for detecting and auto-correcting
 * session structure violations. Ensures files are in canonical locations:
 * notebooks/, reports/ instead of legacy gyoshu/research/.
 *
 * @module mcp/tools/session-structure-validator
 */

import * as fs from "fs/promises";
import * as path from "path";
import {
  detectProjectRoot,
  getLegacySessionsDir,
  hasLegacySessions,
  ensureDirSync,
} from "../../lib/paths.js";
import { fileExists, copyFileNoFollow } from "../../lib/atomic-write.js";
import { isPathContainedIn } from "../../lib/path-security.js";

type ViolationType =
  | "notebook_wrong_location"
  | "report_wrong_location"
  | "orphaned_research"
  | "legacy_session"
  | "gyoshu_root_notebook";

interface StructureViolation {
  type: ViolationType;
  sourcePath: string;
  suggestedPath: string;
  canAutoFix: boolean;
  reason: string;
  reportTitle?: string;
}

interface FixResult {
  moved: string[];
  errors: string[];
  skipped: string[];
}

interface ScanSummary {
  totalViolations: number;
  byType: Record<ViolationType, number>;
  autoFixable: number;
  manualRequired: number;
}

// ===== MCP TOOL DEFINITION =====

export const sessionStructureValidatorTool = {
  name: "session_structure_validator",
  description:
    "Detect and auto-correct session structure violations. " +
    "Ensures files are in canonical locations (notebooks/, reports/) " +
    "not legacy locations (gyoshu/research/). " +
    "Actions: scan (detect violations), fix (auto-reorganize), validate (quick check).",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["scan", "fix", "validate"],
        description:
          "Operation to perform: " +
          "'scan' detects violations without fixing, " +
          "'fix' auto-reorganizes files to correct locations, " +
          "'validate' quick check if structure is valid",
      },
      dryRun: {
        type: "boolean",
        description:
          "For 'fix' action: preview changes without applying (default: false)",
      },
      reportTitle: {
        type: "string",
        description:
          "Optional: validate/fix only a specific report by its title",
      },
    },
    required: ["action"],
  },
};

// ===== TYPES =====

interface SessionStructureValidatorArgs {
  action: "scan" | "fix" | "validate";
  dryRun?: boolean;
  reportTitle?: string;
}

// ===== HELPER FUNCTIONS =====

function extractReportTitleFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");

  const researchMatch = normalized.match(/gyoshu\/research\/([^/]+)/);
  if (researchMatch) {
    return researchMatch[1];
  }

  const notebookMatch = normalized.match(/([^/]+)\.ipynb$/);
  if (notebookMatch) {
    return notebookMatch[1];
  }

  return path.basename(filePath, path.extname(filePath));
}

async function findFilesRecursive(
  dir: string,
  pattern: RegExp,
  results: string[] = []
): Promise<string[]> {
  try {
    // Security: Reject if dir is a symlink to prevent escaping project root
    const dirStat = await fs.lstat(dir);
    if (dirStat.isSymbolicLink()) {
      return results;  // Skip symlink directories
    }

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await findFilesRecursive(fullPath, pattern, results);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore inaccessible directories
  }

  return results;
}

async function hasContent(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.length > 0;
  } catch {
    return false;
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
      const projectRoot = detectProjectRoot();
      if (!isPathContainedIn(srcPath, projectRoot, { useRealpath: true })) {
        throw new Error(`Security: source path escapes project root: ${srcPath}`);
      }
      await copyFileNoFollow(srcPath, destPath);
      copiedCount++;
    }
  }

  return copiedCount;
}

async function scanLegacyResearchNotebooks(
  projectRoot: string
): Promise<StructureViolation[]> {
  const violations: StructureViolation[] = [];
  const researchDir = path.join(projectRoot, "gyoshu", "research");

  if (!(await fileExists(researchDir))) {
    return violations;
  }

  try {
    const researchEntries = await fs.readdir(researchDir, { withFileTypes: true });

    for (const entry of researchEntries) {
      if (!entry.isDirectory()) continue;

      const reportTitle = entry.name;
      const notebooksDir = path.join(researchDir, reportTitle, "notebooks");

      if (await fileExists(notebooksDir)) {
        const notebooks = await findFilesRecursive(notebooksDir, /\.ipynb$/);

        for (const notebook of notebooks) {
          violations.push({
            type: "notebook_wrong_location",
            sourcePath: notebook,
            suggestedPath: path.join(projectRoot, "notebooks", `${reportTitle}.ipynb`),
            canAutoFix: true,
            reason: "Legacy research directory - notebook should be in notebooks/",
            reportTitle,
          });
        }
      }
    }
  } catch {
    // Ignore read errors
  }

  return violations;
}

async function scanGyoshuRootNotebooks(
  projectRoot: string
): Promise<StructureViolation[]> {
  const violations: StructureViolation[] = [];
  const gyoshuDir = path.join(projectRoot, "gyoshu");

  if (!(await fileExists(gyoshuDir))) {
    return violations;
  }

  const notebooks = await findFilesRecursive(gyoshuDir, /\.ipynb$/);

  const rootNotebooks = notebooks.filter((nb) => {
    const relative = path.relative(gyoshuDir, nb);
    return !relative.startsWith("research");
  });

  for (const notebook of rootNotebooks) {
    const reportTitle = extractReportTitleFromPath(notebook);

    violations.push({
      type: "gyoshu_root_notebook",
      sourcePath: notebook,
      suggestedPath: path.join(projectRoot, "notebooks", `${reportTitle}.ipynb`),
      canAutoFix: true,
      reason: "Notebook in gyoshu/ root - should be in notebooks/",
      reportTitle,
    });
  }

  return violations;
}

async function scanLegacyResearchArtifacts(
  projectRoot: string
): Promise<StructureViolation[]> {
  const violations: StructureViolation[] = [];
  const researchDir = path.join(projectRoot, "gyoshu", "research");

  if (!(await fileExists(researchDir))) {
    return violations;
  }

  try {
    const researchEntries = await fs.readdir(researchDir, { withFileTypes: true });

    for (const entry of researchEntries) {
      if (!entry.isDirectory()) continue;

      const reportTitle = entry.name;
      const artifactsDir = path.join(researchDir, reportTitle, "artifacts");

      if (await fileExists(artifactsDir) && await hasContent(artifactsDir)) {
        violations.push({
          type: "report_wrong_location",
          sourcePath: artifactsDir,
          suggestedPath: path.join(projectRoot, "reports", reportTitle),
          canAutoFix: true,
          reason: "Legacy research artifacts - should be in reports/{reportTitle}/",
          reportTitle,
        });
      }
    }
  } catch {
    // Ignore read errors
  }

  return violations;
}

async function scanOrphanedResearchDirs(
  projectRoot: string
): Promise<StructureViolation[]> {
  const violations: StructureViolation[] = [];
  const researchDir = path.join(projectRoot, "gyoshu", "research");

  if (!(await fileExists(researchDir))) {
    return violations;
  }

  if (await hasContent(researchDir)) {
    violations.push({
      type: "orphaned_research",
      sourcePath: researchDir,
      suggestedPath: path.join(projectRoot, "notebooks") + " + " + path.join(projectRoot, "reports"),
      canAutoFix: true,
      reason: "Legacy gyoshu/research/ directory exists with content - should be migrated to notebooks/ and reports/",
    });
  }

  return violations;
}

async function scanLegacySessions(): Promise<StructureViolation[]> {
  const violations: StructureViolation[] = [];

  if (!hasLegacySessions()) {
    return violations;
  }

  const legacyDir = getLegacySessionsDir();

  try {
    const entries = await fs.readdir(legacyDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const sessionDir = path.join(legacyDir, entry.name);
      const manifestPath = path.join(sessionDir, "manifest.json");

      if (await fileExists(manifestPath)) {
        violations.push({
          type: "legacy_session",
          sourcePath: sessionDir,
          suggestedPath: "Use migration-tool to migrate to notebooks/",
          canAutoFix: false,
          reason: "Legacy session in ~/.gyoshu/sessions/ - use 'migration-tool' action='migrate' to migrate",
        });
      }
    }
  } catch {
    // Ignore read errors
  }

  return violations;
}

async function scanForViolations(): Promise<{
  violations: StructureViolation[];
  summary: ScanSummary;
}> {
  const projectRoot = detectProjectRoot();
  const violations: StructureViolation[] = [];

  violations.push(...await scanLegacyResearchNotebooks(projectRoot));
  violations.push(...await scanGyoshuRootNotebooks(projectRoot));
  violations.push(...await scanLegacyResearchArtifacts(projectRoot));
  violations.push(...await scanOrphanedResearchDirs(projectRoot));
  violations.push(...await scanLegacySessions());

  const byType: Record<ViolationType, number> = {
    notebook_wrong_location: 0,
    report_wrong_location: 0,
    orphaned_research: 0,
    legacy_session: 0,
    gyoshu_root_notebook: 0,
  };

  for (const v of violations) {
    byType[v.type]++;
  }

  const summary: ScanSummary = {
    totalViolations: violations.length,
    byType,
    autoFixable: violations.filter((v) => v.canAutoFix).length,
    manualRequired: violations.filter((v) => !v.canAutoFix).length,
  };

  return { violations, summary };
}

async function fixNotebookViolation(
  violation: StructureViolation,
  dryRun: boolean
): Promise<{ success: boolean; message: string }> {
  const { sourcePath, suggestedPath } = violation;

  if (await fileExists(suggestedPath)) {
    return {
      success: false,
      message: `Target already exists: ${suggestedPath}. Manual merge required.`,
    };
  }

  if (dryRun) {
    return {
      success: true,
      message: `[DRY RUN] Would move ${sourcePath} → ${suggestedPath}`,
    };
  }

  try {
    const projectRoot = detectProjectRoot();
    if (!isPathContainedIn(sourcePath, projectRoot, { useRealpath: true })) {
      return {
        success: false,
        message: `Security: source path escapes project root: ${sourcePath}`,
      };
    }

    const sourceStat = await fs.lstat(sourcePath);
    if (!sourceStat.isFile()) {
      return {
        success: false,
        message: `Security: source is not a regular file: ${sourcePath}`,
      };
    }

    ensureDirSync(path.dirname(suggestedPath), 0o700);

    await copyFileNoFollow(sourcePath, suggestedPath);

    if (await fileExists(suggestedPath)) {
      await fs.unlink(sourcePath);
      return {
        success: true,
        message: `Moved ${sourcePath} → ${suggestedPath}`,
      };
    } else {
      return {
        success: false,
        message: `Copy verification failed for ${suggestedPath}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      message: `Failed to move ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function fixReportViolation(
  violation: StructureViolation,
  dryRun: boolean
): Promise<{ success: boolean; message: string }> {
  const { sourcePath, suggestedPath } = violation;
  const targetDir = suggestedPath.split(" + ")[0];

  if (dryRun) {
    return {
      success: true,
      message: `[DRY RUN] Would copy contents of ${sourcePath} → ${targetDir}`,
    };
  }

  try {
    ensureDirSync(targetDir);
    const copiedCount = await copyDirectory(sourcePath, targetDir);

    return {
      success: true,
      message: `Copied ${copiedCount} files from ${sourcePath} → ${targetDir}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to copy ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function fixViolations(
  violations: StructureViolation[],
  dryRun: boolean,
  reportTitle?: string
): Promise<FixResult> {
  const result: FixResult = {
    moved: [],
    errors: [],
    skipped: [],
  };

  let toFix = violations.filter((v) => v.canAutoFix);
  if (reportTitle) {
    toFix = toFix.filter((v) => v.reportTitle === reportTitle);
  }

  for (const violation of toFix) {
    let fixResult: { success: boolean; message: string };

    switch (violation.type) {
      case "notebook_wrong_location":
      case "gyoshu_root_notebook":
        fixResult = await fixNotebookViolation(violation, dryRun);
        break;

      case "report_wrong_location":
        fixResult = await fixReportViolation(violation, dryRun);
        break;

      case "orphaned_research":
        fixResult = {
          success: false,
          message: "Use migration-tool action='migrate-to-notebooks' for comprehensive migration",
        };
        break;

      default:
        fixResult = {
          success: false,
          message: `Unknown violation type: ${violation.type}`,
        };
    }

    if (fixResult.success) {
      result.moved.push(fixResult.message);
    } else {
      result.errors.push(fixResult.message);
    }
  }

  const skipped = violations.filter((v) => !v.canAutoFix);
  for (const v of skipped) {
    result.skipped.push(`${v.sourcePath}: ${v.reason}`);
  }

  return result;
}

async function validateStructure(reportTitle?: string): Promise<{
  valid: boolean;
  issues: string[];
}> {
  const { violations } = await scanForViolations();

  let relevantViolations = violations;
  if (reportTitle) {
    relevantViolations = violations.filter((v) => v.reportTitle === reportTitle);
  }

  const issues = relevantViolations.map((v) =>
    `${v.type}: ${v.sourcePath} → ${v.suggestedPath}`
  );

  return {
    valid: relevantViolations.length === 0,
    issues,
  };
}

// ===== MCP HANDLER =====

export async function handleSessionStructureValidator(args: unknown): Promise<unknown> {
  const typedArgs = args as SessionStructureValidatorArgs;
  const { action, dryRun, reportTitle } = typedArgs;

  switch (action) {
    case "scan": {
      const { violations, summary } = await scanForViolations();

      let filteredViolations = violations;
      if (reportTitle) {
        filteredViolations = violations.filter(
          (v) => v.reportTitle === reportTitle
        );
      }

      return JSON.stringify(
        {
          success: true,
          action: "scan",
          projectRoot: detectProjectRoot(),
          violations: filteredViolations,
          summary: reportTitle
            ? {
                totalViolations: filteredViolations.length,
                autoFixable: filteredViolations.filter((v) => v.canAutoFix).length,
                manualRequired: filteredViolations.filter((v) => !v.canAutoFix).length,
              }
            : summary,
          message:
            filteredViolations.length === 0
              ? "No structure violations found. All files are in correct locations."
              : `Found ${filteredViolations.length} structure violations: ${summary.autoFixable} auto-fixable, ${summary.manualRequired} require manual intervention`,
        },
        null,
        2
      );
    }

    case "fix": {
      const dryRunMode = dryRun === true;
      const { violations, summary } = await scanForViolations();

      if (violations.length === 0) {
        return JSON.stringify(
          {
            success: true,
            action: "fix",
            dryRun: dryRunMode,
            result: {
              moved: [],
              errors: [],
              skipped: [],
            },
            message: "No structure violations to fix. All files are in correct locations.",
          },
          null,
          2
        );
      }

      const result = await fixViolations(violations, dryRunMode, reportTitle);

      return JSON.stringify(
        {
          success: result.errors.length === 0,
          action: "fix",
          dryRun: dryRunMode,
          result,
          summary: {
            totalFixed: result.moved.length,
            totalErrors: result.errors.length,
            totalSkipped: result.skipped.length,
          },
          message: dryRunMode
            ? `Dry run complete: ${result.moved.length} files would be moved`
            : `Fix complete: ${result.moved.length} files moved, ${result.errors.length} errors, ${result.skipped.length} skipped`,
          warning:
            result.skipped.length > 0
              ? "Some violations require manual intervention or migration-tool. See 'skipped' array for details."
              : undefined,
        },
        null,
        2
      );
    }

    case "validate": {
      const { valid, issues } = await validateStructure(reportTitle);

      return JSON.stringify(
        {
          success: true,
          action: "validate",
          valid,
          issues,
          projectRoot: detectProjectRoot(),
          reportTitle: reportTitle || null,
          message: valid
            ? reportTitle
              ? `Structure is valid for report '${reportTitle}'.`
              : "Project structure is valid. All files are in correct locations."
            : `Found ${issues.length} structure issues.`,
        },
        null,
        2
      );
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
