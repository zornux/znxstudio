import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from './harness';
import { ZORNUX_EXE, hostRid, newestZornux, resolveZornux, zornuxCandidates } from '../src/main/util/zornuxRuntime';

type MutableProcess = NodeJS.Process & { resourcesPath?: string };

/** Run `fn` with a fresh temp dir posed as the packaged `resources` path, then restore. */
function withResources(fn: (resources: string) => void): void {
  const proc = process as MutableProcess;
  const prev = proc.resourcesPath;
  const prevCli = process.env.ZORNUX_CLI;
  const prevHome = process.env.ZORNUX_HOME;
  const prevPath = process.env.PATH;
  Reflect.deleteProperty(process.env, 'ZORNUX_CLI'); // isolate from the runner's environment
  Reflect.deleteProperty(process.env, 'ZORNUX_HOME');
  process.env.PATH = '';
  const dir = mkdtempSync(join(tmpdir(), 'znx-runtime-'));
  try {
    proc.resourcesPath = dir;
    fn(dir);
  } finally {
    if (prev === undefined) Reflect.deleteProperty(proc, 'resourcesPath');
    else proc.resourcesPath = prev;
    if (prevCli === undefined) Reflect.deleteProperty(process.env, 'ZORNUX_CLI');
    else process.env.ZORNUX_CLI = prevCli;
    if (prevHome === undefined) Reflect.deleteProperty(process.env, 'ZORNUX_HOME');
    else process.env.ZORNUX_HOME = prevHome;
    if (prevPath === undefined) Reflect.deleteProperty(process.env, 'PATH');
    else process.env.PATH = prevPath;
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('zornux runtime resolution', () => {
  test('hostRid is <os>-<arch>', () => {
    expect(/^(win|osx|linux)-(x64|arm64)$/.test(hostRid())).toBe(true);
  });

  test('an explicit override that exists wins, tagged env', () => {
    withResources((resources) => {
      const override = join(resources, ZORNUX_EXE);
      writeFileSync(override, '');
      const resolved = resolveZornux(override);
      expect(resolved.path).toBe(override);
      expect(resolved.source).toBe('env');
    });
  });

  test('newestZornux selects the greatest semantic version regardless of discovery order', () => {
    const selected = newestZornux([
      { path: 'bundled-1.8', source: 'bundled', version: '1.8.0' },
      { path: 'installed-1.9', source: 'path', version: '1.9.0' },
      { path: 'old-dev', source: 'default', version: '1.7.4' },
    ]);
    expect(selected?.path).toBe('installed-1.9');
    expect(selected?.version).toBe('1.9.0');
  });

  test('newestZornux ignores candidates that cannot report a version', () => {
    const selected = newestZornux([
      { path: 'broken', source: 'bundled', version: null },
      { path: 'working', source: 'path', version: '1.9.0' },
    ]);
    expect(selected?.path).toBe('working');
  });

  test('candidate order puts the bundled per-rid path before the flat fallback', () => {
    withResources((resources) => {
      const paths = zornuxCandidates().map((c) => c.path);
      const perRid = join(resources, 'zornux', hostRid(), ZORNUX_EXE);
      const flat = join(resources, 'zornux', ZORNUX_EXE);
      expect(paths.indexOf(perRid) < paths.indexOf(flat)).toBe(true);
      expect(paths.indexOf(perRid)).toBeGreaterThan(-1);
    });
  });
});
