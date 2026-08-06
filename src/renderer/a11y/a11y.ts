/**
 * Accessibility audit — the pure model (Phase 20A).
 *
 * UX-7 gave the workbench chrome its ARIA landmarks + tab roles; 20A adds an
 * automated linter that walks the real DOM and flags interactive controls with
 * NO accessible name (an icon-only button a screen reader would announce as just
 * "button"). The DOM-walking lives in the module; the classification here is pure
 * so it is testable without a browser.
 *
 * The accessible-name rule is a pragmatic subset of the ARIA spec: a control is
 * "named" if it has non-whitespace text content, an `aria-label`, an
 * `aria-labelledby`, a `title`, or (for inputs) an associated label / `alt`.
 */
export interface A11yElement {
  tag: string;
  role?: string;
  ariaLabel?: string;
  ariaLabelledby?: string;
  title?: string;
  alt?: string;
  /** A fallback accessible name for inputs/textareas (accname step 2.5.3). */
  placeholder?: string;
  /** Trimmed visible text content. */
  text?: string;
  /** Present for inputs wrapped in / pointed at by a <label>. */
  hasLabel?: boolean;
  disabled?: boolean;
  /** aria-hidden subtree — excluded from the audit. */
  hidden?: boolean;
  /** First CSS class, purely to identify a finding in the report. */
  className?: string;
}

const INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea']);
const INTERACTIVE_ROLES = new Set(['button', 'tab', 'menuitem', 'menuitemcheckbox', 'checkbox', 'link', 'switch']);
/** Inputs that carry their own semantics and don't need a text name here. */
const NAMELESS_INPUT_TYPES = new Set(['hidden']);

export function isInteractive(el: A11yElement): boolean {
  if (el.hidden) return false;
  const tag = el.tag.toLowerCase();
  if (tag === 'a') return true; // links (href presence is checked by the collector)
  if (INTERACTIVE_TAGS.has(tag)) return true;
  return el.role ? INTERACTIVE_ROLES.has(el.role) : false;
}

export function hasAccessibleName(el: A11yElement): boolean {
  return Boolean(
    (el.text && el.text.trim().length > 0) ||
      (el.ariaLabel && el.ariaLabel.trim().length > 0) ||
      (el.ariaLabelledby && el.ariaLabelledby.trim().length > 0) ||
      (el.title && el.title.trim().length > 0) ||
      (el.alt && el.alt.trim().length > 0) ||
      (el.placeholder && el.placeholder.trim().length > 0) ||
      el.hasLabel === true,
  );
}

export interface A11yFinding {
  tag: string;
  role?: string;
  className?: string;
}

export interface A11yReport {
  /** Every element considered. */
  total: number;
  /** Interactive elements (the audited set). */
  interactive: number;
  /** Interactive elements missing an accessible name. */
  unnamed: A11yFinding[];
}

/**
 * Audit a flat list of elements. Only interactive, visible controls are checked;
 * a text-only input (e.g. type=hidden) is skipped.
 */
export function auditA11y(elements: A11yElement[]): A11yReport {
  const interactive = elements.filter(isInteractive);
  const unnamed: A11yFinding[] = [];
  for (const el of interactive) {
    if (el.tag.toLowerCase() === 'input' && NAMELESS_INPUT_TYPES.has(el.role ?? '')) continue;
    if (!hasAccessibleName(el)) unnamed.push({ tag: el.tag, role: el.role, className: el.className });
  }
  return { total: elements.length, interactive: interactive.length, unnamed };
}
