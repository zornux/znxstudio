/**
 * Zornux AST — typed nodes for the first real parse tree.
 *
 * Every node carries a 0-based source `range`, and named declarations also carry
 * a `nameRange` (used as the symbol's selection/navigation target). This model
 * is Monaco-free and IDE-free: it belongs to the Zornux front-end and can be
 * replaced wholesale by the compiler's AST without touching the IDE platform.
 */
import type { SrcRange } from './lexer';

export interface ParameterNode {
  kind: 'Parameter';
  name: string;
  nameRange: SrcRange;
  range: SrcRange;
}

export interface ImportNode {
  kind: 'Import';
  name: string;
  nameRange: SrcRange;
  /** Optional `as <alias>` — the local handle when the module is renamed. */
  alias?: string;
  aliasRange?: SrcRange;
  /** Selectively-imported symbols from `import Name showing a, b` — each is in scope. */
  exposed: { name: string; range: SrcRange }[];
  /** Range of the contextual `showing` word, so it isn't mistaken for a reference. */
  showingRange?: SrcRange;
  source?: string;
  range: SrcRange;
}

export interface FunctionNode {
  kind: 'Function';
  name: string;
  nameRange: SrcRange;
  params: ParameterNode[];
  body: BlockNode | null;
  range: SrcRange;
}

export interface ClassNode {
  kind: 'Class' | 'Record';
  name: string;
  nameRange: SrcRange;
  body: BlockNode | null;
  range: SrcRange;
}

export interface TypeNode {
  kind: 'Type';
  name: string;
  nameRange: SrcRange;
  range: SrcRange;
}

export interface VariableNode {
  kind: 'Variable' | 'Constant';
  name: string;
  nameRange: SrcRange;
  range: SrcRange;
}

export interface BlockNode {
  kind: 'Block';
  body: StatementNode[];
  range: SrcRange;
  /** Span from the opening keyword to the start of the body — identifiers inside
   *  are header context (names, prefixes, clauses) and must not be resolved. */
  headerRange?: SrcRange;
}

export type StatementNode =
  | ImportNode
  | FunctionNode
  | ClassNode
  | TypeNode
  | VariableNode
  | BlockNode;

export interface FileNode {
  kind: 'File';
  body: StatementNode[];
  range: SrcRange;
}

export type ZornuxNode = FileNode | StatementNode | ParameterNode;

export const EMPTY_FILE: FileNode = {
  kind: 'File',
  body: [],
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
};
