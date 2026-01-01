/**
 * Cell Identity Management for Jupyter Notebooks
 *
 * Provides deterministic cell ID generation and migration for nbformat 4.5 compatibility.
 * Legacy notebooks (pre-4.5) lack cell IDs; this module backfills them deterministically
 * to ensure reproducible cell identification across sessions.
 *
 * @module cell-identity
 */

import * as crypto from 'crypto';

/**
 * Represents a single cell in a Jupyter notebook.
 * Supports code, markdown, and raw cell types as per nbformat spec.
 */
export interface NotebookCell {
  /** Type of the cell */
  cell_type: 'code' | 'markdown' | 'raw';

  /** Cell ID (optional in nbformat < 4.5, required in 4.5+) */
  id?: string;

  /** Cell source content - can be string or array of strings (one per line) */
  source: string | string[];

  /** Cell metadata */
  metadata?: Record<string, unknown>;

  /** Execution count for code cells (null if not executed) */
  execution_count?: number | null;

  /** Cell outputs for code cells */
  outputs?: unknown[];
}

/**
 * Represents a complete Jupyter notebook structure.
 */
export interface Notebook {
  /** Array of cells in the notebook */
  cells: NotebookCell[];

  /** Notebook-level metadata */
  metadata: Record<string, unknown>;

  /** Major format version (typically 4) */
  nbformat: number;

  /** Minor format version (4.5 required for cell IDs) */
  nbformat_minor: number;
}

/**
 * Result of notebook cell ID migration.
 */
export interface MigrationResult {
  /** Number of cells that were assigned new IDs */
  migrated: number;
}

/**
 * Computes a canonical content hash for a notebook cell.
 *
 * The hash is computed from the normalized source content:
 * 1. Join array sources into a single string
 * 2. Trim trailing whitespace
 * 3. Normalize line endings to LF (Unix-style)
 * 4. Compute SHA-256 hash
 *
 * This ensures identical content produces identical hashes regardless of
 * how the source was stored (string vs array) or the original line endings.
 *
 * @param cell - The notebook cell to hash
 * @returns A prefixed hash string in format "sha256:{hex}"
 *
 * @example
 * ```typescript
 * const hash = canonicalCellHash({
 *   cell_type: 'code',
 *   source: 'print("hello")\n'
 * });
 * // Returns: "sha256:abc123..."
 * ```
 */
export function canonicalCellHash(cell: NotebookCell): string {
  const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
  const normalized = source.trimEnd().replace(/\r\n/g, '\n');
  const hash = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  return `sha256:${hash}`;
}

/**
 * Ensures a cell has an ID, generating one deterministically if missing.
 *
 * For cells without an existing ID, a deterministic ID is generated based on:
 * - The notebook file path (for uniqueness across notebooks)
 * - The cell index (for uniqueness within the notebook)
 * - The cell content hash (for detecting content changes)
 *
 * This combination ensures:
 * - Same notebook + same position + same content = same ID
 * - Different notebooks or positions get different IDs
 * - Content changes result in different IDs (intentional for change detection)
 *
 * Generated IDs use format: "gyoshu-{8-char-hex}"
 *
 * @param cell - The notebook cell (modified in place if ID is added)
 * @param index - Zero-based index of the cell in the notebook
 * @param notebookPath - Path to the notebook file (used for uniqueness)
 * @returns The cell's ID (existing or newly generated)
 *
 * @example
 * ```typescript
 * const cell = { cell_type: 'code', source: 'x = 1' };
 * const id = ensureCellId(cell, 0, '/path/to/notebook.ipynb');
 * // cell.id is now set, and id contains the same value
 * ```
 */
export function ensureCellId(cell: NotebookCell, index: number, notebookPath: string): string {
  if (cell.id) {
    return cell.id;
  }

  const contentHash = canonicalCellHash(cell);
  const combined = `${notebookPath}:${index}:${contentHash}`;
  const hash = crypto.createHash('sha256').update(combined).digest('hex').slice(0, 8);

  const newId = `gyoshu-${hash}`;
  cell.id = newId;
  return newId;
}

/**
 * Migrates all cells in a notebook to have IDs, updating format version if needed.
 *
 * This function:
 * 1. Iterates through all cells in the notebook
 * 2. Assigns deterministic IDs to cells that lack them
 * 3. Updates the notebook format to nbformat 4.5 if any cells were migrated
 *
 * The notebook object is modified in place.
 *
 * @param notebook - The notebook to migrate (modified in place)
 * @param notebookPath - Path to the notebook file (used for ID generation)
 * @returns Object containing the count of migrated cells
 *
 * @example
 * ```typescript
 * const notebook = JSON.parse(fs.readFileSync('notebook.ipynb', 'utf8'));
 * const result = migrateNotebookCellIds(notebook, 'notebook.ipynb');
 * console.log(`Migrated ${result.migrated} cells`);
 *
 * if (result.migrated > 0) {
 *   fs.writeFileSync('notebook.ipynb', JSON.stringify(notebook, null, 2));
 * }
 * ```
 */
export function migrateNotebookCellIds(notebook: Notebook, notebookPath: string): MigrationResult {
  let migrated = 0;

  for (let i = 0; i < notebook.cells.length; i++) {
    const cell = notebook.cells[i];
    if (!cell.id) {
      ensureCellId(cell, i, notebookPath);
      migrated++;
    }
  }

  if (migrated > 0) {
    notebook.nbformat = 4;
    notebook.nbformat_minor = 5;
  }

  return { migrated };
}
