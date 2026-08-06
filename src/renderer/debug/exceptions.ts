/**
 * Exception breakpoints (Phase 4H, rebuilt on Zornux rc.4).
 *
 * Through rc.3 `zornux dap` answered `setExceptionBreakpoints` with an empty
 * response and nothing else: the request succeeded and changed nothing, and the
 * session always broke on every raised error. ZnxStudio therefore showed no toggle
 * rather than one that lied.
 *
 * rc.4 honours the request and advertises `exceptionBreakpointFilters` in its
 * `initialize` capabilities:
 *
 *   • `all`      — break whenever an error is raised, even one a `try` recovers from.
 *   • `uncaught` — break only on errors that escape every `try`, `protect` and
 *                  `expect`. This is the adapter's DEFAULT, and it is also a
 *                  behaviour change from rc.3, which always broke.
 *
 * Sending no filters at all means "never break on exceptions", which DAP models
 * as an empty array — so `never` is a real mode, not the absence of a choice.
 */

export type ExceptionBreakMode = 'all' | 'uncaught' | 'never';

export const EXCEPTION_BREAK_MODES: ExceptionBreakMode[] = ['all', 'uncaught', 'never'];

/** One filter the adapter says it supports. */
export interface ExceptionFilter {
  filter: string;
  label: string;
  description: string;
  default: boolean;
}

/** The DAP `filters` array for a mode. `never` sends an empty array, not nothing. */
export function filtersFor(mode: ExceptionBreakMode): string[] {
  switch (mode) {
    case 'all':
      return ['all'];
    case 'uncaught':
      return ['uncaught'];
    default:
      return [];
  }
}

/**
 * The mode a set of DAP filters denotes. `all` wins over `uncaught` when both are
 * present, exactly as the adapter resolves them (`filters.Contains("all") ? …`).
 */
export function modeForFilters(filters: string[]): ExceptionBreakMode {
  if (filters.includes('all')) return 'all';
  if (filters.includes('uncaught')) return 'uncaught';
  return 'never';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * The filters an adapter advertised. An adapter that advertises none does not
 * support the request at all — rc.3 and earlier — and the caller must not send it.
 */
export function parseExceptionFilters(capabilities: unknown): ExceptionFilter[] {
  const raw = asRecord(capabilities).exceptionBreakpointFilters;
  if (!Array.isArray(raw)) return [];
  const filters: ExceptionFilter[] = [];
  for (const entry of raw) {
    const f = asRecord(entry);
    if (typeof f.filter !== 'string') continue;
    filters.push({
      filter: f.filter,
      label: typeof f.label === 'string' ? f.label : f.filter,
      description: typeof f.description === 'string' ? f.description : '',
      default: f.default === true,
    });
  }
  return filters;
}

/** True when the adapter honours `setExceptionBreakpoints` (rc.4 and later). */
export function supportsExceptionFilters(capabilities: unknown): boolean {
  return parseExceptionFilters(capabilities).length > 0;
}

/**
 * The mode the adapter would use if we sent nothing — read from which filters it
 * marks `default`. Falls back to `uncaught`, which is what rc.4 does.
 */
export function adapterDefaultMode(filters: ExceptionFilter[]): ExceptionBreakMode {
  const defaults = filters.filter((f) => f.default).map((f) => f.filter);
  return defaults.length ? modeForFilters(defaults) : 'uncaught';
}

/** A one-line explanation, for the picker. */
export function describeMode(mode: ExceptionBreakMode): string {
  switch (mode) {
    case 'all':
      return 'Break on every error, even one a try or protect recovers from.';
    case 'uncaught':
      return 'Break only on errors that escape every try, protect and expect.';
    default:
      return 'Never pause on an error; the program runs to completion or to a breakpoint.';
  }
}

/** True when a mode is one the adapter actually advertised. */
export function isModeSupported(mode: ExceptionBreakMode, filters: ExceptionFilter[]): boolean {
  if (mode === 'never') return filters.length > 0; // sending an empty filter list is always valid
  return filters.some((f) => f.filter === mode);
}
