/**
 * Tolerant JSON reading (Integration Layer, IL-D). The rules every reader of
 * Zornux CLI output follows so the compiler can evolve its `--json` shapes
 * without breaking the IDE:
 *
 *   • ignore unknown fields;
 *   • treat new optional fields safely, defaulting the ones we need when absent;
 *   • never depend on JSON property ORDER (we read by key, never by position);
 *   • reject only fields that are truly required (the reader returns null / drops
 *     the item — it never throws);
 *   • preserve unknown ENUM values rather than crashing on them.
 *
 * These helpers centralize the small coercions that used to be copy-pasted into
 * each reader, so the policy is defined — and tested — in exactly one place.
 */

/** A value as a plain object, or `{}` — so a missing/!object field reads as "no keys". */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A finite number, or `fallback` (default 0) for anything non-numeric. */
export function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** A string, or `fallback` (default '') for anything non-string. */
export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** A boolean, or `fallback` (default false) — only a real `true`/`false` counts. */
export function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** An array of strings, keeping only the string elements; `[]` when absent. */
export function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * Match `value` against a set of canonical enum values, case-INSENSITIVELY, and
 * return the canonical spelling — or `fallback` when it matches none. This is
 * the "coerce an unknown enum to a safe known value" policy (used for
 * severities/confidence, where the UI needs a concrete member). Never throws.
 */
export function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const lowered = typeof value === 'string' ? value.toLowerCase() : '';
  return allowed.find((option) => option.toLowerCase() === lowered) ?? fallback;
}

/**
 * The "preserve unknown as unknown" policy: return the canonical enum member
 * when `value` matches one (case-insensitively), else the literal `'unknown'` —
 * so a new enum member a newer Zornux emits is surfaced as unknown rather than
 * silently coerced into a wrong-but-known one. Never throws.
 */
export function preserveEnum<T extends string>(value: unknown, allowed: readonly T[]): T | 'unknown' {
  const lowered = typeof value === 'string' ? value.toLowerCase() : '';
  return allowed.find((option) => option.toLowerCase() === lowered) ?? 'unknown';
}
