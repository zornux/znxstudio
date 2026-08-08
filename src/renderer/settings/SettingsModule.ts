import * as monaco from 'monaco-editor';
import {
  ServiceKeys,
  type EditorService,
  type SettingScope,
  type SettingsChangeEvent,
  type SettingsService,
  type ThemeService,
  type WorkspaceService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import {
  coerceSetting,
  RELOAD_REQUIRED_KEYS,
  SETTINGS_DEFAULTS,
  SETTINGS_DESCRIPTIONS,
  SETTINGS_JSON_SCHEMA,
  SETTINGS_MODEL_URI,
} from './SettingsSchema';
import {
  getEffective,
  getUserValue,
  hasOverride,
  isOverridable,
  legacyOverridesFor,
  overriddenKeys,
  sanitizeWorkspaceSettings,
  withOverride,
  withoutLegacyRoot,
  withoutOverride,
  LEGACY_OVERRIDES_KEY,
  WORKSPACE_SETTINGS_DIR,
  WORKSPACE_SETTINGS_FILE,
  type WorkspaceStore,
} from './settingsScope';
import { normalizeRoot } from '../workspace/workspaceFolders';
import {
  describeSettings,
  filterSettings,
  groupSettings,
  type SettingDescriptor,
} from './settingsUi';
import { i18n } from '../i18n';

/**
 * Persistence-backed settings engine. Reads/writes ~/.znxstudio/settings.json via
 * IPC, broadcasts changes through an Emitter so Monaco and the workbench update
 * live, and renders an interactive split-pane settings.json editor in Monaco.
 */
export class SettingsModule implements IModule, SettingsService {
  readonly id = 'znxstudio.settings';
  readonly displayName = 'Settings System';

  private context!: ModuleContext;
  private store: Record<string, unknown> = {};
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private settingsEditor: monaco.editor.IStandaloneCodeEditor | null = null;
  /** Live control updaters keyed by setting key (UX-8 form view). */
  private readonly controlUpdaters = new Map<string, (value: unknown) => void>();

  /** Workspace scope (post-1.0): the open primary root + which scope the form edits. */
  private workspace: WorkspaceService | undefined;
  private root: string | null = null;
  private formScope: SettingScope = 'user';
  /** Re-render the open form (scope switch / override reset need a rebuild). */
  private formRerender: (() => void) | null = null;
  /** The open folder's overrides, loaded from `<root>/.znxstudio/settings.json`. */
  private workspaceStore: WorkspaceStore = {};
  private workspaceWriteTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guard so the headless self-test can exercise scope without writing to disk. */
  private persistWorkspace = true;

  private readonly changeEmitter = new Emitter<SettingsChangeEvent>();
  readonly onDidChange = this.changeEmitter.event;

  async activate(context: ModuleContext): Promise<void> {
    this.context = context;

    const persisted = await window.znxstudio.settings.read();
    this.store = { ...SETTINGS_DEFAULTS, ...persisted };

    context.services.register(ServiceKeys.Settings, this);
    context.commands.register(CommandIds.SettingsOpen, () => this.openView(), 'Open Settings');

    this.bindWorkspaceScope();
    this.configureMonacoSchema();
    this.wireThemeSync();
    this.wireLocaleSync();

    // Keep any open form controls in step with external changes (JSON editor,
    // theme toggle, other modules calling set(), a workspace switch). The updater
    // recomputes from the viewed scope, so the event's value is not used directly.
    this.onDidChange((event) => this.controlUpdaters.get(event.key)?.(event.value));

    void selfTestCoordinator.run('settingsui', () => this.maybeSelfTest());
  }

  /**
   * Bind to the workspace so `get`/`set` are scope-aware. Settings usually
   * activates before the workspace module, so if the service isn't registered
   * yet we bind on the next tick (after all modules have activated). Binding
   * captures an already-open folder and re-fires the keys it overrides so live
   * consumers (theme, locale) reflect the workspace scope at startup.
   */
  private bindWorkspaceScope(): void {
    const bind = (): void => {
      const ws = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
      if (!ws) return;
      this.workspace = ws;
      ws.onDidChangeWorkspace(() => void this.onWorkspaceChanged());
      // Capture an already-open folder: load its overrides and re-fire them.
      void this.reloadWorkspace(ws.currentFolder());
    };
    const ws = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    if (ws) bind();
    else setTimeout(bind, 0);
  }

  private async onWorkspaceChanged(): Promise<void> {
    const next = this.workspace?.currentFolder() ?? null;
    const same = (this.root ? normalizeRoot(this.root) : null) === (next ? normalizeRoot(next) : null);
    if (same) return;
    await this.reloadWorkspace(next);
  }

  /**
   * Point the workspace scope at `root`, loading its `.znxstudio/settings.json`
   * (migrating any legacy per-user overrides on first load), then re-firing every
   * key whose effective value may have changed so live consumers + the open form
   * follow the new scope.
   */
  private async reloadWorkspace(root: string | null): Promise<void> {
    const before = this.workspaceStore;
    this.root = root;
    if (root) {
      const { ws, migrated } = await this.loadWorkspaceStore(root, this.store);
      this.workspaceStore = ws;
      if (migrated) this.pruneLegacyOverrides(root); // remove UX-021 byRoot from the global store
    } else {
      this.workspaceStore = {};
    }
    const affected = new Set<string>([...overriddenKeys(before), ...overriddenKeys(this.workspaceStore)]);
    for (const key of affected) {
      this.changeEmitter.fire({ key, value: this.effectiveOf(key), settings: this.all() });
    }
    this.formRerender?.();
  }

  /**
   * Read `<root>/.znxstudio/settings.json`. If it has no overrides, fold any
   * legacy UX-021 per-user overrides for this root (from `store`) into it and
   * write the folder file, reporting `migrated` so the caller can prune the
   * global store. Pure w.r.t. `store` (never mutates it) so the self-test can
   * drive a real migration against a synthetic store + temp root.
   */
  private async loadWorkspaceStore(
    root: string,
    store: Record<string, unknown>,
  ): Promise<{ ws: WorkspaceStore; migrated: boolean }> {
    let raw: unknown = {};
    try {
      raw = JSON.parse(await window.znxstudio.fs.readFile(this.workspaceFilePath(root)));
    } catch {
      // Missing or corrupt → no folder overrides (mirrors SettingsStore.read).
    }
    let ws = sanitizeWorkspaceSettings(raw);
    let migrated = false;
    if (Object.keys(ws).length === 0) {
      const legacy = legacyOverridesFor(store, root);
      if (Object.keys(legacy).length > 0) {
        ws = legacy;
        migrated = true;
        if (this.persistWorkspace) await this.writeWorkspaceFile(root, ws);
      }
    }
    return { ws, migrated };
  }

  private pruneLegacyOverrides(root: string): void {
    const pruned = withoutLegacyRoot(this.store, root);
    if (pruned) this.store[LEGACY_OVERRIDES_KEY] = pruned;
    else delete this.store[LEGACY_OVERRIDES_KEY];
    this.schedulePersist();
  }

  private workspaceFilePath(root: string): string {
    const sep = root.includes('\\') ? '\\' : '/';
    return `${root}${sep}${WORKSPACE_SETTINGS_DIR}${sep}${WORKSPACE_SETTINGS_FILE}`;
  }

  private effectiveOf(key: string): unknown {
    return getEffective(this.store, this.workspaceStore, key, undefined);
  }

  /* ----- workspace-file persistence ----- */
  private writeWorkspaceFile(root: string, ws: WorkspaceStore): Promise<void> {
    return window.znxstudio.fs
      .writeFile(this.workspaceFilePath(root), `${JSON.stringify(ws, null, 2)}\n`)
      .catch(() => {
        // Write failures (e.g. read-only folder) are non-fatal: the override still
        // applies in-memory for this session.
      });
  }

  private scheduleWorkspacePersist(): void {
    if (!this.root || !this.persistWorkspace) return;
    const root = this.root;
    const snapshot = { ...this.workspaceStore };
    if (this.workspaceWriteTimer) clearTimeout(this.workspaceWriteTimer);
    this.workspaceWriteTimer = setTimeout(() => void this.writeWorkspaceFile(root, snapshot), 200);
  }

  /* ----- SettingsService ----- */
  get<T>(key: string, fallback: T): T {
    // The effective value: a workspace override (for the open folder) shadows the
    // user value, which falls back to `fallback`.
    return getEffective(this.store, this.workspaceStore, key, fallback);
  }

  set<T>(key: string, value: T, scope: SettingScope = 'user'): void {
    // Validate against the schema before persisting: reject values it forbids (bad enum, malformed
    // pattern, wrong type) and clamp out-of-range numbers, so neither the form nor the JSON editor can
    // silently save an invalid value. Keys the schema doesn't describe pass through unchanged.
    const coerced = coerceSetting(key, value);
    if (!coerced.ok) return;
    const next = coerced.value;

    if (scope === 'workspace' && this.root && isOverridable(key)) {
      if (key in this.workspaceStore && this.deepEqual(this.workspaceStore[key], next)) return;
      this.workspaceStore = withOverride(this.workspaceStore, key, next);
      this.scheduleWorkspacePersist(); // → <root>/.znxstudio/settings.json
    } else {
      // User scope (default). A non-overridable key or a missing root also lands here.
      if (this.deepEqual(this.store[key], next)) return;
      this.store[key] = next;
      this.schedulePersist(); // → ~/.znxstudio/settings.json
    }

    // Fire the effective value so live consumers get what they will actually read.
    // (Setting the user value while a workspace override shadows it fires an
    // unchanged effective value; the form updater still refreshes its control.)
    this.changeEmitter.fire({ key, value: this.effectiveOf(key), settings: this.all() });
  }

  /** Remove the open workspace's override for a key, falling back to the user value. */
  private clearWorkspaceOverride(key: string): void {
    if (!this.root || !hasOverride(this.workspaceStore, key)) return;
    this.workspaceStore = withoutOverride(this.workspaceStore, key);
    this.scheduleWorkspacePersist();
    this.changeEmitter.fire({ key, value: this.effectiveOf(key), settings: this.all() });
  }

  applyAll(next: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(next)) {
      this.set(key, value);
    }
  }

  all(): Record<string, unknown> {
    return { ...this.store };
  }

  /* ----- Persistence ----- */
  private schedulePersist(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      void window.znxstudio.settings.write(this.all());
    }, 200);
  }

  /* ----- Locale wiring (20B) ----- */
  private wireLocaleSync(): void {
    i18n.setLocale(this.get('workbench.locale', 'en'));
    this.onDidChange((event) => {
      if (event.key === 'workbench.locale') i18n.setLocale(String(event.value));
    });
  }

  /* ----- Theme wiring ----- */
  private wireThemeSync(): void {
    const theme = this.context.services.tryGet<ThemeService>(ServiceKeys.Theme);
    if (!theme) return;
    theme.apply(this.get('workbench.theme', theme.current()));
    this.onDidChange((event) => {
      if (event.key === 'workbench.theme') theme.apply(String(event.value));
    });
  }

  /* ----- Interactive settings editor ----- */
  private configureMonacoSchema(): void {
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      schemas: [
        {
          uri: 'https://znxstudio.dev/schemas/settings.json',
          fileMatch: [SETTINGS_MODEL_URI],
          schema: SETTINGS_JSON_SCHEMA,
        },
      ],
    });
  }

  /** The default settings surface (UX-8): a searchable, grouped form. */
  private openView(): HTMLElement {
    this.controlUpdaters.clear();
    const descriptors = describeSettings(SETTINGS_JSON_SCHEMA, SETTINGS_DESCRIPTIONS, this.all() as Record<string, unknown>);

    const view = document.createElement('div');
    view.className = 'znxstudio-settings-ui';

    const header = document.createElement('div');
    header.className = 'znxstudio-settings-ui-header';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'znxstudio-settings-ui-search';
    search.placeholder = 'Search settings…';
    search.setAttribute('aria-label', 'Search settings');

    const jsonButton = document.createElement('button');
    jsonButton.className = 'znxstudio-btn znxstudio-settings-ui-json';
    jsonButton.textContent = '{ } settings.json';
    jsonButton.title = 'Edit the raw settings.json (power users)';
    jsonButton.addEventListener('click', () => this.openJsonView());

    header.append(search, jsonButton);

    // Scope switch (post-1.0): only when a workspace folder is open. Editing under
    // "Workspace" writes an override that applies to this folder only.
    if (this.root) header.appendChild(this.buildScopeSwitch(() => this.formRerender?.()));

    const body = document.createElement('div');
    body.className = 'znxstudio-settings-ui-body';
    const nav = document.createElement('nav');
    nav.className = 'znxstudio-settings-ui-nav';
    const list = document.createElement('div');
    list.className = 'znxstudio-settings-ui-list';
    body.append(nav, list);

    const render = (query: string) => {
      this.controlUpdaters.clear();
      const groups = groupSettings(filterSettings(descriptors, query));
      nav.replaceChildren();
      list.replaceChildren();
      if (!groups.length) {
        const empty = document.createElement('div');
        empty.className = 'znxstudio-settings-ui-empty';
        empty.textContent = 'No settings match your search.';
        list.appendChild(empty);
        return;
      }
      for (const group of groups) {
        const navItem = document.createElement('button');
        navItem.className = 'znxstudio-settings-ui-navitem';
        navItem.textContent = group.group;
        const anchorId = `settings-group-${group.group.replace(/\s+/g, '-').toLowerCase()}`;
        navItem.addEventListener('click', () => document.getElementById(anchorId)?.scrollIntoView({ block: 'start' }));
        nav.appendChild(navItem);

        const section = document.createElement('section');
        section.className = 'znxstudio-settings-ui-group';
        section.id = anchorId;
        const heading = document.createElement('h2');
        heading.textContent = group.group;
        section.appendChild(heading);
        for (const descriptor of group.items) section.appendChild(this.renderRow(descriptor));
        list.appendChild(section);
      }
    };

    search.addEventListener('input', () => render(search.value));
    this.formRerender = () => render(search.value);
    render('');

    view.append(header, body);
    // The editor may not be registered yet during the headless self-test; the
    // view is still built and returned so it can be inspected.
    this.context.services.tryGet<EditorService>(ServiceKeys.Editor)?.showView(view);
    return view;
  }

  /** The two-segment User / Workspace scope switch shown when a folder is open. */
  private buildScopeSwitch(onChange: () => void): HTMLElement {
    const group = document.createElement('div');
    group.className = 'znxstudio-settings-ui-scope';
    group.setAttribute('role', 'tablist');
    group.setAttribute('aria-label', 'Settings scope');
    const make = (scope: SettingScope, label: string, title: string): HTMLButtonElement => {
      const button = document.createElement('button');
      button.className = 'znxstudio-settings-ui-scopebtn';
      button.textContent = label;
      button.title = title;
      button.setAttribute('role', 'tab');
      const sync = () => button.setAttribute('aria-selected', this.formScope === scope ? 'true' : 'false');
      sync();
      button.addEventListener('click', () => {
        if (this.formScope === scope) return;
        this.formScope = scope;
        onChange();
      });
      return button;
    };
    group.append(
      make('user', 'User', 'Settings for every window'),
      make('workspace', 'Workspace', 'Overrides that apply to this folder only'),
    );
    return group;
  }

  /** The value a control shows/edits under the current form scope. */
  private scopedValue(key: string): unknown {
    if (this.formScope === 'workspace' && this.root) {
      // An existing override, else the inherited value shown as the base to edit.
      return key in this.workspaceStore
        ? this.workspaceStore[key]
        : getEffective(this.store, this.workspaceStore, key, undefined);
    }
    return getUserValue(this.store, key);
  }

  private renderRow(descriptor: SettingDescriptor): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-settings-ui-row';

    const info = document.createElement('div');
    info.className = 'znxstudio-settings-ui-info';
    const title = document.createElement('div');
    title.className = 'znxstudio-settings-ui-title';
    title.textContent = descriptor.title;
    if (RELOAD_REQUIRED_KEYS.has(descriptor.key)) {
      const badge = document.createElement('span');
      badge.className = 'znxstudio-settings-ui-badge';
      badge.textContent = 'Reload required';
      badge.title = 'Changing this needs a window reload to fully apply.';
      title.appendChild(badge);
    }
    // Workspace scope: flag an active override and offer a one-click reset to the user value.
    if (this.formScope === 'workspace' && this.root && hasOverride(this.workspaceStore, descriptor.key)) {
      const badge = document.createElement('span');
      badge.className = 'znxstudio-settings-ui-badge is-override';
      badge.textContent = 'Workspace';
      badge.title = 'Overridden for this workspace';
      title.appendChild(badge);
      const reset = document.createElement('button');
      reset.className = 'znxstudio-settings-ui-reset';
      reset.textContent = 'Reset';
      reset.title = 'Remove the workspace override (fall back to the user value)';
      reset.addEventListener('click', () => {
        this.clearWorkspaceOverride(descriptor.key);
        this.formRerender?.();
      });
      title.appendChild(reset);
    }
    const key = document.createElement('code');
    key.className = 'znxstudio-settings-ui-key';
    key.textContent = descriptor.key;
    info.append(title, key);
    if (descriptor.description) {
      const desc = document.createElement('div');
      desc.className = 'znxstudio-settings-ui-desc';
      desc.textContent = descriptor.description;
      info.appendChild(desc);
    }

    const control = document.createElement('div');
    control.className = 'znxstudio-settings-ui-control';
    control.appendChild(this.renderControl(descriptor));

    row.append(info, control);
    return row;
  }

  private renderControl(descriptor: SettingDescriptor): HTMLElement {
    // The value shown/edited follows the form scope (user vs. the open workspace).
    const current = this.scopedValue(descriptor.key);
    const label = `${descriptor.title} setting`;

    if (descriptor.type === 'boolean') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = current === true;
      input.setAttribute('aria-label', label);
      input.addEventListener('change', () => {
        this.set(descriptor.key, input.checked, this.formScope);
        if (this.formScope === 'workspace') this.formRerender?.(); // toggles the override badge
      });
      this.controlUpdaters.set(descriptor.key, () => (input.checked = this.scopedValue(descriptor.key) === true));
      return input;
    }

    if (descriptor.type === 'enum') {
      const select = document.createElement('select');
      select.setAttribute('aria-label', label);
      const options = descriptor.enumValues ?? [];
      for (const option of options) {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        select.appendChild(opt);
      }
      // Show the stored value even when it is not a valid option (legacy / hand-edited settings.json):
      // surface it as a transient "(invalid)" entry rather than blanking the control. Picking a real
      // option removes it.
      const applyValue = (value: unknown): void => {
        const str = String(value ?? '');
        const stray = select.querySelector<HTMLOptionElement>('option[data-stray="true"]');
        if (str && !options.includes(str)) {
          if (stray) {
            stray.value = str;
            stray.textContent = `${str} (invalid)`;
          } else {
            const opt = document.createElement('option');
            opt.value = str;
            opt.textContent = `${str} (invalid)`;
            opt.dataset.stray = 'true';
            select.insertBefore(opt, select.firstChild);
          }
        } else {
          stray?.remove();
        }
        select.value = str;
      };
      applyValue(current);
      select.addEventListener('change', () => {
        this.set(descriptor.key, select.value, this.formScope);
        if (this.formScope === 'workspace') this.formRerender?.();
      });
      this.controlUpdaters.set(descriptor.key, () => applyValue(this.scopedValue(descriptor.key)));
      return select;
    }

    const input = document.createElement('input');
    input.setAttribute('aria-label', label);
    if (descriptor.type === 'number') {
      input.type = 'number';
      if (descriptor.min !== undefined) input.min = String(descriptor.min);
      if (descriptor.max !== undefined) input.max = String(descriptor.max);
      input.value = String(current ?? '');
      input.addEventListener('change', () =>
        this.commitControl(descriptor.key, input.value === '' ? input.value : Number(input.value), input),
      );
      this.controlUpdaters.set(descriptor.key, () => (input.value = String(this.scopedValue(descriptor.key) ?? '')));
    } else {
      input.type = 'text';
      input.value = String(current ?? '');
      input.addEventListener('change', () => this.commitControl(descriptor.key, input.value, input));
      this.controlUpdaters.set(descriptor.key, () => (input.value = String(this.scopedValue(descriptor.key) ?? '')));
    }
    return input;
  }

  // Persist a form control's value at the current scope; if the schema rejects it, revert the control to
  // the stored value and mark it invalid so the feedback is inline (no silently-saved bad value, no lost
  // keystroke). Comparison is against the scoped value so it works for both user and workspace edits.
  private commitControl(key: string, value: unknown, input: HTMLInputElement): void {
    const before = this.scopedValue(key);
    this.set(key, value, this.formScope);
    const after = this.scopedValue(key);
    const rejected = this.deepEqual(before, after) && !this.deepEqual(value, after);
    input.value = String(after ?? ''); // reflect a rejection (revert) or a clamp
    if (rejected) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
    input.classList.toggle('is-invalid', rejected);
    if (!rejected && this.formScope === 'workspace') this.formRerender?.(); // toggles the override badge
  }

  /** The raw JSON editor, kept for power users (reachable from the form header). */
  private openJsonView(): void {
    const view = document.createElement('div');
    view.className = 'znxstudio-settings';
    view.innerHTML = `
      <aside class="znxstudio-settings-side">
        <h1>Settings (JSON)</h1>
        <p class="znxstudio-muted">Edit <code>settings.json</code> — changes apply live.</p>
        <ul class="znxstudio-settings-keys">
          ${SETTINGS_DESCRIPTIONS.map(
            (item) =>
              `<li><code>${item.key}</code><span>${item.description}</span></li>`,
          ).join('')}
        </ul>
        <button class="znxstudio-btn" data-role="back">← Back to Settings</button>
      </aside>
      <div class="znxstudio-settings-editor" data-role="settings-editor"></div>
    `;

    view.querySelector<HTMLElement>('[data-role="back"]')!.addEventListener('click', () => this.openView());
    this.context.services.get<EditorService>(ServiceKeys.Editor).showView(view);

    const host = view.querySelector<HTMLElement>('[data-role="settings-editor"]')!;
    this.mountEditor(host);
  }

  private mountEditor(host: HTMLElement): void {
    this.settingsEditor?.dispose();

    const uri = monaco.Uri.parse(SETTINGS_MODEL_URI);
    const text = `${JSON.stringify(this.all(), null, 2)}\n`;
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(text, 'json', uri);
    model.setValue(text);

    this.settingsEditor = monaco.editor.create(host, {
      model,
      language: 'json',
      theme: 'znxstudio-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: this.get('editor.fontSize', 13),
      fontFamily: this.get('editor.fontFamily', "'Cascadia Code', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace"),
      lineHeight: Math.round(this.get('editor.fontSize', 14) * 1.5),
      scrollBeyondLastLine: false,
    });

    let applyTimer: ReturnType<typeof setTimeout> | null = null;
    model.onDidChangeContent(() => {
      if (applyTimer) clearTimeout(applyTimer);
      applyTimer = setTimeout(() => this.applyFromEditor(model.getValue()), 300);
    });
  }

  private applyFromEditor(text: string): void {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        this.applyAll(parsed as Record<string, unknown>);
      }
    } catch {
      // Invalid JSON while typing — Monaco surfaces the diagnostic; ignore here.
    }
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let info: Awaited<ReturnType<typeof window.znxstudio.app.getInfo>> | null = null;
    try {
      info = await window.znxstudio.app.getInfo();
    } catch {
      info = null;
    }
    if (info?.selftest !== true) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    try {
      const view = this.openView();
      const rows = view.querySelectorAll('.znxstudio-settings-ui-row').length;
      const groups = view.querySelectorAll('.znxstudio-settings-ui-group').length;
      const controls = view.querySelectorAll('.znxstudio-settings-ui-control input, .znxstudio-settings-ui-control select').length;

      // Layout guard: the content column is capped + centered so controls sit next
      // to their settings instead of being flung to the far edge of a wide window.
      // Attach to the DOM briefly so computed styles reflect the stylesheet.
      const group = view.querySelector<HTMLElement>('.znxstudio-settings-ui-group');
      if (group) {
        document.body.appendChild(view);
        const style = getComputedStyle(group);
        log(`settingsui LAYOUT: groupMaxWidth=${style.maxWidth} centered=${style.marginLeft === style.marginRight} (expect 920px, centered)`);
        view.remove();
      }

      // Drive the search box like a user and re-read the DOM.
      const search = view.querySelector<HTMLInputElement>('.znxstudio-settings-ui-search')!;
      search.value = 'font';
      search.dispatchEvent(new Event('input'));
      const filtered = view.querySelectorAll('.znxstudio-settings-ui-row').length;

      // Toggle a boolean control and confirm it round-trips into the store.
      search.value = 'autosave';
      search.dispatchEvent(new Event('input'));
      const box = view.querySelector<HTMLInputElement>('.znxstudio-settings-ui-control input[type="checkbox"]');
      let toggled = 'n/a';
      if (box) {
        const before = this.get('files.autosave', false);
        box.checked = !before;
        box.dispatchEvent(new Event('change'));
        toggled = `${before}→${this.get('files.autosave', before)}`;
        this.set('files.autosave', before); // restore
      }
      log(
        `settingsui REAL DOM: rows=${rows} groups=${groups} controls=${controls} search"font"→rows=${filtered} autosaveToggle=${toggled}`,
      );
    } catch (error) {
      log(`settingsui self-test failed: ${(error as Error).message}`);
    }

    // Workspace-settings migration (UX-023): drive the REAL folder-file IO + legacy
    // migration end-to-end in the running app, against a throwaway temp workspace
    // root under the OS temp dir. The legacy store is synthetic, so the user's real
    // ~/.znxstudio/settings.json is never touched — only the temp folder file is.
    try {
      const sep = info.tempDir.includes('\\') ? '\\' : '/';
      const tempRoot = `${info.tempDir}${sep}znxstudio-migration-selftest`;
      const filePath = this.workspaceFilePath(tempRoot);
      // Reset the folder file so the "empty file → migrate legacy" path runs every time.
      await this.writeWorkspaceFile(tempRoot, {});
      const legacyStore = { [LEGACY_OVERRIDES_KEY]: { [normalizeRoot(tempRoot)]: { 'editor.fontSize': 22 } } };
      const { ws, migrated } = await this.loadWorkspaceStore(tempRoot, legacyStore);
      let onDisk = '(none)';
      try {
        onDisk = (await window.znxstudio.fs.readFile(filePath)).replace(/\s+/g, ' ').trim();
      } catch {
        /* file missing → left as (none) */
      }
      const legacyPruned = withoutLegacyRoot(legacyStore, tempRoot) === undefined;
      log(
        `settingsmigrate REAL: migrated=${migrated} ws=${JSON.stringify(ws)} fileOnDisk=${onDisk} ` +
          `legacyPrunedToNone=${legacyPruned} path=${filePath} ` +
          `(expect migrated=true, folder file holds editor.fontSize:22, legacy bucket gone)`,
      );
    } catch (error) {
      log(`settingsmigrate self-test failed: ${(error as Error).message}`);
    }

    // Workspace scope (post-1.0): drive the real get/set with a temporary root and
    // confirm precedence (override shadows user) + reset falls back. persistWorkspace
    // is disabled so no `.znxstudio/settings.json` is ever written to disk. Restore all.
    const savedRoot = this.root;
    const savedWorkspaceStore = this.workspaceStore;
    this.persistWorkspace = false;
    try {
      const userFont = this.get('editor.fontSize', 13);
      this.root = '/selftest/ws';
      this.workspaceStore = {};
      this.set('editor.fontSize', 21, 'workspace');
      const overridden = this.get('editor.fontSize', 13);
      const isOverride = hasOverride(this.workspaceStore, 'editor.fontSize');
      this.clearWorkspaceOverride('editor.fontSize');
      const afterReset = this.get('editor.fontSize', 13);
      log(
        `settingsscope REAL: user=${userFont} wsOverride=${overridden} hadOverride=${isOverride} afterReset=${afterReset} ` +
          `(expect override=21 shadows user, reset falls back to ${userFont}; no file written)`,
      );
    } catch (error) {
      log(`settingsscope self-test failed: ${(error as Error).message}`);
    } finally {
      this.root = savedRoot;
      this.workspaceStore = savedWorkspaceStore;
      this.persistWorkspace = true;
    }
  }
}
