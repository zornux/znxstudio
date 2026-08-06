/**
 * Live security diagnostics over `zornux lsp`.
 *
 * The language server has always been able to run the security analyzer — see
 * `Zornux.LanguageServer/Providers/DiagnosticsProvider.Compute(document, security)`
 * — gated on a `zornux.security` setting the editor supplies through
 * `initializationOptions.zornux` and can change later with
 * `workspace/didChangeConfiguration` (which republishes every open document).
 * ZnxStudio simply never set it. Setting it turns Phase 15's on-demand CLI scan
 * into as-you-type feedback, over a connection we already own.
 *
 * FOUR DIFFERENCES FROM `zornux check --security`, which the UI must not blur:
 *
 *   1. The server calls `SecurityConfiguration.Load(null, source)` — the FIRST
 *      argument is the `zornux.project` text, and it passes NULL. So the live
 *      diagnostics ignore `security.profile`, `security.disable` and
 *      `security.severity.*`. Every rule runs at its AUTHORED severity. The CLI
 *      applies the project settings; the editor does not.
 *   2. Source-level `# zornux:suppress` directives ARE honoured live, because
 *      they are parsed from the document itself.
 *   3. The server gates on `!document.Parse.Diagnostics.HasErrors` — a PARSE
 *      error. The CLI additionally requires the program to COMPILE. So a file
 *      that parses but fails to compile gets live findings and none from the CLI.
 *   4. ZX3709 needs an advisory source the server never composes in, so a
 *      vulnerable dependency never appears as a live diagnostic. Only
 *      `check --security --advisories` reports it.
 *
 * Consequently the live findings are a fast preview, and the CLI scan remains
 * the authority on what fails a build. The UI says so rather than implying the
 * two agree.
 */

import type { LspRawDiagnostic, ZornuxLspSettings } from '../../../shared/types';

/** The `source` the server stamps on a security finding (`DiagnosticsProvider.ToLsp`). */
export const SECURITY_DIAGNOSTIC_SOURCE = 'zornux-security';

/** The `source` it stamps on an ordinary compiler diagnostic. */
export const COMPILER_DIAGNOSTIC_SOURCE = 'zornux';

/** The settings block sent as `initializationOptions.zornux` and on config changes. */
export function buildZornuxSettings(security: boolean, maxProblems?: number): ZornuxLspSettings {
  const settings: ZornuxLspSettings = { security };
  if (maxProblems !== undefined && maxProblems > 0) settings.maxProblems = maxProblems;
  return settings;
}

/** The `workspace/didChangeConfiguration` params the server reads (`prms.settings.zornux`). */
export function buildConfigurationChange(settings: ZornuxLspSettings): { settings: { zornux: ZornuxLspSettings } } {
  return { settings: { zornux: settings } };
}

/** True when this published diagnostic came from the security analyzer. */
export function isSecurityDiagnostic(diagnostic: LspRawDiagnostic): boolean {
  return diagnostic.source === SECURITY_DIAGNOSTIC_SOURCE;
}

/** Split one published batch into compiler diagnostics and security findings. */
export function partitionDiagnostics(diagnostics: LspRawDiagnostic[]): {
  compiler: LspRawDiagnostic[];
  security: LspRawDiagnostic[];
} {
  const compiler: LspRawDiagnostic[] = [];
  const security: LspRawDiagnostic[] = [];
  for (const diagnostic of diagnostics) (isSecurityDiagnostic(diagnostic) ? security : compiler).push(diagnostic);
  return { compiler, security };
}

/**
 * The rule ids present in a batch. The server puts the rule id in `code`, so a
 * live ZX37xx diagnostic names its rule exactly as the CLI's finding does.
 */
export function securityRuleIds(diagnostics: LspRawDiagnostic[]): string[] {
  return [...new Set(diagnostics.filter(isSecurityDiagnostic).map((d) => String(d.code ?? '')))].filter(Boolean).sort();
}

/**
 * The server appends the suggested fix after a newline
 * (`$"{finding.Message}\n{finding.SuggestedFix}"`), the same shape it uses for a
 * compiler diagnostic's help text. Split it back apart.
 */
export function splitSecurityMessage(message: string): { message: string; suggestedFix: string | null } {
  const newline = message.indexOf('\n');
  if (newline < 0) return { message, suggestedFix: null };
  const fix = message.slice(newline + 1).trim();
  return { message: message.slice(0, newline), suggestedFix: fix.length ? fix : null };
}

/**
 * A one-line caveat for the UI. Live findings run every rule at its authored
 * severity, because the server never reads `zornux.project`.
 */
export const LIVE_SECURITY_CAVEAT =
  'Live findings run every rule at its authored severity and skip dependency advisories. Run a Security scan for what the build will actually do.';
