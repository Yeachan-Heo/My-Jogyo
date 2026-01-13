/**
 * Research Manager MCP Tool - Manage Gyoshu research projects via MCP.
 *
 * This is the MCP-compatible version of the research-manager tool.
 * Provides the same functionality as the OpenCode plugin version.
 *
 * @module mcp/tools/research-manager
 */

import * as fs from "fs/promises";
import * as path from "path";
import { durableAtomicWrite, fileExists, readFile, readFileNoFollow } from "../../lib/atomic-write.js";
import {
  getResearchDir,
  getResearchPath,
  getResearchManifestPath,
  getRunPath,
  getResearchNotebooksDir,
  getResearchArtifactsDir,
  getNotebookRootDir,
  getReportsRootDir,
  getReportDir,
  getNotebookPath,
  ensureDirSync,
  validatePathSegment,
} from "../../lib/paths.js";
import { isPathContainedIn } from "../../lib/path-security.js";
import {
  extractFrontmatter,
  GyoshuFrontmatter,
  ensureFrontmatterCell,
  updateFrontmatter,
  ResearchStatus,
} from "../../lib/notebook-frontmatter.js";
import { generateReport } from "../../lib/report-markdown.js";
import { exportReportToPdf, detectAvailableConverters } from "../../lib/pdf-export.js";
import { createInitialState, saveState as saveAutoLoopState, loadState as loadAutoLoopState } from "../../lib/auto-loop-state.js";
import type { Notebook, NotebookCell } from "../../lib/cell-identity.js";

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

type RunMode = "PLANNER" | "AUTO" | "REPL";
type RunStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED" | "ABORTED" | "FAILED";

interface RunSummary {
  runId: string;
  startedAt: string;
  endedAt?: string;
  mode: RunMode;
  goal: string;
  status: RunStatus;
  notebookPath: string;
  artifactsDir: string;
}

interface KeyResult {
  type: "finding" | "metric" | "conclusion" | "observation";
  name?: string;
  text: string;
  value?: string;
}

interface Artifact {
  path: string;
  type: string;
  createdAt: string;
}

interface ExecutionLogEntry {
  timestamp: string;
  event: string;
  details?: unknown;
}

interface RunDetail {
  schemaVersion: 1;
  runId: string;
  researchId: string;
  keyResults: KeyResult[];
  artifacts: Artifact[];
  sessionId?: string;
  contextBundle?: unknown;
  executionLog?: ExecutionLogEntry[];
}

interface DerivedFromEntry {
  researchId: string;
  note?: string;
}

interface ResearchSummaries {
  executive: string;
  methods: string[];
  pitfalls: string[];
}

interface ResearchManifest {
  schemaVersion: 1;
  researchId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: ResearchStatus;
  tags: string[];
  parentResearchId?: string;
  derivedFrom?: DerivedFromEntry[];
  runs: RunSummary[];
  summaries: ResearchSummaries;
}

interface SearchResult {
  researchId: string;
  title: string;
  status: ResearchStatus;
  score: number;
  matchedFields: string[];
  snippet: string;
}

interface NotebookResearchItem {
  reportTitle: string;
  title: string;
  status: ResearchStatus;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  tags: string[];
  notebookPath: string;
}

// =============================================================================
// MCP TOOL DEFINITION
// =============================================================================

export const researchManagerTool = {
  name: "research_manager",
  description:
    "Manage Gyoshu research projects with notebook-centric storage. " +
    "Research metadata is stored in notebook YAML frontmatter (source of truth). " +
    "Notebooks organized by workspace with mirrored outputs directory. " +
    "Legacy research.json format supported for migration only.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "create",
          "get",
          "list",
          "update",
          "delete",
          "addRun",
          "getRun",
          "updateRun",
          "search",
          "report",
          "export-pdf",
          "activate-auto",
          "deactivate-auto",
        ],
        description: "Operation to perform on research or runs",
      },
      researchId: {
        type: "string",
        description: "Unique research identifier (legacy mode, required for run operations)",
      },
      runId: {
        type: "string",
        description: "Unique run identifier (required for run-specific actions)",
      },
      reportTitle: {
        type: "string",
        description:
          "Notebook basename without .ipynb (e.g., 'churn-prediction'). Used for notebook-based operations.",
      },
      title: {
        type: "string",
        description: "Human-readable title for the research (optional, defaults to reportTitle)",
      },
      goal: {
        type: "string",
        description: "Research goal or objective (optional, added as markdown cell)",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Tags for categorization (e.g., ['ml', 'classification'])",
      },
      status: {
        type: "string",
        enum: ["active", "completed", "archived"],
        description: "Research status for update action",
      },
      query: {
        type: "string",
        description: "Search query for action=search",
      },
      data: {
        type: "object",
        description:
          "Data for create/update operations. For research: title, status, tags, summaries. For runs: goal, mode, keyResults, artifacts, sessionId, executionLog, status, endedAt.",
      },
    },
    required: ["action"],
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generateReportTitle(slug: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const timestamp = `${year}${month}${day}-${hours}${minutes}${seconds}`;
  const randomId = Math.random().toString(36).substring(2, 8);
  const sanitizedSlug = slug
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${timestamp}-${randomId}-${sanitizedSlug}`;
}

function isPrefixedReportTitle(reportTitle: string): boolean {
  const pattern = /^\d{8}-\d{6}-[a-z0-9]{6}-.+$/;
  return pattern.test(reportTitle);
}

function createDefaultManifest(
  researchId: string,
  data?: Partial<ResearchManifest>
): ResearchManifest {
  const now = new Date().toISOString();
  const base: ResearchManifest = {
    schemaVersion: 1,
    researchId,
    title: researchId,
    createdAt: now,
    updatedAt: now,
    status: "active",
    tags: [],
    runs: [],
    summaries: {
      executive: "",
      methods: [],
      pitfalls: [],
    },
  };

  if (data) {
    if (data.title !== undefined) base.title = data.title;
    if (data.status !== undefined) base.status = data.status;
    if (data.tags !== undefined) base.tags = data.tags;
    if (data.parentResearchId !== undefined) base.parentResearchId = data.parentResearchId;
    if (data.derivedFrom !== undefined) base.derivedFrom = data.derivedFrom;
    if (data.runs !== undefined) base.runs = data.runs;
    if (data.summaries !== undefined) base.summaries = data.summaries;
    if (data.createdAt !== undefined) base.createdAt = data.createdAt;
  }

  return base;
}

function createDefaultRunSummary(
  runId: string,
  goal: string,
  mode: RunMode = "REPL"
): RunSummary {
  const now = new Date().toISOString();
  return {
    runId,
    startedAt: now,
    mode,
    goal,
    status: "PENDING",
    notebookPath: `notebooks/${runId}.ipynb`,
    artifactsDir: `artifacts/${runId}/`,
  };
}

function createDefaultRunDetail(
  researchId: string,
  runId: string,
  data?: Partial<RunDetail>
): RunDetail {
  const base: RunDetail = {
    schemaVersion: 1,
    runId,
    researchId,
    keyResults: [],
    artifacts: [],
    executionLog: [],
  };

  if (data) {
    if (data.keyResults !== undefined) base.keyResults = data.keyResults;
    if (data.artifacts !== undefined) base.artifacts = data.artifacts;
    if (data.sessionId !== undefined) base.sessionId = data.sessionId;
    if (data.contextBundle !== undefined) base.contextBundle = data.contextBundle;
    if (data.executionLog !== undefined) base.executionLog = data.executionLog;
  }

  return base;
}

function normalizeQuery(query: string): string {
  return query.toLowerCase().trim();
}

function containsIgnoreCase(text: string | undefined, query: string): boolean {
  if (!text) return false;
  return text.toLowerCase().includes(query);
}

function calculateScore(manifest: ResearchManifest, query: string): number {
  const normalizedQuery = normalizeQuery(query);
  let score = 0;
  if (containsIgnoreCase(manifest.title, normalizedQuery)) {
    score += 3;
  }
  for (const run of manifest.runs) {
    if (containsIgnoreCase(run.goal, normalizedQuery)) {
      score += 2;
      break;
    }
  }
  for (const tag of manifest.tags) {
    if (containsIgnoreCase(tag, normalizedQuery)) {
      score += 1;
    }
  }
  if (containsIgnoreCase(manifest.status, normalizedQuery)) {
    score += 1;
  }
  return score;
}

function getMatchedFields(manifest: ResearchManifest, query: string): string[] {
  const normalizedQuery = normalizeQuery(query);
  const matched: string[] = [];
  if (containsIgnoreCase(manifest.title, normalizedQuery)) {
    matched.push("title");
  }
  for (const run of manifest.runs) {
    if (containsIgnoreCase(run.goal, normalizedQuery)) {
      matched.push("goal");
      break;
    }
  }
  for (const tag of manifest.tags) {
    if (containsIgnoreCase(tag, normalizedQuery)) {
      matched.push("tags");
      break;
    }
  }
  if (containsIgnoreCase(manifest.status, normalizedQuery)) {
    matched.push("status");
  }
  return matched;
}

function getSnippet(manifest: ResearchManifest, query: string): string {
  const normalizedQuery = normalizeQuery(query);
  if (containsIgnoreCase(manifest.title, normalizedQuery)) {
    return `Title: ${manifest.title}`;
  }
  for (const run of manifest.runs) {
    if (containsIgnoreCase(run.goal, normalizedQuery)) {
      const goal = run.goal;
      const maxLength = 100;
      return goal.length > maxLength ? `Goal: ${goal.substring(0, maxLength)}...` : `Goal: ${goal}`;
    }
  }
  for (const tag of manifest.tags) {
    if (containsIgnoreCase(tag, normalizedQuery)) {
      return `Tag: ${tag}`;
    }
  }
  if (containsIgnoreCase(manifest.status, normalizedQuery)) {
    return `Status: ${manifest.status}`;
  }
  return "";
}

async function loadNotebook(notebookPath: string): Promise<Notebook | null> {
  try {
    const content = await readFileNoFollow(notebookPath);
    return JSON.parse(content) as Notebook;
  } catch {
    return null;
  }
}

async function listResearchFromNotebooks(): Promise<NotebookResearchItem[]> {
  const notebookRoot = getNotebookRootDir();
  const results: NotebookResearchItem[] = [];

  if (!(await fileExists(notebookRoot))) {
    return results;
  }

  let files: string[];
  try {
    files = await fs.readdir(notebookRoot);
  } catch {
    return results;
  }

  for (const file of files) {
    if (!file.endsWith(".ipynb")) continue;

    const notebookPath = path.join(notebookRoot, file);
    const notebook = await loadNotebook(notebookPath);

    if (!notebook) continue;

    const frontmatter = extractFrontmatter(notebook);

    if (!frontmatter) continue;

    const reportTitle = file.replace(".ipynb", "");

    const researchItem: NotebookResearchItem = {
      reportTitle,
      title: frontmatter.slug || reportTitle,
      status: frontmatter.status,
      createdAt: frontmatter.created,
      updatedAt: frontmatter.updated,
      runCount: frontmatter.runs?.length ?? 0,
      tags: frontmatter.tags,
      notebookPath: path.relative(process.cwd(), notebookPath),
    };

    results.push(researchItem);
  }

  results.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return results;
}

function createEmptyNotebook(): Notebook {
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
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

function createMarkdownCell(content: string): NotebookCell {
  const id = `md-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    cell_type: "markdown",
    id,
    source: content.split("\n").map((line, i, arr) =>
      i < arr.length - 1 ? line + "\n" : line
    ),
    metadata: {},
  };
}

async function writeNotebook(notebookPath: string, notebook: Notebook): Promise<void> {
  await durableAtomicWrite(notebookPath, JSON.stringify(notebook, null, 2));
}

// =============================================================================
// MCP HANDLER
// =============================================================================

interface ResearchManagerArgs {
  action: string;
  researchId?: string;
  runId?: string;
  reportTitle?: string;
  title?: string;
  goal?: string;
  tags?: string[];
  status?: ResearchStatus;
  query?: string;
  data?: Record<string, unknown>;
}

export async function handleResearchManager(args: unknown): Promise<string> {
  const typedArgs = args as ResearchManagerArgs;
  const { action } = typedArgs;

  switch (action) {
    // =========================================================================
    // RESEARCH CRUD OPERATIONS
    // =========================================================================

    case "create": {
      const { reportTitle: inputTitle, title, goal, tags } = typedArgs;

      if (inputTitle) {
        const reportTitle = isPrefixedReportTitle(inputTitle)
          ? inputTitle
          : generateReportTitle(inputTitle);

        validatePathSegment(reportTitle, "reportTitle");

        const notebookPath = getNotebookPath(reportTitle);
        const reportDir = getReportDir(reportTitle);

        if (await fileExists(notebookPath)) {
          throw new Error(
            `Research '${reportTitle}' already exists. Use 'update' to modify.`
          );
        }

        ensureDirSync(getNotebookRootDir());
        ensureDirSync(reportDir);

        const now = new Date().toISOString();
        const frontmatter: GyoshuFrontmatter = {
          schema_version: 1,
          reportTitle: reportTitle,
          status: "active",
          created: now,
          updated: now,
          tags: tags || [],
          outputs_dir: path.relative(process.cwd(), reportDir),
          runs: [],
        };

        let notebook = ensureFrontmatterCell(createEmptyNotebook(), frontmatter);

        if (title || goal) {
          const mdContent = `# ${title || reportTitle}\n\n${goal || ""}`;
          const mdCell = createMarkdownCell(mdContent);
          notebook.cells.push(mdCell);
        }

        await writeNotebook(notebookPath, notebook);

        return JSON.stringify(
          {
            success: true,
            action: "create",
            mode: "notebook",
            reportTitle,
            notebookPath: path.relative(process.cwd(), notebookPath),
            reportDir: path.relative(process.cwd(), reportDir),
          },
          null,
          2
        );
      }

      if (!typedArgs.researchId) {
        throw new Error("reportTitle or researchId is required for create action");
      }
      validatePathSegment(typedArgs.researchId, "researchId");

      const manifestPath = getResearchManifestPath(typedArgs.researchId);

      if (await fileExists(manifestPath)) {
        throw new Error(
          `Research '${typedArgs.researchId}' already exists. Use 'update' to modify existing research.`
        );
      }

      const manifest = createDefaultManifest(
        typedArgs.researchId,
        typedArgs.data as Partial<ResearchManifest>
      );

      await durableAtomicWrite(manifestPath, JSON.stringify(manifest, null, 2));

      return JSON.stringify(
        {
          success: true,
          action: "create",
          mode: "legacy",
          researchId: typedArgs.researchId,
          manifest,
          deprecated: true,
          migrationHint:
            "Use reportTitle parameter for notebook-centric storage. Run /gyoshu migrate --to-notebooks to convert.",
        },
        null,
        2
      );
    }

    case "get": {
      if (!typedArgs.researchId) {
        throw new Error("researchId is required for get action");
      }
      validatePathSegment(typedArgs.researchId, "researchId");

      const manifestPath = getResearchManifestPath(typedArgs.researchId);

      if (!(await fileExists(manifestPath))) {
        throw new Error(`Research '${typedArgs.researchId}' not found`);
      }

      const manifest = await readFile<ResearchManifest>(manifestPath, true);

      return JSON.stringify(
        {
          success: true,
          action: "get",
          researchId: typedArgs.researchId,
          manifest,
        },
        null,
        2
      );
    }

    case "list": {
      const filterData = typedArgs.data as { status?: ResearchStatus; tags?: string[] } | undefined;
      const filterStatus = filterData?.status;
      const filterTags = filterData?.tags;

      const notebookResearch = await listResearchFromNotebooks();

      if (notebookResearch.length > 0) {
        let filtered = notebookResearch;

        if (filterStatus) {
          filtered = filtered.filter((r) => r.status === filterStatus);
        }
        if (filterTags && filterTags.length > 0) {
          filtered = filtered.filter((r) => filterTags.some((t) => r.tags.includes(t)));
        }

        return JSON.stringify(
          {
            success: true,
            action: "list",
            source: "notebooks",
            researches: filtered,
            count: filtered.length,
          },
          null,
          2
        );
      }

      const legacyResearches: Array<{
        researchId: string;
        title: string;
        status: ResearchStatus;
        createdAt: string;
        updatedAt: string;
        runCount: number;
        tags: string[];
      }> = [];

      const researchDir = getResearchDir();
      let entries: Array<{ name: string; isDirectory: () => boolean }>;

      try {
        entries = await fs.readdir(researchDir, { withFileTypes: true });
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return JSON.stringify(
            {
              success: true,
              action: "list",
              source: "legacy",
              researches: [],
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

        const manifestPath = getResearchManifestPath(entry.name);
        const manifest = await readFile<ResearchManifest>(manifestPath, true).catch(
          () => null
        );
        if (!manifest) continue;

        legacyResearches.push({
          researchId: manifest.researchId,
          title: manifest.title,
          status: manifest.status,
          createdAt: manifest.createdAt,
          updatedAt: manifest.updatedAt,
          runCount: manifest.runs.length,
          tags: manifest.tags,
        });
      }

      legacyResearches.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      let filteredLegacy = legacyResearches;
      if (filterStatus) {
        filteredLegacy = filteredLegacy.filter((r) => r.status === filterStatus);
      }
      if (filterTags && filterTags.length > 0) {
        filteredLegacy = filteredLegacy.filter((r) =>
          filterTags.some((t) => r.tags.includes(t))
        );
      }

      return JSON.stringify(
        {
          success: true,
          action: "list",
          source: "legacy",
          researches: filteredLegacy,
          count: filteredLegacy.length,
        },
        null,
        2
      );
    }

    case "update": {
      const { reportTitle, status, tags } = typedArgs;

      if (reportTitle) {
        validatePathSegment(reportTitle, "reportTitle");

        const notebookPath = getNotebookPath(reportTitle);

        if (!(await fileExists(notebookPath))) {
          throw new Error(`Notebook not found: ${notebookPath}`);
        }

        const notebook = await loadNotebook(notebookPath);
        if (!notebook) {
          throw new Error(`Failed to load notebook: ${notebookPath}`);
        }

        const updates: Partial<GyoshuFrontmatter> = {};
        if (status) updates.status = status;
        if (tags) updates.tags = tags;
        updates.updated = new Date().toISOString();

        const updatedNotebook = updateFrontmatter(notebook, updates);
        await writeNotebook(notebookPath, updatedNotebook);

        return JSON.stringify(
          {
            success: true,
            action: "update",
            mode: "notebook",
            reportTitle,
            updated: updates,
          },
          null,
          2
        );
      }

      if (!typedArgs.researchId) {
        throw new Error("reportTitle or researchId is required for update action");
      }
      validatePathSegment(typedArgs.researchId, "researchId");

      const manifestPath = getResearchManifestPath(typedArgs.researchId);

      if (!(await fileExists(manifestPath))) {
        throw new Error(`Research '${typedArgs.researchId}' not found. Use 'create' first.`);
      }

      const existing = await readFile<ResearchManifest>(manifestPath, true);
      const updateData = typedArgs.data as Partial<ResearchManifest> | undefined;

      const updated: ResearchManifest = {
        ...existing,
        ...updateData,
        updatedAt: new Date().toISOString(),
        schemaVersion: 1,
        researchId: existing.researchId,
        createdAt: existing.createdAt,
      };

      if (updateData?.tags) {
        updated.tags = Array.from(new Set([...existing.tags, ...updateData.tags]));
      }

      if (updateData?.derivedFrom) {
        updated.derivedFrom = [...(existing.derivedFrom ?? []), ...updateData.derivedFrom];
      }

      if (updateData?.summaries) {
        updated.summaries = {
          executive: updateData.summaries.executive ?? existing.summaries.executive,
          methods: Array.from(
            new Set([...existing.summaries.methods, ...(updateData.summaries.methods ?? [])])
          ),
          pitfalls: Array.from(
            new Set([...existing.summaries.pitfalls, ...(updateData.summaries.pitfalls ?? [])])
          ),
        };
      }

      updated.runs = existing.runs;

      await durableAtomicWrite(manifestPath, JSON.stringify(updated, null, 2));

      return JSON.stringify(
        {
          success: true,
          action: "update",
          mode: "legacy",
          researchId: typedArgs.researchId,
          manifest: updated,
        },
        null,
        2
      );
    }

    case "delete": {
      if (!typedArgs.researchId) {
        throw new Error("researchId is required for delete action");
      }
      validatePathSegment(typedArgs.researchId, "researchId");

      const researchPath = getResearchPath(typedArgs.researchId);

      if (!(await fileExists(researchPath))) {
        throw new Error(`Research '${typedArgs.researchId}' not found`);
      }

      if (!isPathContainedIn(researchPath, getResearchDir(), { useRealpath: true })) {
        throw new Error(`Security: ${researchPath} escapes containment`);
      }

      await fs.rm(researchPath, { recursive: true, force: true });

      return JSON.stringify(
        {
          success: true,
          action: "delete",
          researchId: typedArgs.researchId,
          message: `Research '${typedArgs.researchId}' and all associated data deleted`,
        },
        null,
        2
      );
    }

    // =========================================================================
    // RUN OPERATIONS
    // =========================================================================

    case "addRun": {
      if (!typedArgs.researchId) {
        throw new Error("researchId is required for addRun action");
      }
      if (!typedArgs.runId) {
        throw new Error("runId is required for addRun action");
      }
      validatePathSegment(typedArgs.researchId, "researchId");
      validatePathSegment(typedArgs.runId, "runId");

      const manifestPath = getResearchManifestPath(typedArgs.researchId);
      const runDetailPath = getRunPath(typedArgs.researchId, typedArgs.runId);

      if (!(await fileExists(manifestPath))) {
        throw new Error(`Research '${typedArgs.researchId}' not found. Create it first.`);
      }

      if (await fileExists(runDetailPath)) {
        throw new Error(
          `Run '${typedArgs.runId}' already exists in research '${typedArgs.researchId}'. Use 'updateRun' to modify.`
        );
      }

      const manifest = await readFile<ResearchManifest>(manifestPath, true);
      const runData = typedArgs.data as Partial<RunSummary & RunDetail> | undefined;

      const runSummary = createDefaultRunSummary(
        typedArgs.runId,
        runData?.goal ?? "",
        runData?.mode ?? "REPL"
      );

      if (runData?.startedAt) runSummary.startedAt = runData.startedAt;
      if (runData?.status) runSummary.status = runData.status;
      if (runData?.endedAt) runSummary.endedAt = runData.endedAt;

      const runDetail = createDefaultRunDetail(typedArgs.researchId, typedArgs.runId, {
        keyResults: runData?.keyResults,
        artifacts: runData?.artifacts,
        sessionId: runData?.sessionId,
        contextBundle: runData?.contextBundle,
        executionLog: runData?.executionLog,
      });

      manifest.runs.push(runSummary);
      manifest.updatedAt = new Date().toISOString();

      await durableAtomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
      await durableAtomicWrite(runDetailPath, JSON.stringify(runDetail, null, 2));

      return JSON.stringify(
        {
          success: true,
          action: "addRun",
          researchId: typedArgs.researchId,
          runId: typedArgs.runId,
          runSummary,
          runDetail,
          notebookPath: path.join(
            getResearchNotebooksDir(typedArgs.researchId),
            `${typedArgs.runId}.ipynb`
          ),
          artifactsDir: path.join(getResearchArtifactsDir(typedArgs.researchId), typedArgs.runId),
        },
        null,
        2
      );
    }

    case "getRun": {
      if (!typedArgs.researchId) {
        throw new Error("researchId is required for getRun action");
      }
      if (!typedArgs.runId) {
        throw new Error("runId is required for getRun action");
      }
      validatePathSegment(typedArgs.researchId, "researchId");
      validatePathSegment(typedArgs.runId, "runId");

      const manifestPath = getResearchManifestPath(typedArgs.researchId);
      const runDetailPath = getRunPath(typedArgs.researchId, typedArgs.runId);

      if (!(await fileExists(manifestPath))) {
        throw new Error(`Research '${typedArgs.researchId}' not found`);
      }

      if (!(await fileExists(runDetailPath))) {
        throw new Error(`Run '${typedArgs.runId}' not found in research '${typedArgs.researchId}'`);
      }

      const manifest = await readFile<ResearchManifest>(manifestPath, true);
      const runDetail = await readFile<RunDetail>(runDetailPath, true);

      const runSummary = manifest.runs.find((r) => r.runId === typedArgs.runId);

      return JSON.stringify(
        {
          success: true,
          action: "getRun",
          researchId: typedArgs.researchId,
          runId: typedArgs.runId,
          runSummary,
          runDetail,
          notebookPath: path.join(
            getResearchNotebooksDir(typedArgs.researchId),
            `${typedArgs.runId}.ipynb`
          ),
          artifactsDir: path.join(getResearchArtifactsDir(typedArgs.researchId), typedArgs.runId),
        },
        null,
        2
      );
    }

    case "updateRun": {
      if (!typedArgs.researchId) {
        throw new Error("researchId is required for updateRun action");
      }
      if (!typedArgs.runId) {
        throw new Error("runId is required for updateRun action");
      }
      validatePathSegment(typedArgs.researchId, "researchId");
      validatePathSegment(typedArgs.runId, "runId");

      const manifestPath = getResearchManifestPath(typedArgs.researchId);
      const runDetailPath = getRunPath(typedArgs.researchId, typedArgs.runId);

      if (!(await fileExists(manifestPath))) {
        throw new Error(`Research '${typedArgs.researchId}' not found`);
      }

      if (!(await fileExists(runDetailPath))) {
        throw new Error(`Run '${typedArgs.runId}' not found in research '${typedArgs.researchId}'`);
      }

      const manifest = await readFile<ResearchManifest>(manifestPath, true);
      const existingDetail = await readFile<RunDetail>(runDetailPath, true);
      const updateData = typedArgs.data as Partial<RunSummary & RunDetail> | undefined;

      const runIndex = manifest.runs.findIndex((r) => r.runId === typedArgs.runId);
      if (runIndex === -1) {
        throw new Error(
          `Run '${typedArgs.runId}' not found in manifest. Data inconsistency detected.`
        );
      }

      const runSummary = manifest.runs[runIndex];

      if (updateData?.goal !== undefined) runSummary.goal = updateData.goal;
      if (updateData?.mode !== undefined) runSummary.mode = updateData.mode;
      if (updateData?.status !== undefined) runSummary.status = updateData.status;
      if (updateData?.endedAt !== undefined) runSummary.endedAt = updateData.endedAt;
      if (updateData?.startedAt !== undefined) runSummary.startedAt = updateData.startedAt;

      manifest.runs[runIndex] = runSummary;
      manifest.updatedAt = new Date().toISOString();

      const updatedDetail: RunDetail = {
        ...existingDetail,
        ...updateData,
        schemaVersion: 1,
        runId: existingDetail.runId,
        researchId: existingDetail.researchId,
      };

      if (updateData?.keyResults) {
        updatedDetail.keyResults = [...existingDetail.keyResults, ...updateData.keyResults];
      }

      if (updateData?.artifacts) {
        updatedDetail.artifacts = [...existingDetail.artifacts, ...updateData.artifacts];
      }

      if (updateData?.executionLog) {
        updatedDetail.executionLog = [
          ...(existingDetail.executionLog ?? []),
          ...updateData.executionLog,
        ];
      }

      await durableAtomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
      await durableAtomicWrite(runDetailPath, JSON.stringify(updatedDetail, null, 2));

      return JSON.stringify(
        {
          success: true,
          action: "updateRun",
          researchId: typedArgs.researchId,
          runId: typedArgs.runId,
          runSummary,
          runDetail: updatedDetail,
        },
        null,
        2
      );
    }

    // =========================================================================
    // SEARCH OPERATIONS
    // =========================================================================

    case "search": {
      const query = typedArgs.query || (typedArgs.data?.query as string);
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        throw new Error("query is required for search action");
      }

      const researchDir = getResearchDir();
      let entries: Array<{ name: string; isDirectory: () => boolean }>;

      try {
        entries = await fs.readdir(researchDir, { withFileTypes: true });
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return JSON.stringify(
            {
              success: true,
              action: "search",
              query: query,
              results: [],
              count: 0,
            },
            null,
            2
          );
        }
        throw err;
      }

      const results: SearchResult[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const manifestPath = getResearchManifestPath(entry.name);
        const manifest = await readFile<ResearchManifest>(manifestPath, true).catch(() => null);
        if (!manifest) continue;

        const score = calculateScore(manifest, query);
        if (score <= 0) continue;

        results.push({
          researchId: manifest.researchId,
          title: manifest.title,
          status: manifest.status,
          score,
          matchedFields: getMatchedFields(manifest, query),
          snippet: getSnippet(manifest, query),
        });
      }

      results.sort((a, b) => b.score - a.score);

      return JSON.stringify(
        {
          success: true,
          action: "search",
          query: query,
          results,
          count: results.length,
        },
        null,
        2
      );
    }

    // =========================================================================
    // REPORT OPERATIONS
    // =========================================================================

    case "report": {
      const { reportTitle } = typedArgs;

      if (!reportTitle) {
        throw new Error("reportTitle is required for report action");
      }

      validatePathSegment(reportTitle, "reportTitle");

      const { reportPath, model } = await generateReport(reportTitle);

      return JSON.stringify(
        {
          success: true,
          action: "report",
          reportTitle,
          reportPath: path.relative(process.cwd(), reportPath),
          sectionsGenerated: {
            objective: !!model.objective,
            hypotheses: model.hypotheses.length,
            metrics: model.metrics.length,
            findings: model.findings.length,
            artifacts: model.artifacts.length,
            conclusion: !!model.conclusion,
          },
        },
        null,
        2
      );
    }

    case "export-pdf": {
      const { reportTitle } = typedArgs;

      if (!reportTitle) {
        throw new Error("reportTitle is required for export-pdf action");
      }

      validatePathSegment(reportTitle, "reportTitle");

      const result = await exportReportToPdf(reportTitle);

      if (!result.success) {
        const availableConverters = await detectAvailableConverters();
        return JSON.stringify(
          {
            success: false,
            action: "export-pdf",
            error: result.error,
            installHint: result.installHint,
            availableConverters,
          },
          null,
          2
        );
      }

      return JSON.stringify(
        {
          success: true,
          action: "export-pdf",
          reportTitle,
          pdfPath: path.relative(process.cwd(), result.pdfPath!),
          converter: result.converter,
        },
        null,
        2
      );
    }

    // =========================================================================
    // AUTO-LOOP OPERATIONS
    // =========================================================================

    case "activate-auto": {
      const { reportTitle } = typedArgs;
      const data = typedArgs.data as {
        researchSessionID: string;
        runId: string;
        maxIterations?: number;
        maxAttempts?: number;
        maxCycles?: number;
        maxToolCalls?: number;
        maxTimeMinutes?: number;
      } | undefined;

      if (!reportTitle) {
        throw new Error("reportTitle is required for activate-auto action");
      }
      if (!data?.researchSessionID) {
        throw new Error("data.researchSessionID is required for activate-auto action");
      }
      if (!data?.runId) {
        throw new Error("data.runId is required for activate-auto action");
      }

      validatePathSegment(reportTitle, "reportTitle");

      const existingState = await loadAutoLoopState(reportTitle);
      if (existingState?.active) {
        throw new Error(
          `Auto-loop already active for '${reportTitle}'. Use 'deactivate-auto' first.`
        );
      }

      const state = createInitialState(reportTitle, data.researchSessionID, data.runId, {
        maxIterations: data.maxIterations,
        maxAttempts: data.maxAttempts,
        maxCycles: data.maxCycles,
        maxToolCalls: data.maxToolCalls,
        maxTimeMinutes: data.maxTimeMinutes,
      });

      await saveAutoLoopState(state);

      return JSON.stringify(
        {
          success: true,
          action: "activate-auto",
          reportTitle,
          state: {
            active: state.active,
            iteration: state.iteration,
            maxIterations: state.maxIterations,
            budgets: state.budgets,
            attemptNumber: state.attemptNumber,
            maxAttempts: state.maxAttempts,
          },
          statePath: `reports/${reportTitle}/auto/loop-state.json`,
        },
        null,
        2
      );
    }

    case "deactivate-auto": {
      const { reportTitle } = typedArgs;

      if (!reportTitle) {
        throw new Error("reportTitle is required for deactivate-auto action");
      }

      validatePathSegment(reportTitle, "reportTitle");

      const existingState = await loadAutoLoopState(reportTitle);
      if (!existingState) {
        return JSON.stringify(
          {
            success: true,
            action: "deactivate-auto",
            reportTitle,
            message: "No auto-loop state found (already inactive)",
          },
          null,
          2
        );
      }

      existingState.active = false;
      await saveAutoLoopState(existingState);

      return JSON.stringify(
        {
          success: true,
          action: "deactivate-auto",
          reportTitle,
          message: "Auto-loop deactivated",
          finalState: {
            active: existingState.active,
            iteration: existingState.iteration,
            lastDecision: existingState.lastDecision,
            budgets: existingState.budgets,
          },
        },
        null,
        2
      );
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
