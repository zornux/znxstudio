import { describe, expect, test } from './harness';
import {
  CATEGORY_ORDER,
  flattenGroups,
  groupHits,
  parseQuery,
  rankCandidates,
  searchEverywhere,
  type SearchCandidate,
} from '../src/renderer/palette/searchEverywhere';

const POOL: SearchCandidate[] = [
  { category: 'commands', id: 'znxstudio.build.start', label: 'Build Project', keywords: 'znxstudio.build.start' },
  { category: 'commands', id: 'znxstudio.run.start', label: 'Run Project', keywords: 'znxstudio.run.start' },
  { category: 'files', id: '/w/src/main.zx', label: 'main.zx', detail: 'src/main.zx' },
  { category: 'files', id: '/w/src/build.zx', label: 'build.zx', detail: 'src/build.zx' },
  { category: 'symbols', id: 'sym-0', label: 'buildGraph', detail: 'function', keywords: 'function' },
  { category: 'settings', id: 'zornux.compiler.path', label: 'zornux.compiler.path', detail: 'Path to the zornux CLI.' },
  { category: 'views', id: 'security', label: 'Security', keywords: 'Security' },
];

describe('search everywhere — query parsing', () => {
  test('a leading sigil scopes to its category and strips the sigil + space', () => {
    expect(parseQuery('>build')).toEqual({ scope: 'commands', term: 'build' });
    expect(parseQuery('> build')).toEqual({ scope: 'commands', term: 'build' });
    expect(parseQuery('@sym')).toEqual({ scope: 'symbols', term: 'sym' });
    expect(parseQuery('#font')).toEqual({ scope: 'settings', term: 'font' });
  });

  test('with no sigil the explicit scope applies, defaulting to all', () => {
    expect(parseQuery('main')).toEqual({ scope: 'all', term: 'main' });
    expect(parseQuery('main', 'files')).toEqual({ scope: 'files', term: 'main' });
    expect(parseQuery('  spaced  ')).toEqual({ scope: 'all', term: 'spaced' });
  });
});

describe('search everywhere — ranking', () => {
  test('an empty term keeps the input order at score zero (shows the natural list)', () => {
    const ranked = rankCandidates('', POOL);
    expect(ranked).toHaveLength(POOL.length);
    expect(ranked[0].id).toBe('znxstudio.build.start');
    expect(ranked[0].score).toBe(0);
  });

  test('the term filters and orders; a keyword-only match still surfaces', () => {
    const ranked = rankCandidates('run', POOL);
    // "Run Project" (label) matches; the command id keyword also carries "run".
    expect(ranked.map((hit) => hit.id)).toContain('znxstudio.run.start');
    expect(ranked.every((hit) => hit.score > 0)).toBe(true);
  });
});

describe('search everywhere — grouping', () => {
  test('sections come out in CATEGORY_ORDER and empty ones are dropped', () => {
    const groups = groupHits(rankCandidates('', POOL));
    expect(groups.map((group) => group.category)).toEqual(CATEGORY_ORDER);
    const onlyFiles = groupHits(rankCandidates('', POOL.filter((c) => c.category === 'files')));
    expect(onlyFiles.map((group) => group.category)).toEqual(['files']);
  });

  test('each section is capped and flatten yields the navigation order', () => {
    const many: SearchCandidate[] = Array.from({ length: 20 }, (_, i) => ({
      category: 'files',
      id: `f${i}`,
      label: `file${i}.zx`,
    }));
    const groups = groupHits(rankCandidates('', many), 8);
    expect(groups[0].hits).toHaveLength(8);
    expect(flattenGroups(groups)).toHaveLength(8);
  });
});

describe('search everywhere — pipeline', () => {
  test('all-scope fans results across sections', () => {
    const { parsed, groups } = searchEverywhere('build', POOL);
    expect(parsed.scope).toBe('all');
    // "build" hits a command, a file, and a symbol (buildGraph) — three sections.
    const categories = groups.map((group) => group.category);
    expect(categories).toContain('commands');
    expect(categories).toContain('files');
    expect(categories).toContain('symbols');
  });

  test('a sigil narrows the pipeline to one section', () => {
    const { parsed, groups } = searchEverywhere('>build', POOL);
    expect(parsed.scope).toBe('commands');
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('commands');
    expect(groups[0].hits[0].id).toBe('znxstudio.build.start');
  });

  test('an explicit tab scope narrows even without a sigil', () => {
    const { groups } = searchEverywhere('build', POOL, 'files');
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('files');
    expect(groups[0].hits[0].id).toBe('/w/src/build.zx');
  });
});
