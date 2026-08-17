/**
 * Canonical DiagnosticsEngine source keys for the Zornux diagnostic layers.
 * Each source is an independent bucket in the engine (last write per source
 * wins), so distinct owners never clobber one another:
 *
 *   - Frontend  — fast, provisional squiggles from the in-renderer analyzer.
 *   - Compiler  — authoritative live diagnostics for OPEN documents (Phase 3A).
 *   - Build     — results of the last `zornux build`, for files NOT open
 *                 (open files are already covered live by Compiler) (Phase 3B).
 */
export const DiagnosticSources = {
  ZornuxFrontend: 'zornux',
  ZornuxCompiler: 'zornux-compiler',
  ZornuxBuild: 'zornux-build',
  /**
   * Module-aware whole-project check. Carries only the cross-file module range
   * (ZX13xx) — disjoint from the single-file layers, so no duplicate squiggles.
   */
  ZornuxProject: 'zornux-project',
  /**
   * Live ZX37xx security findings, pushed by `zornux lsp` when `zornux.security`
   * is enabled. A separate bucket from the compiler's: the server publishes both
   * in one batch, and a user turning security off must not lose their squiggles.
   */
  ZornuxSecurity: 'zornux-security',
  /** Zoijs framework-intelligence diagnostics for .js/.ts files (Phase 6A). */
  Zoijs: 'zoijs',
  /** Mobile build diagnostics from `zornux mobile build android`. */
  ZornuxMobileBuild: 'zornux-mobile-build',
} as const;
