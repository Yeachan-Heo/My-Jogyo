/**
 * Tests for atomic-write.ts library
 *
 * Tests durable atomic file writes, file existence checking, and file reading.
 */

import { describe, test, expect, beforeEach, afterEach, afterAll } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import {
  durableAtomicWrite,
  fileExists,
  readFile,
} from '../.opencode/lib/atomic-write';

// Test directory for all atomic write tests
let testDir: string;

beforeEach(async () => {
  // Create a unique temp directory for each test
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibesci-atomic-write-test-'));
});

afterEach(async () => {
  // Clean up the test directory
  if (testDir) {
    await fs.rm(testDir, { recursive: true, force: true });
  }
});

describe('durableAtomicWrite', () => {
  test('writes file content successfully', async () => {
    const filePath = path.join(testDir, 'test.txt');
    const content = 'Hello, World!';

    await durableAtomicWrite(filePath, content);

    const result = await fs.readFile(filePath, 'utf-8');
    expect(result).toBe(content);
  });

  test('creates parent directories if they do not exist', async () => {
    const filePath = path.join(testDir, 'nested', 'deeply', 'test.txt');
    const content = 'Nested content';

    await durableAtomicWrite(filePath, content);

    const result = await fs.readFile(filePath, 'utf-8');
    expect(result).toBe(content);
  });

  test('overwrites existing file atomically', async () => {
    const filePath = path.join(testDir, 'overwrite.txt');
    const initialContent = 'Initial content';
    const newContent = 'New content';

    await durableAtomicWrite(filePath, initialContent);
    await durableAtomicWrite(filePath, newContent);

    const result = await fs.readFile(filePath, 'utf-8');
    expect(result).toBe(newContent);
  });

  test('validates JSON files before writing', async () => {
    const filePath = path.join(testDir, 'valid.json');
    const validJson = JSON.stringify({ key: 'value' });

    await durableAtomicWrite(filePath, validJson);

    const result = await fs.readFile(filePath, 'utf-8');
    expect(JSON.parse(result)).toEqual({ key: 'value' });
  });

  test('rejects invalid JSON for .json files', async () => {
    const filePath = path.join(testDir, 'invalid.json');
    const invalidJson = '{ invalid json }';

    await expect(durableAtomicWrite(filePath, invalidJson)).rejects.toThrow();
    
    // File should not exist after failed write
    const exists = await fileExists(filePath);
    expect(exists).toBe(false);
  });

  test('handles empty content', async () => {
    const filePath = path.join(testDir, 'empty.txt');

    await durableAtomicWrite(filePath, '');

    const result = await fs.readFile(filePath, 'utf-8');
    expect(result).toBe('');
  });

  test('handles large content', async () => {
    const filePath = path.join(testDir, 'large.txt');
    const largeContent = 'x'.repeat(1024 * 1024); // 1MB of data

    await durableAtomicWrite(filePath, largeContent);

    const result = await fs.readFile(filePath, 'utf-8');
    expect(result.length).toBe(largeContent.length);
    expect(result).toBe(largeContent);
  });

  test('handles special characters in content', async () => {
    const filePath = path.join(testDir, 'special.txt');
    const content = 'Unicode: 你好 🌍 émoji\nNewlines\tand\ttabs';

    await durableAtomicWrite(filePath, content);

    const result = await fs.readFile(filePath, 'utf-8');
    expect(result).toBe(content);
  });

  test('cleans up temp file on failure', async () => {
    const filePath = path.join(testDir, 'cleanup.json');
    const invalidJson = 'not valid json';

    try {
      await durableAtomicWrite(filePath, invalidJson);
    } catch {
      // Expected to fail
    }

    // Check no temp files remain
    const files = await fs.readdir(testDir);
    const tempFiles = files.filter(f => f.includes('.tmp.'));
    expect(tempFiles.length).toBe(0);
  });
});

describe('fileExists', () => {
  test('returns true for existing file', async () => {
    const filePath = path.join(testDir, 'exists.txt');
    await fs.writeFile(filePath, 'content');

    const exists = await fileExists(filePath);
    expect(exists).toBe(true);
  });

  test('returns false for non-existing file', async () => {
    const filePath = path.join(testDir, 'does-not-exist.txt');

    const exists = await fileExists(filePath);
    expect(exists).toBe(false);
  });

  test('returns true for existing directory', async () => {
    const dirPath = path.join(testDir, 'subdir');
    await fs.mkdir(dirPath);

    const exists = await fileExists(dirPath);
    expect(exists).toBe(true);
  });

  test('handles special characters in path', async () => {
    const filePath = path.join(testDir, 'file with spaces.txt');
    await fs.writeFile(filePath, 'content');

    const exists = await fileExists(filePath);
    expect(exists).toBe(true);
  });
});

describe('readFile', () => {
  test('reads text file as string', async () => {
    const filePath = path.join(testDir, 'read.txt');
    const content = 'File content';
    await fs.writeFile(filePath, content);

    const result = await readFile(filePath);
    expect(result).toBe(content);
  });

  test('reads and parses JSON file', async () => {
    const filePath = path.join(testDir, 'data.json');
    const data = { name: 'test', value: 42, nested: { key: 'value' } };
    await fs.writeFile(filePath, JSON.stringify(data));

    const result = await readFile<typeof data>(filePath, true);
    expect(result).toEqual(data);
  });

  test('returns string when parseJson is false', async () => {
    const filePath = path.join(testDir, 'json-as-string.json');
    const content = '{"key": "value"}';
    await fs.writeFile(filePath, content);

    const result = await readFile(filePath, false);
    expect(result).toBe(content);
    expect(typeof result).toBe('string');
  });

  test('throws on non-existent file', async () => {
    const filePath = path.join(testDir, 'missing.txt');

    await expect(readFile(filePath)).rejects.toThrow();
  });

  test('throws on invalid JSON when parsing', async () => {
    const filePath = path.join(testDir, 'invalid.json');
    await fs.writeFile(filePath, '{ invalid }');

    await expect(readFile(filePath, true)).rejects.toThrow();
  });

  test('reads empty file', async () => {
    const filePath = path.join(testDir, 'empty.txt');
    await fs.writeFile(filePath, '');

    const result = await readFile(filePath);
    expect(result).toBe('');
  });

  test('reads file with Unicode content', async () => {
    const filePath = path.join(testDir, 'unicode.txt');
    const content = '日本語テスト 🎉 Ñoño';
    await fs.writeFile(filePath, content);

    const result = await readFile(filePath);
    expect(result).toBe(content);
  });

  test('parses JSON array', async () => {
    const filePath = path.join(testDir, 'array.json');
    const data = [1, 2, 3, { key: 'value' }];
    await fs.writeFile(filePath, JSON.stringify(data));

    const result = await readFile<typeof data>(filePath, true);
    expect(result).toEqual(data);
  });
});
