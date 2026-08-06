/**
 * Pure workspace-symbol scanner (Phase 7A). A lightweight, line-oriented
 * declaration scan — grounded in the REAL Zornux declaration forms (class /
 * function / record / type / module / policy / service / configuration) and
 * common JS/TS declarations — so workspace symbol search never needs the full
 * parser over every file. No DOM/Node.
 */
export type SymbolKind =
  | 'function'
  | 'class'
  | 'record'
  | 'type'
  | 'module'
  | 'policy'
  | 'service'
  | 'configuration'
  | 'variable';

export interface ScannedSymbol {
  name: string;
  kind: SymbolKind;
  /** 0-based line + column of the name. */
  line: number;
  col: number;
}

interface Rule {
  re: RegExp;
  kind: SymbolKind;
}

const ZX_RULES: Rule[] = [
  { re: /^\s*module\s+([A-Za-z_][\w.]*)/, kind: 'module' },
  { re: /^\s*function\s+([A-Za-z_]\w*)/, kind: 'function' },
  { re: /^\s*class\s+([A-Za-z_]\w*)/, kind: 'class' },
  { re: /^\s*record\s+([A-Za-z_]\w*)/, kind: 'record' },
  { re: /^\s*type\s+([A-Za-z_]\w*)/, kind: 'type' },
  { re: /^\s*policy\s+([A-Za-z_]\w*)/, kind: 'policy' },
  { re: /^\s*service\s+([A-Za-z_]\w*)/, kind: 'service' },
  { re: /^\s*configuration\s+([A-Za-z_]\w*)/, kind: 'configuration' },
];

const JS_RULES: Rule[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
  { re: /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
  // Only EXPORTED top-level consts (components, route tables, etc.) — avoids local-variable noise.
  { re: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, kind: 'variable' },
];

const JS_EXTENSIONS = new Set(['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs']);

/** True when a file extension has symbol rules. */
export function isSymbolScannable(ext: string): boolean {
  const lower = ext.toLowerCase();
  return lower === 'zx' || JS_EXTENSIONS.has(lower);
}

export function scanSymbols(text: string, ext: string): ScannedSymbol[] {
  const lower = ext.toLowerCase();
  const rules = lower === 'zx' ? ZX_RULES : JS_EXTENSIONS.has(lower) ? JS_RULES : [];
  if (rules.length === 0) return [];

  const symbols: ScannedSymbol[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const rule of rules) {
      const match = rule.re.exec(line);
      if (match) {
        symbols.push({ name: match[1], kind: rule.kind, line: i, col: line.indexOf(match[1]) });
        break; // one declaration per line
      }
    }
  }
  return symbols;
}
