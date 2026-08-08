export type TerminalShortcutAction = 'copy' | 'paste' | 'next-tab' | 'previous-tab' | 'shell';

export interface TerminalKeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Resolve shortcuts owned by the terminal UI. Everything else is explicitly
 * returned to xterm so shells retain Ctrl+C/D/L/R, arrows, function keys, and
 * application-specific keybindings.
 */
export function resolveTerminalShortcut(event: TerminalKeyLike, isMac: boolean): TerminalShortcutAction {
  const key = event.key.toLowerCase();
  const noAlt = !event.altKey;

  if (noAlt && event.ctrlKey && !event.metaKey && key === 'pagedown') return 'next-tab';
  if (noAlt && event.ctrlKey && !event.metaKey && key === 'pageup') return 'previous-tab';

  // Conventional Linux/Windows terminal clipboard shortcuts.
  if (noAlt && event.ctrlKey && event.shiftKey && !event.metaKey && key === 'c') return 'copy';
  if (noAlt && event.ctrlKey && event.shiftKey && !event.metaKey && key === 'v') return 'paste';
  // Legacy terminal shortcuts remain useful on compact and remote keyboards.
  if (noAlt && event.ctrlKey && !event.shiftKey && !event.metaKey && key === 'insert') return 'copy';
  if (noAlt && event.shiftKey && !event.ctrlKey && !event.metaKey && key === 'insert') return 'paste';

  // macOS reserves Command for clipboard operations; Ctrl stays shell-owned.
  if (isMac && noAlt && event.metaKey && !event.ctrlKey && key === 'c') return 'copy';
  if (isMac && noAlt && event.metaKey && !event.ctrlKey && key === 'v') return 'paste';

  return 'shell';
}
