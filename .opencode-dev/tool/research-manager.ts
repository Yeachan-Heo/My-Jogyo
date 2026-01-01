/**
 * Research Manager - OpenCode tool for managing Gyoshu research projects
 *
 * Implements flat notebook-centric architecture:
 * - Research metadata stored in notebook YAML frontmatter (source of truth)
 * - Notebooks organized flat: notebooks/{reportTitle}.ipynb
 * - Reports in: reports/{reportTitle}/
 * - Runtime in gyoshu/runtime/ (ephemeral, gitignored)
 *
 * Primary Storage Structure:
 * ```
 * ./notebooks/                       # Flat notebook storage
 * └── {reportTitle}.ipynb            # Self-describing with YAML frontmatter
 *
 * ./reports/{reportTitle}/           # Report outputs
 * ├── README.md                      # Generated research report
 * ├── figures/                       # Saved plots
 * └── exports/                       # Data exports (CSV, etc.)
 * ```
 *
 * Legacy Support (for migration only):
 * - Can read from ./gyoshu/research/{researchId}/research.json
 * - Use /gyoshu migrate --to-notebooks to convert legacy data
 *
 * @module research-manager
 */

import { tool } from "@opencode-ai/plugin";
import * as fs from "fs/promises";
import * as path from "path";
import { durableAtomicWrite, fileExists, readFile } from "../lib/atomic-write";
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
} from "../lib/paths";
import { 
  extractFrontmatter, 
  GyoshuFrontmatter,
  ensureFrontmatterCell,
  updateFrontmatter,
} from "../lib/notebook-frontmatter";
import { generateReport } from "../lib/report-markdown";
import { exportReportToPdf, detectAvailableConverters } from "../lib/pdf-export";
import type { Notebook, NotebookCell } from "../lib/cell-identity";

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/**
 * Research orchestration mode.
 * - PLANNER: Creating/refining research plan
 * - AUTO: Autonomous execution of plan
 * - REPL: Interactive exploration mode
 */
type RunMode = "PLANNER" | "AUTO" | "REPL";

/**
 * Status of a research run.
 */
type RunStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED" | "ABORTED" | "FAILED";

/**
 * Status of a research project.
 */
type ResearchStatus = "active" | "completed" | "archived";

/**
 * Summary of a run stored in the research manifest.
 * Contains lightweight metadata for fast listing.
 */
interface RunSummary {
  /** Unique identifier for this run */
  runId: string;
  /** ISO 8601 timestamp when run started */
  startedAt: string;
  /** ISO 8601 timestamp when run ended (optional) */
  endedAt?: string;
  /** Orchestration mode used for this run */
  mode: RunMode;
  /** Research goal for this run */
  goal: string;
  /** Current status of the run */
  status: RunStatus;
  /** Path to notebook relative to research directory: "notebooks/{runId}.ipynb" */
  notebookPath: string;
  /** Path to artifacts directory relative to research directory: "artifacts/{runId}/" */
  artifactsDir: string;
}

/**
 * Key result from a run.
 */
interface KeyResult {
  /** Type of result */
  type: "finding" | "metric" | "conclusion" | "observation";
  /** Optional name for the result */
  name?: string;
  /** Description or value as text */
  text: string;
  /** Optional numeric or string value */
  value?: string;
}

/**
 * Artifact produced during a run.
 */
interface Artifact {
  /** Path to artifact relative to run's artifact directory */
  path: string;
  /** Type of artifact (e.g., "plot", "csv", "model") */
  type: string;
  /** ISO 8601 timestamp when artifact was created */
  createdAt: string;
}

/**
 * Execution log entry.
 */
interface ExecutionLogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Event description */
  event: string;
  /** Optional additional details */
  details?: any;
}

/**
 * Full details of a run stored in runs/{runId}.json.
 * Contains execution details, results, and artifacts.
 */
interface RunDetail {
  /** Schema version for future migrations */
  schemaVersion: 1;
  /** Unique identifier for this run */
  runId: string;
  /** Parent research project ID */
  researchId: string;
  /** Key results from this run */
  keyResults: KeyResult[];
  /** Artifacts produced during this run */
  artifacts: Artifact[];
  /** Link to runtime session (if applicable) */
  sessionId?: string;
  /** Context bundle for future use */
  contextBundle?: any;
  /** Execution log entries */
  executionLog?: ExecutionLogEntry[];
}

/**
 * Lineage reference to another research project.
 */
interface DerivedFromEntry {
  /** ID of the source research project */
  researchId: string;
  /** Optional note about the relationship */
  note?: string;
}

/**
 * Rolling summaries for quick access.
 */
interface ResearchSummaries {
  /** Executive summary of the research */
  executive: string;
  /** Methods used */
  methods: string[];
  /** Known pitfalls and warnings */
  pitfalls: string[];
}

/**
 * Complete research manifest structure.
 * Stored as JSON in ./gyoshu/research/{researchId}/research.json
 */
interface ResearchManifest {
  /** Schema version for future migrations */
  schemaVersion: 1;
  /** Unique identifier for this research project */
  researchId: string;
  /** Title of the research project */
  title: string;
  /** ISO 8601 timestamp when research was created */
  createdAt: string;
  /** ISO 8601 timestamp when research was last updated */
  updatedAt: string;
  /** Current status of the research project */
  status: ResearchStatus;
  /** Tags for organization */
  tags: string[];
  /** Parent research project ID (for forked/derived research) */
  parentResearchId?: string;
  /** Research projects this was derived from */
  derivedFrom?: DerivedFromEntry[];
  /** Run summaries (details stored separately in runs/{runId}.json) */
  runs: RunSummary[];
  /** Rolling summaries for quick access */
  summaries: ResearchSummaries;
}

/**
 * Search result with ranked scoring.
 */
interface SearchResult {
  /** Research project ID */
  researchId: string;
  /** Title of the research */
  title: string;
  /** Current status */
  status: ResearchStatus;
  /** Relevance score (higher = more relevant) */
  score: number;
  /** Fields that matched the query */
  matchedFields: string[];
  /** Snippet of matched content */
  snippet: string;
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validates that an ID is safe to use in file paths.
 * Prevents directory traversal and other path injection attacks.
 *
 * @param id - The ID to validate
 * @param type - Type of ID for error messages ("researchId" or "runId")
 * @throws Error if ID is invalid
 */
function validateId(id: string, type: string): void {
  if (!id || typeof id !== "string") {
    throw new Error(`${type} is required and must be a string`);
  }

  // Prevent path traversal attacks
  if (id.includes("..") || id.includes("/") || id.includes("\\")) {
    throw new Error(`Invalid ${type}: contains path traversal characters`);
  }

  // Prevent empty or whitespace-only IDs
  if (id.trim().length === 0) {
    throw new Error(`Invalid ${type}: cannot be empty or whitespace`);
  }

  // Limit length to prevent filesystem issues
  if (id.length > 255) {
    throw new Error(`Invalid ${type}: exceeds maximum length of 255 characters`);
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Ensures the research directory exists.
 * Creates parent directories recursively if needed.
 */
function ensureResearchRootDir(): void {
  ensureDirSync(getResearchDir());
}

/**
 * Ensures all directories for a research project exist.
 *
 * @param researchId - The research project identifier
 */
async function ensureResearchDirs(researchId: string): Promise<void> {
  const researchPath = getResearchPath(researchId);
  const runsDir = path.join(researchPath, "runs");
  const notebooksDir = getResearchNotebooksDir(researchId);
  const artifactsDir = getResearchArtifactsDir(researchId);

  await fs.mkdir(researchPath, { recursive: true });
  await fs.mkdir(runsDir, { recursive: true });
  await fs.mkdir(notebooksDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });
}

/**
 * Ensures run-specific directories exist.
 *
 * @param researchId - The research project identifier
 * @param runId - The run identifier
 */
async function ensureRunDirs(researchId: string, runId: string): Promise<void> {
  const runArtifactsDir = path.join(getResearchArtifactsDir(researchId), runId);
  const plotsDir = path.join(runArtifactsDir, "plots");
  const exportsDir = path.join(runArtifactsDir, "exports");

  await fs.mkdir(runArtifactsDir, { recursive: true });
  await fs.mkdir(plotsDir, { recursive: true });
  await fs.mkdir(exportsDir, { recursive: true });
}

/**
 * Creates a default research manifest with default values.
 *
 * @param researchId - The research project identifier
 * @param data - Optional initial data to merge into the manifest
 * @returns A new ResearchManifest object
 */
function createDefaultManifest(
  researchId: string,
  data?: Partial<ResearchManifest>
): ResearchManifest {
  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    researchId,
    title: data?.title ?? researchId,
    createdAt: now,
    updatedAt: now,
    status: data?.status ?? "active",
    tags: data?.tags ?? [],
    parentResearchId: data?.parentResearchId,
    derivedFrom: data?.derivedFrom,
    runs: data?.runs ?? [],
    summaries: data?.summaries ?? {
      executive: "",
      methods: [],
      pitfalls: [],
    },
    ...data,
    // Ensure these are not overwritten
    schemaVersion: 1,
    researchId,
    createdAt: data?.createdAt ?? now,
  };
}

/**
 * Creates a default run summary.
 *
 * @param runId - The run identifier
 * @param goal - The research goal for this run
 * @param mode - The orchestration mode
 * @returns A new RunSummary object
 */
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

/**
 * Creates a default run detail.
 *
 * @param researchId - The research project identifier
 * @param runId - The run identifier
 * @param data - Optional initial data
 * @returns A new RunDetail object
 */
function createDefaultRunDetail(
  researchId: string,
  runId: string,
  data?: Partial<RunDetail>
): RunDetail {
  return {
    schemaVersion: 1,
    runId,
    researchId,
    keyResults: data?.keyResults ?? [],
    artifacts: data?.artifacts ?? [],
    sessionId: data?.sessionId,
    contextBundle: data?.contextBundle,
    executionLog: data?.executionLog ?? [],
    ...data,
    // Ensure these are not overwritten
    schemaVersion: 1,
    runId,
    researchId,
  };
}

// =============================================================================
// SEARCH HELPERS
// =============================================================================

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

// =============================================================================
// NOTEBOOK-BASED LISTING
// =============================================================================

/**
 * Result item from notebook-based listing.
 */
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

/**
 * Load a Jupyter notebook from disk.
 *
 * @param notebookPath - Path to the .ipynb file
 * @returns Parsed notebook or null if it cannot be loaded
 */
async function loadNotebook(notebookPath: string): Promise<Notebook | null> {
  try {
    const content = await fs.readFile(notebookPath, "utf-8");
    return JSON.parse(content) as Notebook;
  } catch {
    return null;
  }
}

/**
 * List research projects by scanning notebooks in flat notebooks/ directory.
 */
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

// =============================================================================
// NOTEBOOK CREATION HELPERS
// =============================================================================

/**
 * Create an empty Jupyter notebook structure.
 *
 * @returns A minimal notebook object ready to be populated
 */
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

/**
 * Create a markdown cell with the given content.
 *
 * @param content - Markdown content for the cell
 * @returns A markdown NotebookCell
 */
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

/**
 * Write a notebook to disk with atomic write.
 *
 * @param notebookPath - Path to write the notebook
 * @param notebook - The notebook object to write
 */
async function writeNotebook(notebookPath: string, notebook: Notebook): Promise<void> {
  await durableAtomicWrite(notebookPath, JSON.stringify(notebook, null, 2));
}



// =============================================================================
// TOOL EXPORT
// =============================================================================

export default tool({
  description:
    "Manage Gyoshu research projects with flat notebook-centric storage. " +
    "Research metadata is stored in notebook YAML frontmatter (source of truth). " +
    "Notebooks in notebooks/{reportTitle}.ipynb, reports in reports/{reportTitle}/. " +
    "Legacy research.json format supported for migration only.",
  args: {
    action: tool.schema
      .enum(["create", "get", "list", "update", "delete", "addRun", "getRun", "updateRun", "search", "report", "export-pdf"])
      .describe("Operation to perform on research or runs"),
    researchId: tool.schema
      .string()
      .optional()
      .describe("Unique research identifier (legacy mode, required for run operations)"),
    runId: tool.schema
      .string()
      .optional()
      .describe("Unique run identifier (required for run-specific actions)"),
    reportTitle: tool.schema
      .string()
      .optional()
      .describe("Notebook basename without .ipynb (e.g., 'churn-prediction'). Used for notebook-based operations."),
    title: tool.schema
      .string()
      .optional()
      .describe("Human-readable title for the research (optional, defaults to reportTitle)"),
    goal: tool.schema
      .string()
      .optional()
      .describe("Research goal or objective (optional, added as markdown cell)"),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Tags for categorization (e.g., ['ml', 'classification'])"),
    status: tool.schema
      .enum(["active", "completed", "archived"])
      .optional()
      .describe("Research status for update action"),
    data: tool.schema
      .any()
      .optional()
      .describe(
        "Data for create/update operations. For research: title, status, tags, summaries. " +
          "For runs: goal, mode, keyResults, artifacts, sessionId, executionLog, status, endedAt."
      ),
  },

  async execute(args) {
    ensureResearchRootDir();

    switch (args.action) {
      // =========================================================================
      // RESEARCH CRUD OPERATIONS
      // =========================================================================

      case "create": {
        const { reportTitle, title, goal, tags } = args;

        if (reportTitle) {
          validatePathSegment(reportTitle, "reportTitle");

          const notebookPath = getNotebookPath(reportTitle);
          const reportDir = getReportDir(reportTitle);

          if (await fileExists(notebookPath)) {
            throw new Error(
              `Research '${reportTitle}' already exists. Use 'update' to modify.`
            );
          }

          await fs.mkdir(getNotebookRootDir(), { recursive: true });
          await fs.mkdir(reportDir, { recursive: true });

          const now = new Date().toISOString();
          const frontmatter: GyoshuFrontmatter = {
            schema_version: 1,
            reportTitle: reportTitle,
            status: 'active',
            created: now,
            updated: now,
            tags: tags || [],
            outputs_dir: path.relative(process.cwd(), reportDir),
            runs: []
          };

          let notebook = ensureFrontmatterCell(createEmptyNotebook(), frontmatter);

          if (title || goal) {
            const mdContent = `# ${title || reportTitle}\n\n${goal || ''}`;
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
              reportDir: path.relative(process.cwd(), reportDir)
            },
            null,
            2
          );
        }

        if (!args.researchId) {
          throw new Error("reportTitle or researchId is required for create action");
        }
        validateId(args.researchId, "researchId");

        const manifestPath = getResearchManifestPath(args.researchId);

        if (await fileExists(manifestPath)) {
          throw new Error(
            `Research '${args.researchId}' already exists. Use 'update' to modify existing research.`
          );
        }

        await ensureResearchDirs(args.researchId);

        const manifest = createDefaultManifest(
          args.researchId,
          args.data as Partial<ResearchManifest>
        );

        await durableAtomicWrite(manifestPath, JSON.stringify(manifest, null, 2));

        return JSON.stringify(
          {
            success: true,
            action: "create",
            mode: "legacy",
            researchId: args.researchId,
            manifest,
            deprecated: true,
            migrationHint: "Use reportTitle parameter for notebook-centric storage. Run /gyoshu migrate --to-notebooks to convert.",
          },
          null,
          2
        );
      }

      case "get": {
        if (!args.researchId) {
          throw new Error("researchId is required for get action");
        }
        validateId(args.researchId, "researchId");

        const manifestPath = getResearchManifestPath(args.researchId);

        if (!(await fileExists(manifestPath))) {
          throw new Error(`Research '${args.researchId}' not found`);
        }

        const manifest = await readFile<ResearchManifest>(manifestPath, true);

        return JSON.stringify(
          {
            success: true,
            action: "get",
            researchId: args.researchId,
            manifest,
          },
          null,
          2
        );
      }

      case "list": {
        const filterData = args.data as { status?: ResearchStatus; tags?: string[] } | undefined;
        const filterStatus = filterData?.status;
        const filterTags = filterData?.tags;

        const notebookResearch = await listResearchFromNotebooks();

        if (notebookResearch.length > 0) {
          let filtered = notebookResearch;
          
          if (filterStatus) {
            filtered = filtered.filter(r => r.status === filterStatus);
          }
          if (filterTags && filterTags.length > 0) {
            filtered = filtered.filter(r => 
              filterTags.some(t => r.tags.includes(t))
            );
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
        } catch (err: any) {
          if (err.code === "ENOENT") {
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
          filteredLegacy = filteredLegacy.filter(r => r.status === filterStatus);
        }
        if (filterTags && filterTags.length > 0) {
          filteredLegacy = filteredLegacy.filter(r => 
            filterTags.some(t => r.tags.includes(t))
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
        const { reportTitle, status, tags } = args;

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
              updated: updates
            },
            null,
            2
          );
        }

        if (!args.researchId) {
          throw new Error("reportTitle or researchId is required for update action");
        }
        validateId(args.researchId, "researchId");

        const manifestPath = getResearchManifestPath(args.researchId);

        if (!(await fileExists(manifestPath))) {
          throw new Error(`Research '${args.researchId}' not found. Use 'create' first.`);
        }

        const existing = await readFile<ResearchManifest>(manifestPath, true);
        const updateData = args.data as Partial<ResearchManifest> | undefined;

        const updated: ResearchManifest = {
          ...existing,
          ...updateData,
          updatedAt: new Date().toISOString(),
          schemaVersion: 1,
          researchId: existing.researchId,
          createdAt: existing.createdAt,
        };

        if (updateData?.tags) {
          updated.tags = [...new Set([...existing.tags, ...updateData.tags])];
        }

        if (updateData?.derivedFrom) {
          updated.derivedFrom = [...(existing.derivedFrom ?? []), ...updateData.derivedFrom];
        }

        if (updateData?.summaries) {
          updated.summaries = {
            executive: updateData.summaries.executive ?? existing.summaries.executive,
            methods: [...new Set([...existing.summaries.methods, ...(updateData.summaries.methods ?? [])])],
            pitfalls: [...new Set([...existing.summaries.pitfalls, ...(updateData.summaries.pitfalls ?? [])])],
          };
        }

        updated.runs = existing.runs;

        await durableAtomicWrite(manifestPath, JSON.stringify(updated, null, 2));

        return JSON.stringify(
          {
            success: true,
            action: "update",
            mode: "legacy",
            researchId: args.researchId,
            manifest: updated,
          },
          null,
          2
        );
      }

      case "delete": {
        if (!args.researchId) {
          throw new Error("researchId is required for delete action");
        }
        validateId(args.researchId, "researchId");

        const researchPath = getResearchPath(args.researchId);

        if (!(await fileExists(researchPath))) {
          throw new Error(`Research '${args.researchId}' not found`);
        }

        await fs.rm(researchPath, { recursive: true, force: true });

        return JSON.stringify(
          {
            success: true,
            action: "delete",
            researchId: args.researchId,
            message: `Research '${args.researchId}' and all associated data deleted`,
          },
          null,
          2
        );
      }

      // =========================================================================
      // RUN OPERATIONS
      // =========================================================================

      case "addRun": {
        if (!args.researchId) {
          throw new Error("researchId is required for addRun action");
        }
        if (!args.runId) {
          throw new Error("runId is required for addRun action");
        }
        validateId(args.researchId, "researchId");
        validateId(args.runId, "runId");

        const manifestPath = getResearchManifestPath(args.researchId);
        const runDetailPath = getRunPath(args.researchId, args.runId);

        if (!(await fileExists(manifestPath))) {
          throw new Error(`Research '${args.researchId}' not found. Create it first.`);
        }

        if (await fileExists(runDetailPath)) {
          throw new Error(
            `Run '${args.runId}' already exists in research '${args.researchId}'. Use 'updateRun' to modify.`
          );
        }

        const manifest = await readFile<ResearchManifest>(manifestPath, true);
        const runData = args.data as Partial<RunSummary & RunDetail> | undefined;

        // Create run summary for manifest
        const runSummary = createDefaultRunSummary(
          args.runId,
          runData?.goal ?? "",
          runData?.mode ?? "REPL"
        );

        // Override with provided data
        if (runData?.startedAt) runSummary.startedAt = runData.startedAt;
        if (runData?.status) runSummary.status = runData.status;
        if (runData?.endedAt) runSummary.endedAt = runData.endedAt;

        // Create run detail
        const runDetail = createDefaultRunDetail(args.researchId, args.runId, {
          keyResults: runData?.keyResults,
          artifacts: runData?.artifacts,
          sessionId: runData?.sessionId,
          contextBundle: runData?.contextBundle,
          executionLog: runData?.executionLog,
        });

        // Update manifest with new run
        manifest.runs.push(runSummary);
        manifest.updatedAt = new Date().toISOString();

        // Ensure run directories exist
        await ensureRunDirs(args.researchId, args.runId);

        // Write both files atomically
        await durableAtomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
        await durableAtomicWrite(runDetailPath, JSON.stringify(runDetail, null, 2));

        return JSON.stringify(
          {
            success: true,
            action: "addRun",
            researchId: args.researchId,
            runId: args.runId,
            runSummary,
            runDetail,
            notebookPath: path.join(
              getResearchNotebooksDir(args.researchId),
              `${args.runId}.ipynb`
            ),
            artifactsDir: path.join(getResearchArtifactsDir(args.researchId), args.runId),
          },
          null,
          2
        );
      }

      case "getRun": {
        if (!args.researchId) {
          throw new Error("researchId is required for getRun action");
        }
        if (!args.runId) {
          throw new Error("runId is required for getRun action");
        }
        validateId(args.researchId, "researchId");
        validateId(args.runId, "runId");

        const manifestPath = getResearchManifestPath(args.researchId);
        const runDetailPath = getRunPath(args.researchId, args.runId);

        if (!(await fileExists(manifestPath))) {
          throw new Error(`Research '${args.researchId}' not found`);
        }

        if (!(await fileExists(runDetailPath))) {
          throw new Error(`Run '${args.runId}' not found in research '${args.researchId}'`);
        }

        const manifest = await readFile<ResearchManifest>(manifestPath, true);
        const runDetail = await readFile<RunDetail>(runDetailPath, true);

        // Get run summary from manifest
        const runSummary = manifest.runs.find((r) => r.runId === args.runId);

        return JSON.stringify(
          {
            success: true,
            action: "getRun",
            researchId: args.researchId,
            runId: args.runId,
            runSummary,
            runDetail,
            notebookPath: path.join(
              getResearchNotebooksDir(args.researchId),
              `${args.runId}.ipynb`
            ),
            artifactsDir: path.join(getResearchArtifactsDir(args.researchId), args.runId),
          },
          null,
          2
        );
      }

      case "updateRun": {
        if (!args.researchId) {
          throw new Error("researchId is required for updateRun action");
        }
        if (!args.runId) {
          throw new Error("runId is required for updateRun action");
        }
        validateId(args.researchId, "researchId");
        validateId(args.runId, "runId");

        const manifestPath = getResearchManifestPath(args.researchId);
        const runDetailPath = getRunPath(args.researchId, args.runId);

        if (!(await fileExists(manifestPath))) {
          throw new Error(`Research '${args.researchId}' not found`);
        }

        if (!(await fileExists(runDetailPath))) {
          throw new Error(`Run '${args.runId}' not found in research '${args.researchId}'`);
        }

        const manifest = await readFile<ResearchManifest>(manifestPath, true);
        const existingDetail = await readFile<RunDetail>(runDetailPath, true);
        const updateData = args.data as Partial<RunSummary & RunDetail> | undefined;

        // Find and update run summary in manifest
        const runIndex = manifest.runs.findIndex((r) => r.runId === args.runId);
        if (runIndex === -1) {
          throw new Error(
            `Run '${args.runId}' not found in manifest. Data inconsistency detected.`
          );
        }

        const runSummary = manifest.runs[runIndex];

        // Update summary fields
        if (updateData?.goal !== undefined) runSummary.goal = updateData.goal;
        if (updateData?.mode !== undefined) runSummary.mode = updateData.mode;
        if (updateData?.status !== undefined) runSummary.status = updateData.status;
        if (updateData?.endedAt !== undefined) runSummary.endedAt = updateData.endedAt;
        if (updateData?.startedAt !== undefined) runSummary.startedAt = updateData.startedAt;

        // Update manifest
        manifest.runs[runIndex] = runSummary;
        manifest.updatedAt = new Date().toISOString();

        // Update run detail
        const updatedDetail: RunDetail = {
          ...existingDetail,
          ...updateData,
          // Preserve immutable fields
          schemaVersion: 1,
          runId: existingDetail.runId,
          researchId: existingDetail.researchId,
        };

        // Merge arrays
        if (updateData?.keyResults) {
          updatedDetail.keyResults = [
            ...existingDetail.keyResults,
            ...updateData.keyResults,
          ];
        }

        if (updateData?.artifacts) {
          updatedDetail.artifacts = [
            ...existingDetail.artifacts,
            ...updateData.artifacts,
          ];
        }

        if (updateData?.executionLog) {
          updatedDetail.executionLog = [
            ...(existingDetail.executionLog ?? []),
            ...updateData.executionLog,
          ];
        }

        // Write both files atomically
        await durableAtomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
        await durableAtomicWrite(runDetailPath, JSON.stringify(updatedDetail, null, 2));

        return JSON.stringify(
          {
            success: true,
            action: "updateRun",
            researchId: args.researchId,
            runId: args.runId,
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
        const query = args.data?.query as string;
        if (!query || typeof query !== "string" || query.trim().length === 0) {
          throw new Error("query is required for search action (non-empty string in data.query)");
        }

        const researchDir = getResearchDir();
        let entries: Array<{ name: string; isDirectory: () => boolean }>;

        try {
          entries = await fs.readdir(researchDir, { withFileTypes: true });
        } catch (err: any) {
          if (err.code === "ENOENT") {
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
          const manifest = await readFile<ResearchManifest>(manifestPath, true).catch(
            () => null
          );
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

      case "report": {
        const { reportTitle } = args;

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
        const { reportTitle } = args;

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

      default:
        throw new Error(`Unknown action: ${args.action}`);
    }
  },
});
