/**
 * ARIA wiring for combobox/listbox overlays (Phase 20J WI4).
 *
 * The command palette, quick-open and search-everywhere pickers render a text
 * input over a list of results. Visually the selected row is highlighted, but a
 * screen reader needs the roles + `aria-activedescendant` to announce the
 * highlighted option. These helpers apply the WAI-ARIA combobox pattern so the
 * pickers are operable non-visually, and provide focus capture/restore so the
 * overlay behaves as a modal dialog.
 */

/** Turn an overlay root into a labelled modal dialog. */
export function markDialog(root: HTMLElement, label: string): void {
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', label);
}

/** Wire a search input as a combobox controlling `listId`. */
export function markCombobox(input: HTMLElement, listId: string): void {
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', listId);
  input.setAttribute('aria-autocomplete', 'list');
}

/** Wire the results container as a listbox. */
export function markListbox(list: HTMLElement, id: string, label?: string): void {
  list.id = id;
  list.setAttribute('role', 'listbox');
  if (label) list.setAttribute('aria-label', label);
}

/** Wire one result row as a selectable option with a stable id. */
export function markOption(item: HTMLElement, id: string, selected: boolean): void {
  item.id = id;
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(selected));
}

/** Point the input's `aria-activedescendant` at the active option (or clear it). */
export function setActiveDescendant(input: HTMLElement, optionId: string | null): void {
  if (optionId) input.setAttribute('aria-activedescendant', optionId);
  else input.removeAttribute('aria-activedescendant');
}

/**
 * Capture the currently-focused element and return a function that restores
 * focus to it — call on overlay open, invoke the result on close so focus never
 * gets stranded on `<body>`.
 */
export function captureFocus(): () => void {
  const previous = document.activeElement as HTMLElement | null;
  return () => {
    if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
  };
}
