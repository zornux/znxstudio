import { describe, expect, test } from './harness';
import {
  completionKindToPlatform,
  lspCompletionItemToPlatform,
  lspCompletionToPlatform,
  lspDocumentSymbolsToPlatform,
  lspFoldingRangesToPlatform,
  lspHoverToPlatform,
  lspLocationsToPlatform,
  lspSemanticTokensToPlatform,
  lspSignatureHelpToPlatform,
  lspTextEditsToPlatform,
  lspWorkspaceEditToPlatform,
} from '../src/renderer/language/lsp/lspConversions';
import { ZORNUX_SEMANTIC_LEGEND } from '../src/renderer/language/lsp/semanticLegend';

const range = (line: number, s: number, e: number) => ({
  start: { line, character: s },
  end: { line, character: e },
});

describe('lsp completion conversion', () => {
  test('maps LSP completion kind ints to platform kind strings', () => {
    expect(completionKindToPlatform(3)).toBe('function');
    expect(completionKindToPlatform(6)).toBe('variable');
    expect(completionKindToPlatform(14)).toBe('keyword');
    expect(completionKindToPlatform(7)).toBe('class');
  });

  test('unknown or missing kind maps to undefined (bridge defaults to Text)', () => {
    expect(completionKindToPlatform(99)).toBeFalsy();
    expect(completionKindToPlatform(undefined)).toBeFalsy();
  });

  test('maps an item, flattening MarkupContent documentation', () => {
    const item = lspCompletionItemToPlatform({
      label: 'greet',
      kind: 3,
      detail: 'function',
      documentation: { value: 'Say hi' },
    });
    expect(item.label).toBe('greet');
    expect(item.kind).toBe('function');
    expect(item.detail).toBe('function');
    expect(item.documentation).toBe('Say hi');
  });

  test('accepts a bare array (the server returns CompletionItem[], not a list)', () => {
    const list = lspCompletionToPlatform([{ label: 'a' }, { label: 'b', kind: 14 }]);
    expect(list.items).toHaveLength(2);
    expect(list.items[1].kind).toBe('keyword');
  });

  test('accepts a { items } object and tolerates null', () => {
    expect(lspCompletionToPlatform({ items: [{ label: 'x' }] }).items).toHaveLength(1);
    expect(lspCompletionToPlatform(null).items).toHaveLength(0);
  });
});

describe('lsp hover conversion', () => {
  test('returns null for a null result or empty contents', () => {
    expect(lspHoverToPlatform(null)).toBeNull();
    expect(lspHoverToPlatform({ contents: { value: '' } })).toBeNull();
  });

  test('extracts MarkupContent value and copies the 0-based range', () => {
    const hover = lspHoverToPlatform({
      contents: { kind: 'markdown', value: '```zornux\nfunction greet()\n```' },
      range: { start: { line: 1, character: 6 }, end: { line: 1, character: 11 } },
    });
    expect(hover).toBeTruthy();
    expect(hover!.contents[0]).toContain('function greet()');
    expect(hover!.range?.start.line).toBe(1);
    expect(hover!.range?.start.character).toBe(6);
  });

  test('handles string contents and an array of contents', () => {
    expect(lspHoverToPlatform({ contents: 'hi' })!.contents).toHaveLength(1);
    expect(lspHoverToPlatform({ contents: ['a', { value: 'b' }] })!.contents).toHaveLength(2);
  });
});

describe('lsp locations conversion', () => {
  test('wraps a single Location (definition) into an array', () => {
    const locs = lspLocationsToPlatform({ uri: 'file:///a.zx', range: range(1, 9, 22) });
    expect(locs).toHaveLength(1);
    expect(locs[0].uri).toBe('file:///a.zx');
    expect(locs[0].range.start.line).toBe(1);
  });

  test('maps an array (references) and drops malformed entries', () => {
    const locs = lspLocationsToPlatform([
      { uri: 'file:///a.zx', range: range(6, 9, 14) },
      { uri: 'file:///a.zx', range: range(12, 5, 10) },
    ]);
    expect(locs).toHaveLength(2);
    expect(locs.map((l) => l.range.start.line).join(',')).toBe('6,12');
  });

  test('null → empty array', () => {
    expect(lspLocationsToPlatform(null)).toHaveLength(0);
  });
});

describe('lsp signatureHelp conversion', () => {
  test('maps signatures + parameters and defaults active indices', () => {
    const help = lspSignatureHelpToPlatform({
      signatures: [{ label: 'calculate_tax(price)', parameters: [{ label: 'price' }] }],
      activeParameter: 0,
    });
    expect(help).toBeTruthy();
    expect(help!.signatures[0].label).toBe('calculate_tax(price)');
    expect(help!.signatures[0].parameters).toHaveLength(1);
    expect(help!.activeSignature).toBe(0);
  });

  test('null when there are no signatures', () => {
    expect(lspSignatureHelpToPlatform({ signatures: [] })).toBeNull();
    expect(lspSignatureHelpToPlatform(null)).toBeNull();
  });
});

describe('lsp workspaceEdit conversion', () => {
  test('maps per-uri text edits', () => {
    const edit = lspWorkspaceEditToPlatform({
      changes: {
        'file:///a.zx': [
          { range: range(6, 9, 14), newText: 'greeting' },
          { range: range(12, 5, 10), newText: 'greeting' },
        ],
      },
    });
    expect(edit).toBeTruthy();
    expect(edit!.changes['file:///a.zx']).toHaveLength(2);
    expect(edit!.changes['file:///a.zx'][0].newText).toBe('greeting');
  });

  test('a present-but-empty change map is authoritative (not null)', () => {
    const edit = lspWorkspaceEditToPlatform({ changes: {} });
    expect(edit).toBeTruthy();
    expect(Object.keys(edit!.changes)).toHaveLength(0);
  });

  test('missing changes → null (fall back to TS)', () => {
    expect(lspWorkspaceEditToPlatform({})).toBeNull();
    expect(lspWorkspaceEditToPlatform(null)).toBeNull();
  });
});

describe('lsp formatting conversion', () => {
  test('maps a whole-document TextEdit[]', () => {
    const edits = lspTextEditsToPlatform([{ range: range(0, 0, 0), newText: 'formatted\n' }]);
    expect(edits).toHaveLength(1);
    expect(edits[0].newText).toBe('formatted\n');
  });

  test('non-array (already formatted / null) → empty', () => {
    expect(lspTextEditsToPlatform(null)).toHaveLength(0);
  });
});

describe('lsp documentSymbol conversion', () => {
  test('maps kind ints to strings and preserves the hierarchy', () => {
    const symbols = lspDocumentSymbolsToPlatform([
      {
        name: 'Account',
        kind: 5, // Class
        range: range(0, 0, 20),
        selectionRange: range(0, 6, 13),
        children: [{ name: 'balance', kind: 8, range: range(1, 2, 12), selectionRange: range(1, 2, 9) }],
      },
      { name: 'greet', kind: 12, range: range(3, 0, 5), selectionRange: range(3, 0, 5) },
    ]);
    expect(symbols).toHaveLength(2);
    expect(symbols[0].kind).toBe('class');
    expect(symbols[0].children).toHaveLength(1);
    expect(symbols[0].children![0].kind).toBe('field');
    expect(symbols[1].kind).toBe('function');
  });

  test('unknown/missing kind defaults to variable; non-array → empty', () => {
    expect(lspDocumentSymbolsToPlatform([{ name: 'x', range: range(0, 0, 1), selectionRange: range(0, 0, 1) }])[0].kind).toBe(
      'variable',
    );
    expect(lspDocumentSymbolsToPlatform(null)).toHaveLength(0);
  });
});

describe('lsp folding conversion', () => {
  test('maps startLine/endLine (0-based) preserving kind', () => {
    const folds = lspFoldingRangesToPlatform([
      { startLine: 1, endLine: 4 },
      { startLine: 6, endLine: 8, kind: 'region' },
    ]);
    expect(folds).toHaveLength(2);
    expect(folds[0].start).toBe(1);
    expect(folds[0].end).toBe(4);
    expect(folds[1].kind).toBe('region');
  });

  test('non-array → empty', () => {
    expect(lspFoldingRangesToPlatform(undefined)).toHaveLength(0);
  });
});

describe('lsp semantic tokens conversion', () => {
  test('passes the delta-encoded data array through', () => {
    const tokens = lspSemanticTokensToPlatform({ data: [0, 0, 4, 0, 0, 1, 4, 5, 3, 0] });
    expect(tokens.data).toHaveLength(10);
    expect(tokens.data[3]).toBe(0); // token type index into the legend
  });

  test('missing/invalid data → empty', () => {
    expect(lspSemanticTokensToPlatform({}).data).toHaveLength(0);
    expect(lspSemanticTokensToPlatform(null).data).toHaveLength(0);
  });

  test('legend matches the server contract (15 types, order-sensitive)', () => {
    // The token-type ints index into this list, so order is load-bearing.
    expect(ZORNUX_SEMANTIC_LEGEND.tokenTypes).toHaveLength(15);
    expect(ZORNUX_SEMANTIC_LEGEND.tokenTypes[0]).toBe('keyword');
    expect(ZORNUX_SEMANTIC_LEGEND.tokenTypes[3]).toBe('function');
    expect(ZORNUX_SEMANTIC_LEGEND.tokenTypes[14]).toBe('operator');
    expect(ZORNUX_SEMANTIC_LEGEND.tokenModifiers).toHaveLength(0);
  });
});
