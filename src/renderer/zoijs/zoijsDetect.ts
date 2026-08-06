/**
 * Pure Zoijs detection (Phase 6A): does a source file use Zoijs, and which
 * `@zoijs/*` symbols does it import (with positions, for import validation)?
 * Named-import aware; namespace/default imports mark the file as Zoijs but
 * contribute no per-symbol checks. No DOM.
 */
export interface ZoijsImportedSymbol {
  name: string;
  /** 0-based line. */
  line: number;
  /** 0-based columns (end exclusive). */
  startCol: number;
  endCol: number;
}

export interface ZoijsImport {
  package: string;
  /** Named symbols; empty for `import * as` / default imports. */
  symbols: ZoijsImportedSymbol[];
}

const NAMED_IMPORT = /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"](@zoijs\/[^'"]+)['"]/;
const ANY_ZOIJS_IMPORT = /from\s*['"]@zoijs\//;

/** True when the file imports anything from an `@zoijs/*` package. */
export function isZoijsSource(text: string): boolean {
  return ANY_ZOIJS_IMPORT.test(text);
}

/** Parse named `@zoijs/*` imports with symbol positions (single-line import statements). */
export function scanZoijsImports(text: string): ZoijsImport[] {
  const imports: ZoijsImport[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, line) => {
    const match = NAMED_IMPORT.exec(lineText);
    if (!match) return;
    const bracesStart = lineText.indexOf('{');
    const inner = match[1];
    const symbols: ZoijsImportedSymbol[] = [];
    // Walk comma-separated names, tracking each name's column within the line.
    let cursor = bracesStart + 1;
    for (const raw of inner.split(',')) {
      const segment = raw;
      const trimmed = segment.trim();
      if (trimmed) {
        // A rename `foo as bar` imports `foo`; validate the source name.
        const name = trimmed.split(/\s+as\s+/)[0].trim();
        const rel = segment.indexOf(name);
        const startCol = cursor + (rel < 0 ? 0 : rel);
        symbols.push({ name, line, startCol, endCol: startCol + name.length });
      }
      cursor += segment.length + 1; // +1 for the comma
    }
    imports.push({ package: match[2], symbols });
  });
  return imports;
}
