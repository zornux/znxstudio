/**
 * ZnxStudio build pipeline.
 *
 * Produces four independent bundles into ./dist:
 *   - main     (Electron main process, CJS/node)
 *   - preload  (context-bridge, CJS/node)
 *   - renderer (IDE shell, ESM/browser + CSS)
 *   - workers  (Monaco language workers, IIFE/browser)
 *
 * Pass --watch for incremental rebuilds during development.
 */
import * as esbuild from 'esbuild';
import { rmSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

/** Monaco worker entry points -> output basenames. */
const workerEntries = {
  'editor.worker': 'monaco-editor/esm/vs/editor/editor.worker.js',
  'json.worker': 'monaco-editor/esm/vs/language/json/json.worker.js',
  'css.worker': 'monaco-editor/esm/vs/language/css/css.worker.js',
  'html.worker': 'monaco-editor/esm/vs/language/html/html.worker.js',
  'ts.worker': 'monaco-editor/esm/vs/language/typescript/ts.worker.js',
};
const workerPoints = Object.fromEntries(
  Object.entries(workerEntries).map(([name, rel]) => [name, join(root, 'node_modules', rel)]),
);

const prod = !watch;
const shared = { bundle: true, sourcemap: !prod, minify: prod, logLevel: 'info' };

/** @type {{ name: string, options: import('esbuild').BuildOptions }[]} */
const targets = [
  {
    name: 'main',
    options: {
      ...shared,
      entryPoints: { main: join(root, 'src/main/main.ts') },
      outdir: join(dist, 'main'),
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      // electron + native modules stay external and resolve from node_modules at runtime.
      external: ['electron', '@lydell/node-pty'],
    },
  },
  {
    name: 'preload',
    options: {
      ...shared,
      entryPoints: { preload: join(root, 'src/preload/preload.ts') },
      outdir: join(dist, 'preload'),
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['electron'],
    },
  },
  {
    name: 'renderer',
    options: {
      ...shared,
      entryPoints: { renderer: join(root, 'src/renderer/renderer.ts'), simulatorWindow: join(root, 'src/renderer/simulator/SimulatorWindow.ts') },
      outdir: join(dist, 'renderer'),
      platform: 'browser',
      format: 'esm',
      target: 'chrome124',
      loader: { '.ttf': 'dataurl' },
      define: { 'process.env.NODE_ENV': '"production"' },
    },
  },
  {
    name: 'workers',
    options: {
      ...shared,
      entryPoints: workerPoints,
      outdir: join(dist, 'renderer'),
      platform: 'browser',
      format: 'iife',
      target: 'chrome124',
      loader: { '.ttf': 'dataurl' },
    },
  },
];

function copyStaticAssets() {
  copyFileSync(join(root, 'src/renderer/index.html'), join(dist, 'renderer/index.html'));
  copyFileSync(join(root, 'src/renderer/simulator.html'), join(dist, 'renderer/simulator.html'));
}

async function run() {
  rmSync(dist, { recursive: true, force: true });

  if (watch) {
    for (const t of targets) {
      const ctx = await esbuild.context(t.options);
      await ctx.watch();
      console.log(`[watch] ${t.name}`);
    }
    copyStaticAssets();
    console.log('[watch] initial build complete — watching for changes…');
    return;
  }

  for (const t of targets) {
    await esbuild.build(t.options);
    console.log(`[build] ${t.name} ✓`);
  }
  copyStaticAssets();
  console.log('[build] done → dist/');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
