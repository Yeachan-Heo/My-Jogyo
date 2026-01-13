/**
 * Notebook Search MCP Tool - Full-text search within Jupyter notebooks for Gyoshu research.
 *
 * Provides comprehensive search capabilities across:
 * - Code cell source
 * - Markdown cell source
 * - Code cell outputs (text, display_data, execute_result)
 *
 * Features:
 * - Case-insensitive matching by default
 * - Scope search to specific research or search globally
 * - Relevance-based scoring (exact match > partial)
 * - Returns contextual snippets around matches
 *
 * @module mcp/tools/notebook-search
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileExists, readFileNoFollow } from "../../lib/atomic-write.js";
import {
  getResearchDir,
  getResearchNotebooksDir,
  getNotebookRootDir,
  validatePathSegment,
} from "../../lib/paths.js";
import {
  extractFrontmatter,
  GyoshuFrontmatter,
  ResearchStatus,
} from "../../lib/notebook-frontmatter.js";
import { isPathContainedIn } from "../../lib/path-security.js";
import { Notebook, NotebookCell } from "../../lib/cell-identity.js";

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/**
 * Stream output from code execution.
 */
interface StreamOutput {
  output_type: "stream";
  name: "stdout" | "stderr";
  text: string[];
}

/**
 * Execute result output.
 */
interface ExecuteResultOutput {
  output_type: "execute_result";
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Display data output (e.g., images, HTML).
 */
interface DisplayDataOutput {
  output_type: "display_data";
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Error output.
 */
interface ErrorOutput {
  output_type: "error";
  ename: string;
  evalue: string;
  traceback: string[];
}

type CellOutput = StreamOutput | ExecuteResultOutput | DisplayDataOutput | ErrorOutput;

/**
 * Search match result.
 */
interface SearchMatch {
  /** Path to the notebook file */
  notebookPath: string;
  /** Research ID this notebook belongs to */
  researchId: string;
  /** Run ID extracted from notebook filename */
  runId: string;
  /** Cell identifier */
  cellId: string;
  /** Cell type: 'code' or 'markdown' */
  cellType: "code" | "markdown" | "raw";
  /** What was matched: 'source' or 'output' */
  matchLocation: "source" | "output";
  /** Contextual snippet around the match */
  snippet: string;
  /** Relevance score (higher is better) */
  score: number;
  /** Line number within the cell where match was found (1-indexed) */
  lineNumber: number;
}

/**
 * Notebook discovery result with frontmatter.
 */
interface DiscoveredNotebook {
  /** Path to the notebook file */
  path: string;
  /** Research/run ID (from filename or frontmatter) */
  researchId: string;
  /** Run ID (from filename if in legacy format) */
  runId: string;
  /** Parsed frontmatter if available */
  frontmatter?: GyoshuFrontmatter;
}

/**
 * Frontmatter-based filter options.
 */
interface FrontmatterFilters {
  /** Filter by tags (all must match) */
  tags?: string[];
  /** Filter by research status */
  status?: ResearchStatus;
  /** Include archived research (default: false) */
  includeArchived?: boolean;
}

/**
 * Tool input arguments.
 */
interface NotebookSearchArgs {
  query: string;
  researchId?: string;
  tags?: string[];
  status?: "active" | "completed" | "archived";
  includeArchived?: boolean;
  includeOutputs?: boolean;
  limit?: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum length for snippets */
const MAX_SNIPPET_LENGTH = 200;

/** Context characters around match */
const CONTEXT_CHARS = 50;

/** Base score for exact case match */
const SCORE_EXACT_CASE = 100;

/** Base score for case-insensitive match */
const SCORE_CASE_INSENSITIVE = 80;

/** Bonus for match in source vs output */
const SCORE_SOURCE_BONUS = 20;

/** Bonus for match early in content */
const SCORE_EARLY_BONUS = 10;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Normalize source which can be string or array of strings.
 */
function normalizeSource(source: string | string[]): string {
  if (Array.isArray(source)) {
    return source.join("");
  }
  return source;
}

/**
 * Extract text content from cell outputs.
 */
function extractOutputText(outputs: CellOutput[]): string[] {
  const texts: string[] = [];

  for (const output of outputs) {
    switch (output.output_type) {
      case "stream":
        texts.push(normalizeSource(output.text));
        break;
      case "execute_result":
      case "display_data":
        // Extract text/plain if available
        if (output.data) {
          const textPlain = output.data["text/plain"];
          if (textPlain) {
            texts.push(normalizeSource(textPlain as string | string[]));
          }
        }
        break;
      case "error":
        // Include error name and value
        texts.push(`${output.ename}: ${output.evalue}`);
        break;
    }
  }

  return texts;
}

/**
 * Create a contextual snippet around a match.
 */
function createSnippet(text: string, matchIndex: number, queryLength: number): string {
  const start = Math.max(0, matchIndex - CONTEXT_CHARS);
  const end = Math.min(text.length, matchIndex + queryLength + CONTEXT_CHARS);

  let snippet = text.slice(start, end);

  // Add ellipsis if truncated
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";

  // Clean up whitespace but preserve structure
  snippet = snippet.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Truncate to max length if still too long
  if (snippet.length > MAX_SNIPPET_LENGTH) {
    snippet = snippet.slice(0, MAX_SNIPPET_LENGTH) + "...";
  }

  return snippet;
}

/**
 * Calculate relevance score for a match.
 */
function calculateScore(
  text: string,
  query: string,
  matchIndex: number,
  isSourceMatch: boolean,
  caseSensitive: boolean
): number {
  let score = 0;

  // Check for exact case match
  const exactMatch = text.slice(matchIndex, matchIndex + query.length) === query;
  if (exactMatch && !caseSensitive) {
    score += SCORE_EXACT_CASE;
  } else {
    score += SCORE_CASE_INSENSITIVE;
  }

  // Bonus for source matches
  if (isSourceMatch) {
    score += SCORE_SOURCE_BONUS;
  }

  // Bonus for early matches
  const position = matchIndex / text.length;
  if (position < 0.2) {
    score += SCORE_EARLY_BONUS;
  }

  return score;
}

/**
 * Find line number for a character index in text.
 */
function findLineNumber(text: string, charIndex: number): number {
  let lineNumber = 1;
  for (let i = 0; i < charIndex && i < text.length; i++) {
    if (text[i] === "\n") {
      lineNumber++;
    }
  }
  return lineNumber;
}

function searchCell(
  cell: NotebookCell,
  cellIndex: number,
  query: string,
  queryLower: string,
  includeOutputs: boolean,
  notebookPath: string,
  researchId: string,
  runId: string
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const cellId = cell.id || `cell-${cellIndex}`;

  const source = normalizeSource(cell.source);
  const sourceLower = source.toLowerCase();
  let searchPos = 0;

  while ((searchPos = sourceLower.indexOf(queryLower, searchPos)) !== -1) {
    const lineNumber = findLineNumber(source, searchPos);
    const score = calculateScore(source, query, searchPos, true, false);
    const snippet = createSnippet(source, searchPos, query.length);

    matches.push({
      notebookPath,
      researchId,
      runId,
      cellId,
      cellType: cell.cell_type,
      matchLocation: "source",
      snippet,
      score,
      lineNumber,
    });

    searchPos += 1;
  }

  if (includeOutputs && cell.cell_type === "code" && cell.outputs) {
    const outputTexts = extractOutputText(cell.outputs as CellOutput[]);

    for (const outputText of outputTexts) {
      const outputLower = outputText.toLowerCase();
      searchPos = 0;

      while ((searchPos = outputLower.indexOf(queryLower, searchPos)) !== -1) {
        const lineNumber = findLineNumber(outputText, searchPos);
        const score = calculateScore(outputText, query, searchPos, false, false);
        const snippet = createSnippet(outputText, searchPos, query.length);

        matches.push({
          notebookPath,
          researchId,
          runId,
          cellId,
          cellType: cell.cell_type,
          matchLocation: "output",
          snippet,
          score,
          lineNumber,
        });

        searchPos += 1;
      }
    }
  }

  return matches;
}

async function searchNotebook(
  notebookPath: string,
  researchId: string,
  runId: string,
  query: string,
  queryLower: string,
  includeOutputs: boolean
): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];

  try {
    // Security: readFileNoFollow uses O_NOFOLLOW to atomically reject symlinks
    const content = await readFileNoFollow(notebookPath);
    const notebook: Notebook = JSON.parse(content);

    if (!notebook.cells || !Array.isArray(notebook.cells)) {
      return matches;
    }

    for (let i = 0; i < notebook.cells.length; i++) {
      const cell = notebook.cells[i];

      if (cell.cell_type !== "code" && cell.cell_type !== "markdown") {
        continue;
      }

      const cellMatches = searchCell(
        cell,
        i,
        query,
        queryLower,
        includeOutputs,
        notebookPath,
        researchId,
        runId
      );
      matches.push(...cellMatches);
    }
  } catch (error) {
    process.env.GYOSHU_DEBUG && console.warn(`Warning: Could not search notebook ${notebookPath}: ${error}`);
  }

  return matches;
}

/**
 * Load a Jupyter notebook from disk.
 * Security: Uses O_NOFOLLOW to atomically reject symlinks (no TOCTOU race)
 */
async function loadNotebook(notebookPath: string): Promise<Notebook | null> {
  try {
    // Security: readFileNoFollow uses O_NOFOLLOW to atomically reject symlinks
    const content = await readFileNoFollow(notebookPath);
    return JSON.parse(content) as Notebook;
  } catch {
    // Returns null for ENOENT, ELOOP (symlink), or parse errors
    return null;
  }
}

/**
 * Find all notebooks in a directory (flat structure).
 * For flat structure: notebooks/{reportTitle}.ipynb
 */
async function findNotebooksInDir(
  dir: string
): Promise<DiscoveredNotebook[]> {
  const notebooks: DiscoveredNotebook[] = [];

  if (!(await fileExists(dir))) {
    return notebooks;
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isFile() && entry.name.endsWith(".ipynb")) {
        const slug = entry.name.slice(0, -6); // Remove .ipynb extension

        // Try to extract frontmatter for additional metadata
        const notebook = await loadNotebook(fullPath);
        const frontmatter = notebook ? extractFrontmatter(notebook) : null;

        notebooks.push({
          path: fullPath,
          researchId: frontmatter?.slug || slug,
          runId: slug,
          frontmatter: frontmatter || undefined,
        });
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return notebooks;
}

/**
 * Security error thrown when symlink-based escape is detected.
 */
class NotebookSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotebookSecurityError";
  }
}

/**
 * Find all notebooks from detected notebook root and legacy research paths.
 * Primary: getNotebookRootDir() (e.g., notebooks/)
 * Fallback: getResearchDir() (e.g., gyoshu/research/)
 *
 * Security: Rejects symlinked notebook roots and verifies realpath containment
 * for each discovered notebook to prevent directory escape attacks.
 *
 * @throws {NotebookSecurityError} If notebook root is a symlink
 */
async function findAllNotebooks(): Promise<DiscoveredNotebook[]> {
  const notebooks: DiscoveredNotebook[] = [];
  const seen = new Set<string>();

  // Primary: detected notebook root (flat structure)
  const notebookRoot = getNotebookRootDir();
  if (await fileExists(notebookRoot)) {
    // Security: Reject if notebook root is a symlink
    const rootStat = await fs.lstat(notebookRoot);
    if (rootStat.isSymbolicLink()) {
      throw new NotebookSecurityError("Security: notebook root is a symlink");
    }

    // Get realpath of root for containment checks
    const rootRealpath = await fs.realpath(notebookRoot);

    const found = await findNotebooksInDir(notebookRoot);
    for (const nb of found) {
      // Security: Verify realpath containment for each notebook
      if (!isPathContainedIn(nb.path, rootRealpath, { useRealpath: true })) {
        process.env.GYOSHU_DEBUG && console.warn(`Security: Skipping notebook outside root: ${nb.path}`);
        continue;
      }

      if (!seen.has(nb.path)) {
        notebooks.push(nb);
        seen.add(nb.path);
      }
    }
  }

  // Fallback: legacy gyoshu/research paths
  const researchDir = getResearchDir();
  if (await fileExists(researchDir)) {
    // Security: Reject if research dir is a symlink
    const researchStat = await fs.lstat(researchDir);
    if (researchStat.isSymbolicLink()) {
      throw new NotebookSecurityError("Security: research directory is a symlink");
    }

    // Get realpath of research dir for containment checks
    const researchRealpath = await fs.realpath(researchDir);

    try {
      const entries = await fs.readdir(researchDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const researchId = entry.name;
        const notebooksDir = getResearchNotebooksDir(researchId);

        if (await fileExists(notebooksDir)) {
          try {
            const nbEntries = await fs.readdir(notebooksDir, { withFileTypes: true });

            for (const nbEntry of nbEntries) {
              if (nbEntry.isFile() && nbEntry.name.endsWith(".ipynb")) {
                const nbPath = path.join(notebooksDir, nbEntry.name);

                // Security: Verify realpath containment for each notebook
                if (!isPathContainedIn(nbPath, researchRealpath, { useRealpath: true })) {
                  process.env.GYOSHU_DEBUG && console.warn(`Security: Skipping notebook outside research dir: ${nbPath}`);
                  continue;
                }

                if (!seen.has(nbPath)) {
                  const runId = nbEntry.name.slice(0, -6);
                  notebooks.push({
                    path: nbPath,
                    researchId,
                    runId,
                  });
                  seen.add(nbPath);
                }
              }
            }
          } catch {
            // Skip unreadable directories
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  return notebooks;
}

/**
 * Filter discovered notebooks by frontmatter fields.
 */
async function filterByFrontmatter(
  notebooks: DiscoveredNotebook[],
  filters: FrontmatterFilters
): Promise<DiscoveredNotebook[]> {
  const { tags, status, includeArchived = false } = filters;

  // Fast path: no filters
  if (!tags?.length && !status && includeArchived) {
    return notebooks;
  }

  const filtered: DiscoveredNotebook[] = [];

  for (const nb of notebooks) {
    // Load frontmatter if not already loaded
    let fm = nb.frontmatter;
    if (!fm) {
      const notebook = await loadNotebook(nb.path);
      fm = notebook ? extractFrontmatter(notebook) ?? undefined : undefined;
    }

    // No frontmatter - include only if no filters specified
    if (!fm) {
      if (!tags?.length && !status) {
        filtered.push(nb);
      }
      continue;
    }

    // Apply status filter
    if (status && fm.status !== status) {
      continue;
    }

    // Exclude archived unless explicitly requested
    if (!includeArchived && fm.status === "archived") {
      continue;
    }

    // Apply tags filter (all must match)
    if (tags && tags.length > 0) {
      const hasAllTags = tags.every((t) => fm!.tags.includes(t));
      if (!hasAllTags) {
        continue;
      }
    }

    filtered.push(nb);
  }

  return filtered;
}

/**
 * Get all notebooks for a specific research project (legacy path).
 */
async function getResearchNotebooks(
  researchId: string
): Promise<Array<{ path: string; runId: string }>> {
  const notebooks: Array<{ path: string; runId: string }> = [];
  const notebooksDir = getResearchNotebooksDir(researchId);

  try {
    const entries = await fs.readdir(notebooksDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".ipynb")) {
        const runId = entry.name.slice(0, -6); // Remove .ipynb extension
        notebooks.push({
          path: path.join(notebooksDir, entry.name),
          runId,
        });
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return notebooks;
}

// =============================================================================
// MCP TOOL DEFINITION
// =============================================================================

/**
 * MCP tool definition for notebook search.
 */
export const notebookSearchTool = {
  name: "notebook_search",
  description:
    "Search within Jupyter notebooks for Gyoshu research. " +
    "Searches code cells, markdown cells, and optionally cell outputs. " +
    "Supports filtering by tags and status from notebook frontmatter. " +
    "Looks in detected notebook locations first, then falls back to legacy paths. " +
    "Returns ranked results with contextual snippets.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Search query text (case-insensitive)",
      },
      researchId: {
        type: "string",
        description:
          "Optional: Scope search to a specific research project. " +
          "If not provided, searches across all research projects.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional: Filter by tags (all must match). " +
          "Only notebooks containing all specified tags will be searched.",
      },
      status: {
        type: "string",
        enum: ["active", "completed", "archived"],
        description: "Optional: Filter by research status from notebook frontmatter.",
      },
      includeArchived: {
        type: "boolean",
        description: "Whether to include archived research in search. Default: false",
      },
      includeOutputs: {
        type: "boolean",
        description:
          "Whether to search code cell outputs (stdout, display_data, errors). " +
          "Default: true",
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return. Default: 50",
      },
    },
    required: ["query"],
  },
};

// =============================================================================
// MCP HANDLER FUNCTION
// =============================================================================

/**
 * Handle notebook search tool invocation.
 *
 * @param args - Tool arguments (unknown, validated internally)
 * @returns Search results as JSON string
 */
export async function handleNotebookSearch(args: unknown): Promise<string> {
  // Validate and extract arguments
  const params = args as NotebookSearchArgs;
  const {
    query,
    researchId,
    tags,
    status,
    includeArchived = false,
    includeOutputs = true,
    limit = 50,
  } = params;

  if (!query || query.trim().length === 0) {
    return JSON.stringify({
      success: false,
      error: "Query cannot be empty",
    });
  }

  const queryTrimmed = query.trim();
  const queryLower = queryTrimmed.toLowerCase();
  let allMatches: SearchMatch[] = [];

  const hasFilters = !!(tags?.length || status);

  if (researchId) {
    try {
      validatePathSegment(researchId, "researchId");
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Invalid researchId",
      });
    }

    const notebooksDir = getResearchNotebooksDir(researchId);
    if (!(await fileExists(notebooksDir))) {
      return JSON.stringify({
        success: false,
        error: `Research '${researchId}' not found or has no notebooks`,
      });
    }

    const notebooks = await getResearchNotebooks(researchId);

    for (const { path: notebookPath, runId } of notebooks) {
      const matches = await searchNotebook(
        notebookPath,
        researchId,
        runId,
        queryTrimmed,
        queryLower,
        includeOutputs
      );
      allMatches.push(...matches);
    }
  } else {
    let notebooks: DiscoveredNotebook[];
    try {
      notebooks = await findAllNotebooks();
    } catch (error) {
      if (error instanceof NotebookSecurityError) {
        return JSON.stringify({
          success: false,
          error: error.message,
        });
      }
      throw error;
    }

    if (hasFilters) {
      notebooks = await filterByFrontmatter(notebooks, {
        tags,
        status,
        includeArchived,
      });
    } else if (!includeArchived) {
      notebooks = await filterByFrontmatter(notebooks, { includeArchived: false });
    }

    for (const nb of notebooks) {
      const matches = await searchNotebook(
        nb.path,
        nb.researchId,
        nb.runId,
        queryTrimmed,
        queryLower,
        includeOutputs
      );
      allMatches.push(...matches);
    }
  }

  allMatches.sort((a, b) => b.score - a.score);

  const limitedMatches = allMatches.slice(0, limit);

  const notebooksSearched = new Set(allMatches.map((m) => m.notebookPath)).size;
  const researchesSearched = new Set(allMatches.map((m) => m.researchId)).size;
  const sourceMatches = allMatches.filter((m) => m.matchLocation === "source").length;
  const outputMatches = allMatches.filter((m) => m.matchLocation === "output").length;

  const appliedFilters: Record<string, unknown> = {};
  if (tags?.length) appliedFilters.tags = tags;
  if (status) appliedFilters.status = status;
  if (includeArchived) appliedFilters.includeArchived = true;

  return JSON.stringify(
    {
      success: true,
      query: queryTrimmed,
      scope: researchId || "global",
      filters: Object.keys(appliedFilters).length > 0 ? appliedFilters : undefined,
      totalMatches: allMatches.length,
      returnedMatches: limitedMatches.length,
      researchesSearched,
      notebooksSearched,
      matchesByLocation: {
        source: sourceMatches,
        output: outputMatches,
      },
      results: limitedMatches,
      message:
        allMatches.length === 0
          ? `No matches found for '${queryTrimmed}'`
          : `Found ${allMatches.length} matches across ${notebooksSearched} notebooks`,
    },
    null,
    2
  );
}
