#!/usr/bin/env node
/**
 * Build script for Gyoshu MCP Server
 * Uses esbuild to bundle TypeScript into a single executable
 */

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Ensure build directory exists
const buildDir = join(__dirname, 'build');
if (!existsSync(buildDir)) {
  mkdirSync(buildDir, { recursive: true });
}

try {
  await esbuild.build({
    entryPoints: [join(__dirname, 'index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: join(buildDir, 'index.cjs'),
    // External packages that should not be bundled
    external: [],
    // Allow importing from parent lib directory
    absWorkingDir: join(__dirname, '..'),
    // No banner needed - we'll add shebang separately
    // Source maps for debugging
    sourcemap: true,
    // Minify for smaller bundle
    minify: false,
    // Tree shaking
    treeShaking: true,
    // Keep names for better stack traces
    keepNames: true,
  });

  // Add shebang to the output file
  const outFile = join(buildDir, 'index.cjs');
  const content = readFileSync(outFile, 'utf8');
  writeFileSync(outFile, '#!/usr/bin/env node\n' + content);

  console.log('Build completed successfully!');
  console.log(`Output: ${outFile}`);
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
