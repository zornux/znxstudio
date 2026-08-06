import { describe, expect, test } from './harness';
import {
  BUILTIN_SNIPPETS,
  escapeSnippetBody,
  matchSnippets,
  parseUserSnippets,
  renderSnippetPreview,
  snippetsFor,
} from '../src/renderer/snippets/snippets';

describe('BUILTIN_SNIPPETS', () => {
  test('all Zornux snippets target the zornux language', () => {
    for (const snippet of BUILTIN_SNIPPETS) {
      expect(snippet.languages).toContain('zornux');
      expect(snippet.prefix.length).toBeGreaterThan(0);
      expect(snippet.body.length).toBeGreaterThan(0);
    }
  });

  test('the service snippet uses real Zornux surface syntax', () => {
    const service = BUILTIN_SNIPPETS.find((s) => s.prefix === 'service')!;
    const preview = renderSnippetPreview(service.body);
    expect(preview).toContain('service Name');
    expect(preview).toContain('on GET "/path"');
    expect(preview).toContain('publish Name on port 8080');
  });
});

describe('snippetsFor', () => {
  test('filters by language id', () => {
    expect(snippetsFor('zornux', BUILTIN_SNIPPETS).length).toBe(BUILTIN_SNIPPETS.length);
    expect(snippetsFor('python', BUILTIN_SNIPPETS)).toHaveLength(0);
  });
});

describe('matchSnippets', () => {
  test('matches prefix and name, empty query returns all', () => {
    const snippets = snippetsFor('zornux', BUILTIN_SNIPPETS);
    expect(matchSnippets('', snippets)).toHaveLength(snippets.length);
    expect(matchSnippets('for', snippets).map((s) => s.prefix)).toContain('for');
    expect(matchSnippets('zzzznomatch', snippets)).toHaveLength(0);
  });
});

describe('renderSnippetPreview', () => {
  test('resolves placeholders, choices and bare tab-stops', () => {
    expect(renderSnippetPreview('if ${1:condition}\n\t$0\nend')).toBe('if condition\n\t\nend');
    expect(renderSnippetPreview('on ${1|GET,POST|} "${2:/path}"')).toBe('on GET "/path"');
    expect(renderSnippetPreview('${1} literal $0')).toBe(' literal ');
  });
});

describe('escapeSnippetBody', () => {
  test('escapes backslashes and dollar signs so text inserts literally', () => {
    expect(escapeSnippetBody('cost = $5')).toBe('cost = \\$5');
    expect(escapeSnippetBody('a\\b')).toBe('a\\\\b');
  });
});

describe('parseUserSnippets', () => {
  test('accepts well-formed entries and drops bad ones', () => {
    const parsed = parseUserSnippets([
      { name: 'Log', prefix: 'log', body: 'show $1', languages: ['zornux'] },
      { prefix: 'noBody', languages: ['zornux'] }, // missing body
      { prefix: 'noLang', body: 'x', languages: [] }, // no language
      'garbage',
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Log');
    expect(parsed[0].description).toBe('User snippet');
  });

  test('non-array input yields nothing', () => {
    expect(parseUserSnippets(undefined)).toHaveLength(0);
    expect(parseUserSnippets({})).toHaveLength(0);
  });

  test('defaults the name to the prefix when omitted', () => {
    const parsed = parseUserSnippets([{ prefix: 'p', body: 'b', languages: ['zornux'] }]);
    expect(parsed[0].name).toBe('p');
  });
});
