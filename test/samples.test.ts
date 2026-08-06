import { describe, expect, test } from './harness';
import {
  buildRunArgs,
  collectSamples,
  exampleRootCandidates,
  filterSamples,
  judgeRun,
  sampleCategories,
  sampleTitle,
  scratchCopyPath,
  sortSamples,
  type Sample,
} from '../src/renderer/docs/samples';

const COMPILER = 'C:\\Studio Apps\\xojin\\src\\Zornux.Cli\\bin\\Release\\net10.0\\zornux.exe';
const ROOT = 'C:\\Studio Apps\\xojin\\examples';

describe('samples — locating the compiler examples', () => {
  test('climbs from a dev build to the repository examples folder', () => {
    const candidates = exampleRootCandidates(COMPILER);
    expect(candidates).toContain('C:/Studio Apps/xojin/examples');
  });

  test('the nearest candidate comes first', () => {
    expect(exampleRootCandidates(COMPILER)[0]).toBe('C:/Studio Apps/xojin/src/Zornux.Cli/bin/Release/net10.0/examples');
  });

  test('a bare executable name yields no candidate it cannot form', () => {
    expect(exampleRootCandidates('zornux.exe')).toEqual([]);
  });
});

describe('samples — collecting', () => {
  const files = [
    `${ROOT}\\hello.zx`,
    `${ROOT}\\variables.zx`,
    `${ROOT}\\oop\\inheritance.zx`,
    `${ROOT}\\invalid\\missing_end.zx`,
    `${ROOT}\\README.md`,
  ];

  test('root programs land in Basics; folders become categories', () => {
    const samples = collectSamples(ROOT, files);
    expect(samples).toHaveLength(4);
    expect(samples[0].category).toBe('Basics');
    expect(samples.map((s) => s.path)).toContain('oop/inheritance.zx');
  });

  test('non-.zx files are ignored', () => {
    expect(collectSamples(ROOT, files).some((s) => s.path.endsWith('.md'))).toBe(false);
  });

  test('files outside the root are ignored', () => {
    expect(collectSamples(ROOT, ['C:\\elsewhere\\x.zx'])).toEqual([]);
  });

  test('examples/invalid programs are marked as expected to fail', () => {
    const invalid = collectSamples(ROOT, files).find((s) => s.path.startsWith('invalid/'));
    expect(invalid?.expectFailure).toBe(true);
  });

  test('everything else is expected to succeed', () => {
    const hello = collectSamples(ROOT, files).find((s) => s.path === 'hello.zx');
    expect(hello?.expectFailure).toBe(false);
  });

  test('Basics sorts before the named categories', () => {
    expect(sampleCategories(collectSamples(ROOT, files))[0]).toBe('Basics');
  });

  test('titles are humanised', () => {
    expect(sampleTitle('invalid/missing_end.zx')).toBe('missing end');
    expect(sampleTitle('hello.zx')).toBe('hello');
  });
});

describe('samples — filtering', () => {
  const samples: Sample[] = [
    { path: 'hello.zx', title: 'hello', category: 'Basics', expectFailure: false },
    { path: 'oop/inheritance.zx', title: 'inheritance', category: 'oop', expectFailure: false },
  ];

  test('an empty query matches everything', () => {
    expect(filterSamples(samples, '   ')).toHaveLength(2);
  });

  test('matches title, path or category, case-insensitively', () => {
    expect(filterSamples(samples, 'OOP')).toHaveLength(1);
    expect(filterSamples(samples, 'HELL')).toHaveLength(1);
    expect(filterSamples(samples, 'zzz')).toEqual([]);
  });

  test('sorting is stable and deterministic', () => {
    expect(sortSamples([...samples].reverse()).map((s) => s.path)).toEqual(['hello.zx', 'oop/inheritance.zx']);
  });
});

describe('samples — running', () => {
  const ok: Sample = { path: 'hello.zx', title: 'hello', category: 'Basics', expectFailure: false };
  const bad: Sample = { path: 'invalid/missing_end.zx', title: 'missing end', category: 'invalid', expectFailure: true };

  test('the engine picks the subcommand', () => {
    expect(buildRunArgs('a.zx', 'interpreter')).toEqual(['run', 'a.zx']);
    expect(buildRunArgs('a.zx', 'vm')).toEqual(['vm-run', 'a.zx']);
  });

  test('a normal sample is judged on a clean exit', () => {
    expect(judgeRun(ok, 0, 'Hello World!').asExpected).toBe(true);
    expect(judgeRun(ok, 1, 'boom').asExpected).toBe(false);
  });

  test('an invalid sample is SUPPOSED to fail', () => {
    expect(judgeRun(bad, 1, 'ZX0102').asExpected).toBe(true);
    // A program in examples/invalid that compiles is the surprising outcome.
    expect(judgeRun(bad, 0, '').asExpected).toBe(false);
  });

  test('a killed process (null exit) is not a success', () => {
    expect(judgeRun(ok, null, '').asExpected).toBe(false);
  });

  test('the scratch copy flattens nested paths so names stay unique', () => {
    expect(scratchCopyPath('C:\\Temp\\s', bad)).toBe('C:\\Temp\\s\\invalid-missing_end.zx');
  });
});
