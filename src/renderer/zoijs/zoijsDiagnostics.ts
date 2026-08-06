/**
 * Pure Zoijs diagnostics (Phase 6A). Two grounded, low-false-positive checks:
 *  - ZOIJS-REACTIVE: a binding whose whole expression is a bare `x.get()`
 *    (state read) not wrapped in `() => …` — it renders ONCE and won't update.
 *  - ZOIJS-UNKNOWN-EXPORT: a named import from a cataloged `@zoijs/*` package
 *    that the package does not export.
 * Emits platform `Diagnostic`s (0-based ranges). No DOM.
 */
import type { Diagnostic, Position } from '../language/api';
import { scanHtmlBindings } from './zoijsBindings';
import { scanZoijsImports } from './zoijsDetect';
import { isZoijsPackage, zoijsPackageExports } from './zoijsApi';

/** Whole-expression bare state read: `foo.get()` / `a.b.get()`, no arrow. */
const BARE_GET = /\.get\(\s*\)$/;

function positionAt(lineStarts: number[], offset: number): Position {
  // Binary search the line whose start is <= offset.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: offset - lineStarts[lo] };
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

export function analyzeZoijs(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lineStarts = computeLineStarts(text);

  // (1) Reactivity footgun.
  for (const binding of scanHtmlBindings(text)) {
    const trimmed = binding.expr.trim();
    if (!trimmed) continue;
    if (BARE_GET.test(trimmed) && !trimmed.includes('=>')) {
      diagnostics.push({
        range: { start: positionAt(lineStarts, binding.start), end: positionAt(lineStarts, binding.end) },
        severity: 'warning',
        source: 'zoijs',
        code: 'ZOIJS-REACTIVE',
        message: 'This binding reads state once and will not update when it changes.',
        hint: `Wrap it to stay reactive: \${() => ${trimmed}}`,
      });
    }
  }

  // (2) Unknown named imports from a cataloged @zoijs/* package.
  for (const imp of scanZoijsImports(text)) {
    if (!isZoijsPackage(imp.package)) continue; // uncataloged subpackage — don't guess
    const exportsSet = new Set(zoijsPackageExports(imp.package));
    for (const symbol of imp.symbols) {
      if (!exportsSet.has(symbol.name)) {
        diagnostics.push({
          range: {
            start: { line: symbol.line, character: symbol.startCol },
            end: { line: symbol.line, character: symbol.endCol },
          },
          severity: 'warning',
          source: 'zoijs',
          code: 'ZOIJS-UNKNOWN-EXPORT',
          message: `'${symbol.name}' is not exported by ${imp.package}.`,
          hint: 'Check the spelling, or import it from the correct @zoijs package.',
        });
      }
    }
  }

  return diagnostics;
}
