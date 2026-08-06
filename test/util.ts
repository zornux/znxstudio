import type { Range, TextDocument, WorkspaceEdit } from '../src/renderer/language/api';

const DEFAULT_URI = 'file:///test.zx';

/** A minimal in-memory TextDocument for headless tests. */
export function makeDoc(content: string, version = 1, uri = DEFAULT_URI): TextDocument {
  const lines = content.split(/\r?\n/);
  return {
    uri,
    path: 'test.zx',
    languageId: 'zornux',
    version,
    getText: () => content,
    lineCount: () => lines.length,
    lineAt: (line: number) => lines[line] ?? '',
  };
}

export function offsetOf(text: string, position: { line: number; character: number }): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < position.line; i++) offset += lines[i].length + 1;
  return offset + position.character;
}

/** Apply a single-file WorkspaceEdit to text (edits applied right-to-left). */
export function applyWorkspaceEdit(text: string, edit: WorkspaceEdit, uri = DEFAULT_URI): string {
  const edits = [...(edit.changes[uri] ?? [])].sort(
    (a, b) => offsetOf(text, b.range.start) - offsetOf(text, a.range.start),
  );
  for (const change of edits) {
    text = text.slice(0, offsetOf(text, change.range.start)) + change.newText + text.slice(offsetOf(text, change.range.end));
  }
  return text;
}

export function range(sl: number, sc: number, el: number, ec: number): Range {
  return { start: { line: sl, character: sc }, end: { line: el, character: ec } };
}
