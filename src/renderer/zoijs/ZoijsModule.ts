import * as monaco from 'monaco-editor';
import { ServiceKeys, type EditorService, type StatusService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { LanguageServiceKeys, type DiagnosticSink } from '../language/api';
import { DiagnosticSources } from '../language/diagnosticSources';
import { DocumentManager, type ManagedDocument } from '../language/DocumentManager';
import { isZoijsSource } from './zoijsDetect';
import { analyzeZoijs } from './zoijsDiagnostics';
import { analyzeZoijsComponents } from './zoijsComponentDiagnostics';
import { scanZoijsComponents, type ZoijsComponent } from './zoijsComponents';
import { templateContextAt, htmlTagCompletions, htmlAttributeCompletions } from './zoijsHtml';
import { analyzeReactiveGraph, type ReactiveGraph } from './zoijsReactivity';
import { scanRoutes, analyzeRoutes, type RouteEntry } from './zoijsRouter';
import { DevtoolsModel, BRIDGE_CALLBACKS, type DevtoolsEvent } from './zoijsDevtools';
import { zoijsCompletions, zoijsComponentCompletions, zoijsHover, type ZoijsCompletion } from './zoijsCompletions';
import { buildComponentIndex, crossFileComponentCompletions, samePath, type IndexedComponent } from './zoijsComponentIndex';
import { reactiveMembersAt } from './zoijsReactiveMembers';

const JS_LANGUAGES = ['javascript', 'typescript'];
const DEBOUNCE_MS = 350;
/** Cap the cross-file component scan so a huge workspace can't stall indexing. */
const MAX_INDEX_FILES = 400;

/**
 * Zoijs JavaScript Framework Intelligence (Phase 6A). Zoijs is a no-build JS
 * framework (.js/.ts, components = functions returning `html`…``), with no
 * compiler/LSP — so this support is self-contained and LAYERS on Monaco's
 * built-in JS/TS: it registers supplemental completion + hover providers (gated
 * to Zoijs files) for the `@zoijs/*` API + idiom snippets, and publishes
 * reactivity/import diagnostics into the shared DiagnosticsEngine (source
 * `zoijs`). It never replaces the JS language or touches non-Zoijs files.
 */
export class ZoijsModule implements IModule {
  readonly id = 'znxstudio.zoijs';
  readonly displayName = 'Zoijs Intelligence';

  private context!: ModuleContext;
  private documents?: DocumentManager;
  private engine?: DiagnosticSink;
  private componentsView?: HTMLElement;
  private reactivityView?: HTMLElement;
  private routesView?: HTMLElement;
  private devtoolsView?: HTMLElement;
  private readonly devtools = new DevtoolsModel();
  private devtoolsListener?: (event: MessageEvent) => void;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disposables: monaco.IDisposable[] = [];
  /** Workspace-wide index of exported components, for cross-file completion. */
  private workspace?: WorkspaceService;
  private componentIndex: IndexedComponent[] = [];

  activate(context: ModuleContext): void {
    this.context = context;
    this.documents = context.services.tryGet<DocumentManager>(LanguageServiceKeys.Documents);
    this.engine = context.services.tryGet<DiagnosticSink>(LanguageServiceKeys.Diagnostics);

    // Cross-file component index: full scan on open + whenever the workspace changes.
    this.workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    this.workspace?.onDidChangeWorkspace(() => void this.refreshComponentIndex());
    void this.refreshComponentIndex();

    this.registerProviders();

    // Components panel (Phase 6B) — a bottom-panel view of the active file's components.
    this.componentsView = document.createElement('div');
    this.componentsView.className = 'znxstudio-zoijs-components';
    context.layout.addPanelView({ id: 'zoijs-components', title: 'Components', element: this.componentsView });
    this.renderComponents(null);

    // Reactive State Inspector (Phase 6D) — the active file's reactive graph.
    this.reactivityView = document.createElement('div');
    this.reactivityView.className = 'znxstudio-zoijs-reactivity';
    context.layout.addPanelView({ id: 'zoijs-reactivity', title: 'Reactivity', element: this.reactivityView });
    this.renderReactivity(null);

    // Router Designer (Phase 6E) — the active file's @zoijs/router route table.
    this.routesView = document.createElement('div');
    this.routesView.className = 'znxstudio-zoijs-routes';
    context.layout.addPanelView({ id: 'zoijs-routes', title: 'Routes', element: this.routesView });
    this.renderRoutes(null);

    // DevTools (Phase 6F) — folds live inspector events from a running Zoijs app
    // into a reactive-node view. Sources: a same-realm global hook, or postMessage
    // from a preview iframe/webview (wired by Live Preview, 6G).
    this.devtoolsView = document.createElement('div');
    this.devtoolsView.className = 'znxstudio-zoijs-devtools';
    context.layout.addPanelView({ id: 'zoijs-devtools', title: 'DevTools', element: this.devtoolsView });
    this.wireDevtoolsSources();
    this.renderDevtools();

    // Diagnostics pipeline over JS/TS documents (Zoijs files only).
    if (this.documents) {
      context.subscriptions.push(this.documents.onDidOpen((doc) => this.refresh(doc, 0)));
      context.subscriptions.push(this.documents.onDidChange((doc) => this.refresh(doc, DEBOUNCE_MS)));
      context.subscriptions.push(this.documents.onDidChangeActive((doc) => {
        this.updateStatus(doc);
        this.renderComponents(doc);
        this.renderReactivity(doc);
        this.renderRoutes(doc);
      }));
    }

    void selfTestCoordinator.run('zoijs', () => this.maybeSelfTest());
  }

  deactivate(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    if (this.devtoolsListener) window.removeEventListener('message', this.devtoolsListener);
    delete (window as unknown as { __ZNXSTUDIO_DEVTOOLS__?: unknown }).__ZNXSTUDIO_DEVTOOLS__;
  }

  /* ----- completion + hover (supplemental, gated to Zoijs files) ----- */

  private registerProviders(): void {
    this.disposables.push(
      monaco.languages.registerCompletionItemProvider(JS_LANGUAGES, {
        triggerCharacters: ['<', ' ', '.'],
        provideCompletionItems: (model, position) => {
          const text = model.getValue();
          if (!this.isZoijsContext(text)) return { suggestions: [] };
          const word = model.getWordUntilPosition(position);
          const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
          const items = this.completionsFor(text, model.getOffsetAt(position), model.uri.fsPath);
          const suggestions = items.map((c) => ({
            label: c.label,
            kind: this.monacoKind(c.kind),
            detail: c.detail,
            documentation: c.documentation ? { value: c.documentation } : undefined,
            insertText: c.insertText,
            insertTextRules: c.snippet
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            // Auto-import for a cross-file component (0-based edit → 1-based Range).
            additionalTextEdits: c.additionalEdit
              ? [
                  {
                    range: new monaco.Range(
                      c.additionalEdit.start.line + 1,
                      c.additionalEdit.start.character + 1,
                      c.additionalEdit.end.line + 1,
                      c.additionalEdit.end.character + 1,
                    ),
                    text: c.additionalEdit.newText,
                  },
                ]
              : undefined,
            range,
          }));
          return { suggestions };
        },
      }),
    );

    this.disposables.push(
      monaco.languages.registerHoverProvider(JS_LANGUAGES, {
        provideHover: (model, position) => {
          if (!this.isZoijsContext(model.getValue())) return null;
          const word = model.getWordAtPosition(position);
          if (!word) return null;
          const hover = zoijsHover(word.word);
          if (!hover) return null;
          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents: [{ value: hover.value }],
          };
        },
      }),
    );
  }

  /**
   * Context-aware completion set (Phase 6C). Inside `html`…`` markup we offer
   * HTML tags (after `<`) or attributes/events (in a tag); inside a `${…}`
   * interpolation we offer the API + the file's components; in the JS body we
   * offer the API + idiom snippets.
   */
  private completionsFor(text: string, offset: number, path: string): ZoijsCompletion[] {
    const ctx = templateContextAt(text, offset);
    // Member access (`state.` → get/set/peek, `router.` → view/go/…) in any JS
    // position — the `${…}` interpolation or the plain JS body. In member position
    // we return ONLY the receiver's members (empty for an unknown receiver), so a
    // `.` never spills the API/component list.
    if (ctx.region === 'expr' || ctx.region === 'none') {
      const members = reactiveMembersAt(text, offset);
      if (members !== null) return members;
    }
    switch (ctx.region) {
      case 'markup-tag':
        return htmlTagCompletions();
      case 'markup-attr':
        return htmlAttributeCompletions(ctx.tag || undefined);
      case 'markup-text':
      case 'markup-value':
        return [];
      case 'expr': {
        // The file's own components, plus exported components from other files
        // (which auto-import when accepted).
        const localNames = new Set(scanZoijsComponents(text).map((c) => c.name));
        return [
          ...zoijsCompletions(),
          ...zoijsComponentCompletions([...localNames]),
          ...crossFileComponentCompletions(this.componentIndex, path, text, localNames),
        ];
      }
      default:
        return zoijsCompletions();
    }
  }

  private monacoKind(kind: ZoijsCompletion['kind']): monaco.languages.CompletionItemKind {
    switch (kind) {
      case 'snippet':
        return monaco.languages.CompletionItemKind.Snippet;
      case 'html-tag':
        return monaco.languages.CompletionItemKind.Field;
      case 'html-attribute':
        return monaco.languages.CompletionItemKind.Property;
      default:
        return monaco.languages.CompletionItemKind.Function;
    }
  }

  /** A file gets Zoijs help if it imports `@zoijs/*`, or the workspace targets Zoijs. */
  private isZoijsContext(text: string): boolean {
    return isZoijsSource(text) || this.workspaceIsZoijs();
  }

  private workspaceIsZoijs(): boolean {
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace)?.currentWorkspace();
    if (!workspace) return false;
    if (workspace.detectedType === 'zoijs-frontend' || workspace.detectedType === 'zornux-zoijs-fullstack') return true;
    return (workspace.project?.frameworkTargets ?? []).some((f) => f.toLowerCase() === 'zoijs');
  }

  /* ----- diagnostics ----- */

  private refresh(doc: ManagedDocument, delay: number): void {
    if (!JS_LANGUAGES.includes(doc.languageId)) return;
    const previous = this.timers.get(doc.uri);
    if (previous) clearTimeout(previous);
    this.timers.set(
      doc.uri,
      setTimeout(() => {
        this.timers.delete(doc.uri);
        this.run(doc);
      }, delay),
    );
  }

  private run(doc: ManagedDocument): void {
    if (!this.engine) return;
    const text = doc.document.getText();
    const zoijs = isZoijsSource(text);
    // Keep this file's exported components fresh in the cross-file index as it's
    // edited (a full workspace scan only happens on open / workspace change).
    this.updateComponentIndexForDoc(this.pathOf(doc), text);
    const routes = scanRoutes(text);
    // Zoijs API files get framework + component checks; any file with a route
    // table also gets router checks (a routes.js may not import @zoijs/* itself).
    if (zoijs || routes.length > 0) {
      const diagnostics = [
        ...(zoijs ? [...analyzeZoijs(text), ...analyzeZoijsComponents(text)] : []),
        ...(routes.length ? analyzeRoutes(text) : []),
      ];
      this.engine.set(doc.uri, DiagnosticSources.Zoijs, diagnostics);
    } else {
      this.engine.clear(doc.uri, DiagnosticSources.Zoijs);
    }
    // Keep the panels in sync if this is the active doc.
    if (doc.uri === this.documents?.getActive()?.uri) {
      this.renderComponents(doc);
      this.renderReactivity(doc);
      this.renderRoutes(doc);
    }
  }

  /* ----- cross-file component index (6B, cross-file) ----- */

  /** Full workspace scan for exported Zoijs components (bounded, Zoijs files only). */
  private async refreshComponentIndex(): Promise<void> {
    const root = this.workspace?.currentFolder();
    if (!root) {
      this.componentIndex = [];
      return;
    }
    try {
      const paths = (await window.znxstudio.search.files(root))
        .filter((p) => /\.(?:js|ts|jsx|tsx|mjs|cjs)$/i.test(p))
        .slice(0, MAX_INDEX_FILES);
      const files: { path: string; text: string }[] = [];
      for (const path of paths) {
        try {
          const text = await window.znxstudio.fs.readFile(path);
          if (isZoijsSource(text)) files.push({ path, text });
        } catch {
          /* unreadable file — skip */
        }
      }
      this.componentIndex = buildComponentIndex(files);
    } catch {
      /* search unavailable (no host) — keep whatever index we have */
    }
  }

  /** Replace one file's entries in the index (incremental refresh as you type). */
  private updateComponentIndexForDoc(path: string, text: string): void {
    const others = this.componentIndex.filter((component) => !samePath(component.file, path));
    const own = isZoijsSource(text) ? buildComponentIndex([{ path, text }]) : [];
    this.componentIndex = [...others, ...own];
  }

  private pathOf(doc: ManagedDocument): string {
    try {
      return monaco.Uri.parse(doc.uri).fsPath;
    } catch {
      return doc.uri;
    }
  }

  private updateStatus(doc: ManagedDocument | null): void {
    const status = this.context.services.tryGet<StatusService>(ServiceKeys.Status);
    if (!status) return;
    const active = doc && JS_LANGUAGES.includes(doc.languageId) && isZoijsSource(doc.document.getText());
    if (active) {
      status.setItem('zoijs.active', { text: 'Zoijs', tooltip: 'Zoijs framework intelligence active', side: 'right', priority: 34 });
    } else {
      status.removeItem('zoijs.active');
    }
  }

  /* ----- Components panel (6B) ----- */

  private renderComponents(doc: ManagedDocument | null): void {
    const host = this.componentsView;
    if (!host) return;

    const zoijs = doc && JS_LANGUAGES.includes(doc.languageId) && isZoijsSource(doc.document.getText());
    if (!doc || !zoijs) {
      const message = document.createElement('div');
      message.className = 'znxstudio-outline-empty';
      message.textContent = doc ? 'Not a Zoijs file.' : 'Open a Zoijs file to see its components.';
      host.replaceChildren(message);
      return;
    }

    const components = scanZoijsComponents(doc.document.getText());
    if (components.length === 0) {
      const message = document.createElement('div');
      message.className = 'znxstudio-outline-empty';
      message.textContent = 'No components found.';
      host.replaceChildren(message);
      return;
    }

    const list = document.createElement('div');
    list.className = 'znxstudio-zoijs-complist';
    for (const component of components) list.appendChild(this.renderComponentRow(component));
    host.replaceChildren(list);
  }

  private renderComponentRow(component: ZoijsComponent): HTMLElement {
    const item = document.createElement('div');
    item.className = 'znxstudio-zoijs-comp';

    const row = document.createElement('div');
    row.className = 'znxstudio-tree-row';
    const icon = document.createElement('span');
    icon.className = 'znxstudio-icon';
    icon.textContent = '◇';
    const name = document.createElement('span');
    name.className = 'znxstudio-zoijs-comp-name';
    name.textContent = component.params.length ? `${component.name}(${component.params.join(', ')})` : component.name;
    row.append(icon, name);
    if (component.exported) {
      const badge = document.createElement('span');
      badge.className = 'znxstudio-solution-badge';
      badge.textContent = 'export';
      row.appendChild(badge);
    }
    row.addEventListener('click', () => {
      const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
      editor?.revealPosition(component.nameLine, component.nameChar);
    });
    item.appendChild(row);

    const facts: string[] = [];
    if (component.state.length) facts.push(`state: ${component.state.join(', ')}`);
    if (component.effects) facts.push(`${component.effects} effect${component.effects > 1 ? 's' : ''}`);
    if (component.uses.length) facts.push(`renders: ${component.uses.join(', ')}`);
    if (facts.length) {
      const meta = document.createElement('div');
      meta.className = 'znxstudio-zoijs-comp-meta';
      meta.textContent = facts.join(' · ');
      item.appendChild(meta);
    }
    return item;
  }

  /* ----- Reactive State Inspector (6D) ----- */

  private renderReactivity(doc: ManagedDocument | null): void {
    const host = this.reactivityView;
    if (!host) return;

    const zoijs = doc && JS_LANGUAGES.includes(doc.languageId) && isZoijsSource(doc.document.getText());
    if (!doc || !zoijs) {
      host.replaceChildren(this.panelMessage(doc ? 'Not a Zoijs file.' : 'Open a Zoijs file to inspect its reactivity.'));
      return;
    }

    const graph = analyzeReactiveGraph(doc.document.getText());
    if (graph.values.length === 0 && graph.effects.length === 0) {
      host.replaceChildren(this.panelMessage('No reactive state found.'));
      return;
    }

    const fragment = document.createDocumentFragment();
    const states = graph.values.filter((v) => v.kind === 'state');
    const computeds = graph.values.filter((v) => v.kind === 'computed');

    if (states.length) {
      fragment.appendChild(this.sectionHeader('State'));
      for (const state of states) fragment.appendChild(this.reactiveValueRow(state, graph, '↓'));
    }
    if (computeds.length) {
      fragment.appendChild(this.sectionHeader('Computed'));
      for (const computed of computeds) fragment.appendChild(this.reactiveValueRow(computed, graph, '∑'));
    }
    if (graph.effects.length) {
      fragment.appendChild(this.sectionHeader('Effects'));
      for (const effect of graph.effects) fragment.appendChild(this.effectRow(effect));
    }
    host.replaceChildren(fragment);
  }

  private reactiveValueRow(value: ReactiveGraph['values'][number], graph: ReactiveGraph, icon: string): HTMLElement {
    const item = document.createElement('div');
    item.className = 'znxstudio-zoijs-comp';

    const row = document.createElement('div');
    row.className = 'znxstudio-tree-row';
    const ic = document.createElement('span');
    ic.className = 'znxstudio-icon';
    ic.textContent = icon;
    const name = document.createElement('span');
    name.className = 'znxstudio-zoijs-comp-name';
    name.textContent = value.kind === 'state' ? `${value.name} = ${value.detail}` : value.name;
    row.append(ic, name);
    row.addEventListener('click', () => {
      this.context.services.tryGet<EditorService>(ServiceKeys.Editor)?.revealPosition(value.line, value.char);
    });
    item.appendChild(row);

    const facts: string[] = [];
    if (value.kind === 'computed' && value.reads.length) facts.push(`reads: ${value.reads.join(', ')}`);
    if (value.kind === 'state') {
      const readers = [
        ...graph.values.filter((v) => v.kind === 'computed' && v.reads.includes(value.name)).map((v) => v.name),
        ...graph.effects.filter((e) => e.reads.includes(value.name)).map((e) => `effect#${e.index}`),
      ];
      const views = graph.bindingReads[value.name] ?? 0;
      if (views) readers.push(`${views} binding${views > 1 ? 's' : ''}`);
      if (readers.length) facts.push(`read by: ${readers.join(', ')}`);

      const writers = graph.effects.filter((e) => e.writes.includes(value.name)).map((e) => `effect#${e.index}`);
      const handlers = graph.bindingWrites[value.name] ?? 0;
      if (handlers) writers.push(`${handlers} handler${handlers > 1 ? 's' : ''}`);
      if (writers.length) facts.push(`set by: ${writers.join(', ')}`);
    }
    if (facts.length) {
      const meta = document.createElement('div');
      meta.className = 'znxstudio-zoijs-comp-meta';
      meta.textContent = facts.join(' · ');
      item.appendChild(meta);
    }
    return item;
  }

  private effectRow(effect: ReactiveGraph['effects'][number]): HTMLElement {
    const item = document.createElement('div');
    item.className = 'znxstudio-zoijs-comp';
    const row = document.createElement('div');
    row.className = 'znxstudio-tree-row';
    const ic = document.createElement('span');
    ic.className = 'znxstudio-icon';
    ic.textContent = '⚡';
    const name = document.createElement('span');
    name.className = 'znxstudio-zoijs-comp-name';
    name.textContent = `effect#${effect.index}`;
    row.append(ic, name);
    row.addEventListener('click', () => {
      this.context.services.tryGet<EditorService>(ServiceKeys.Editor)?.revealPosition(effect.line, 0);
    });
    item.appendChild(row);

    const facts: string[] = [];
    facts.push(effect.reads.length ? `reads: ${effect.reads.join(', ')}` : 'reads: (none — runs once)');
    if (effect.writes.length) facts.push(`writes: ${effect.writes.join(', ')}`);
    const meta = document.createElement('div');
    meta.className = 'znxstudio-zoijs-comp-meta';
    meta.textContent = facts.join(' · ');
    item.appendChild(meta);
    return item;
  }

  /* ----- Router Designer (6E) ----- */

  private renderRoutes(doc: ManagedDocument | null): void {
    const host = this.routesView;
    if (!host) return;
    if (!doc || !JS_LANGUAGES.includes(doc.languageId)) {
      host.replaceChildren(this.panelMessage('Open a Zoijs file to see its routes.'));
      return;
    }
    const routes = scanRoutes(doc.document.getText());
    if (routes.length === 0) {
      host.replaceChildren(this.panelMessage('No @zoijs/router routes found.'));
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const route of routes) fragment.appendChild(this.routeRow(route));
    host.replaceChildren(fragment);
  }

  private routeRow(route: RouteEntry): HTMLElement {
    const item = document.createElement('div');
    item.className = 'znxstudio-zoijs-comp';
    const row = document.createElement('div');
    row.className = 'znxstudio-tree-row';
    const ic = document.createElement('span');
    ic.className = 'znxstudio-icon';
    ic.textContent = route.notFound ? '⚠' : '→';
    const name = document.createElement('span');
    name.className = 'znxstudio-zoijs-comp-name';
    name.textContent = `${route.pattern} → ${route.component}`;
    row.append(ic, name);
    if (route.dynamic) {
      const badge = document.createElement('span');
      badge.className = 'znxstudio-solution-badge';
      badge.textContent = route.params.map((p) => `:${p}`).join(' ');
      row.appendChild(badge);
    }
    if (route.notFound) {
      const badge = document.createElement('span');
      badge.className = 'znxstudio-solution-badge';
      badge.textContent = 'not-found';
      row.appendChild(badge);
    }
    row.addEventListener('click', () => {
      this.context.services.tryGet<EditorService>(ServiceKeys.Editor)?.revealPosition(route.line, route.char);
    });
    item.appendChild(row);
    return item;
  }

  /* ----- DevTools (6F) ----- */

  private wireDevtoolsSources(): void {
    // Same-realm hook — a preview mounted in this window, or the self-test.
    (window as unknown as { __ZNXSTUDIO_DEVTOOLS__?: (e: DevtoolsEvent) => void }).__ZNXSTUDIO_DEVTOOLS__ = (e) =>
      this.applyDevtoolsEvent(e);
    // Cross-realm — a preview iframe/webview (wired by Live Preview, 6G).
    this.devtoolsListener = (event: MessageEvent) => {
      const data = event.data as { __zoijsDevtools?: DevtoolsEvent } | null;
      if (data && data.__zoijsDevtools) this.applyDevtoolsEvent(data.__zoijsDevtools);
    };
    window.addEventListener('message', this.devtoolsListener);
  }

  private applyDevtoolsEvent(event: DevtoolsEvent): void {
    this.devtools.apply(event);
    this.renderDevtools();
  }

  private renderDevtools(): void {
    const host = this.devtoolsView;
    if (!host) return;
    const snap = this.devtools.snapshot();

    const fragment = document.createDocumentFragment();
    const status = document.createElement('div');
    status.className = 'znxstudio-zoijs-devtools-status';
    status.textContent = snap.attached
      ? `● Connected — ${snap.liveCount} live node${snap.liveCount === 1 ? '' : 's'}, ${snap.totalRuns} runs, ${snap.totalWrites} writes`
      : '○ Not connected — run a Zoijs app (Live Preview) or inject the DevTools bridge.';
    status.classList.toggle('is-connected', snap.attached);
    fragment.appendChild(status);

    const kinds = Object.entries(snap.countsByKind);
    if (kinds.length) {
      const summary = document.createElement('div');
      summary.className = 'znxstudio-zoijs-comp-meta';
      summary.textContent = kinds.map(([kind, n]) => `${kind}: ${n}`).join(' · ');
      fragment.appendChild(summary);

      fragment.appendChild(this.sectionHeader('Reactive nodes'));
      for (const node of snap.nodes.slice(-100)) {
        const item = document.createElement('div');
        item.className = 'znxstudio-tree-row';
        if (!node.alive) item.style.opacity = '0.5';
        const label = node.label ? ` (${node.label})` : '';
        item.textContent = `#${node.id} ${node.kind}${label} — runs ${node.runs}, writes ${node.writes}`;
        fragment.appendChild(item);
      }
    }
    host.replaceChildren(fragment);
  }

  private sectionHeader(text: string): HTMLElement {
    const header = document.createElement('div');
    header.className = 'znxstudio-explorer-section-header';
    header.textContent = text;
    return header;
  }

  private panelMessage(text: string): HTMLElement {
    const message = document.createElement('div');
    message.className = 'znxstudio-outline-empty';
    message.textContent = text;
    return message;
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

    // Crafted cases (pure logic also covered exhaustively by the unit suite).
    const footgun = analyzeZoijs('import { html, createState } from "@zoijs/core";\nconst c = createState(0);\nexport const V = html`<span>${c.get()}</span>`;\n');
    log(`zoijs footgun: diagnostics=${footgun.length} first=${footgun[0]?.code ?? '-'}`);
    const reactive = analyzeZoijs('import { html, createState } from "@zoijs/core";\nconst c = createState(0);\nexport const V = html`<span>${() => c.get()}</span>`;\n');
    log(`zoijs reactive-ok: diagnostics=${reactive.length} (expect 0)`);
    const unknown = analyzeZoijs('import { html, nope } from "@zoijs/core";\n');
    log(`zoijs unknown-import: diagnostics=${unknown.length} first=${unknown[0]?.code ?? '-'}`);
    log(`zoijs completions: count=${zoijsCompletions().length}`);

    // 6B: component detection + case diagnostic on crafted input.
    const compsCrafted = scanZoijsComponents(
      'import { html, createState } from "@zoijs/core";\n' +
        'export function Card() {\n  const open = createState(false);\n  return html`<div>${() => open.get()} ${Icon()}</div>`;\n}\n' +
        'function icon() { return html`<i></i>`; }\n',
    );
    log(`zoijs components(crafted): count=${compsCrafted.length} names=[${compsCrafted.map((c) => c.name).join(', ')}]`);
    const card = compsCrafted.find((c) => c.name === 'Card');
    log(`zoijs Card: exported=${card?.exported} state=[${card?.state.join(',')}] effects=${card?.effects} uses=[${card?.uses.join(',')}]`);
    const caseDiags = analyzeZoijsComponents(
      'import { html } from "@zoijs/core";\nfunction icon() { return html`<i></i>`; }\n',
    );
    log(`zoijs component-case: diagnostics=${caseDiags.length} first=${caseDiags[0]?.code ?? '-'}`);

    // 6B cross-file: index another file's exported component and offer it here with
    // an auto-import (the real functions the completion provider uses).
    const xIndex = buildComponentIndex([
      { path: 'C:/app/ui/Card.js', text: 'import { html } from "@zoijs/core";\nexport function Card() { return html`<div></div>`; }\n' },
    ]);
    const xHome = 'import { html } from "@zoijs/core";\nexport function Home() { return html`${}`; }\n';
    const xComps = crossFileComponentCompletions(xIndex, 'C:/app/pages/home.js', xHome, new Set(['Home']));
    const xCard = xComps.find((c) => c.label === 'Card');
    log(
      `zoijs crossfile: indexed=${xIndex.length} offered=[${xComps.map((c) => c.label).join(',')}] ` +
        `insert=${xCard?.insertText} autoImport=${JSON.stringify(xCard?.additionalEdit?.newText ?? null)} ` +
        `(expect Card, "Card()", import from ../ui/Card)`,
    );

    // 6C member access: infer a reactive receiver's kind and offer its members.
    const memberStateSrc = 'import { createState } from "@zoijs/core";\nconst count = createState(0);\ncount.';
    const memberRouterSrc = 'import { createRouter } from "@zoijs/router";\nconst router = createRouter({});\nrouter.';
    const stateMembers = reactiveMembersAt(memberStateSrc, memberStateSrc.length);
    const routerMembers = reactiveMembersAt(memberRouterSrc, memberRouterSrc.length);
    const unknownMembers = reactiveMembersAt('foo.', 4);
    log(
      `zoijs member: state.=[${(stateMembers ?? []).map((m) => m.label).join(',')}] ` +
        `router.=[${(routerMembers ?? []).map((m) => m.label).join(',')}] ` +
        `unknown.len=${unknownMembers?.length} (expect get,set,peek | view,link,go,path,query,match,destroy | 0)`,
    );

    // 6C: template-context detection + HTML completions.
    const tagSrc = 'const v = html`<di';
    const tagCtx = templateContextAt(tagSrc, tagSrc.length);
    log(`zoijs ctx(after "<di"): region=${tagCtx.region} tags=${htmlTagCompletions().length}`);
    const attrSrc = 'const v = html`<button ';
    const attrCtx = templateContextAt(attrSrc, attrSrc.length);
    log(`zoijs ctx(inside <button ): region=${attrCtx.region} tag=${attrCtx.region === 'markup-attr' ? attrCtx.tag : '-'} attrs=${htmlAttributeCompletions('button').length}`);
    const exprSrc = 'const v = html`<div>${Ca';
    log(`zoijs ctx(inside \${}): region=${templateContextAt(exprSrc, exprSrc.length).region}`);
    const jsSrc = 'const x = 1; // ';
    log(`zoijs ctx(js body): region=${templateContextAt(jsSrc, jsSrc.length).region}`);

    // 6D: reactive graph on a crafted counter.
    const graph = analyzeReactiveGraph(
      'import { html, createState, computed, effect } from "@zoijs/core";\n' +
        'export function Counter() {\n' +
        '  const count = createState(0);\n' +
        '  const doubled = computed(() => count.get() * 2);\n' +
        '  effect(() => console.log(doubled.get()));\n' +
        '  return html`<button onclick=${() => count.set(count.get() + 1)}>${() => count.get()}</button>`;\n' +
        '}\n',
    );
    const doubled = graph.values.find((v) => v.name === 'doubled');
    log(`zoijs reactive(crafted): states=${graph.values.filter((v) => v.kind === 'state').length} computeds=${graph.values.filter((v) => v.kind === 'computed').length} effects=${graph.effects.length}`);
    log(`zoijs reactive doubled.reads=[${doubled?.reads.join(',')}] effect#1.reads=[${graph.effects[0]?.reads.join(',')}] count(bindReads=${graph.bindingReads.count ?? 0}, bindWrites=${graph.bindingWrites.count ?? 0})`);

    // Real Zoijs source from the docs site — detection, analysis, component scan.
    try {
      const real = await window.znxstudio.fs.readFile('C:\\Studio Apps\\Xornux frontend documentation\\app\\layout.js');
      const diags = analyzeZoijs(real);
      const comps = scanZoijsComponents(real);
      const rgraph = analyzeReactiveGraph(real);
      log(`zoijs real(layout.js): isZoijs=${isZoijsSource(real)} bytes=${real.length} diagnostics=${diags.length} components=[${comps.map((c) => c.name).join(', ')}]`);
      log(`zoijs real(layout.js) reactivity: states=[${rgraph.values.filter((v) => v.kind === 'state').map((v) => v.name).join(', ')}] effects=${rgraph.effects.length}`);
      const home = await window.znxstudio.fs.readFile('C:\\Studio Apps\\Xornux frontend documentation\\app\\pages\\home.js');
      const homeComps = scanZoijsComponents(home);
      log(`zoijs real(home.js): components=${homeComps.length} first=${homeComps[0]?.name ?? '-'} caseDiags=${analyzeZoijsComponents(home).length}`);

      // 6E: routes from the real routes.js.
      const routesFile = await window.znxstudio.fs.readFile('C:\\Studio Apps\\Xornux frontend documentation\\app\\routes.js');
      const routes = scanRoutes(routesFile);
      const dyn = routes.filter((r) => r.dynamic).length;
      const notFound = routes.filter((r) => r.notFound).length;
      log(`zoijs real(routes.js): routes=${routes.length} dynamic=${dyn} notFound=${notFound} first=${routes[0] ? `${routes[0].pattern}->${routes[0].component}` : '-'}`);
    } catch (error) {
      log(`zoijs real-file skipped: ${(error as Error).message}`);
    }

    // 6E: crafted route table with a dynamic + not-found route and a duplicate.
    const routerSrc =
      'import { createRouter } from "@zoijs/router";\n' +
      'const routes = { "/": Home, "/users/:id": UserPage, "/users/:id": UserPage, "*": NotFound };\n' +
      'createRouter(routes, { interceptLinks: true });\n';
    const craftedRoutes = scanRoutes(routerSrc);
    log(`zoijs routes(crafted): count=${craftedRoutes.length} dynamic=[${craftedRoutes.filter((r) => r.dynamic).map((r) => r.pattern).join(',')}] dupDiags=${analyzeRoutes(routerSrc).length}`);

    // 6F: DevTools — (a) conformance to the real inspector hook's callback set.
    try {
      const dtSrc = await window.znxstudio.fs.readFile('C:\\Studio Apps\\Xornux frontend documentation\\vendor\\zoijs\\core\\reactivity\\devtools.js');
      const called = [...new Set([...dtSrc.matchAll(/inspector\.(\w+)/g)].map((m) => m[1]))].sort();
      const impl = [...BRIDGE_CALLBACKS].sort();
      const missing = called.filter((c) => !impl.includes(c));
      log(`zoijs devtools conformance: engineCalls=[${called.join(',')}] bridge=[${impl.join(',')}] missing=[${missing.join(',')}]`);
    } catch (error) {
      log(`zoijs devtools conformance skipped: ${(error as Error).message}`);
    }

    // (b) Drive the REAL reactivity engine + hook (its core needs no DOM).
    try {
      const base = `file:///${encodeURI('C:/Studio Apps/Xornux frontend documentation/vendor/zoijs/core/reactivity/')}`;
      const dt = (await import(/* @vite-ignore */ `${base}devtools.js`)) as { attachInspector: (i: unknown) => () => void };
      const st = (await import(`${base}state.js`)) as { createState: <T>(v: T) => { get(): T; set(v: T): void } };
      const cp = (await import(`${base}computed.js`)) as { computed: <T>(f: () => T) => { get(): T } };
      const ef = (await import(`${base}effect.js`)) as { effect: (f: () => void) => unknown };
      const model = new DevtoolsModel();
      const ids = new WeakMap<object, number>();
      let seq = 0;
      const idOf = (n: object) => {
        let id = ids.get(n);
        if (id === undefined) {
          id = (seq += 1);
          ids.set(n, id);
        }
        return id;
      };
      dt.attachInspector({
        onAttach: () => model.apply({ type: 'attach' }),
        onCreate: (n: object, k: unknown, l: { kind?: string } | undefined) => model.apply({ type: 'create', id: idOf(n), nodeKind: String(k), label: l?.kind }),
        onRun: (n: object) => model.apply({ type: 'run', id: idOf(n) }),
        onWrite: (n: object) => model.apply({ type: 'write', id: idOf(n) }),
        onDispose: (n: object) => model.apply({ type: 'dispose', id: idOf(n) }),
      });
      const count = st.createState(0);
      const doubled = cp.computed(() => count.get() * 2);
      ef.effect(() => void doubled.get());
      count.set(5);
      await new Promise((resolve) => setTimeout(resolve, 25)); // let the scheduler flush
      const snap = model.snapshot();
      log(`zoijs devtools real-engine: attached=${snap.attached} nodes=${snap.nodes.length} kinds=${JSON.stringify(snap.countsByKind)} runs=${snap.totalRuns} writes=${snap.totalWrites}`);
    } catch (error) {
      log(`zoijs devtools real-engine skipped: ${(error as Error).message}`);
    }
  }
}
