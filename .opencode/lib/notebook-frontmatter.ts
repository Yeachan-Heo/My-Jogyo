/**
 * Notebook Frontmatter Library - Parse and update YAML frontmatter in Jupyter notebooks.
 *
 * Features:
 * - Parse YAML frontmatter from first raw cell
 * - Update frontmatter preserving rest of notebook
 * - Validate against schema version
 * - Handle Quarto compatibility
 *
 * YAML Format:
 * ```yaml
 * ---
 * title: "Research Title"
 * gyoshu:
 *   schema_version: 1
 *   reportTitle: churn-prediction
 *   status: active
 *   ...
 * ---
 * ```
 *
 * @module notebook-frontmatter
 */

import { Notebook, NotebookCell } from "./cell-identity";
import * as crypto from "crypto";

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/**
 * Status of a research notebook.
 */
export type ResearchStatus = "active" | "completed" | "archived";

/**
 * Status of an individual run within a research.
 */
export type RunStatus = "in_progress" | "completed" | "failed";

/**
 * Represents a single run entry in the frontmatter.
 */
export interface RunEntry {
  /** Unique identifier for the run */
  id: string;
  /** ISO 8601 timestamp when run started */
  started: string;
  /** ISO 8601 timestamp when run ended (optional) */
  ended?: string;
  /** Status of the run */
  status: RunStatus;
  /** Optional notes about the run */
  notes?: string;
}

/**
 * Gyoshu-specific frontmatter stored in the `gyoshu:` namespace.
 */
export interface GyoshuFrontmatter {
  /** Schema version for future migrations */
  schema_version: number;
  /** Workspace folder name (optional - for workspace-organized research) */
  workspace?: string;
  /** Notebook basename without .ipynb extension (optional - can use reportTitle instead) */
  slug?: string;
  /** Report title - alternative identifier when not using workspace/slug */
  reportTitle?: string;
  /** Research status */
  status: ResearchStatus;
  /** ISO 8601 timestamp when created */
  created: string;
  /** ISO 8601 timestamp when last updated */
  updated: string;
  /** Tags for categorization */
  tags: string[];
  /** Python environment path (optional) */
  python_env?: string;
  /** Outputs directory path (optional) */
  outputs_dir?: string;
  /** Run history - bounded to last 10 runs (optional) */
  runs?: RunEntry[];
}

/**
 * Complete frontmatter including optional Quarto-compatible fields.
 */
export interface NotebookFrontmatter {
  /** Document title (Quarto-compatible) */
  title?: string;
  /** Author name (Quarto-compatible) */
  author?: string;
  /** Date string (Quarto-compatible) */
  date?: string;
  /** Gyoshu-specific metadata */
  gyoshu?: GyoshuFrontmatter;
  /** Any other top-level fields for Quarto compatibility */
  [key: string]: unknown;
}

// =============================================================================
// YAML PARSING (Simple subset, no external library)
// =============================================================================

/**
 * Parse a simple YAML string into an object.
 * Supports: top-level keys, nested objects (one level), arrays, quoted strings.
 *
 * @param yamlString - The YAML string to parse
 * @returns Parsed object
 */
export function parseSimpleYaml(yamlString: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yamlString.split("\n");

  let currentKey: string | null = null;
  let currentObject: Record<string, unknown> | null = null;
  let currentArray: unknown[] | null = null;
  let currentArrayKey: string | null = null;
  let arrayItemBuffer: Record<string, unknown> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    // Skip empty lines and comments
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    // Detect indentation level
    const indent = line.length - line.trimStart().length;

    // Check for array item start (- key: value or just - value)
    const arrayItemMatch = trimmed.match(/^(\s*)- (.+)$/);
    if (arrayItemMatch) {
      const itemContent = arrayItemMatch[2].trim();

      // Check if this is a key-value pair within an array item
      const kvMatch = itemContent.match(/^([^:]+):\s*(.*)$/);
      if (kvMatch && currentArrayKey) {
        // Start of a new object in the array
        if (arrayItemBuffer) {
          // Save previous buffer
          currentArray?.push(arrayItemBuffer);
        }
        arrayItemBuffer = {};
        const key = kvMatch[1].trim();
        const value = parseYamlValue(kvMatch[2].trim());
        arrayItemBuffer[key] = value;
      } else if (currentArrayKey && currentArray) {
        // Simple string array item
        if (arrayItemBuffer) {
          currentArray.push(arrayItemBuffer);
          arrayItemBuffer = null;
        }
        currentArray.push(parseYamlValue(itemContent));
      }
      continue;
    }

    // Check if we're continuing an object array item (indented key: value under -)
    if (arrayItemBuffer && indent >= 6) {
      const kvMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1].trim();
        const value = parseYamlValue(kvMatch[2].trim());
        arrayItemBuffer[key] = value;
        continue;
      }
    }

    // Check for key: value pair
    const kvMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const value = kvMatch[2].trim();

      // Finish any pending array
      if (currentArray && currentArrayKey) {
        if (arrayItemBuffer) {
          currentArray.push(arrayItemBuffer);
          arrayItemBuffer = null;
        }
        if (currentObject) {
          currentObject[currentArrayKey] = currentArray;
        } else {
          result[currentArrayKey] = currentArray;
        }
        currentArray = null;
        currentArrayKey = null;
      }

      // Handle based on indentation
      if (indent === 0) {
        // Top-level key
        currentObject = null;
        currentKey = key;

        if (value === "") {
          // Start of a nested object or array
          // Look ahead to see if it's an array
          if (i + 1 < lines.length && lines[i + 1].trim().startsWith("-")) {
            currentArray = [];
            currentArrayKey = key;
          } else {
            // Nested object
            currentObject = {};
            result[key] = currentObject;
          }
        } else {
          result[key] = parseYamlValue(value);
        }
      } else if (indent >= 2 && currentObject) {
        // Nested key within an object
        if (value === "") {
          // Check if it's an array
          if (i + 1 < lines.length && lines[i + 1].trim().startsWith("-")) {
            currentArray = [];
            currentArrayKey = key;
          } else {
            currentObject[key] = null;
          }
        } else {
          currentObject[key] = parseYamlValue(value);
        }
      } else if (indent >= 2 && !currentObject && value === "") {
        // This might be a top-level array
        if (i + 1 < lines.length && lines[i + 1].trim().startsWith("-")) {
          currentArray = [];
          currentArrayKey = key;
        }
      }
    }
  }

  // Finish any pending array
  if (currentArray && currentArrayKey) {
    if (arrayItemBuffer) {
      currentArray.push(arrayItemBuffer);
    }
    if (currentObject) {
      currentObject[currentArrayKey] = currentArray;
    } else {
      result[currentArrayKey] = currentArray;
    }
  }

  return result;
}

/**
 * Parse a YAML value, handling quoted strings, numbers, booleans, null.
 */
function parseYamlValue(value: string): unknown {
  if (value === "" || value === "null" || value === "~") {
    return null;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  // Handle quoted strings
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  // Handle numbers
  if (/^-?\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return parseFloat(value);
  }
  // Plain string
  return value;
}

/**
 * Serialize an object back to YAML format.
 *
 * @param obj - The object to serialize
 * @returns YAML string
 */
export function serializeToYaml(obj: Record<string, unknown>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === "object" && !Array.isArray(value)) {
      // Nested object
      lines.push(`${key}:`);
      const nested = value as Record<string, unknown>;
      for (const [nestedKey, nestedValue] of Object.entries(nested)) {
        if (nestedValue === null || nestedValue === undefined) {
          continue;
        }

        if (Array.isArray(nestedValue)) {
          // Array within nested object
          lines.push(`  ${nestedKey}:`);
          for (const item of nestedValue) {
            if (typeof item === "object" && item !== null) {
              // Object array item
              const objItem = item as Record<string, unknown>;
              const entries = Object.entries(objItem);
              if (entries.length > 0) {
                const [firstKey, firstValue] = entries[0];
                lines.push(`    - ${firstKey}: ${formatYamlValue(firstValue)}`);
                for (let i = 1; i < entries.length; i++) {
                  const [k, v] = entries[i];
                  if (v !== null && v !== undefined) {
                    lines.push(`      ${k}: ${formatYamlValue(v)}`);
                  }
                }
              }
            } else {
              // Simple array item
              lines.push(`    - ${formatYamlValue(item)}`);
            }
          }
        } else {
          lines.push(`  ${nestedKey}: ${formatYamlValue(nestedValue)}`);
        }
      }
    } else if (Array.isArray(value)) {
      // Top-level array
      lines.push(`${key}:`);
      for (const item of value) {
        if (typeof item === "object" && item !== null) {
          const objItem = item as Record<string, unknown>;
          const entries = Object.entries(objItem);
          if (entries.length > 0) {
            const [firstKey, firstValue] = entries[0];
            lines.push(`  - ${firstKey}: ${formatYamlValue(firstValue)}`);
            for (let i = 1; i < entries.length; i++) {
              const [k, v] = entries[i];
              if (v !== null && v !== undefined) {
                lines.push(`    ${k}: ${formatYamlValue(v)}`);
              }
            }
          }
        } else {
          lines.push(`  - ${formatYamlValue(item)}`);
        }
      }
    } else {
      lines.push(`${key}: ${formatYamlValue(value)}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a value for YAML output.
 */
function formatYamlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    // Quote if contains special characters or looks like a number
    if (
      value.includes(":") ||
      value.includes("#") ||
      value.includes("\n") ||
      /^[\d.-]/.test(value)
    ) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  return String(value);
}

// =============================================================================
// FRONTMATTER EXTRACTION AND MANIPULATION
// =============================================================================

/**
 * Check if a cell is a frontmatter cell (raw type with YAML delimiters).
 * Uses line-based detection to avoid false positives from "---" within content.
 *
 * Requirements:
 * - Delimiters must start at column 0 (no leading whitespace)
 * - Accepts "---" or "..." as valid closing delimiter (YAML document end marker)
 * - Normalizes CRLF to LF for Windows compatibility
 */
function isFrontmatterCell(cell: NotebookCell): boolean {
  if (cell.cell_type !== "raw") {
    return false;
  }

  const source = Array.isArray(cell.source)
    ? cell.source.join("")
    : cell.source;

  // Normalize CRLF to LF for Windows compatibility
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  // First line must be exactly "---" (no leading whitespace)
  if (lines.length < 2 || lines[0] !== "---") {
    return false;
  }

  // Find closing delimiter: "---" or "..." on its own line (no leading whitespace)
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---" || lines[i] === "...") {
      return true;
    }
  }

  return false;
}

/**
 * Extract the YAML content from a frontmatter cell.
 * Uses line-based detection for delimiters.
 */
function extractYamlContent(cell: NotebookCell): string | null {
  const source = Array.isArray(cell.source)
    ? cell.source.join("")
    : cell.source;

  // Normalize CRLF to LF for Windows compatibility
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  // First line must be exactly "---" (no leading whitespace)
  if (lines.length < 2 || lines[0] !== "---") {
    return null;
  }

  // Find closing delimiter: "---" or "..." on its own line (no leading whitespace)
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---" || lines[i] === "...") {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    return null;
  }

  // Extract content between delimiters (lines 1 to closingIndex-1)
  const contentLines = lines.slice(1, closingIndex);
  return contentLines.join("\n").trim();
}

/**
 * Extract GyoshuFrontmatter from a notebook's first cell.
 *
 * @param notebook - The notebook to extract frontmatter from
 * @returns GyoshuFrontmatter if found and valid, null otherwise
 */
export function extractFrontmatter(notebook: Notebook): GyoshuFrontmatter | null {
  if (notebook.cells.length === 0) {
    return null;
  }

  const firstCell = notebook.cells[0];
  if (!isFrontmatterCell(firstCell)) {
    return null;
  }

  const yamlContent = extractYamlContent(firstCell);
  if (!yamlContent) {
    return null;
  }

  try {
    const parsed = parseSimpleYaml(yamlContent);
    const gyoshu = parsed.gyoshu as Record<string, unknown> | undefined;

    if (!gyoshu) {
      return null;
    }

    // Validate required fields (workspace and slug are now optional)
    if (
      typeof gyoshu.schema_version !== "number" ||
      typeof gyoshu.status !== "string" ||
      typeof gyoshu.created !== "string" ||
      typeof gyoshu.updated !== "string"
    ) {
      return null;
    }

    // Validate status
    if (!["active", "completed", "archived"].includes(gyoshu.status)) {
      return null;
    }

    // Build the frontmatter object
    const frontmatter: GyoshuFrontmatter = {
      schema_version: gyoshu.schema_version as number,
      status: gyoshu.status as ResearchStatus,
      created: gyoshu.created as string,
      updated: gyoshu.updated as string,
      tags: Array.isArray(gyoshu.tags)
        ? (gyoshu.tags as string[])
        : [],
    };

    // Optional fields: workspace, slug, reportTitle
    if (typeof gyoshu.workspace === "string") {
      frontmatter.workspace = gyoshu.workspace;
    }
    if (typeof gyoshu.slug === "string") {
      frontmatter.slug = gyoshu.slug;
    }
    if (typeof gyoshu.reportTitle === "string") {
      frontmatter.reportTitle = gyoshu.reportTitle;
    }

    // Optional fields
    if (typeof gyoshu.python_env === "string") {
      frontmatter.python_env = gyoshu.python_env;
    }
    if (typeof gyoshu.outputs_dir === "string") {
      frontmatter.outputs_dir = gyoshu.outputs_dir;
    }
    if (Array.isArray(gyoshu.runs)) {
      frontmatter.runs = gyoshu.runs as RunEntry[];
    }

    return frontmatter;
  } catch (error) {
    console.debug(`[notebook-frontmatter] Failed to parse YAML in extractFrontmatter: ${error}`);
    return null;
  }
}

/**
 * Extract full notebook frontmatter including Quarto fields.
 *
 * @param notebook - The notebook to extract frontmatter from
 * @returns Full frontmatter object or null if not found
 */
export function extractFullFrontmatter(notebook: Notebook): NotebookFrontmatter | null {
  if (notebook.cells.length === 0) {
    return null;
  }

  const firstCell = notebook.cells[0];
  if (!isFrontmatterCell(firstCell)) {
    return null;
  }

  const yamlContent = extractYamlContent(firstCell);
  if (!yamlContent) {
    return null;
  }

  try {
    const parsed = parseSimpleYaml(yamlContent);
    return parsed as NotebookFrontmatter;
  } catch (error) {
    console.debug(`[notebook-frontmatter] Failed to parse YAML in extractFullFrontmatter: ${error}`);
    return null;
  }
}

/**
 * Update frontmatter in a notebook, returning a new notebook object (immutable).
 *
 * @param notebook - The notebook to update
 * @param updates - Partial frontmatter updates to merge
 * @returns New notebook with updated frontmatter
 */
export function updateFrontmatter(
  notebook: Notebook,
  updates: Partial<GyoshuFrontmatter>
): Notebook {
  // Deep clone the notebook to maintain immutability
  const newNotebook: Notebook = JSON.parse(JSON.stringify(notebook));

  if (newNotebook.cells.length === 0) {
    throw new Error("Cannot update frontmatter: notebook has no cells");
  }

  const firstCell = newNotebook.cells[0];
  if (!isFrontmatterCell(firstCell)) {
    throw new Error("Cannot update frontmatter: first cell is not a frontmatter cell");
  }

  // Extract existing frontmatter
  const existingFull = extractFullFrontmatter(notebook);
  if (!existingFull || !existingFull.gyoshu) {
    throw new Error("Cannot update frontmatter: no valid gyoshu frontmatter found");
  }

  // Merge updates
  const mergedGyoshu: GyoshuFrontmatter = {
    ...existingFull.gyoshu,
    ...updates,
    updated: new Date().toISOString(),
  };

  // Preserve tags array properly (merge if both exist)
  if (updates.tags) {
    mergedGyoshu.tags = updates.tags;
  }

  // Preserve runs array properly (merge if both exist)
  if (updates.runs) {
    mergedGyoshu.runs = updates.runs;
  }

  // Build new frontmatter object
  const newFrontmatter: NotebookFrontmatter = {
    ...existingFull,
    gyoshu: mergedGyoshu,
  };

  // Serialize to YAML
  const yamlContent = serializeToYaml(newFrontmatter as Record<string, unknown>);
  const newSource = `---\n${yamlContent}\n---`;

  // Update the cell source
  firstCell.source = newSource.split("\n").map((line, i, arr) =>
    i < arr.length - 1 ? line + "\n" : line
  );

  return newNotebook;
}

/**
 * Ensure a notebook has a frontmatter cell, adding one if not present.
 *
 * @param notebook - The notebook to ensure has frontmatter
 * @param initial - Initial frontmatter values to use if creating new cell
 * @returns New notebook with frontmatter cell at position 0
 */
export function ensureFrontmatterCell(
  notebook: Notebook,
  initial: GyoshuFrontmatter
): Notebook {
  // Deep clone the notebook to maintain immutability
  const newNotebook: Notebook = JSON.parse(JSON.stringify(notebook));

  // Check if first cell already has frontmatter
  if (newNotebook.cells.length > 0 && isFrontmatterCell(newNotebook.cells[0])) {
    return newNotebook;
  }

  // Build frontmatter object
  const frontmatter: NotebookFrontmatter = {
    gyoshu: initial,
  };

  // Serialize to YAML
  const yamlContent = serializeToYaml(frontmatter as Record<string, unknown>);
  const source = `---\n${yamlContent}\n---`;

  // Create new raw cell
  const frontmatterCell: NotebookCell = {
    cell_type: "raw",
    id: `frontmatter-${crypto.randomUUID().slice(0, 8)}`,
    source: source.split("\n").map((line, i, arr) =>
      i < arr.length - 1 ? line + "\n" : line
    ),
    metadata: {
      gyoshu: {
        type: "frontmatter",
      },
    },
  };

  // Insert at position 0
  newNotebook.cells.unshift(frontmatterCell);

  return newNotebook;
}

/**
 * Validate frontmatter against schema version.
 *
 * @param frontmatter - The frontmatter to validate
 * @returns Object with isValid boolean and errors array
 */
export function validateFrontmatter(
  frontmatter: GyoshuFrontmatter
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check schema version
  if (frontmatter.schema_version !== 1) {
    errors.push(`Unsupported schema version: ${frontmatter.schema_version}. Expected: 1`);
  }

  // Check required string fields (workspace and slug are now optional)
  if (frontmatter.workspace !== undefined && typeof frontmatter.workspace !== "string") {
    errors.push("Invalid workspace (must be string if provided)");
  }
  if (frontmatter.slug !== undefined && typeof frontmatter.slug !== "string") {
    errors.push("Invalid slug (must be string if provided)");
  }
  if (frontmatter.reportTitle !== undefined && typeof frontmatter.reportTitle !== "string") {
    errors.push("Invalid reportTitle (must be string if provided)");
  }
  if (!frontmatter.created || typeof frontmatter.created !== "string") {
    errors.push("Missing or invalid created timestamp");
  }
  if (!frontmatter.updated || typeof frontmatter.updated !== "string") {
    errors.push("Missing or invalid updated timestamp");
  }

  // Check status
  if (!["active", "completed", "archived"].includes(frontmatter.status)) {
    errors.push(`Invalid status: ${frontmatter.status}. Expected: active, completed, or archived`);
  }

  // Check tags is array
  if (!Array.isArray(frontmatter.tags)) {
    errors.push("Tags must be an array");
  }

  // Validate runs if present
  if (frontmatter.runs) {
    if (!Array.isArray(frontmatter.runs)) {
      errors.push("Runs must be an array");
    } else {
      for (let i = 0; i < frontmatter.runs.length; i++) {
        const run = frontmatter.runs[i];
        if (!run.id || typeof run.id !== "string") {
          errors.push(`Run ${i}: missing or invalid id`);
        }
        if (!run.started || typeof run.started !== "string") {
          errors.push(`Run ${i}: missing or invalid started timestamp`);
        }
        if (!["in_progress", "completed", "failed"].includes(run.status)) {
          errors.push(`Run ${i}: invalid status: ${run.status}`);
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Check if a notebook has valid Gyoshu frontmatter.
 *
 * @param notebook - The notebook to check
 * @returns true if notebook has valid frontmatter
 */
export function hasFrontmatter(notebook: Notebook): boolean {
  return extractFrontmatter(notebook) !== null;
}

/**
 * Get the current run from frontmatter (the one with status "in_progress").
 *
 * @param frontmatter - The frontmatter to check
 * @returns The current run or null if none in progress
 */
export function getCurrentRun(frontmatter: GyoshuFrontmatter): RunEntry | null {
  if (!frontmatter.runs) {
    return null;
  }
  return frontmatter.runs.find((run) => run.status === "in_progress") || null;
}

/**
 * Add a new run to the frontmatter, keeping only the last 10 runs.
 *
 * @param frontmatter - The frontmatter to update
 * @param run - The new run to add
 * @returns New frontmatter with the run added
 */
export function addRun(
  frontmatter: GyoshuFrontmatter,
  run: RunEntry
): GyoshuFrontmatter {
  const runs = [...(frontmatter.runs || []), run];

  // Keep only last 10 runs
  const boundedRuns = runs.slice(-10);

  return {
    ...frontmatter,
    runs: boundedRuns,
    updated: new Date().toISOString(),
  };
}

/**
 * Update a run in the frontmatter by ID.
 *
 * @param frontmatter - The frontmatter to update
 * @param runId - The ID of the run to update
 * @param updates - Partial run updates
 * @returns New frontmatter with the run updated
 */
export function updateRun(
  frontmatter: GyoshuFrontmatter,
  runId: string,
  updates: Partial<RunEntry>
): GyoshuFrontmatter {
  if (!frontmatter.runs) {
    return frontmatter;
  }

  const newRuns = frontmatter.runs.map((run) =>
    run.id === runId ? { ...run, ...updates } : run
  );

  return {
    ...frontmatter,
    runs: newRuns,
    updated: new Date().toISOString(),
  };
}
