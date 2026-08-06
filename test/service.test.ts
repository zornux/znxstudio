import { describe, expect, test } from './harness';
import { LanguageServiceZornux } from '../src/renderer/language/languages/LanguageServiceZornux';
import { applyWorkspaceEdit, makeDoc } from './util';

const svc = new LanguageServiceZornux();

describe('service: diagnostics', () => {
  test('merges syntax + semantic sources', async () => {
    const doc = makeDoc('define x to 1\ndefine x to 2\nsay "oops\n', 1);
    const codes = (await svc.diagnostics!.provideDiagnostics(doc)).map((d) => d.code);
    expect(codes).toContain('zx-duplicate-declaration'); // semantic
    expect(codes).toContain('zx-unterminated-string'); // syntax
  });
});

describe('service: completion', () => {
  test('includes in-scope symbols and keywords', async () => {
    const doc = makeDoc('define value to 1\nfunction main() {\n  say value\n}\n', 2);
    const list = await svc.completion!.provideCompletions(doc, { line: 2, character: 6 });
    const labels = list.items.map((i) => i.label);
    expect(labels).toContain('value');
    expect(labels).toContain('main');
    expect(labels).toContain('define');
  });

  test('declares "." as a member trigger character', () => {
    // Without this, member (dot) completion never auto-opens even though the
    // language server answers `textDocument/completion` on `.`.
    expect(svc.completion!.triggerCharacters).toEqual(['.']);
  });

  test('stays quiet in member position with no server (no keyword spam after ".")', async () => {
    const doc = makeDoc('define value to 1\nsay value.\n', 9);
    const list = await svc.completion!.provideCompletions(doc, { line: 1, character: 10 });
    expect(list.items).toHaveLength(0);
  });
});

describe('service: hover + signature help', () => {
  const doc = makeDoc('function greet(name, greeting) {\n  say greeting\n}\ncall greet(a, b)\n', 3);
  test('hover shows a function signature', async () => {
    const hover = await svc.hover!.provideHover(doc, { line: 0, character: 10 });
    expect(hover?.contents[0]).toContain('function greet(name, greeting)');
  });
  test('hover returns null on a keyword', async () => {
    expect(await svc.hover!.provideHover(doc, { line: 1, character: 3 })).toBeNull();
  });
  test('signature help tracks the active parameter', async () => {
    const sig = await svc.signatureHelp!.provideSignatureHelp(doc, { line: 3, character: 14 });
    expect(sig?.signatures[0].label).toBe('greet(name, greeting)');
    expect(sig?.activeParameter).toBe(1);
  });
});

describe('service: references + rename', () => {
  const doc = makeDoc('define value to 1\nsay value\nsay value\n', 4);
  test('references returns declaration + uses', async () => {
    expect(await svc.references!.provideReferences(doc, { line: 1, character: 5 })).toHaveLength(3);
  });
  test('rename edits every occurrence', async () => {
    const edit = await svc.rename!.provideRenameEdits(doc, { line: 1, character: 5 }, 'amount');
    expect(edit?.changes[doc.uri]).toHaveLength(3);
  });
  test('rename rejects keywords and invalid names', async () => {
    expect(await svc.rename!.provideRenameEdits(doc, { line: 1, character: 5 }, 'if')).toBeNull();
    expect(await svc.rename!.provideRenameEdits(doc, { line: 1, character: 5 }, '9bad')).toBeNull();
  });
});

describe('service: code actions (quick fixes)', () => {
  const codeCount = async (text: string, code: string): Promise<number> =>
    (await svc.diagnostics!.provideDiagnostics(makeDoc(text, Math.random()))).filter((d) => d.code === code).length;

  test('did-you-mean fix resolves the undefined identifier', async () => {
    const src = 'define value to 1\nsay valeu\n';
    const doc = makeDoc(src, 5);
    const actions = await svc.codeActions!.provideCodeActions(
      doc,
      { start: { line: 1, character: 4 }, end: { line: 1, character: 9 } },
      { diagnostics: [] },
    );
    expect(actions[0].title).toContain("to 'value'");
    const fixed = applyWorkspaceEdit(src, actions[0].edit!);
    expect(await codeCount(fixed, 'zx-undefined-identifier')).toBe(0);
  });

  test('remove-duplicate fix resolves the duplicate', async () => {
    const src = 'define count to 1\ndefine count to 2\n';
    const doc = makeDoc(src, 6);
    const actions = await svc.codeActions!.provideCodeActions(
      doc,
      { start: { line: 1, character: 7 }, end: { line: 1, character: 12 } },
      { diagnostics: [] },
    );
    const remove = actions.find((a) => a.title.includes('Remove duplicate'))!;
    expect(await codeCount(applyWorkspaceEdit(src, remove.edit!), 'zx-duplicate-declaration')).toBe(0);
  });
});

describe('service: refactorings', () => {
  test('inline constant replaces uses and removes the declaration', async () => {
    const src = 'define greeting to "Hello"\nsay greeting\nsay greeting\n';
    const doc = makeDoc(src, 7);
    const actions = await svc.codeActions!.provideCodeActions(
      doc,
      { start: { line: 0, character: 8 }, end: { line: 0, character: 8 } },
      { diagnostics: [] },
    );
    const inline = actions.find((a) => a.kind === 'refactor.inline')!;
    expect(applyWorkspaceEdit(src, inline.edit!)).toBe('say "Hello"\nsay "Hello"\n');
  });

  test('convert variable → constant rewrites the declaration', async () => {
    const src = 'let counter is 0\nsay counter\n';
    const doc = makeDoc(src, 8);
    const actions = await svc.codeActions!.provideCodeActions(
      doc,
      { start: { line: 0, character: 4 }, end: { line: 0, character: 4 } },
      { diagnostics: [] },
    );
    const convert = actions.find((a) => a.kind === 'refactor.rewrite')!;
    expect(applyWorkspaceEdit(src, convert.edit!)).toContain('define counter to 0');
  });
});
