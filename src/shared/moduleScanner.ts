/**
 * Lightweight scanner for Zornux module structure. Pure and dependency-free so
 * it runs in the main process (over on-disk files) and in tests. It extracts a
 * file's `module` declaration and its `import` statements — enough to build the
 * project dependency graph without a full parse.
 *
 * Real Zornux syntax (line-oriented, no punctuation):
 *   module Products.Inventory
 *   import Math
 *   import Products.Inventory as Inv
 *   import Math showing square, cube
 *   import Products.Inventory as Inv showing Product, list_all
 *
 * Imports reference dotted MODULE NAMES (not file paths); resolution to a file
 * is done later against the registry of `module` declarations.
 */

export interface SourceRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export interface ScannedImport {
  /** Dotted module name being imported. */
  module: string;
  alias?: string;
  showing: string[];
  /** Range of the module name (for go-to navigation). */
  range: SourceRange;
}

export interface ScannedModuleInfo {
  /** Declared module name, or null when the file declares none. */
  module: string | null;
  moduleRange?: SourceRange;
  imports: ScannedImport[];
}

const NAME = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*';
const MODULE_RE = new RegExp(`^(\\s*module\\s+)(${NAME})\\b`);
const IMPORT_RE = new RegExp(`^(\\s*import\\s+)(${NAME})\\b(.*)$`);
const ALIAS_RE = /^\s+as\s+([A-Za-z_]\w*)/;
const SHOWING_RE = /^\s+showing\s+(.+?)\s*(?:#.*)?$/;

export function scanModuleInfo(text: string): ScannedModuleInfo {
  const lines = text.split(/\r?\n/);
  let moduleName: string | null = null;
  let moduleRange: SourceRange | undefined;
  const imports: ScannedImport[] = [];

  for (let line = 0; line < lines.length; line++) {
    const content = lines[line];

    if (moduleName === null) {
      const moduleMatch = MODULE_RE.exec(content);
      if (moduleMatch) {
        moduleName = moduleMatch[2];
        const start = moduleMatch[1].length;
        moduleRange = rangeOf(line, start, moduleName.length);
        continue;
      }
    }

    const importMatch = IMPORT_RE.exec(content);
    if (importMatch) {
      const module = importMatch[2];
      const start = importMatch[1].length;
      let rest = importMatch[3];

      let alias: string | undefined;
      const aliasMatch = ALIAS_RE.exec(rest);
      if (aliasMatch) {
        alias = aliasMatch[1];
        rest = rest.slice(aliasMatch[0].length);
      }

      let showing: string[] = [];
      const showingMatch = SHOWING_RE.exec(rest);
      if (showingMatch) {
        showing = showingMatch[1]
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
      }

      imports.push({ module, alias, showing, range: rangeOf(line, start, module.length) });
    }
  }

  return { module: moduleName, moduleRange, imports };
}

function rangeOf(line: number, startCharacter: number, length: number): SourceRange {
  return { startLine: line, startCharacter, endLine: line, endCharacter: startCharacter + length };
}
