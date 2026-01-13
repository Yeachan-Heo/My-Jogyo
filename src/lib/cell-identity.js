"use strict";
/**
 * Cell Identity Management for Jupyter Notebooks
 *
 * Provides deterministic cell ID generation and migration for nbformat 4.5 compatibility.
 * Legacy notebooks (pre-4.5) lack cell IDs; this module backfills them deterministically
 * to ensure reproducible cell identification across sessions.
 *
 * @module cell-identity
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalCellHash = canonicalCellHash;
exports.ensureCellId = ensureCellId;
exports.migrateNotebookCellIds = migrateNotebookCellIds;
const crypto = __importStar(require("crypto"));
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
function canonicalCellHash(cell) {
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
function ensureCellId(cell, index, notebookPath) {
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
 * // Security: Use O_NOFOLLOW read and atomic write to prevent symlink attacks
 * // AVOID: fs.readFileSync() follows symlinks, fs.writeFileSync() is non-atomic
 * const notebook = JSON.parse(readFileNoFollowSync('notebook.ipynb'));
 * const result = migrateNotebookCellIds(notebook, 'notebook.ipynb');
 * console.log(`Migrated ${result.migrated} cells`);
 *
 * if (result.migrated > 0) {
 *   durableAtomicWrite('notebook.ipynb', JSON.stringify(notebook, null, 2));
 * }
 * ```
 */
function migrateNotebookCellIds(notebook, notebookPath) {
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
