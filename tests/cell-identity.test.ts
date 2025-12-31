/**
 * Tests for cell-identity.ts library
 *
 * Tests deterministic cell ID generation, content hashing,
 * and notebook migration for nbformat 4.5 compatibility.
 */

import { describe, test, expect } from 'bun:test';

import {
  canonicalCellHash,
  ensureCellId,
  migrateNotebookCellIds,
  type NotebookCell,
  type Notebook,
} from '../.opencode/lib/cell-identity';

describe('canonicalCellHash', () => {
  test('produces consistent hash for same content', () => {
    const cell: NotebookCell = {
      cell_type: 'code',
      source: 'print("hello")',
    };

    const hash1 = canonicalCellHash(cell);
    const hash2 = canonicalCellHash(cell);

    expect(hash1).toBe(hash2);
  });

  test('produces sha256 prefixed hash', () => {
    const cell: NotebookCell = {
      cell_type: 'code',
      source: 'x = 1',
    };

    const hash = canonicalCellHash(cell);

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test('normalizes array source to string', () => {
    const cellString: NotebookCell = {
      cell_type: 'code',
      source: 'line1\nline2',
    };

    const cellArray: NotebookCell = {
      cell_type: 'code',
      source: ['line1\n', 'line2'],
    };

    const hashString = canonicalCellHash(cellString);
    const hashArray = canonicalCellHash(cellArray);

    expect(hashString).toBe(hashArray);
  });

  test('normalizes CRLF to LF', () => {
    const cellLF: NotebookCell = {
      cell_type: 'code',
      source: 'line1\nline2',
    };

    const cellCRLF: NotebookCell = {
      cell_type: 'code',
      source: 'line1\r\nline2',
    };

    const hashLF = canonicalCellHash(cellLF);
    const hashCRLF = canonicalCellHash(cellCRLF);

    expect(hashLF).toBe(hashCRLF);
  });

  test('trims trailing whitespace', () => {
    const cellTrimmed: NotebookCell = {
      cell_type: 'code',
      source: 'code',
    };

    const cellWithTrailing: NotebookCell = {
      cell_type: 'code',
      source: 'code   \n\n',
    };

    const hashTrimmed = canonicalCellHash(cellTrimmed);
    const hashWithTrailing = canonicalCellHash(cellWithTrailing);

    expect(hashTrimmed).toBe(hashWithTrailing);
  });

  test('different content produces different hash', () => {
    const cell1: NotebookCell = {
      cell_type: 'code',
      source: 'x = 1',
    };

    const cell2: NotebookCell = {
      cell_type: 'code',
      source: 'x = 2',
    };

    const hash1 = canonicalCellHash(cell1);
    const hash2 = canonicalCellHash(cell2);

    expect(hash1).not.toBe(hash2);
  });

  test('handles empty source', () => {
    const cell: NotebookCell = {
      cell_type: 'code',
      source: '',
    };

    const hash = canonicalCellHash(cell);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test('handles markdown cells', () => {
    const cell: NotebookCell = {
      cell_type: 'markdown',
      source: '# Heading\n\nSome text',
    };

    const hash = canonicalCellHash(cell);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test('handles raw cells', () => {
    const cell: NotebookCell = {
      cell_type: 'raw',
      source: 'raw content',
    };

    const hash = canonicalCellHash(cell);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test('handles Unicode content', () => {
    const cell: NotebookCell = {
      cell_type: 'code',
      source: 'print("你好世界 🌍")',
    };

    const hash = canonicalCellHash(cell);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe('ensureCellId', () => {
  test('returns existing ID if present', () => {
    const cell: NotebookCell = {
      cell_type: 'code',
      source: 'x = 1',
      id: 'existing-id',
    };

    const id = ensureCellId(cell, 0, '/path/notebook.ipynb');

    expect(id).toBe('existing-id');
    expect(cell.id).toBe('existing-id');
  });

  test('generates ID for cell without ID', () => {
    const cell: NotebookCell = {
      cell_type: 'code',
      source: 'x = 1',
    };

    const id = ensureCellId(cell, 0, '/path/notebook.ipynb');

    expect(id).toMatch(/^vibesci-[a-f0-9]{8}$/);
    expect(cell.id).toBe(id);
  });

  test('generates deterministic ID for same inputs', () => {
    const cell1: NotebookCell = {
      cell_type: 'code',
      source: 'x = 1',
    };

    const cell2: NotebookCell = {
      cell_type: 'code',
      source: 'x = 1',
    };

    const id1 = ensureCellId(cell1, 0, '/path/notebook.ipynb');
    const id2 = ensureCellId(cell2, 0, '/path/notebook.ipynb');

    expect(id1).toBe(id2);
  });

  test('generates different ID for different index', () => {
    const cell1: NotebookCell = {
      cell_type: 'code',
      source: 'x = 1',
    };

    const cell2: NotebookCell = {
      cell_type: 'code',
      source: 'x = 1',
    };

    const id1 = ensureCellId(cell1, 0, '/path/notebook.ipynb');
    const id2 = ensureCellId(cell2, 1, '/path/notebook.ipynb');

    expect(id1).not.toBe(id2);
  });

  test('generates different ID for different notebook path', () => {
    const cell1: NotebookCell = {
      cell_type: 'code',
      source: 'x = 1',
    };

    const cell2: NotebookCell = {
      cell_type: 'code',
      source: 'x = 1',
    };

    const id1 = ensureCellId(cell1, 0, '/path/notebook1.ipynb');
    const id2 = ensureCellId(cell2, 0, '/path/notebook2.ipynb');

    expect(id1).not.toBe(id2);
  });

  test('generates different ID for different content', () => {
    const cell1: NotebookCell = {
      cell_type: 'code',
      source: 'x = 1',
    };

    const cell2: NotebookCell = {
      cell_type: 'code',
      source: 'x = 2',
    };

    const id1 = ensureCellId(cell1, 0, '/path/notebook.ipynb');
    const id2 = ensureCellId(cell2, 0, '/path/notebook.ipynb');

    expect(id1).not.toBe(id2);
  });

  test('modifies cell in place', () => {
    const cell: NotebookCell = {
      cell_type: 'code',
      source: 'x = 1',
    };

    expect(cell.id).toBeUndefined();

    ensureCellId(cell, 0, '/path/notebook.ipynb');

    expect(cell.id).toBeDefined();
    expect(cell.id).toMatch(/^vibesci-[a-f0-9]{8}$/);
  });
});

describe('migrateNotebookCellIds', () => {
  test('migrates cells without IDs', () => {
    const notebook: Notebook = {
      cells: [
        { cell_type: 'code', source: 'x = 1' },
        { cell_type: 'markdown', source: '# Title' },
        { cell_type: 'code', source: 'y = 2' },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 4,
    };

    const result = migrateNotebookCellIds(notebook, '/path/notebook.ipynb');

    expect(result.migrated).toBe(3);
    expect(notebook.cells[0].id).toMatch(/^vibesci-[a-f0-9]{8}$/);
    expect(notebook.cells[1].id).toMatch(/^vibesci-[a-f0-9]{8}$/);
    expect(notebook.cells[2].id).toMatch(/^vibesci-[a-f0-9]{8}$/);
  });

  test('skips cells with existing IDs', () => {
    const notebook: Notebook = {
      cells: [
        { cell_type: 'code', source: 'x = 1', id: 'existing-1' },
        { cell_type: 'code', source: 'y = 2' },
        { cell_type: 'code', source: 'z = 3', id: 'existing-2' },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 4,
    };

    const result = migrateNotebookCellIds(notebook, '/path/notebook.ipynb');

    expect(result.migrated).toBe(1);
    expect(notebook.cells[0].id).toBe('existing-1');
    expect(notebook.cells[1].id).toMatch(/^vibesci-[a-f0-9]{8}$/);
    expect(notebook.cells[2].id).toBe('existing-2');
  });

  test('returns zero when all cells have IDs', () => {
    const notebook: Notebook = {
      cells: [
        { cell_type: 'code', source: 'x = 1', id: 'id-1' },
        { cell_type: 'code', source: 'y = 2', id: 'id-2' },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };

    const result = migrateNotebookCellIds(notebook, '/path/notebook.ipynb');

    expect(result.migrated).toBe(0);
  });

  test('updates nbformat to 4.5 when migrating', () => {
    const notebook: Notebook = {
      cells: [
        { cell_type: 'code', source: 'x = 1' },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 4,
    };

    migrateNotebookCellIds(notebook, '/path/notebook.ipynb');

    expect(notebook.nbformat).toBe(4);
    expect(notebook.nbformat_minor).toBe(5);
  });

  test('does not update nbformat when no migration needed', () => {
    const notebook: Notebook = {
      cells: [
        { cell_type: 'code', source: 'x = 1', id: 'existing' },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 4,
    };

    migrateNotebookCellIds(notebook, '/path/notebook.ipynb');

    expect(notebook.nbformat_minor).toBe(4);
  });

  test('handles empty notebook', () => {
    const notebook: Notebook = {
      cells: [],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 4,
    };

    const result = migrateNotebookCellIds(notebook, '/path/notebook.ipynb');

    expect(result.migrated).toBe(0);
  });

  test('generates unique IDs for all cells', () => {
    const notebook: Notebook = {
      cells: [
        { cell_type: 'code', source: 'a' },
        { cell_type: 'code', source: 'b' },
        { cell_type: 'code', source: 'c' },
        { cell_type: 'code', source: 'd' },
        { cell_type: 'code', source: 'e' },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 4,
    };

    migrateNotebookCellIds(notebook, '/path/notebook.ipynb');

    const ids = notebook.cells.map(c => c.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(5);
  });

  test('modifies notebook in place', () => {
    const notebook: Notebook = {
      cells: [
        { cell_type: 'code', source: 'x = 1' },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 4,
    };

    const originalCell = notebook.cells[0];

    migrateNotebookCellIds(notebook, '/path/notebook.ipynb');

    // Same object reference, modified in place
    expect(notebook.cells[0]).toBe(originalCell);
    expect(originalCell.id).toBeDefined();
  });

  test('handles cells with array source', () => {
    const notebook: Notebook = {
      cells: [
        { cell_type: 'code', source: ['line1\n', 'line2\n', 'line3'] },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 4,
    };

    const result = migrateNotebookCellIds(notebook, '/path/notebook.ipynb');

    expect(result.migrated).toBe(1);
    expect(notebook.cells[0].id).toMatch(/^vibesci-[a-f0-9]{8}$/);
  });

  test('produces deterministic IDs across migrations', () => {
    const notebook1: Notebook = {
      cells: [
        { cell_type: 'code', source: 'x = 1' },
        { cell_type: 'markdown', source: '# Title' },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 4,
    };

    const notebook2: Notebook = {
      cells: [
        { cell_type: 'code', source: 'x = 1' },
        { cell_type: 'markdown', source: '# Title' },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 4,
    };

    migrateNotebookCellIds(notebook1, '/path/notebook.ipynb');
    migrateNotebookCellIds(notebook2, '/path/notebook.ipynb');

    expect(notebook1.cells[0].id).toBe(notebook2.cells[0].id);
    expect(notebook1.cells[1].id).toBe(notebook2.cells[1].id);
  });

  test('handles mixed cell types', () => {
    const notebook: Notebook = {
      cells: [
        { cell_type: 'markdown', source: '# Introduction' },
        { cell_type: 'code', source: 'import pandas as pd' },
        { cell_type: 'raw', source: 'Raw text content' },
        { cell_type: 'code', source: 'df = pd.DataFrame()' },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 4,
    };

    const result = migrateNotebookCellIds(notebook, '/path/notebook.ipynb');

    expect(result.migrated).toBe(4);
    notebook.cells.forEach(cell => {
      expect(cell.id).toMatch(/^vibesci-[a-f0-9]{8}$/);
    });
  });
});

describe('edge cases', () => {
  test('handles very long source content', () => {
    const longSource = 'x'.repeat(100000);
    const cell: NotebookCell = {
      cell_type: 'code',
      source: longSource,
    };

    const hash = canonicalCellHash(cell);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const id = ensureCellId(cell, 0, '/path/notebook.ipynb');
    expect(id).toMatch(/^vibesci-[a-f0-9]{8}$/);
  });

  test('handles source with only whitespace', () => {
    const cell: NotebookCell = {
      cell_type: 'code',
      source: '   \n\t\n   ',
    };

    const hash = canonicalCellHash(cell);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test('handles path with special characters', () => {
    const cell: NotebookCell = {
      cell_type: 'code',
      source: 'x = 1',
    };

    const id = ensureCellId(cell, 0, '/path/with spaces/and-dashes/notebook (1).ipynb');
    expect(id).toMatch(/^vibesci-[a-f0-9]{8}$/);
  });

  test('handles empty array source', () => {
    const cell: NotebookCell = {
      cell_type: 'code',
      source: [],
    };

    const hash = canonicalCellHash(cell);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test('cell metadata does not affect hash', () => {
    const cell1: NotebookCell = {
      cell_type: 'code',
      source: 'x = 1',
      metadata: { custom: 'value1' },
    };

    const cell2: NotebookCell = {
      cell_type: 'code',
      source: 'x = 1',
      metadata: { custom: 'value2' },
    };

    const hash1 = canonicalCellHash(cell1);
    const hash2 = canonicalCellHash(cell2);

    expect(hash1).toBe(hash2);
  });

  test('cell_type does not affect hash', () => {
    const codeCell: NotebookCell = {
      cell_type: 'code',
      source: 'content',
    };

    const markdownCell: NotebookCell = {
      cell_type: 'markdown',
      source: 'content',
    };

    const hash1 = canonicalCellHash(codeCell);
    const hash2 = canonicalCellHash(markdownCell);

    // Note: Current implementation only hashes source, not cell_type
    expect(hash1).toBe(hash2);
  });
});
