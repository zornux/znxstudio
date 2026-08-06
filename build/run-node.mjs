/**
 * Bundle a TypeScript entry with esbuild and run it under Node. Used by the
 * `test` and `bench` scripts so the Monaco-free Zornux front-end can be exercised
 * headless without a test-framework dependency.
 *
 *   node build/run-node.mjs test/index.ts
 *   node build/run-node.mjs test/bench.ts
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = process.argv[2];
if (!entry) {
  console.error('usage: node build/run-node.mjs <entry.ts>');
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.test-build');
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, 'bundle.cjs');

await build({
  entryPoints: [join(root, entry)],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: 'inline',
  logLevel: 'error',
});

const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
process.exit(result.status ?? 1);
