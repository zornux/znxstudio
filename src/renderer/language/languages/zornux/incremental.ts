/**
 * Incremental tokenizer — Monaco-free.
 *
 * Zornux lines tokenize independently, so between two versions of a document we
 * reuse the previously-computed token array for every line whose text is
 * unchanged — no re-scanning AND no re-allocation (the cached tokens already
 * carry the correct absolute line, which is unchanged for a same-line-count
 * edit, the dominant "type within a line" case). Only changed lines are
 * re-tokenized. When the line COUNT changes we recompute fully (line numbers
 * shift); the parser/semantics passes are O(n) anyway.
 *
 * Output is byte-for-byte identical to the batch `tokenize` — reuse never
 * changes results, only cost. Tokens are treated as immutable by all consumers,
 * so sharing references across versions is safe.
 */
import {
  shiftDiagnostic,
  shiftToken,
  tokenizeLineRelative,
  TokenKind,
  type LexResult,
  type SrcPosition,
  type Token,
  type ZornuxDiagnostic,
} from './lexer';

export class IncrementalTokenizer {
  private prevLines: string[] = [];
  private prevTokens: Token[][] = [];
  private prevDiagnostics: ZornuxDiagnostic[][] = [];

  tokenize(source: string): LexResult {
    const lines = source.split(/\r?\n/);
    const sameLineCount = lines.length === this.prevLines.length;

    const tokens: Token[] = [];
    const diagnostics: ZornuxDiagnostic[] = [];
    const nextTokens: Token[][] = new Array(lines.length);
    const nextDiagnostics: ZornuxDiagnostic[][] = new Array(lines.length);

    for (let line = 0; line < lines.length; line++) {
      let lineTokens: Token[];
      let lineDiagnostics: ZornuxDiagnostic[];

      if (sameLineCount && this.prevLines[line] === lines[line]) {
        // Unchanged line: reuse its shifted tokens verbatim (line number is the same).
        lineTokens = this.prevTokens[line];
        lineDiagnostics = this.prevDiagnostics[line];
      } else {
        const relative = tokenizeLineRelative(lines[line]);
        lineTokens = relative.tokens.map((token) => shiftToken(token, line));
        lineDiagnostics = relative.diagnostics.map((diagnostic) => shiftDiagnostic(diagnostic, line));
      }

      nextTokens[line] = lineTokens;
      nextDiagnostics[line] = lineDiagnostics;
      for (const token of lineTokens) tokens.push(token);
      for (const diagnostic of lineDiagnostics) diagnostics.push(diagnostic);
    }

    const last = lines.length - 1;
    const end: SrcPosition = { line: last, character: lines[last].length };
    tokens.push({ kind: TokenKind.EOF, value: '', range: { start: end, end: { ...end } } });

    this.prevLines = lines;
    this.prevTokens = nextTokens;
    this.prevDiagnostics = nextDiagnostics;
    return { tokens, diagnostics };
  }

  clear(): void {
    this.prevLines = [];
    this.prevTokens = [];
    this.prevDiagnostics = [];
  }
}
