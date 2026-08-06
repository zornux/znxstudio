import { describe, expect, test } from './harness';
import { tokenize } from '../src/renderer/language/languages/zornux/lexer';
import { IncrementalTokenizer } from '../src/renderer/language/languages/zornux/incremental';

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

describe('incremental tokenizer', () => {
  const src = 'define x to 1\nfunction main() {\n  say x\n  say y\n}\n';

  test('matches batch tokenize on a fresh document', () => {
    const inc = new IncrementalTokenizer().tokenize(src);
    const batch = tokenize(src);
    expect(eq(inc.tokens, batch.tokens)).toBe(true);
    expect(eq(inc.diagnostics, batch.diagnostics)).toBe(true);
  });

  test('matches batch after a same-line edit', () => {
    const inc = new IncrementalTokenizer();
    inc.tokenize(src);
    const edited = src.replace('say x', 'say renamed');
    expect(eq(inc.tokenize(edited).tokens, tokenize(edited).tokens)).toBe(true);
  });

  test('matches batch after inserting a line', () => {
    const inc = new IncrementalTokenizer();
    inc.tokenize(src);
    const inserted = src.replace('  say x\n', '  say x\n  let z is 3\n');
    expect(eq(inc.tokenize(inserted).tokens, tokenize(inserted).tokens)).toBe(true);
  });

  test('matches batch after deleting a line', () => {
    const inc = new IncrementalTokenizer();
    inc.tokenize(src);
    const deleted = src.replace('  say y\n', '');
    expect(eq(inc.tokenize(deleted).tokens, tokenize(deleted).tokens)).toBe(true);
  });
});
