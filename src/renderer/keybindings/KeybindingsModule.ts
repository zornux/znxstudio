import { ServiceKeys, type KeybindingService, type SettingsService } from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { Disposable, IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import {
  chordFromEvent,
  findConflicts,
  findShadowedPrefixes,
  formatKeybinding,
  match,
  normalizeKeybinding,
  parseKeybinding,
  parseUserKeybindings,
  renderUserKeybindings,
  resolveBindings,
  resolvePrimaryModifier,
  type Chord,
  type Keybinding,
} from './keybindings';

const USER_SETTING = 'znxstudio.keybindings';
/** How long a pending first chord waits for its partner before giving up. */
const CHORD_TIMEOUT_MS = 2_000;

/**
 * The default bindings ZnxStudio ships. Every one names a command that exists; the
 * self-test asserts it, because a binding for a command nobody registered is a
 * key that silently does nothing.
 *
 * The DEBUGGER's keys (F5, F6, F9, F10, F11) are deliberately absent. Its own
 * handlers are state-sensitive — F5 continues when paused and starts when idle —
 * and a command id cannot express that. Binding them here would install a second
 * handler for each key, which is the exact bug this module exists to prevent.
 * Migrating them means giving the debugger state-aware commands first.
 */
const DEFAULT_BINDINGS: [string, string][] = [
  ['Mod+P', CommandIds.QuickOpen],
  ['Mod+Shift+P', CommandIds.PaletteShow],
  ['Mod+Shift+A', CommandIds.SearchEverywhere],
  ['Mod+W', CommandIds.EditorClose],
  ['Mod+S', CommandIds.FileSave],
  ['Mod+B', CommandIds.LayoutToggleSideBar],
  ['Mod+J', CommandIds.LayoutTogglePanel],
  ['Mod+K Z', CommandIds.LayoutToggleZen],
  ['Mod+K Mod+S', CommandIds.KeybindingsShow],
  ['Mod+K Mod+M', CommandIds.MacroShow],
  ['Mod+Shift+E', CommandIds.SearchShow],
  ['Mod+Shift+M', CommandIds.ViewProblems],
  ['Mod+=', CommandIds.ZoomIn],
  ['Mod+-', CommandIds.ZoomOut],
  ['Mod+0', CommandIds.ZoomReset],
];

/**
 * Keybindings (Phase 17D). ONE capture-phase listener owns the keyboard: it
 * resolves the chord against defaults + user overrides and dispatches a command.
 * Modules no longer install their own listeners, so a conflict is detectable
 * rather than a race between two handlers.
 *
 * A key that matches nothing is left alone — the editor must keep receiving the
 * keys it needs. A key that matches is consumed, so it never also types a `p`.
 */
export class KeybindingsModule implements IModule, KeybindingService {
  readonly id = 'znxstudio.keybindings';
  readonly displayName = 'Keybindings';

  private context!: ModuleContext;
  private settings: SettingsService | undefined;
  /** macOS uses Command as the primary modifier; every other OS uses Control. */
  private readonly isMac = /mac/i.test(
    (typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '',
  );
  private defaults: Keybinding[] = [];
  private external: Keybinding[] = [];
  private user: Keybinding[] = [];
  private pending: Chord[] = [];
  private pendingTimer: ReturnType<typeof setTimeout> | undefined;
  private listener: ((event: KeyboardEvent) => void) | undefined;
  private readonly changeEmitter = new Emitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  activate(context: ModuleContext): void {
    this.context = context;
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    context.services.register<KeybindingService>(ServiceKeys.Keybindings, this);

    for (const [keys, command] of DEFAULT_BINDINGS) {
      this.registerDefault(resolvePrimaryModifier(keys, this.isMac), command);
    }
    this.user = parseUserKeybindings(this.settings?.get<unknown>(USER_SETTING, {}));

    context.commands.register(CommandIds.KeybindingsShow, () => this.showEditor(), 'Preferences: Keyboard Shortcuts');
    context.commands.register(CommandIds.KeybindingsReset, () => this.setUserBindings({}), 'Preferences: Reset Keyboard Shortcuts');

    this.listener = (event) => this.onKeyDown(event);
    document.addEventListener('keydown', this.listener, true);

    this.settings?.onDidChange((change) => {
      if (change.key !== USER_SETTING) return;
      this.user = parseUserKeybindings(change.value);
      this.changeEmitter.fire();
    });

    void selfTestCoordinator.run('keybindings', () => this.maybeSelfTest());
  }

  deactivate(): void {
    if (this.listener) document.removeEventListener('keydown', this.listener, true);
  }

  /* ----- KeybindingService ----- */
  bindings(): Keybinding[] {
    // Extension bindings rank after built-in defaults but before user overrides.
    return resolveBindings([...this.defaults, ...this.external], this.user);
  }

  registerDefault(keys: string, command: string): void {
    const chords = parseKeybinding(keys);
    if (!chords) throw new Error(`Not a keybinding: ${keys}`);
    this.defaults.push({ chords, command, source: 'default' });
  }

  registerExternal(keys: string, command: string): Disposable {
    const chords = parseKeybinding(keys);
    if (!chords) throw new Error(`Not a keybinding: ${keys}`);
    const binding: Keybinding = { chords, command, source: 'default' };
    this.external.push(binding);
    this.changeEmitter.fire();
    return {
      dispose: () => {
        const index = this.external.indexOf(binding);
        if (index >= 0) this.external.splice(index, 1);
        this.changeEmitter.fire();
      },
    };
  }

  setUserBindings(bindings: Record<string, string>): void {
    this.user = parseUserKeybindings(bindings);
    this.settings?.set(USER_SETTING, renderUserKeybindings(this.user));
    this.changeEmitter.fire();
  }

  keysFor(command: string): string | null {
    // The LAST binding for a command wins, matching `match`'s resolution order.
    const found = [...this.bindings()].reverse().find((binding) => binding.command === command);
    return found ? formatKeybinding(found.chords) : null;
  }

  /* ----- the one listener ----- */
  private onKeyDown(event: KeyboardEvent): void {
    const chord = chordFromEvent(event);
    if (!chord) return; // a bare modifier press

    const result = match(this.bindings(), [...this.pending, chord]);
    if (result.kind === 'none') {
      // A miss ends any pending chord, and the key belongs to whoever has focus.
      this.clearPending();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (result.kind === 'pending') {
      this.pending = [...this.pending, chord];
      clearTimeout(this.pendingTimer);
      this.pendingTimer = setTimeout(() => this.clearPending(), CHORD_TIMEOUT_MS);
      this.context.layout.showToast(`${formatKeybinding(this.pending)}…`, 'info');
      return;
    }

    this.clearPending();
    // A binding for a command nobody registered must not throw into the void.
    if (!this.context.commands.has(result.command)) {
      this.context.layout.showToast(`No command "${result.command}" for these keys.`, 'error');
      return;
    }
    void this.context.commands.execute(result.command);
  }

  private clearPending(): void {
    this.pending = [];
    clearTimeout(this.pendingTimer);
    this.pendingTimer = undefined;
  }

  /* ----- editor ----- */
  private showEditor(): void {
    const view = document.createElement('div');
    view.className = 'znxstudio-keys';

    const render = (): void => {
      view.replaceChildren();

      const conflicts = findConflicts(this.bindings()).filter((conflict) => !conflict.isOverride);
      if (conflicts.length) {
        view.appendChild(
          note(
            `${conflicts.length} conflict(s): ${conflicts.map((c) => `${c.keys} → ${c.commands.join(' / ')}`).join('; ')}`,
            'znxstudio-keys-warn',
          ),
        );
      }
      for (const { prefix, shadowed } of findShadowedPrefixes(this.bindings())) {
        view.appendChild(note(`${prefix} is bound on its own, so ${shadowed.join(', ')} can never fire.`, 'znxstudio-keys-warn'));
      }

      for (const binding of this.bindings()) {
        const row = document.createElement('div');
        row.className = `znxstudio-keys-row is-${binding.source}`;

        const keys = document.createElement('code');
        keys.className = 'znxstudio-keys-chord';
        keys.textContent = formatKeybinding(binding.chords);

        const command = document.createElement('span');
        command.className = 'znxstudio-keys-command';
        command.textContent = binding.command;

        const origin = document.createElement('span');
        origin.className = 'znxstudio-keys-origin';
        origin.textContent = binding.source;

        const rebind = document.createElement('button');
        rebind.className = 'znxstudio-btn-small';
        rebind.textContent = 'Rebind';
        rebind.addEventListener('click', () => {
          const typed = window.prompt(`New keys for ${binding.command}`, formatKeybinding(binding.chords));
          if (typed === null) return;
          const canonical = normalizeKeybinding(typed);
          if (!canonical) {
            this.context.layout.showToast(`"${typed}" is not a valid keybinding.`, 'error');
            return;
          }
          this.setUserBindings({ ...renderUserKeybindings(this.user), [canonical]: binding.command });
          render();
        });

        row.append(keys, command, origin, rebind);
        view.appendChild(row);
      }

      const reset = document.createElement('button');
      reset.className = 'znxstudio-btn-small';
      reset.textContent = '⟲ Reset to defaults';
      reset.addEventListener('click', () => {
        this.setUserBindings({});
        render();
      });
      view.appendChild(reset);
    };

    this.onDidChange(() => render());
    render();
    this.context.layout.setSideBar('Keyboard Shortcuts', view);
    this.context.layout.focusSideBar();
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
    const log = (message: string) => console.info(`[selftest] ${message}`);

    // Every default must name a command that exists, or the key does nothing.
    const registered = new Set(this.context.commands.list().map((command) => command.id));
    const dangling = this.defaults.filter((binding) => !registered.has(binding.command)).map((binding) => binding.command);
    log(`keybindings defaults: ${this.defaults.length} · dangling (bound to no command)=[${dangling.join(', ') || 'none'}]`);

    const conflicts = findConflicts(this.bindings()).filter((conflict) => !conflict.isOverride);
    log(`keybindings conflicts among defaults: ${conflicts.length} (expect 0) ${conflicts.map((c) => c.keys).join(' ')}`);
    log(`keybindings shadowed prefixes: ${findShadowedPrefixes(this.bindings()).length} (expect 0)`);

    // Dispatch through the REAL listener: synthesise Ctrl+B and see the layout change.
    const layout = this.context.services.tryGet<{ layout(): { sidebar: { visible: boolean } } }>(ServiceKeys.Layout);
    // Dispatch with the platform-primary modifier so the default resolves the
    // same way it will for a real user (Cmd on macOS, Ctrl elsewhere).
    const primary = this.isMac ? { metaKey: true } : { ctrlKey: true };
    const label = this.isMac ? 'Cmd' : 'Ctrl';
    const before = layout?.layout().sidebar.visible;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ...primary, bubbles: true, cancelable: true }));
    const after = layout?.layout().sidebar.visible;
    log(`keybindings REAL dispatch ${label}+B: sidebar.visible ${before} → ${after} (a real key event ran a real command)`);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ...primary, bubbles: true, cancelable: true }));

    // A two-chord binding must not fire on its first chord.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ...primary, bubbles: true, cancelable: true }));
    log(`keybindings chord: after ${label}+K pending=${this.pending.length} (expect 1 — waiting for the second chord)`);
    this.clearPending();

    log(`keybindings keysFor(${CommandIds.QuickOpen}) = ${this.keysFor(CommandIds.QuickOpen)}`);
  }
}

function note(text: string, className: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}
