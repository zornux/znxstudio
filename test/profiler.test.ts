import { describe, expect, test } from './harness';
import { CompilerProfiler } from '../src/shared/compilerProfiler';

describe('compiler profiler', () => {
  test('aggregates per-command totals and cache hits', () => {
    const p = new CompilerProfiler();
    p.record('check', 100, false, '/a.zx');
    p.record('check', 0, true, '/a.zx');
    p.record('check', 200, false, '/b.zx');
    p.record('build', 300, false, '/a.zx');

    const snap = p.snapshot();
    expect(snap.totalOps).toBe(4);
    expect(snap.totalCached).toBe(1);

    const check = snap.commands.find((c) => c.command === 'check')!;
    expect(check.total).toBe(3);
    expect(check.cached).toBe(1);
    expect(check.ranMs).toBe(300); // 100 + 200 (cached excluded)
    expect(check.maxMs).toBe(200);
  });

  test('cache hits do not affect run-time or file stats', () => {
    const p = new CompilerProfiler();
    p.record('check', 0, true, '/a.zx');
    p.record('check', 0, true, '/a.zx');
    const snap = p.snapshot();
    expect(snap.commands[0].ranMs).toBe(0);
    expect(snap.commands[0].maxMs).toBe(0);
    expect(snap.slowestFiles).toHaveLength(0); // no real runs
  });

  test('ranks slowest files by max real duration', () => {
    const p = new CompilerProfiler();
    p.record('build', 50, false, '/fast.zx');
    p.record('build', 500, false, '/slow.zx');
    p.record('build', 120, false, '/slow.zx'); // maxMs stays 500, lastMs=120
    p.record('build', 200, false, '/mid.zx');

    const files = p.snapshot().slowestFiles;
    expect(files.map((f) => f.path)).toEqual(['/slow.zx', '/mid.zx', '/fast.zx']);
    expect(files[0].maxMs).toBe(500);
    expect(files[0].lastMs).toBe(120);
    expect(files[0].runs).toBe(2);
  });

  test('reset clears everything', () => {
    const p = new CompilerProfiler();
    p.record('check', 100, false, '/a.zx');
    p.reset();
    const snap = p.snapshot();
    expect(snap.totalOps).toBe(0);
    expect(snap.commands).toHaveLength(0);
    expect(snap.slowestFiles).toHaveLength(0);
  });
});
