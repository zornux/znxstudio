import type { IModule, ModuleContext } from '../core/Module';
import {
  ServiceKeys,
  type ConfirmOptions,
  type InputBoxOptions,
  type InputBoxService,
} from '../core/Contracts';
import { captureFocus, markDialog } from '../ui/ariaListbox';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import { claimOverlay } from './overlayCoordinator';

/**
 * A small, reusable modal dialog service (`ServiceKeys.InputBox`): a single-field
 * text prompt with live validation, and a yes/no confirm. Keyboard-operable
 * (Enter submits when valid, Escape cancels) and screen-reader labelled. The
 * Explorer "New …" flow is the first consumer.
 */
export class InputBoxModule implements IModule, InputBoxService {
  readonly id = 'znxstudio.inputbox';
  readonly displayName = 'Input Box';

  private root!: HTMLElement;
  private cancelActive: (() => void) | undefined;
  private releaseOverlay: (() => void) | undefined;

  activate(context: ModuleContext): void {
    context.services.register<InputBoxService>(ServiceKeys.InputBox, this);
    this.root = document.createElement('div');
    this.root.className = 'znxstudio-inputbox';
    document.body.appendChild(this.root);
    context.subscriptions.push({
      dispose: () => {
        this.cancelActive?.();
        this.root.remove();
      },
    });
    void selfTestCoordinator.run('inputbox', () => this.maybeSelfTest());
  }

  /** Prompt for a single line of text; resolves to the value, or null if cancelled. */
  prompt(options: InputBoxOptions): Promise<string | null> {
    this.cancelActive?.();
    return new Promise((resolve) => {
      const restoreFocus = captureFocus();
      let settled = false;
      let cancelThis: () => void;
      const settle = (value: string | null): void => {
        if (settled) return;
        settled = true;
        if (this.cancelActive === cancelThis) {
          this.cancelActive = undefined;
          this.root.onmousedown = null;
          this.root.replaceChildren();
          this.root.classList.remove('is-open');
          this.releaseOverlay?.();
          this.releaseOverlay = undefined;
        }
        document.removeEventListener('keydown', onKey, true);
        restoreFocus();
        resolve(value);
      };
      cancelThis = () => settle(null);
      this.cancelActive = cancelThis;
      this.releaseOverlay = claimOverlay(this, cancelThis);

      const panel = document.createElement('div');
      panel.className = 'znxstudio-inputbox-panel';
      markDialog(panel, options.title);

      const heading = document.createElement('div');
      heading.className = 'znxstudio-inputbox-title';
      heading.textContent = options.title;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'znxstudio-input znxstudio-inputbox-field';
      input.value = options.value ?? '';
      input.placeholder = options.placeholder ?? '';
      input.setAttribute('aria-label', options.label ?? options.title);

      const error = document.createElement('div');
      error.className = 'znxstudio-inputbox-error';
      error.setAttribute('role', 'alert');
      error.setAttribute('aria-live', 'polite');

      const actions = document.createElement('div');
      actions.className = 'znxstudio-inputbox-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'znxstudio-btn ghost';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => settle(null));
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'znxstudio-btn primary';
      ok.textContent = options.submitLabel ?? 'Create';
      actions.append(cancel, ok);

      const currentError = (): string | null => options.validate?.(input.value) ?? null;
      const refresh = (): void => {
        const message = currentError();
        error.textContent = message ?? '';
        ok.disabled = message !== null;
      };
      const submit = (): void => {
        if (currentError() !== null) return;
        settle(input.value.trim());
      };
      ok.addEventListener('click', submit);
      input.addEventListener('input', refresh);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      });

      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          event.preventDefault();
          settle(null);
        }
      };

      panel.append(heading);
      if (options.label) {
        const lbl = document.createElement('label');
        lbl.className = 'znxstudio-inputbox-label';
        lbl.textContent = options.label;
        panel.append(lbl);
      }
      panel.append(input, error, actions);
      this.root.replaceChildren(panel);
      this.root.classList.add('is-open');
      this.root.onmousedown = (event) => {
        if (event.target === this.root) settle(null);
      };
      document.addEventListener('keydown', onKey, true);
      refresh();
      input.focus();
      input.select();
    });
  }

  /** Yes/No confirmation; resolves true if confirmed. */
  confirm(options: ConfirmOptions): Promise<boolean> {
    this.cancelActive?.();
    return new Promise((resolve) => {
      const restoreFocus = captureFocus();
      let settled = false;
      let cancelThis: () => void;
      const settle = (value: boolean): void => {
        if (settled) return;
        settled = true;
        if (this.cancelActive === cancelThis) {
          this.cancelActive = undefined;
          this.root.onmousedown = null;
          this.root.replaceChildren();
          this.root.classList.remove('is-open');
          this.releaseOverlay?.();
          this.releaseOverlay = undefined;
        }
        document.removeEventListener('keydown', onKey, true);
        restoreFocus();
        resolve(value);
      };
      cancelThis = () => settle(false);
      this.cancelActive = cancelThis;
      this.releaseOverlay = claimOverlay(this, cancelThis);

      const panel = document.createElement('div');
      panel.className = 'znxstudio-inputbox-panel';
      markDialog(panel, options.title);

      const heading = document.createElement('div');
      heading.className = 'znxstudio-inputbox-title';
      heading.textContent = options.title;
      const message = document.createElement('p');
      message.className = 'znxstudio-inputbox-message';
      message.textContent = options.message;

      const actions = document.createElement('div');
      actions.className = 'znxstudio-inputbox-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'znxstudio-btn ghost';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => settle(false));
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = `znxstudio-btn ${options.danger ? 'is-danger' : 'primary'}`;
      ok.textContent = options.confirmLabel ?? 'OK';
      ok.addEventListener('click', () => settle(true));
      actions.append(cancel, ok);

      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          event.preventDefault();
          settle(false);
        }
      };

      panel.append(heading, message, actions);
      this.root.replaceChildren(panel);
      this.root.classList.add('is-open');
      this.root.onmousedown = (event) => {
        if (event.target === this.root) settle(false);
      };
      document.addEventListener('keydown', onKey, true);
      ok.focus();
    });
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string): void => console.info(`[selftest] ${message}`);

    const pending = this.prompt({
      title: 'New File',
      label: 'Name',
      value: 'draft',
      validate: (v) => (v.trim() ? null : 'Enter a name.'),
    });
    const dialogRole = this.root.querySelector('.znxstudio-inputbox-panel')?.getAttribute('role');
    const field = this.root.querySelector('.znxstudio-inputbox-field') as HTMLInputElement | null;
    // Clear → the error + disabled Create appear; type a value → Enter submits.
    if (field) {
      field.value = '';
      field.dispatchEvent(new Event('input'));
    }
    const errored = (this.root.querySelector('.znxstudio-inputbox-error')?.textContent ?? '') !== '';
    const okDisabled = (this.root.querySelector('.znxstudio-btn.primary') as HTMLButtonElement | null)?.disabled;
    if (field) {
      field.value = 'hello.zx';
      field.dispatchEvent(new Event('input'));
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    }
    const value = await pending;
    log(
      `inputbox REAL DOM: dialog=${dialogRole} clearedError=${errored} okDisabledWhenInvalid=${okDisabled} ` +
        `submitted=${value} (expect dialog, error+disabled on empty, submit "hello.zx")`,
    );
  }
}
