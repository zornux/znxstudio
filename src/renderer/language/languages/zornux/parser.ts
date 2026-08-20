/**
 * Zornux parser foundation — Monaco-free, IDE-agnostic.
 *
 * Two responsibilities, both first-pass:
 *   1. Structural diagnostics (unchanged): balanced delimiters + lexical issues.
 *   2. A first real AST: a File node with imports, functions, classes/records,
 *      types, variables/constants, parameters and blocks — each with ranges.
 *
 * The parser is recovery-oriented: unknown/expression tokens are skipped and
 * unclosed constructs still yield a partial subtree, so an incomplete file keeps
 * producing usable symbols. It does NO semantic analysis and invents no features.
 */
import { tokenize, TokenKind, type LexResult, type SrcPosition, type SrcRange, type Token, type ZornuxDiagnostic } from './lexer';
import type {
  BlockNode,
  ClassNode,
  FileNode,
  FunctionNode,
  ImportNode,
  ParameterNode,
  StatementNode,
  TypeNode,
  VariableNode,
} from './ast';

export interface ZornuxParseResult {
  ast: FileNode;
  diagnostics: ZornuxDiagnostic[];
}

export function parseZornux(source: string, lex?: LexResult): ZornuxParseResult {
  const { tokens, diagnostics: lexical } = lex ?? tokenize(source);
  const diagnostics: ZornuxDiagnostic[] = [...lexical];
  validateDelimiters(tokens, diagnostics);

  const cursor = new Cursor(tokens.filter((token) => token.kind !== TokenKind.Comment));
  const body = parseStatements(cursor, false);
  const end = tokens[tokens.length - 1]?.range.end ?? { line: 0, character: 0 };
  const ast: FileNode = { kind: 'File', body, range: { start: { line: 0, character: 0 }, end } };

  diagnostics.sort(
    (a, b) =>
      a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character,
  );
  return { ast, diagnostics };
}

/* ----- token cursor ----- */
class Cursor {
  index = 0;
  constructor(private readonly tokens: Token[]) {}
  peek(offset = 0): Token {
    return this.tokens[this.index + offset] ?? this.tokens[this.tokens.length - 1];
  }
  next(): Token {
    const token = this.peek();
    this.index++;
    return token;
  }
  atEnd(): boolean {
    return this.peek().kind === TokenKind.EOF;
  }
}

/* ----- statements ----- */
function parseStatements(cursor: Cursor, insideBlock: boolean): StatementNode[] {
  const statements: StatementNode[] = [];
  while (!cursor.atEnd()) {
    if (insideBlock && cursor.peek().kind === TokenKind.BraceClose) break;
    if (insideBlock && isEndKeyword(cursor.peek())) break;
    const before = cursor.index;
    const statement = parseStatement(cursor);
    if (statement) statements.push(statement);
    if (cursor.index === before) cursor.next(); // guarantee forward progress
  }
  return statements;
}

function parseStatement(cursor: Cursor): StatementNode | null {
  const token = cursor.peek();

  if (token.kind === TokenKind.Keyword) {
    switch (token.value) {
      case 'export':
        cursor.next();
        return parseStatement(cursor);
      case 'import':
        return parseImport(cursor);
      case 'function':
        return parseFunction(cursor);
      case 'class':
        return parseClassLike(cursor, 'Class');
      case 'record':
        return parseClassLike(cursor, 'Record');
      case 'type':
        return parseType(cursor);
      case 'create':
        return parseVariable(cursor, 'Variable');
      case 'define':
        return parseVariable(cursor, 'Constant');
      case 'let':
        return parseVariable(cursor, 'Variable');
      default:
        cursor.next();
        return null;
    }
  }

  if (token.kind === TokenKind.BraceOpen) return parseBlock(cursor);

  cursor.next(); // expression/statement noise — skip
  return null;
}

function parseImport(cursor: Cursor): ImportNode {
  const keyword = cursor.next();
  // The module path may be a dotted qualified name (`Api.Identity.Service`).
  // Consume every `.<segment>` so the `as`/`showing`/`from` clauses that follow
  // are still parsed — previously only the first segment was read, orphaning the
  // rest and dropping the `showing` clause (its exposed symbols never entered
  // scope, so every use of them was falsely flagged "cannot find name").
  const nameToken = isNameToken(cursor.peek()) ? cursor.next() : null;
  let name = nameToken ? stripQuotes(nameToken.value) : '(import)';
  const nameStart = nameToken?.range.start ?? keyword.range.start;
  let nameEnd = nameToken?.range.end ?? keyword.range.end;
  while (
    nameToken &&
    cursor.peek().kind === TokenKind.Punctuation &&
    cursor.peek().value === '.' &&
    isNameToken(cursor.peek(1))
  ) {
    cursor.next(); // '.'
    const segment = cursor.next();
    name += `.${stripQuotes(segment.value)}`;
    nameEnd = segment.range.end;
  }
  const nameRange: SrcRange = { start: nameStart, end: nameEnd };
  let source: string | undefined;
  let alias: string | undefined;
  let aliasRange: SrcRange | undefined;
  let showingRange: SrcRange | undefined;
  const exposed: { name: string; range: SrcRange }[] = [];
  let end = nameRange.end;

  // Optional `as <alias>` — the module gets a local handle.
  if (cursor.peek().kind === TokenKind.Keyword && cursor.peek().value === 'as' && isNameToken(cursor.peek(1))) {
    cursor.next();
    const aliasToken = cursor.next();
    alias = aliasToken.value;
    aliasRange = aliasToken.range;
    end = aliasToken.range.end;
  }

  // Optional `showing <name>(, <name>)*` — selective import (`showing` is contextual,
  // an Identifier not a keyword). Each listed name is brought into the file's scope.
  if (cursor.peek().value === 'showing') {
    showingRange = cursor.next().range;
    while (isNameToken(cursor.peek())) {
      const symbol = cursor.next();
      exposed.push({ name: symbol.value, range: symbol.range });
      end = symbol.range.end;
      if (cursor.peek().kind === TokenKind.Punctuation && cursor.peek().value === ',') {
        cursor.next();
        continue;
      }
      break;
    }
  }

  if (cursor.peek().kind === TokenKind.Keyword && cursor.peek().value === 'from') {
    cursor.next();
    if (cursor.peek().kind === TokenKind.String) {
      const stringToken = cursor.next();
      source = stripQuotes(stringToken.value);
      end = stringToken.range.end;
    }
  }
  return { kind: 'Import', name, nameRange, alias, aliasRange, exposed, showingRange, source, range: { start: keyword.range.start, end } };
}

function parseFunction(cursor: Cursor): FunctionNode {
  const keyword = cursor.next();
  const nameToken = cursor.peek().kind === TokenKind.Identifier ? cursor.next() : null;
  const name = nameToken?.value ?? '(anonymous)';
  const nameRange = nameToken?.range ?? keyword.range;
  const params = parseParameters(cursor);
  const body = cursor.peek().kind === TokenKind.BraceOpen
    ? parseBlock(cursor)
    : parseEndBlock(cursor);
  const end = body?.range.end ?? params.end ?? nameRange.end;
  return { kind: 'Function', name, nameRange, params: params.list, body, range: { start: keyword.range.start, end } };
}

function parseParameters(cursor: Cursor): { list: ParameterNode[]; end?: SrcPosition } {
  // Real Zornux: `function name with param1, param2`
  if (cursor.peek().kind === TokenKind.Keyword && cursor.peek().value === 'with') {
    cursor.next();
    const list: ParameterNode[] = [];
    let end: SrcPosition | undefined;
    while (cursor.peek().kind === TokenKind.Identifier) {
      const id = cursor.next();
      list.push({ kind: 'Parameter', name: id.value, nameRange: id.range, range: id.range });
      end = id.range.end;
      if (cursor.peek().kind === TokenKind.Punctuation && cursor.peek().value === ',') {
        cursor.next();
        continue;
      }
      break;
    }
    return { list, end };
  }

  // Legacy front-end: `function name(param1, param2)`
  if (cursor.peek().kind !== TokenKind.ParenOpen) return { list: [] };
  const open = cursor.next();
  const list: ParameterNode[] = [];
  let end: SrcPosition = open.range.end;

  while (!cursor.atEnd()) {
    const token = cursor.peek();
    if (token.kind === TokenKind.ParenClose) {
      end = cursor.next().range.end;
      break;
    }
    if (token.kind === TokenKind.BraceOpen) break; // recovery: params never closed
    if (token.kind === TokenKind.Identifier) {
      const id = cursor.next();
      list.push({ kind: 'Parameter', name: id.value, nameRange: id.range, range: id.range });
      end = id.range.end;
      continue;
    }
    end = cursor.next().range.end; // skip commas / noise
  }
  return { list, end };
}

function parseBlock(cursor: Cursor): BlockNode {
  const open = cursor.next(); // '{'
  const body = parseStatements(cursor, true);
  let end = open.range.end;
  if (cursor.peek().kind === TokenKind.BraceClose) {
    end = cursor.next().range.end;
  } else if (body.length) {
    end = body[body.length - 1].range.end; // unclosed — recover to last child
  }
  return { kind: 'Block', body, range: { start: open.range.start, end } };
}

function parseClassLike(cursor: Cursor, kind: 'Class' | 'Record'): ClassNode {
  const keyword = cursor.next();
  const nameToken = cursor.peek().kind === TokenKind.Identifier ? cursor.next() : null;
  const name = nameToken?.value ?? '(anonymous)';
  const nameRange = nameToken?.range ?? keyword.range;
  const body = cursor.peek().kind === TokenKind.BraceOpen
    ? parseBlock(cursor)
    : parseEndBlock(cursor);
  const end = body?.range.end ?? nameRange.end;
  return { kind, name, nameRange, body, range: { start: keyword.range.start, end } };
}

function parseType(cursor: Cursor): TypeNode {
  const keyword = cursor.next();
  const nameToken = cursor.peek().kind === TokenKind.Identifier ? cursor.next() : null;
  const name = nameToken?.value ?? '(type)';
  const nameRange = nameToken?.range ?? keyword.range;
  return { kind: 'Type', name, nameRange, range: { start: keyword.range.start, end: nameRange.end } };
}

function parseVariable(cursor: Cursor, kind: 'Variable' | 'Constant'): VariableNode | null {
  const keyword = cursor.next();
  const nameToken = cursor.peek().kind === TokenKind.Identifier ? cursor.next() : null;
  if (!nameToken) return null; // incomplete declaration — no symbol
  return {
    kind,
    name: nameToken.value,
    nameRange: nameToken.range,
    range: { start: keyword.range.start, end: nameToken.range.end },
  };
}

/* ----- delimiter validation (unchanged behavior) ----- */
interface OpenDelimiter {
  openKind: TokenKind;
  open: string;
  close: string;
  range: SrcRange;
}

const OPENERS: Partial<Record<TokenKind, { open: string; close: string }>> = {
  [TokenKind.BraceOpen]: { open: '{', close: '}' },
  [TokenKind.ParenOpen]: { open: '(', close: ')' },
  [TokenKind.BracketOpen]: { open: '[', close: ']' },
};
const CLOSERS: Partial<Record<TokenKind, { openKind: TokenKind; open: string; close: string }>> = {
  [TokenKind.BraceClose]: { openKind: TokenKind.BraceOpen, open: '{', close: '}' },
  [TokenKind.ParenClose]: { openKind: TokenKind.ParenOpen, open: '(', close: ')' },
  [TokenKind.BracketClose]: { openKind: TokenKind.BracketOpen, open: '[', close: ']' },
};

function validateDelimiters(tokens: Token[], diagnostics: ZornuxDiagnostic[]): void {
  const stack: OpenDelimiter[] = [];
  for (const token of tokens) {
    const opener = OPENERS[token.kind];
    if (opener) {
      stack.push({ openKind: token.kind, open: opener.open, close: opener.close, range: token.range });
      continue;
    }
    const closer = CLOSERS[token.kind];
    if (!closer) continue;

    const top = stack[stack.length - 1];
    if (!top) {
      diagnostics.push({
        severity: 'error',
        code: 'zx-unexpected-close',
        message: `Unexpected closing '${closer.close}'.`,
        hint: `Remove it, or add a matching opening '${closer.open}' earlier.`,
        range: token.range,
      });
    } else if (top.openKind !== closer.openKind) {
      diagnostics.push({
        severity: 'error',
        code: 'zx-mismatched-delimiter',
        message: `Mismatched '${closer.close}'; expected '${top.close}'.`,
        hint: `Close '${top.open}' with '${top.close}' before using '${closer.close}'.`,
        range: token.range,
      });
      stack.pop();
    } else {
      stack.pop();
    }
  }
  for (const unclosed of stack) {
    diagnostics.push({
      severity: 'error',
      code: 'zx-unclosed-delimiter',
      message: `Unclosed '${unclosed.open}'.`,
      hint: `Add a matching closing '${unclosed.close}'.`,
      range: unclosed.range,
    });
  }
}

/* ----- end-terminated blocks (real Zornux syntax) ----- */

/** True when `token` is the `end` keyword — terminates function/class/if/etc. blocks. */
function isEndKeyword(token: Token): boolean {
  return token.kind === TokenKind.Keyword && token.value === 'end';
}

/**
 * Parse an `end`-terminated block (real Zornux syntax). Called when the next
 * token is NOT `{` — the body runs until the `end` keyword. Returns null when
 * there is no body content and no `end` (e.g. a forward declaration).
 */
function parseEndBlock(cursor: Cursor): BlockNode | null {
  const start = cursor.peek().range.start;
  const body = parseStatements(cursor, true);
  let end = start;
  if (isEndKeyword(cursor.peek())) {
    end = cursor.next().range.end;
  } else if (body.length) {
    end = body[body.length - 1].range.end;
  } else {
    return null;
  }
  return { kind: 'Block', body, range: { start, end } };
}

/* ----- helpers ----- */
function isNameToken(token: Token): boolean {
  return token.kind === TokenKind.Identifier || token.kind === TokenKind.String;
}

function stripQuotes(value: string): string {
  return value.startsWith('"') ? value.replace(/^"|"$/g, '') : value;
}
