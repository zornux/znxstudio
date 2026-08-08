/**
 * A small, accessible modal dialog primitive (Phase 20J — shared by Workspace
 * Trust, unsaved-changes prompts, and other confirmations).
 *
 * It implements the desktop accessibility baseline for dialogs: `role="dialog"`
 * + `aria-modal`, a labelled title and description, a focus trap, Escape to
 * dismiss, and focus restoration to the element that was focused before it
 * opened. Resolves with the chosen button's `value` (or the dismiss value on
 * Escape / backdrop click).
 */

export interface ModalButton {
  label: string;
  value: string;
  /** The default/affirmative action — highlighted and focused first. */
  primary?: boolean;
  /** A non-closing action (e.g. "Learn more"); runs `onClick` and keeps the dialog open. */
  onClick?: () => void;
}
import { claimOverlay } from './overlayCoordinator';
import { runUiCallback } from '../core/uiErrors';

export interface ModalOptions {
  title: string;
  /** Plain text (safe) or a caller-built element. Strings are set via textContent. */
  body: string | HTMLElement;
  buttons: ModalButton[];
  /** Value returned on Escape / backdrop click. Defaults to 'cancel'. */
  dismissValue?: string;
  /** When false, clicking the backdrop does not dismiss. Default true. */
  dismissOnBackdrop?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let seq = 0;
let dismissActiveModal: (() => void) | undefined;

export function showModal(options: ModalOptions): Promise<string> {
  dismissActiveModal?.();
  const dismissValue = options.dismissValue ?? 'cancel';
  const id = `znxstudio-modal-${seq++}`;

  const backdrop = document.createElement('div');
  backdrop.className = 'znxstudio-modal-backdrop';

  const dialog = document.createElement('div');
  dialog.className = 'znxstudio-modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.setAttribute('aria-describedby', `${id}-body`);

  const title = document.createElement('h2');
  title.className = 'znxstudio-modal-title';
  title.id = `${id}-title`;
  title.textContent = options.title;

  const body = document.createElement('div');
  body.className = 'znxstudio-modal-body';
  body.id = `${id}-body`;
  if (typeof options.body === 'string') body.textContent = options.body;
  else body.appendChild(options.body);

  const footer = document.createElement('div');
  footer.className = 'znxstudio-modal-footer';

  return new Promise<string>((resolve) => {
    let settled = false;
    let dismissThis: () => void;
    let releaseOverlay: (() => void) | undefined;
    const close = (value: string): void => {
      if (settled) return;
      settled = true;
      if (dismissActiveModal === dismissThis) dismissActiveModal = undefined;
      releaseOverlay?.();
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
      // Restore focus to where it was before the dialog opened.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
      resolve(value);
    };
    dismissThis = () => close(dismissValue);
    dismissActiveModal = dismissThis;
    releaseOverlay = claimOverlay(backdrop, dismissThis);
    const previouslyFocused = document.activeElement as HTMLElement | null;

    for (const spec of options.buttons) {
      const btn = document.createElement('button');
      btn.className = `znxstudio-modal-btn${spec.primary ? ' is-primary' : ''}`;
      btn.textContent = spec.label;
      btn.addEventListener('click', () => {
        if (spec.onClick) {
          runUiCallback(`Could not run “${spec.label}”`, spec.onClick);
          return; // non-closing action
        }
        close(spec.value);
      });
      footer.appendChild(btn);
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(dismissValue);
        return;
      }
      if (event.key !== 'Tab') return;
      // Focus trap: keep Tab within the dialog.
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop && (options.dismissOnBackdrop ?? true)) close(dismissValue);
    });
    document.addEventListener('keydown', onKeyDown, true);

    dialog.append(title, body, footer);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    // Focus the primary button (or the first focusable control).
    const primary = footer.querySelector<HTMLElement>('.is-primary') ?? footer.querySelector<HTMLElement>('button');
    (primary ?? dialog).focus();
  });
}
