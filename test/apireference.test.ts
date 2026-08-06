import { describe, expect, test } from './harness';
import {
  DEFAULT_DOC_OPTIONS,
  buildDocArgs,
  coverageLine,
  docCoverage,
  docSections,
  indexFile,
  pageTitle,
  parseDocResult,
  undocumentedSymbol,
  type DocSummary,
} from '../src/renderer/docs/apiReference';

/** The exact summary `zornux doc … --json` printed for examples/docs: the
 *  envelope, with the summary under `result`. */
const REAL_SUMMARY = JSON.stringify({
  zornuxJson: 1,
  ok: true,
  command: 'doc',
  result: {
    project: 'Zornux Project',
    version: '1.0.0-rc.9',
    format: 'markdown',
    output: 'C:\\Temp\\api',
    written: true,
    modules: 3,
    files: ['index.md', 'modules/Products.md', 'classes/Product.md', 'modules/Contacts.md', 'services/ProductAPI.md'],
  },
  diagnostics: [],
});

/** A hard failure: an unknown --format makes the generator produce nothing —
 *  `ok:false`, with the reason in the envelope's `diagnostics`. */
const REAL_FAILURE = JSON.stringify({
  zornuxJson: 1,
  ok: false,
  command: 'doc',
  result: null,
  diagnostics: [
    {
      code: 'ZX1605',
      severity: 'error',
      message: "Unknown documentation format 'pdf'.",
      file: 'zxdocsrc',
      range: { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } },
      help: 'use --format markdown or --format html.',
    },
  ],
});

describe('zornux doc — argv', () => {
  test('output is always passed, json last', () => {
    expect(buildDocArgs('src', 'C:\\Temp\\api')).toEqual([
      'doc',
      'src',
      '--output',
      'C:\\Temp\\api',
      '--format',
      'markdown',
      '--json',
    ]);
  });

  test('flags are only added when enabled', () => {
    const args = buildDocArgs('src', 'out', {
      ...DEFAULT_DOC_OPTIONS,
      format: 'html',
      includePrivate: true,
      failOnMissingComments: true,
    });
    expect(args).toContain('--include-private');
    expect(args).toContain('--fail-on-missing-comments');
    expect(args).toContain('html');
    expect(args.includes('--include-tests')).toBe(false);
  });
});

describe('zornux doc — the envelope', () => {
  test('an ok:true envelope carries the summary from result', () => {
    const result = parseDocResult(REAL_SUMMARY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.modules).toBe(3);
    expect(result.summary.written).toBe(true);
    expect(result.summary.files).toHaveLength(5);
  });

  test('an ok:false envelope is a failure, not an empty API surface', () => {
    const result = parseDocResult(REAL_FAILURE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].code).toBe('ZX1605');
    expect(result.failures[0].help).toBe('use --format markdown or --format html.');
  });

  test('finds the payload after leading program output', () => {
    const result = parseDocResult(`writing docs...\nnote: something\n${REAL_SUMMARY}`);
    expect(result.ok).toBe(true);
  });

  test('no JSON at all is a failure, never a silent success', () => {
    const result = parseDocResult('Segmentation fault');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0].code).toBe('ZX1600');
  });

  test('summary severities are normalised from the lowercase the envelope carries', () => {
    const raw = JSON.stringify({
      zornuxJson: 1,
      ok: true,
      command: 'doc',
      result: {
        project: 'p',
        version: '1',
        format: 'markdown',
        output: 'o',
        written: false,
        modules: 1,
        files: ['index.md', 'modules/Widgets.md'],
      },
      diagnostics: [
        { code: 'ZX1601', severity: 'error', message: "'undocumented' has no documentation comment." },
        { code: 'ZX1602', severity: 'warning', message: "A 'param' documentation tag needs a parameter name." },
      ],
    });
    const result = parseDocResult(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.diagnostics[0].severity).toBe('Error');
    // written:false means those files were NOT created, though they are listed.
    expect(result.summary.written).toBe(false);
    expect(result.summary.files).toHaveLength(2);
  });
});

describe('zornux doc — navigation', () => {
  const summary: DocSummary = {
    project: 'p',
    version: '1',
    format: 'markdown',
    output: 'o',
    written: true,
    modules: 3,
    files: ['index.md', 'modules/Products.md', 'classes/Product.md', 'services/ProductAPI.md', 'assets/style.css'],
    diagnostics: [],
  };

  test('sections group by folder and drop assets and the index', () => {
    expect(docSections(summary.files)).toEqual([
      { name: 'Modules', files: ['modules/Products.md'] },
      { name: 'Classes', files: ['classes/Product.md'] },
      { name: 'Services', files: ['services/ProductAPI.md'] },
    ]);
  });

  test('empty sections are omitted', () => {
    expect(docSections(['index.md', 'modules/A.md'])).toEqual([{ name: 'Modules', files: ['modules/A.md'] }]);
  });

  test('the index file matches the format', () => {
    expect(indexFile(summary)).toBe('index.md');
    expect(indexFile({ ...summary, format: 'html', files: ['index.html'] })).toBe('index.html');
    expect(indexFile({ ...summary, files: ['modules/A.md'] })).toBeNull();
  });

  test('page titles drop the folder and extension', () => {
    expect(pageTitle('modules/Products.md')).toBe('Products');
    expect(pageTitle('services/ProductAPI.html')).toBe('ProductAPI');
  });
});

describe('zornux doc — coverage', () => {
  test('pulls the symbol name out of the ZX1601 message', () => {
    expect(undocumentedSymbol("'undocumented' has no documentation comment.")).toBe('undocumented');
    expect(undocumentedSymbol('mystery')).toBe('mystery');
  });

  test('splits missing comments from malformed tags', () => {
    const coverage = docCoverage([
      { code: 'ZX1601', severity: 'Warning', message: "'a' has no documentation comment." },
      { code: 'ZX1602', severity: 'Warning', message: "A 'param' tag needs a name." },
      { code: 'ZX1603', severity: 'Warning', message: 'Broken link.' },
    ]);
    expect(coverage.undocumented).toEqual(['a']);
    expect(coverage.invalidTags).toHaveLength(1);
    expect(coverage.other).toHaveLength(1);
    expect(coverage.wouldFail).toBe(true);
  });

  test('a malformed tag alone would not fail a strict run', () => {
    const coverage = docCoverage([{ code: 'ZX1602', severity: 'Warning', message: 'tag' }]);
    expect(coverage.wouldFail).toBe(false);
  });

  test('clean documentation would pass', () => {
    expect(docCoverage([]).wouldFail).toBe(false);
  });

  test('the coverage line says plainly when nothing was written', () => {
    const summary: DocSummary = {
      project: 'p',
      version: '1',
      format: 'markdown',
      output: 'o',
      written: false,
      modules: 1,
      files: ['index.md', 'modules/W.md'],
      diagnostics: [{ code: 'ZX1601', severity: 'Error', message: "'x' has no documentation comment." }],
    };
    const line = coverageLine(summary, docCoverage(summary.diagnostics));
    expect(line).toContain('NOT written');
    expect(line).toContain('1 public symbol(s) undocumented');
  });
});
