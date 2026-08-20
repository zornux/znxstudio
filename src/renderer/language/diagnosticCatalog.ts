/**
 * Zornux diagnostic catalog — pure, Monaco-free presentation helpers for
 * `ZX####` codes and diagnostic provenance. The compiler assigns codes from
 * stable per-subsystem ranges (docs/spec/diagnostics.md); mapping a code to its
 * category tells the user what KIND of problem it is, and mapping the engine
 * source key to a friendly label tells them WHICH layer reported it.
 */

interface CodeRange {
  min: number;
  max: number;
  category: string;
}

// Authoritative ranges from the Zornux diagnostics standard (ZX0001–ZX3999).
const CODE_RANGES: CodeRange[] = [
  { min: 1, max: 99, category: 'Lexer' },
  { min: 100, max: 299, category: 'Parser' },
  { min: 300, max: 399, category: 'Semantics' },
  { min: 400, max: 499, category: 'Bytecode' },
  { min: 500, max: 699, category: 'Types' },
  { min: 700, max: 899, category: 'Runtime' },
  { min: 900, max: 999, category: 'OOP' },
  { min: 1000, max: 1099, category: 'Standard Library' },
  { min: 1100, max: 1199, category: 'Web' },
  { min: 1200, max: 1299, category: 'Security' },
  { min: 1300, max: 1399, category: 'Module' },
  { min: 1400, max: 1499, category: 'Package' },
  { min: 1500, max: 1599, category: 'Testing' },
  { min: 1600, max: 1699, category: 'Docs' },
  { min: 1700, max: 1799, category: 'Debugger' },
  { min: 1800, max: 1899, category: 'Mobile' },
  { min: 1900, max: 1999, category: 'Entry Point' },
  { min: 2000, max: 2099, category: 'Concurrency' },
  { min: 2100, max: 2199, category: 'Error Recovery' },
  { min: 2200, max: 2299, category: 'Maps' },
  { min: 2300, max: 2399, category: 'Async' },
  { min: 2400, max: 2499, category: 'Data / ORM' },
  { min: 2500, max: 2599, category: 'Enterprise' },
  { min: 2600, max: 2699, category: 'Configuration' },
  { min: 2700, max: 2799, category: 'Middleware' },
  { min: 2800, max: 2899, category: 'Logging' },
  { min: 2900, max: 2999, category: 'Authorization' },
  { min: 3000, max: 3099, category: 'Background Jobs' },
  { min: 3100, max: 3199, category: 'Queries' },
  { min: 3200, max: 3299, category: 'Messaging' },
  { min: 3300, max: 3399, category: 'Hardening' },
  { min: 3400, max: 3499, category: 'Registry' },
  { min: 3500, max: 3599, category: 'Migrations' },
  { min: 3600, max: 3699, category: 'Deployment' },
  { min: 3700, max: 3799, category: 'Security' },
  { min: 3800, max: 3899, category: 'Memory safety' },
  { min: 3900, max: 3999, category: 'Profiling' },
];

/** Friendly label for each diagnostics-engine source key (the layer). */
const SOURCE_LABELS: Record<string, string> = {
  zornux: 'Analyzer',
  'zornux-semantic': 'Analyzer',
  'zornux-compiler': 'Compiler',
  'zornux-build': 'Build',
  'zornux-project': 'Project',
  'zornux-security': 'Security',
  'zornux-mobile': 'Mobile',
  'zornux-mobile-build': 'Mobile Build',
  zoijs: 'Zoijs',
};

/** Subsystem category for a `ZX####` code, or null if unknown / not a ZX code. */
export function categoryOf(code: string | undefined): string | null {
  if (!code) return null;
  const match = /^ZX(\d{4})$/.exec(code);
  if (!match) return null;
  const value = Number(match[1]);
  for (const range of CODE_RANGES) {
    if (value >= range.min && value <= range.max) return range.category;
  }
  return null;
}

/** True for a stable `ZX####` compiler code (vs an IDE-side code like 'no-manifest'). */
export function isZornuxCode(code: string | undefined): boolean {
  return !!code && /^ZX\d{4}$/.test(code);
}

/** Friendly layer label for an engine source key. */
export function describeSource(source: string | undefined): string {
  if (!source) return '';
  return SOURCE_LABELS[source] ?? source;
}

/** "Compiler · Parser"-style provenance line, using whichever parts are known. */
export function formatProvenance(source: string | undefined, code: string | undefined): string {
  const label = describeSource(source);
  const category = categoryOf(code);
  if (label && category) return `${label} · ${category}`;
  return label || category || '';
}
