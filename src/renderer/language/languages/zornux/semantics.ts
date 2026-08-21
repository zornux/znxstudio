/**
 * Zornux semantic analysis engine — Monaco-free and platform-API-free.
 *
 * Consumes the 2C AST plus the source, and produces:
 *   - a scoped symbol table (file / function / class / block scopes)
 *   - duplicate-declaration diagnostics
 *   - undefined-identifier diagnostics (scope-resolved)
 *   - an import foundation (imported names contribute symbols)
 *   - a reference index (occurrence → declaration) for go-to-definition
 *
 * This is a FOUNDATION: it does name/scope resolution, not type checking. It is
 * intentionally conservative and never throws. The real Zornux compiler's
 * semantic model replaces this file behind the language-service boundary.
 */
import { tokenize, TokenKind, type SrcPosition, type SrcRange, type Token } from './lexer';
import type { StatementNode, FileNode } from './ast';

export type SemanticSeverity = 'error' | 'warning' | 'info';

export interface SemanticDiagnostic {
  severity: SemanticSeverity;
  code: string;
  message: string;
  hint?: string;
  range: SrcRange;
}

export type SymbolKind =
  | 'function'
  | 'class'
  | 'record'
  | 'type'
  | 'variable'
  | 'constant'
  | 'parameter'
  | 'import';

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  nameRange: SrcRange;
  range: SrcRange;
  /** Parameter names, for functions (used by signature help). */
  params?: string[];
}

export interface Scope {
  kind: 'file' | 'function' | 'class' | 'block';
  range: SrcRange;
  parent: Scope | null;
  symbols: Map<string, SymbolInfo>;
  children: Scope[];
}

export interface ReferenceInfo {
  name: string;
  range: SrcRange;
  target: SymbolInfo;
}

export interface ImportInfo {
  name: string;
  source?: string;
  nameRange: SrcRange;
  resolved: boolean;
}

export interface SemanticModel {
  fileScope: Scope;
  diagnostics: SemanticDiagnostic[];
  references: ReferenceInfo[];
  imports: ImportInfo[];
}

interface BuildContext {
  diagnostics: SemanticDiagnostic[];
  imports: ImportInfo[];
  declPositions: Set<string>;
}

export function analyze(file: FileNode, tokens: Token[]): SemanticModel {
  const diagnostics: SemanticDiagnostic[] = [];
  const imports: ImportInfo[] = [];
  const declPositions = new Set<string>();

  const fileScope: Scope = {
    kind: 'file',
    range: file.range,
    parent: null,
    symbols: new Map(),
    children: [],
  };

  processStatements(file.body, fileScope, { diagnostics, imports, declPositions });

  const references: ReferenceInfo[] = [];
  const headerRanges = collectHeaderRanges(file.body);
  resolveReferences(tokens, fileScope, declPositions, references, diagnostics, headerRanges);

  diagnostics.sort(
    (a, b) =>
      a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character,
  );
  return { fileScope, diagnostics, references, imports };
}

/** Return the declaration a position points at, if it lands on a known reference. */
export function findDefinition(model: SemanticModel, position: SrcPosition): SymbolInfo | null {
  for (const reference of model.references) {
    if (rangeContains(reference.range, position)) return reference.target;
  }
  return null;
}

/** The symbol under a position — whether it's a reference occurrence or a declaration name. */
export function symbolAt(model: SemanticModel, position: SrcPosition): SymbolInfo | null {
  for (const reference of model.references) {
    if (rangeContains(reference.range, position)) return reference.target;
  }
  return findDeclarationAt(model.fileScope, position);
}

/**
 * All occurrences of the symbol under a position: its declaration name plus
 * every resolved reference to that exact symbol (scope-aware — a same-named
 * symbol in another scope is not included). Ranges are sorted by position.
 */
export function findOccurrences(
  model: SemanticModel,
  position: SrcPosition,
  includeDeclaration = true,
): { symbol: SymbolInfo; ranges: SrcRange[] } | null {
  const target = symbolAt(model, position);
  if (!target) return null;

  const ranges: SrcRange[] = [];
  if (includeDeclaration) ranges.push(target.nameRange);
  for (const reference of model.references) {
    if (reference.target === target) ranges.push(reference.range);
  }
  ranges.sort(
    (a, b) => a.start.line - b.start.line || a.start.character - b.start.character,
  );
  return { symbol: target, ranges };
}

function findDeclarationAt(scope: Scope, position: SrcPosition): SymbolInfo | null {
  for (const symbol of scope.symbols.values()) {
    if (rangeContains(symbol.nameRange, position)) return symbol;
  }
  for (const child of scope.children) {
    const found = findDeclarationAt(child, position);
    if (found) return found;
  }
  return null;
}

/**
 * If `position` sits inside a function call's argument list, return the callee
 * name and the active (0-based) parameter index. Token-based and forgiving.
 */
export function findCallContext(
  source: string,
  position: SrcPosition,
): { name: string; activeParameter: number } | null {
  const { tokens } = tokenize(source);
  const stack: { name: string | null; commas: number }[] = [];
  let previous: Token | null = null;

  for (const token of tokens) {
    if (!positionLT(token.range.start, position)) break;
    if (token.kind === TokenKind.ParenOpen) {
      stack.push({ name: previous?.kind === TokenKind.Identifier ? previous.value : null, commas: 0 });
    } else if (token.kind === TokenKind.ParenClose) {
      stack.pop();
    } else if (token.kind === TokenKind.Punctuation && token.value === ',' && stack.length) {
      stack[stack.length - 1].commas++;
    }
    if (token.kind !== TokenKind.Comment) previous = token;
  }

  const top = stack[stack.length - 1];
  return top?.name ? { name: top.name, activeParameter: top.commas } : null;
}

/**
 * Every symbol visible from a position: the innermost scope's symbols plus all
 * enclosing scopes, nearer scopes shadowing farther ones. Used for completion.
 */
export function symbolsInScope(model: SemanticModel, position: SrcPosition): SymbolInfo[] {
  const seen = new Set<string>();
  const result: SymbolInfo[] = [];
  for (let scope: Scope | null = findScope(model.fileScope, position); scope; scope = scope.parent) {
    for (const symbol of scope.symbols.values()) {
      if (!seen.has(symbol.name)) {
        seen.add(symbol.name);
        result.push(symbol);
      }
    }
  }
  return result;
}

/* ----- scope + symbol construction ----- */
function processStatements(statements: StatementNode[], scope: Scope, ctx: BuildContext): void {
  for (const node of statements) {
    switch (node.kind) {
      case 'Import':
        // The module path is a declaration site (so `import Foo` doesn't flag `Foo`).
        declare(scope, { name: node.name, kind: 'import', nameRange: node.nameRange, range: node.range }, ctx);
        ctx.imports.push({ name: node.name, source: node.source, nameRange: node.nameRange, resolved: false });
        // `as <alias>` is the usable local handle.
        if (node.alias && node.aliasRange) {
          declare(scope, { name: node.alias, kind: 'import', nameRange: node.aliasRange, range: node.aliasRange }, ctx);
        }
        // The contextual `showing` word is syntax, not a reference — don't flag it.
        if (node.showingRange) ctx.declPositions.add(posKey(node.showingRange.start));
        // `showing a, b` brings a, b into scope — their occurrence in the clause is a
        // declaration, and every later use resolves to it (no false "cannot find name").
        for (const symbol of node.exposed) {
          declare(scope, { name: symbol.name, kind: 'import', nameRange: symbol.range, range: symbol.range }, ctx);
        }
        break;
      case 'Function': {
        declare(
          scope,
          {
            name: node.name,
            kind: 'function',
            nameRange: node.nameRange,
            range: node.range,
            params: node.params.map((param) => param.name),
          },
          ctx,
        );
        const fnScope = childScope('function', node.range, scope);
        for (const param of node.params) {
          declare(fnScope, { name: param.name, kind: 'parameter', nameRange: param.nameRange, range: param.range }, ctx);
        }
        if (node.body) processStatements(node.body.body, fnScope, ctx);
        break;
      }
      case 'Class':
      case 'Record': {
        declare(scope, { name: node.name, kind: node.kind === 'Record' ? 'record' : 'class', nameRange: node.nameRange, range: node.range }, ctx);
        const classScope = childScope('class', node.range, scope);
        if (node.body) processStatements(node.body.body, classScope, ctx);
        break;
      }
      case 'Type':
        declare(scope, { name: node.name, kind: 'type', nameRange: node.nameRange, range: node.range }, ctx);
        break;
      case 'Variable':
      case 'Constant':
        declare(scope, { name: node.name, kind: node.kind === 'Constant' ? 'constant' : 'variable', nameRange: node.nameRange, range: node.range }, ctx);
        break;
      case 'Block': {
        const blockScope = childScope('block', node.range, scope);
        processStatements(node.body, blockScope, ctx);
        break;
      }
    }
  }
}

function childScope(kind: Scope['kind'], range: SrcRange, parent: Scope): Scope {
  const scope: Scope = { kind, range, parent, symbols: new Map(), children: [] };
  parent.children.push(scope);
  return scope;
}

function declare(scope: Scope, symbol: SymbolInfo, ctx: BuildContext): void {
  ctx.declPositions.add(posKey(symbol.nameRange.start));
  const existing = scope.symbols.get(symbol.name);
  if (existing) {
    ctx.diagnostics.push({
      severity: 'error',
      code: 'zx-duplicate-declaration',
      message: `Duplicate declaration of '${symbol.name}'.`,
      hint: `'${symbol.name}' is already declared on line ${existing.nameRange.start.line + 1}.`,
      range: symbol.nameRange,
    });
    return; // keep the first declaration
  }
  scope.symbols.set(symbol.name, symbol);
}

/* ----- reference resolution ----- */

function collectHeaderRanges(statements: StatementNode[]): SrcRange[] {
  const ranges: SrcRange[] = [];
  for (const node of statements) {
    if (node.kind === 'Block') {
      if (node.headerRange) ranges.push(node.headerRange);
      ranges.push(...collectHeaderRanges(node.body));
    }
  }
  return ranges;
}

function insideHeaderRange(pos: SrcPosition, headers: SrcRange[]): boolean {
  for (const range of headers) {
    if (positionLE(range.start, pos) && positionLT(pos, range.end)) return true;
  }
  return false;
}

function resolveReferences(
  tokens: Token[],
  fileScope: Scope,
  declPositions: Set<string>,
  references: ReferenceInfo[],
  diagnostics: SemanticDiagnostic[],
  headerRanges: SrcRange[],
): void {
  let previous: Token | null = null;

  for (const token of tokens) {
    if (token.kind === TokenKind.Identifier) {
      const isDeclaration = declPositions.has(posKey(token.range.start));
      const isMemberAccess = previous?.kind === TokenKind.Punctuation && previous.value === '.';
      const isHeader = insideHeaderRange(token.range.start, headerRanges);
      if (!isDeclaration && !isMemberAccess && !isHeader) {
        const scope = findScope(fileScope, token.range.start);
        const symbol = resolveName(scope, token.value);
        if (symbol) {
          references.push({ name: token.value, range: token.range, target: symbol });
        } else {
          diagnostics.push({
            severity: 'warning',
            code: 'zx-undefined-identifier',
            message: `Cannot find name '${token.value}'.`,
            hint: 'Declare it, import it, or check for a typo.',
            range: token.range,
          });
        }
      }
    }
    if (token.kind !== TokenKind.Comment) previous = token;
  }
}

function findScope(scope: Scope, position: SrcPosition): Scope {
  for (const child of scope.children) {
    if (rangeContains(child.range, position)) return findScope(child, position);
  }
  return scope;
}

function resolveName(scope: Scope | null, name: string): SymbolInfo | null {
  for (let current = scope; current; current = current.parent) {
    const symbol = current.symbols.get(name);
    if (symbol) return symbol;
  }
  return null;
}

/* ----- geometry helpers ----- */
function posKey(position: SrcPosition): string {
  return `${position.line}:${position.character}`;
}

function positionLE(a: SrcPosition, b: SrcPosition): boolean {
  return a.line < b.line || (a.line === b.line && a.character <= b.character);
}

function positionLT(a: SrcPosition, b: SrcPosition): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character);
}

function rangeContains(range: SrcRange, position: SrcPosition): boolean {
  return positionLE(range.start, position) && positionLE(position, range.end);
}
