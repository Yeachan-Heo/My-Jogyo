/**
 * README Index Library - Parse and generate README.md files with sentinel blocks.
 *
 * Features:
 * - Parse README.md with sentinel blocks (GYOSHU:*:BEGIN/END)
 * - Update only content between sentinels, preserving user edits
 * - Generate root-level and workspace-level index READMEs
 * - Markdown table generation for workspaces and research projects
 *
 * Sentinel Format:
 * ```markdown
 * <!-- GYOSHU:INDEX:BEGIN -->
 * (auto-generated content here)
 * <!-- GYOSHU:INDEX:END -->
 * ```
 *
 * @module readme-index
 */

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/**
 * Represents a workspace entry for the root README index.
 */
export interface WorkspaceEntry {
  /** Folder name (used in links) */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Total number of research projects in this workspace */
  researchCount: number;
  /** Number of active research projects */
  activeCount: number;
  /** ISO date string of last update */
  lastUpdated: string;
}

/**
 * Represents a research project entry for workspace README.
 */
export interface ResearchEntry {
  /** Notebook basename without .ipynb extension (reportTitle) */
  reportTitle: string;
  /** Human-readable title of the research */
  title: string;
  /** Research status */
  status: "active" | "completed" | "archived";
  /** ISO date string or date portion of last update */
  updated: string;
  /** Tags for categorization */
  tags: string[];
  /** Optional short description */
  description?: string;
}

// =============================================================================
// SENTINEL BLOCK PARSING
// =============================================================================

/**
 * Regex pattern for matching sentinel blocks.
 * Matches: <!-- GYOSHU:{NAME}:BEGIN --> ... <!-- GYOSHU:{NAME}:END -->
 * Captures: block name and content
 */
const SENTINEL_PATTERN = /<!--\s*GYOSHU:([A-Z_]+):BEGIN\s*-->([\s\S]*?)<!--\s*GYOSHU:\1:END\s*-->/g;

/**
 * Parse README.md content and extract all sentinel blocks.
 *
 * @param content - The README.md content to parse
 * @returns Map of block name → content (without the sentinel markers)
 *
 * @example
 * ```typescript
 * const content = `
 * # My README
 * <!-- GYOSHU:INDEX:BEGIN -->
 * | Name | Count |
 * <!-- GYOSHU:INDEX:END -->
 * `;
 * const blocks = parseReadmeWithSentinels(content);
 * // blocks.get("INDEX") === "\n| Name | Count |\n"
 * ```
 */
export function parseReadmeWithSentinels(content: string): Map<string, string> {
  const blocks = new Map<string, string>();
  SENTINEL_PATTERN.lastIndex = 0;

  let match;
  while ((match = SENTINEL_PATTERN.exec(content)) !== null) {
    const blockName = match[1];
    const blockContent = match[2];
    blocks.set(blockName, blockContent);
  }

  return blocks;
}

/**
 * Check if a sentinel block exists in the content.
 *
 * @param content - The README.md content
 * @param blockName - The name of the sentinel block (e.g., "INDEX", "RECENT")
 * @returns true if the block exists
 */
export function hasSentinelBlock(content: string, blockName: string): boolean {
  const pattern = new RegExp(
    `<!--\\s*GYOSHU:${blockName}:BEGIN\\s*-->[\\s\\S]*?<!--\\s*GYOSHU:${blockName}:END\\s*-->`
  );
  return pattern.test(content);
}

// =============================================================================
// SENTINEL BLOCK UPDATING
// =============================================================================

/**
 * Update content within a sentinel block, preserving everything else.
 *
 * If the block doesn't exist, it will be appended at the end of the content.
 *
 * @param content - The README.md content
 * @param blockName - The name of the sentinel block (e.g., "INDEX", "RECENT")
 * @param newContent - The new content to place between sentinels
 * @returns Updated content with the block replaced
 *
 * @example
 * ```typescript
 * const content = `# README
 * <!-- GYOSHU:INDEX:BEGIN -->
 * old content
 * <!-- GYOSHU:INDEX:END -->
 * `;
 * const updated = updateSentinelBlock(content, "INDEX", "new content");
 * // Result:
 * // # README
 * // <!-- GYOSHU:INDEX:BEGIN -->
 * // new content
 * // <!-- GYOSHU:INDEX:END -->
 * ```
 */
export function updateSentinelBlock(
  content: string,
  blockName: string,
  newContent: string
): string {
  const beginMarker = `<!-- GYOSHU:${blockName}:BEGIN -->`;
  const endMarker = `<!-- GYOSHU:${blockName}:END -->`;
  const newBlock = `${beginMarker}\n${newContent}\n${endMarker}`;

  if (hasSentinelBlock(content, blockName)) {
    const pattern = new RegExp(
      `<!--\\s*GYOSHU:${blockName}:BEGIN\\s*-->[\\s\\S]*?<!--\\s*GYOSHU:${blockName}:END\\s*-->`
    );
    return content.replace(pattern, newBlock);
  } else {
    const trimmedContent = content.trimEnd();
    return `${trimmedContent}\n\n${newBlock}\n`;
  }
}

// =============================================================================
// MARKDOWN TABLE GENERATION
// =============================================================================

/**
 * Escape special markdown characters in a string.
 *
 * @param text - The text to escape
 * @returns Escaped text safe for markdown
 */
function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Format a date string for display.
 * Extracts the date portion if full ISO timestamp.
 *
 * @param dateString - ISO date string or date portion
 * @returns Date in YYYY-MM-DD format
 */
function formatDate(dateString: string): string {
  if (dateString.includes("T")) {
    return dateString.split("T")[0];
  }
  return dateString;
}

/**
 * Convert a folder name to a human-readable display name.
 *
 * @param name - The folder name (e.g., "customer-analytics")
 * @returns Display name (e.g., "Customer Analytics")
 */
export function toDisplayName(name: string): string {
  const cleanName = name.startsWith("_") ? name.slice(1) : name;
  return cleanName
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Generate a markdown table row.
 *
 * @param cells - Array of cell contents
 * @returns Markdown table row string
 */
function tableRow(cells: string[]): string {
  return `| ${cells.map(escapeMarkdown).join(" | ")} |`;
}

/**
 * Generate a markdown table header separator.
 *
 * @param columnCount - Number of columns
 * @returns Header separator string
 */
function tableSeparator(columnCount: number): string {
  return `|${Array(columnCount).fill("---").join("|")}|`;
}

// =============================================================================
// ROOT README GENERATION
// =============================================================================

/**
 * Generate the workspace table content for root README.
 *
 * @param workspaces - Array of workspace entries
 * @returns Markdown table content (without sentinels)
 */
function generateWorkspaceTable(workspaces: WorkspaceEntry[]): string {
  if (workspaces.length === 0) {
    return "_No workspaces yet. Start research with `/gyoshu <goal>`_";
  }

  const header = tableRow(["Workspace", "Research", "Status", "Last Updated"]);
  const separator = tableSeparator(4);

  const rows = workspaces.map((ws) => {
    const link = `[${ws.displayName}](./${ws.name}/)`;
    const count = `${ws.researchCount} project${ws.researchCount !== 1 ? "s" : ""}`;
    const status = ws.activeCount > 0 ? `${ws.activeCount} active` : "-";
    const updated = formatDate(ws.lastUpdated);
    return tableRow([link, count, status, updated]);
  });

  return [header, separator, ...rows].join("\n");
}

/**
 * Generate the recent activity list content for root README.
 *
 * @param workspaces - Array of workspace entries with research
 * @param recentItems - Maximum number of items to show
 * @returns Markdown list content (without sentinels)
 */
function generateRecentActivity(
  workspaces: WorkspaceEntry[],
  recentItems: number = 5
): string {
  if (workspaces.length === 0) {
    return "_No recent activity_";
  }

  const sorted = [...workspaces]
    .sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated))
    .slice(0, recentItems);

  const items = sorted.map((ws) => {
    const status = ws.activeCount > 0 ? "active" : "completed";
    return `- **[${ws.displayName}](./${ws.name}/)** - ${status} - ${ws.researchCount} project${ws.researchCount !== 1 ? "s" : ""}`;
  });

  return items.join("\n");
}

/**
 * Generate all unique tags from workspaces content.
 *
 * @param allTags - Array of all tag strings
 * @returns Markdown formatted tags
 */
function generateTagsList(allTags: string[]): string {
  if (allTags.length === 0) {
    return "_No tags yet_";
  }

  const uniqueTags = [...new Set(allTags)].sort();
  return uniqueTags.map((tag) => `\`${tag}\``).join(" ");
}

/**
 * Generate a complete root README for the research index.
 *
 * @param workspaces - Array of workspace entries
 * @param allTags - Optional array of all tags across all research
 * @returns Complete README content with all sentinel blocks
 *
 * @example
 * ```typescript
 * const readme = generateRootReadme([
 *   {
 *     name: "customer-analytics",
 *     displayName: "Customer Analytics",
 *     researchCount: 3,
 *     activeCount: 2,
 *     lastUpdated: "2026-01-01"
 *   }
 * ], ["ml", "classification"]);
 * ```
 */
export function generateRootReadme(
  workspaces: WorkspaceEntry[],
  allTags: string[] = []
): string {
  const header = `# Research Index

> Auto-generated by Gyoshu. Edits outside marked sections are preserved.

## Workspaces

`;

  const workspaceTable = generateWorkspaceTable(workspaces);
  const indexBlock = `<!-- GYOSHU:INDEX:BEGIN -->
${workspaceTable}
<!-- GYOSHU:INDEX:END -->`;

  const recentSection = `

## Recent Activity

<!-- GYOSHU:RECENT:BEGIN -->
${generateRecentActivity(workspaces)}
<!-- GYOSHU:RECENT:END -->`;

  const tagsSection = `

## All Tags

<!-- GYOSHU:TAGS:BEGIN -->
${generateTagsList(allTags)}
<!-- GYOSHU:TAGS:END -->
`;

  return header + indexBlock + recentSection + tagsSection;
}

// =============================================================================
// WORKSPACE README GENERATION
// =============================================================================

/**
 * Generate the research table content for workspace README.
 *
 * @param research - Array of research entries
 * @returns Markdown table content (without sentinels)
 */
function generateResearchTable(research: ResearchEntry[]): string {
  if (research.length === 0) {
    return "_No research projects yet. Start with `/gyoshu <goal>`_";
  }

  const header = tableRow(["Research", "Status", "Updated", "Tags", "Description"]);
  const separator = tableSeparator(5);

  const rows = research.map((r) => {
    const link = `[${r.title}](./${r.reportTitle}.ipynb)`;
    const status = r.status;
    const updated = formatDate(r.updated);
    const tags = r.tags.length > 0 ? r.tags.join(", ") : "-";
    const description = r.description || "-";
    return tableRow([link, status, updated, tags, description]);
  });

  return [header, separator, ...rows].join("\n");
}

/**
 * Generate a complete workspace README.
 *
 * @param name - The workspace folder name
 * @param description - Optional description paragraph
 * @param research - Array of research entries in this workspace
 * @returns Complete README content with all sentinel blocks
 *
 * @example
 * ```typescript
 * const readme = generateWorkspaceReadme(
 *   "customer-analytics",
 *   "Research related to customer behavior, retention, and lifetime value.",
 *   [
 *     {
 *       reportTitle: "churn-prediction",
 *       title: "Churn Prediction",
 *       status: "active",
 *       updated: "2026-01-01",
 *       tags: ["ml", "classification"],
 *       description: "Predict customer churn risk"
 *     }
 *   ]
 * );
 * ```
 */
export function generateWorkspaceReadme(
  name: string,
  description: string,
  research: ResearchEntry[]
): string {
  const displayName = toDisplayName(name);
  const allTags: string[] = [];
  for (const r of research) {
    allTags.push(...r.tags);
  }

  const header = `# ${displayName}

${description || "Research workspace."}

## Research Projects

`;

  const researchTable = generateResearchTable(research);
  const indexBlock = `<!-- GYOSHU:INDEX:BEGIN -->
${researchTable}
<!-- GYOSHU:INDEX:END -->`;

  const tagsSection = `

## Workspace Tags

<!-- GYOSHU:TAGS:BEGIN -->
${generateTagsList(allTags)}
<!-- GYOSHU:TAGS:END -->
`;

  return header + indexBlock + tagsSection;
}

// =============================================================================
// UTILITY EXPORTS
// =============================================================================

/**
 * Extract tags from a line of formatted tags (backtick-separated).
 *
 * @param tagsLine - Line like "`ml` `classification` `test`"
 * @returns Array of tag strings
 */
export function parseTags(tagsLine: string): string[] {
  const matches = tagsLine.match(/`([^`]+)`/g);
  if (!matches) {
    return [];
  }
  return matches.map((m) => m.slice(1, -1));
}
