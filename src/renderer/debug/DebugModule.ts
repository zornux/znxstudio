import * as monaco from 'monaco-editor';
import {
  ServiceKeys,
  type BreakpointService,
  type DebugState,
  type DebuggerService,
  type EditorService,
  type SettingsService,
  type StatusService,
  type ToolchainService,
  type WorkspaceService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import type { IModule, ModuleContext } from '../core/Module';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import { capabilityStatus } from '../toolchain/capabilityGuard';
import {
  EXCEPTION_BREAK_MODES,
  describeMode,
  filtersFor,
  parseExceptionFilters,
  type ExceptionBreakMode,
  type ExceptionFilter,
} from './exceptions';
import { CommandIds } from '../commands/CommandIds';
import type {
  DebugEventMessage,
  DebugLaunchConfig,
  DebugRequestResult,
  WorkspaceInfo,
} from '../../shared/types';
import { dottedExpressionAt } from './hoverExpression';

interface StackFrame {
  id: number;
  name: string;
  path?: string;
  line: number;
  column: number;
}

interface DapStackFrame {
  id: number;
  name: string;
  source?: { path?: string };
  line?: number;
  column?: number;
}

interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  /** DAP variablesReference; > 0 means expandable. */
  reference: number;
  expanded: boolean;
  children: DebugVariable[] | null;
}

interface DebugScope {
  name: string;
  reference: number;
  expanded: boolean;
  variables: DebugVariable[] | null;
}

interface DapScope {
  name: string;
  variablesReference: number;
}

interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

interface DapEvaluate {
  result: string;
  type?: string;
  variablesReference?: number;
}

interface WatchExpression {
  expression: string;
  value: string;
  type?: string;
  reference: number;
  error?: string;
  expanded: boolean;
  children: DebugVariable[] | null;
}

const STATE_LABEL: Record<DebugState, string> = {
  idle: 'Idle',
  starting: 'Starting…',
  running: 'Running',
  stopped: 'Paused',
  terminated: 'Terminated',
  error: 'Error',
};

const STATE_ICON: Record<DebugState, string> = {
  idle: '🐞',
  starting: '⏳',
  running: '▶',
  stopped: '⏸',
  terminated: '⏹',
  error: '⚠️',
};

/**
 * Debugger foundation (Phase 4A). Owns the debug session lifecycle against the
 * `zornux dap` adapter (via the main-process bridge), a Debug panel showing state
 * + an event log (the debug-console scaffold), and Start/Stop commands. Later
 * phases add breakpoints, call stack, and variables — all through the DAP request
 * pass-through this exposes as DebuggerService.
 */
export class DebugModule implements IModule, DebuggerService {
  readonly id = 'znxstudio.debug';
  readonly displayName = 'Debugger';

  private context!: ModuleContext;
  private surface!: HTMLElement;
  private currentState: DebugState = 'idle';
  private keyListener: ((event: KeyboardEvent) => void) | undefined;
  private frames: StackFrame[] = [];
  private activeFrame = 0;
  private scopes: DebugScope[] = [];
  private lastException: string | null = null;
  /** How the adapter should treat raised errors (Zornux rc.4 and later). */
  private exceptionMode: ExceptionBreakMode = 'uncaught';
  /** The filters the running adapter advertised; empty means it honours none. */
  private exceptionFilters: ExceptionFilter[] = [];
  private settings: SettingsService | undefined;
  private readonly watches: WatchExpression[] = [];
  private watchDraft = '';
  private readonly log: string[] = [];
  private readonly stateEmitter = new Emitter<DebugState>();
  readonly onDidChangeState = this.stateEmitter.event;

  activate(context: ModuleContext): void {
    this.context = context;
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    // rc.4's own default is `uncaught`; match it so the picker starts truthful.
    const stored = this.settings?.get<string>('debug.exceptionBreakMode', 'uncaught');
    if (stored && (EXCEPTION_BREAK_MODES as string[]).includes(stored)) this.exceptionMode = stored as ExceptionBreakMode;

    this.surface = document.createElement('div');
    this.surface.className = 'znxstudio-debug';
    context.layout.addPanelView({ id: 'debug', title: 'Debug', element: this.surface });
    context.services.register<DebuggerService>(ServiceKeys.Debugger, this);

    context.commands.register(CommandIds.DebugStart, () => this.start(), 'Debug: Start');
    context.commands.register(CommandIds.DebugAttach, () => this.attach(), 'Debug: Attach to Remote Adapter');
    context.commands.register(CommandIds.DebugStop, () => this.stop(), 'Debug: Stop');
    context.commands.register(CommandIds.DebugContinue, () => this.continue(), 'Debug: Continue');
    context.commands.register(CommandIds.DebugStepOver, () => this.step('next'), 'Debug: Step Over');
    context.commands.register(CommandIds.DebugStepIn, () => this.step('stepIn'), 'Debug: Step Into');
    context.commands.register(CommandIds.DebugStepOut, () => this.step('stepOut'), 'Debug: Step Out');
    context.commands.register(CommandIds.DebugPause, () => this.pause(), 'Debug: Pause');
    context.commands.register(
      CommandIds.ViewDebug,
      () => context.layout.showPanelView('debug'),
      'Debug: Show Panel',
    );

    this.registerKeybindings();

    window.znxstudio.debug.onEvent((event) => this.onEvent(event));
    window.znxstudio.debug.onClosed((event) => {
      this.append(`adapter exited${event.code === null ? '' : ` (code ${event.code})`}`);
      if (this.currentState !== 'terminated' && this.currentState !== 'error') this.setState('idle');
    });

    this.registerHoverEvaluation();
    this.render();
    this.updateStatus();
    void selfTestCoordinator.run('debugger', () => this.maybeSelfTest());
  }

  deactivate(): void {
    if (this.keyListener) document.removeEventListener('keydown', this.keyListener, true);
  }

  /**
   * While paused, hovering an identifier in the editor evaluates it against the
   * active frame (DAP `evaluate` with hover context) and shows its live value.
   */
  private registerHoverEvaluation(): void {
    monaco.languages.registerHoverProvider('zornux', {
      provideHover: async (model, position) => {
        if (this.currentState !== 'stopped') return null;
        const frameId = this.frames[this.activeFrame]?.id;
        if (frameId === undefined) return null;
        const word = model.getWordAtPosition(position);
        if (!word) return null;

        const line = model.getLineContent(position.lineNumber);
        const extracted =
          dottedExpressionAt(line, word.endColumn) ?? { expression: word.word, startColumn: word.startColumn };

        const result = await window.znxstudio.debug.request('evaluate', {
          expression: extracted.expression,
          frameId,
          context: 'hover',
        });
        if (!result.success) return null;
        const body = (result.body ?? {}) as DapEvaluate;
        if (body.result === undefined || body.result === null || body.result === '') return null;

        return {
          range: new monaco.Range(position.lineNumber, extracted.startColumn, position.lineNumber, word.endColumn),
          contents: [
            { value: `\`${extracted.expression}\` = **${body.result}**${body.type ? ` _(${body.type})_` : ''}` },
          ],
        };
      },
    });
  }

  /* ----- DebuggerService ----- */
  request(command: string, args?: unknown): Promise<DebugRequestResult> {
    return window.znxstudio.debug.request(command, args);
  }
  state(): DebugState {
    return this.currentState;
  }

  /* ----- session control ----- */
  private busy(): boolean {
    return this.currentState === 'running' || this.currentState === 'starting' || this.currentState === 'stopped';
  }

  private async start(): Promise<void> {
    if (this.busy()) {
      this.context.layout.showToast('A debug session is already running.', 'info');
      return;
    }
    const info = this.workspaceInfo();
    const program = this.resolveEntry(info);
    if (!program) {
      this.context.layout.showToast('Open a .zx file (or add src/main.zx) to debug.', 'error');
      return;
    }
    const compiler = await window.znxstudio.compiler.info();
    if (!compiler.available) {
      this.context.layout.showToast('Zornux compiler not available — cannot debug.', 'error');
      return;
    }
    const settings = this.context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    const transport = String(settings?.get('zornux.debug.transport', 'stdio')) === 'tcp' ? 'tcp' : 'stdio';
    if (transport === 'tcp' && !(await this.remoteDebugAllowed())) return;
    await this.beginSession(
      { program, compilerPath: compiler.path, workspaceRoot: info?.root ?? null, transport },
      `launching ${program}${transport === 'tcp' ? ' (tcp)' : ''}`,
    );
  }

  /**
   * Capability gate for TCP / attach remote debugging (IL-C). A toolchain that
   * doesn't advertise `remoteDebug` can't serve a socket adapter, so we say so
   * rather than let the connection fail obscurely. No toolchain info ⇒ allow.
   */
  private async remoteDebugAllowed(): Promise<boolean> {
    const toolchain = this.context.services.tryGet<ToolchainService>(ServiceKeys.Toolchain);
    const tc = toolchain ? await toolchain.info() : null;
    if (!tc) return true;
    const status = capabilityStatus(tc, 'remoteDebug', 'Remote debugging');
    if (!status.enabled) {
      this.context.layout.showToast(status.reason ?? 'Remote debugging is unavailable.', 'error');
      return false;
    }
    return true;
  }

  /** Attach to a remote DAP server (host/port from settings). */
  private async attach(): Promise<void> {
    if (this.busy()) {
      this.context.layout.showToast('A debug session is already running.', 'info');
      return;
    }
    if (!(await this.remoteDebugAllowed())) return;
    const settings = this.context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    const host = (settings?.get('zornux.debug.remoteHost', '127.0.0.1') || '127.0.0.1').trim();
    const port = Number(settings?.get('zornux.debug.remotePort', 0));
    if (!port) {
      this.context.layout.showToast('Set "zornux.debug.remotePort" to attach to a remote adapter.', 'error');
      return;
    }
    const program = this.resolveEntry(this.workspaceInfo()) ?? '';
    await this.beginSession(
      { program, connection: { host, port }, workspaceRoot: this.workspaceInfo()?.root ?? null },
      `attaching to ${host}:${port}`,
    );
  }

  private async beginSession(config: DebugLaunchConfig, label: string): Promise<void> {
    this.log.length = 0;
    this.setState('starting');
    this.append(label);
    this.context.layout.showPanelView('debug');

    const breakpoints = this.context.services.tryGet<BreakpointService>(ServiceKeys.Breakpoints);
    let result;
    try {
      result = await window.znxstudio.debug.start({
        ...config,
        breakpoints: breakpoints?.launchList() ?? [],
        exceptionFilters: filtersFor(this.exceptionMode),
      });
    } catch (error) {
      this.append(`failed to start: ${(error as Error).message}`);
      this.setState('error');
      return;
    }
    if (!result.success) {
      this.append(`failed to start: ${result.error ?? 'unknown error'}`);
      this.setState('error');
      return;
    }
    breakpoints?.applyVerified(result.breakpoints ?? []);

    // rc.4 advertises which exception filters it honours. An adapter that
    // advertises none ignored the request we just sent, so say so rather than
    // implying the chosen mode took effect.
    this.exceptionFilters = parseExceptionFilters(result.capabilities);
    if (!this.exceptionFilters.length) {
      this.append('this adapter ignores exception filters and uses its own default (Zornux before 1.0.0-rc.4)');
    } else {
      this.append(`exception mode: ${this.exceptionMode} — ${describeMode(this.exceptionMode)}`);
    }

    const bpCount = (result.breakpoints ?? []).reduce((n, s) => n + s.breakpoints.length, 0);
    const caps = result.capabilities ? Object.keys(result.capabilities).filter((k) => result.capabilities![k]) : [];
    this.append(`session started · ${bpCount} breakpoint(s) · capabilities: ${caps.join(', ') || 'none'}`);
    this.setState('running');
  }

  /**
   * The exception-mode picker. Enabled always — the setting is remembered for the
   * next session — but a running adapter that advertised no filters is one that
   * ignores the request, and the tooltip says so.
   */
  private renderExceptionPicker(): HTMLElement {
    const wrapper = document.createElement('label');
    wrapper.className = 'znxstudio-debug-exception-mode';

    const caption = document.createElement('span');
    caption.textContent = 'Break on';

    const select = document.createElement('select');
    select.className = 'znxstudio-select';
    select.setAttribute('aria-label', 'Exception break mode');
    for (const mode of EXCEPTION_BREAK_MODES) {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = mode === 'never' ? 'no errors' : mode === 'all' ? 'all errors' : 'uncaught errors';
      option.selected = this.exceptionMode === mode;
      select.appendChild(option);
    }
    select.title = describeMode(this.exceptionMode);
    select.addEventListener('change', () => void this.setExceptionMode(select.value as ExceptionBreakMode));

    const running = this.currentState !== 'idle' && this.currentState !== 'error';
    if (running && !this.exceptionFilters.length) {
      select.disabled = true;
      select.title = 'This adapter ignores exception filters (Zornux before 1.0.0-rc.4).';
    }

    wrapper.append(caption, select);
    return wrapper;
  }

  /** Change the mode. Applied live when a session is running; DAP allows it any time. */
  private async setExceptionMode(mode: ExceptionBreakMode): Promise<void> {
    this.exceptionMode = mode;
    this.settings?.set('debug.exceptionBreakMode', mode);
    if (this.currentState !== 'idle' && this.currentState !== 'error' && this.exceptionFilters.length) {
      const result = await window.znxstudio.debug.request('setExceptionBreakpoints', { filters: filtersFor(mode) });
      this.append(result.success ? `exception mode: ${mode}` : `could not change exception mode: ${result.message ?? 'refused'}`);
    }
    this.render();
  }

  private async continue(): Promise<void> {
    if (this.currentState !== 'stopped') return;
    this.append('continue');
    const result = await window.znxstudio.debug.request('continue', { threadId: 1 });
    if (!result.success) {
      this.append(`continue failed: ${result.message ?? 'request refused'}`);
      this.context.layout.showToast('Could not continue the debug session.', 'error');
      return;
    }
    this.clearStack();
    this.setState('running');
  }

  /**
   * Step (next / stepIn / stepOut). The resulting `stopped` event refreshes the
   * call stack, variables and watches in place — or `terminated` ends the run.
   */
  private async step(command: 'next' | 'stepIn' | 'stepOut'): Promise<void> {
    if (this.currentState !== 'stopped') return;
    this.append(command);
    const result = await window.znxstudio.debug.request(command, { threadId: 1 });
    if (!result.success) this.append(`${command} failed: ${result.message ?? ''}`);
  }

  private async pause(): Promise<void> {
    if (this.currentState !== 'running') return;
    this.append('pause');
    const result = await window.znxstudio.debug.request('pause', { threadId: 1 });
    if (!result.success) this.append(`pause failed: ${result.message ?? ''}`);
  }

  private registerKeybindings(): void {
    this.keyListener = (event: KeyboardEvent) => {
      const run = (fn: () => void) => {
        event.preventDefault();
        event.stopPropagation();
        fn();
      };
      if (this.currentState === 'stopped') {
        if (event.key === 'F10') return run(() => void this.step('next'));
        if (event.key === 'F11' && !event.shiftKey) return run(() => void this.step('stepIn'));
        if (event.key === 'F11' && event.shiftKey) return run(() => void this.step('stepOut'));
        if (event.key === 'F5' && !event.shiftKey) return run(() => void this.continue());
      }
      if (this.currentState === 'running' && event.key === 'F6') return run(() => void this.pause());
      if (event.key === 'F5' && event.shiftKey && this.currentState !== 'idle' && this.currentState !== 'terminated') {
        return run(() => void this.stop());
      }
    };
    document.addEventListener('keydown', this.keyListener, true);
  }

  private async stop(): Promise<void> {
    if (this.currentState === 'idle') return;
    this.clearStack();
    try {
      await window.znxstudio.debug.stop();
      this.append('stop requested');
      this.setState('idle');
    } catch (error) {
      this.append(`stop failed: ${(error as Error).message}`);
      this.setState('error');
    }
  }

  /* ----- call stack (Phase 4C) ----- */
  private async loadStack(): Promise<void> {
    const result = await window.znxstudio.debug.request('stackTrace', { threadId: 1, startFrame: 0, levels: 20 });
    if (!result.success) return;
    const raw = ((result.body as { stackFrames?: DapStackFrame[] })?.stackFrames) ?? [];
    this.frames = raw.map((f) => ({
      id: f.id,
      name: f.name,
      path: f.source?.path,
      line: f.line ?? 1,
      column: f.column ?? 1,
    }));
    this.activeFrame = 0;
    this.render();
    if (this.frames.length) this.focusFrame(0);
  }

  private focusFrame(index: number): void {
    const frame = this.frames[index];
    if (!frame) return;
    this.activeFrame = index;
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (editor && frame.path) {
      const uri = monaco.Uri.file(frame.path).toString();
      void editor.revealLocation(uri, frame.line - 1, Math.max(0, frame.column - 1));
      // Only the top frame carries the exception styling.
      editor.setExecutionPointer(uri, frame.line - 1, this.lastException && index === 0 ? 'exception' : 'step');
    }
    this.render();
    void this.loadScopes(frame.id);
    void this.evaluateWatches();
  }

  private clearStack(): void {
    this.frames = [];
    this.activeFrame = 0;
    this.scopes = [];
    this.lastException = null;
    for (const watch of this.watches) this.resetWatch(watch);
    this.context.services.tryGet<EditorService>(ServiceKeys.Editor)?.setExecutionPointer(null);
  }

  /* ----- watch expressions (Phase 4E) ----- */
  private async evaluateWatches(): Promise<void> {
    const frameId = this.frames[this.activeFrame]?.id;
    if (this.currentState !== 'stopped' || frameId === undefined) {
      for (const watch of this.watches) this.resetWatch(watch);
      this.render();
      return;
    }
    await Promise.all(this.watches.map((watch) => this.evaluateWatch(watch, frameId)));
    this.render();
  }

  private async evaluateWatch(watch: WatchExpression, frameId: number): Promise<void> {
    const result = await window.znxstudio.debug.request('evaluate', {
      expression: watch.expression,
      frameId,
      context: 'watch',
    });
    if (result.success) {
      const body = (result.body ?? {}) as DapEvaluate;
      watch.value = body.result;
      watch.type = body.type;
      watch.reference = body.variablesReference ?? 0;
      watch.error = undefined;
    } else {
      watch.error = result.message ?? 'evaluation failed';
      watch.value = '';
      watch.reference = 0;
    }
    watch.expanded = false;
    watch.children = null;
  }

  private resetWatch(watch: WatchExpression): void {
    watch.value = '';
    watch.type = undefined;
    watch.reference = 0;
    watch.error = undefined;
    watch.expanded = false;
    watch.children = null;
  }

  private addWatch(expression: string): void {
    const trimmed = expression.trim();
    if (!trimmed) return;
    const watch: WatchExpression = { expression: trimmed, value: '', reference: 0, expanded: false, children: null };
    this.watches.push(watch);
    const frameId = this.frames[this.activeFrame]?.id;
    if (this.currentState === 'stopped' && frameId !== undefined) {
      void this.evaluateWatch(watch, frameId).then(() => this.render());
    }
    this.render();
  }

  private removeWatch(index: number): void {
    this.watches.splice(index, 1);
    this.render();
  }

  private async toggleWatch(watch: WatchExpression): Promise<void> {
    if (watch.reference <= 0) return;
    watch.expanded = !watch.expanded;
    this.render();
    if (watch.expanded && watch.children === null) {
      watch.children = await this.fetchVariables(watch.reference);
      this.render();
    }
  }

  /* ----- variables (Phase 4D) ----- */
  private async loadScopes(frameId: number): Promise<void> {
    const result = await window.znxstudio.debug.request('scopes', { frameId });
    if (!result.success) {
      this.scopes = [];
      this.render();
      return;
    }
    const raw = ((result.body as { scopes?: DapScope[] })?.scopes) ?? [];
    this.scopes = raw.map((scope, i) => ({
      name: scope.name,
      reference: scope.variablesReference,
      expanded: i === 0, // auto-open the first scope (Locals)
      variables: null,
    }));
    this.render();
    for (const scope of this.scopes) {
      if (scope.expanded) await this.loadScopeVariables(scope);
    }
    this.render();
  }

  private async loadScopeVariables(scope: DebugScope): Promise<void> {
    if (scope.variables !== null || scope.reference <= 0) return;
    scope.variables = await this.fetchVariables(scope.reference);
  }

  private async fetchVariables(reference: number): Promise<DebugVariable[]> {
    const result = await window.znxstudio.debug.request('variables', { variablesReference: reference });
    if (!result.success) return [];
    const raw = ((result.body as { variables?: DapVariable[] })?.variables) ?? [];
    return raw.map((v) => ({
      name: v.name,
      value: v.value,
      type: v.type,
      reference: v.variablesReference,
      expanded: false,
      children: null,
    }));
  }

  private async toggleScope(scope: DebugScope): Promise<void> {
    scope.expanded = !scope.expanded;
    this.render();
    if (scope.expanded && scope.variables === null) {
      await this.loadScopeVariables(scope);
      this.render();
    }
  }

  private async toggleVariable(variable: DebugVariable): Promise<void> {
    if (variable.reference <= 0) return;
    variable.expanded = !variable.expanded;
    this.render();
    if (variable.expanded && variable.children === null) {
      variable.children = await this.fetchVariables(variable.reference);
      this.render();
    }
  }

  /* ----- events ----- */
  private onEvent(event: DebugEventMessage): void {
    switch (event.event) {
      case 'initialized':
        this.append('initialized');
        break;
      case 'stopped': {
        const body = (event.body ?? {}) as { reason?: string; threadId?: number; description?: string; text?: string };
        this.lastException =
          body.reason === 'exception' ? body.description ?? body.text ?? 'A runtime error occurred.' : null;
        this.append(`paused: ${body.reason ?? 'unknown'}${body.description ? ` — ${body.description}` : ''}`);
        this.setState('stopped');
        void this.loadStack();
        break;
      }
      case 'continued':
        this.clearStack();
        this.setState('running');
        break;
      case 'output': {
        const body = (event.body ?? {}) as { output?: string };
        if (body.output) this.append(body.output.replace(/\n$/, ''));
        break;
      }
      case 'terminated':
        this.append('program terminated');
        this.clearStack();
        this.setState('terminated');
        break;
      default:
        this.append(`event: ${event.event}`);
    }
  }

  /* ----- rendering ----- */
  private setState(state: DebugState): void {
    this.currentState = state;
    this.stateEmitter.fire(state);
    this.render();
    this.updateStatus();
  }

  private append(line: string): void {
    this.log.push(line);
    if (this.log.length > 500) this.log.shift();
    this.render();
  }

  private render(): void {
    const watchFocused = this.surface.contains(document.activeElement)
      && (document.activeElement as HTMLElement | null)?.classList.contains('znxstudio-debug-watch-input');
    const watchSelection = watchFocused && document.activeElement instanceof HTMLInputElement
      ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] as const
      : undefined;
    const header = document.createElement('div');
    header.className = 'znxstudio-debug-header';

    const state = document.createElement('span');
    state.className = `znxstudio-debug-state znxstudio-debug-state--${this.currentState}`;
    state.textContent = `${STATE_ICON[this.currentState]} ${STATE_LABEL[this.currentState]}`;
    header.appendChild(state);
    this.renderControls(header);
    header.appendChild(this.renderExceptionPicker());

    const consoleSection = this.consoleView();

    const children: HTMLElement[] = [header];
    if (this.currentState === 'stopped' && this.lastException) children.push(this.exceptionBanner());
    if (this.currentState === 'stopped' && this.frames.length) children.push(this.callStack());
    if (this.currentState === 'stopped' && this.scopes.length) children.push(this.variablesView());
    children.push(this.watchView());
    children.push(consoleSection.section);

    this.surface.replaceChildren(...children);
    consoleSection.console.scrollTop = consoleSection.console.scrollHeight;
    if (watchFocused) {
      const next = this.surface.querySelector<HTMLInputElement>('.znxstudio-debug-watch-input');
      next?.focus();
      if (next && watchSelection) next.setSelectionRange(watchSelection[0], watchSelection[1]);
    }
  }

  private consoleView(): { section: HTMLElement; console: HTMLElement } {
    const section = document.createElement('section');
    section.className = 'znxstudio-debug-console-section';
    const heading = document.createElement('div');
    heading.className = 'znxstudio-debug-stack-title znxstudio-debug-section-heading';
    const title = document.createElement('span');
    title.textContent = 'Debug Console';
    const actions = document.createElement('span');
    actions.className = 'znxstudio-debug-section-actions';
    const copy = this.button('Copy', () => void this.copyConsole());
    copy.classList.add('is-text');
    copy.title = 'Copy debug console';
    copy.setAttribute('aria-label', 'Copy debug console');
    copy.toggleAttribute('disabled', this.log.length === 0);
    const clear = this.button('Clear', () => {
      this.log.length = 0;
      this.render();
    });
    clear.classList.add('is-text');
    clear.title = 'Clear debug console';
    clear.setAttribute('aria-label', 'Clear debug console');
    clear.toggleAttribute('disabled', this.log.length === 0);
    actions.append(copy, clear);
    heading.append(title, actions);
    const console = document.createElement('pre');
    console.className = 'znxstudio-debug-console';
    console.setAttribute('aria-label', 'Debug console output');
    console.textContent = this.log.join('\n') || 'Start debugging to see session output.';
    section.append(heading, console);
    return { section, console };
  }

  private async copyConsole(): Promise<void> {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(this.log.join('\n'));
      this.context.layout.showToast('Debug console copied.', 'success');
    } catch {
      this.context.layout.showToast('Could not copy the debug console.', 'error');
    }
  }

  private watchView(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'znxstudio-debug-watch';

    const heading = document.createElement('div');
    heading.className = 'znxstudio-debug-stack-title';
    heading.textContent = 'Watch';
    section.appendChild(heading);

    const input = document.createElement('input');
    input.className = 'znxstudio-debug-watch-input';
    input.type = 'text';
    input.placeholder = 'Add expression…';
    input.setAttribute('aria-label', 'Add watch expression');
    input.value = this.watchDraft;
    input.addEventListener('input', () => {
      this.watchDraft = input.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        this.addWatch(input.value);
        this.watchDraft = '';
        input.value = '';
      }
    });
    section.appendChild(input);

    this.watches.forEach((watch, index) => {
      const row = document.createElement('div');
      row.className = 'znxstudio-debug-var znxstudio-debug-watch-row';

      const twisty = watch.reference > 0 ? (watch.expanded ? '▾ ' : '▸ ') : '';
      const name = document.createElement('span');
      name.className = 'znxstudio-debug-var-name';
      name.textContent = `${twisty}${watch.expression}`;

      const value = document.createElement('span');
      value.className = watch.error ? 'znxstudio-debug-var-value znxstudio-debug-watch-error' : 'znxstudio-debug-var-value';
      value.textContent = watch.error ?? (watch.value || '—');

      const remove = document.createElement('button');
      remove.className = 'znxstudio-debug-watch-remove';
      remove.textContent = '×';
      remove.title = 'Remove watch';
      remove.setAttribute('aria-label', `Remove watch ${watch.expression}`);
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        this.removeWatch(index);
      });

      row.append(name, value, remove);
      if (watch.reference > 0) {
        row.classList.add('is-expandable');
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-expanded', String(watch.expanded));
        row.addEventListener('click', () => void this.toggleWatch(watch));
        row.addEventListener('keydown', (event) => {
          if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            void this.toggleWatch(watch);
          }
        });
      }
      section.appendChild(row);

      if (watch.expanded && watch.children) {
        for (const child of watch.children) this.appendVariable(section, child, 1);
      }
    });

    return section;
  }

  private variablesView(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'znxstudio-debug-vars';

    const heading = document.createElement('div');
    heading.className = 'znxstudio-debug-stack-title';
    heading.textContent = 'Variables';
    section.appendChild(heading);

    for (const scope of this.scopes) {
      const scopeRow = document.createElement('div');
      scopeRow.className = 'znxstudio-debug-scope';
      scopeRow.textContent = `${scope.expanded ? '▾' : '▸'} ${scope.name}`;
      scopeRow.tabIndex = 0;
      scopeRow.setAttribute('role', 'button');
      scopeRow.setAttribute('aria-expanded', String(scope.expanded));
      scopeRow.addEventListener('click', () => void this.toggleScope(scope));
      scopeRow.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void this.toggleScope(scope);
        }
      });
      section.appendChild(scopeRow);

      if (scope.expanded && scope.variables) {
        for (const variable of scope.variables) this.appendVariable(section, variable, 1);
      }
    }
    return section;
  }

  private appendVariable(parent: HTMLElement, variable: DebugVariable, depth: number): void {
    const row = document.createElement('div');
    row.className = 'znxstudio-debug-var';
    row.style.paddingLeft = `${16 + depth * 14}px`;

    const expandable = variable.reference > 0;
    const twisty = expandable ? (variable.expanded ? '▾ ' : '▸ ') : '';
    const name = document.createElement('span');
    name.className = 'znxstudio-debug-var-name';
    name.textContent = `${twisty}${variable.name}`;

    const value = document.createElement('span');
    value.className = 'znxstudio-debug-var-value';
    value.textContent = variable.type ? `${variable.value}  (${variable.type})` : variable.value;

    row.append(name, value);
    if (expandable) {
      row.classList.add('is-expandable');
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-expanded', String(variable.expanded));
      row.addEventListener('click', () => void this.toggleVariable(variable));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void this.toggleVariable(variable);
        }
      });
    }
    parent.appendChild(row);

    if (variable.expanded && variable.children) {
      for (const child of variable.children) this.appendVariable(parent, child, depth + 1);
    }
  }

  private exceptionBanner(): HTMLElement {
    const banner = document.createElement('div');
    banner.className = 'znxstudio-debug-exception';
    const title = document.createElement('div');
    title.className = 'znxstudio-debug-exception-title';
    title.textContent = '⛔ Paused on exception';
    const message = document.createElement('div');
    message.className = 'znxstudio-debug-exception-message';
    message.textContent = this.lastException ?? '';
    banner.append(title, message);
    return banner;
  }

  private callStack(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'znxstudio-debug-stack';

    const heading = document.createElement('div');
    heading.className = 'znxstudio-debug-stack-title';
    heading.textContent = 'Call Stack';
    section.appendChild(heading);

    this.frames.forEach((frame, index) => {
      const row = document.createElement('div');
      row.className = `znxstudio-debug-frame${index === this.activeFrame ? ' is-active' : ''}`;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-current', index === this.activeFrame ? 'true' : 'false');

      const name = document.createElement('span');
      name.className = 'znxstudio-debug-frame-name';
      name.textContent = frame.name;
      row.appendChild(name);

      if (frame.path) {
        const location = document.createElement('span');
        location.className = 'znxstudio-debug-frame-loc';
        location.textContent = `${fileName(frame.path)}:${frame.line}`;
        row.appendChild(location);
      }

      row.addEventListener('click', () => this.focusFrame(index));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.focusFrame(index);
        }
      });
      section.appendChild(row);
    });
    return section;
  }

  private renderControls(header: HTMLElement): void {
    const add = (label: string, command: string, title: string) => {
      const btn = this.button(label, () => void this.context.commands.execute(command));
      btn.title = title;
      btn.setAttribute('aria-label', title);
      header.appendChild(btn);
    };
    switch (this.currentState) {
      case 'stopped':
        add('▷', CommandIds.DebugContinue, 'Continue (F5)');
        add('⤼', CommandIds.DebugStepOver, 'Step Over (F10)');
        add('⤷', CommandIds.DebugStepIn, 'Step Into (F11)');
        add('⤴', CommandIds.DebugStepOut, 'Step Out (Shift+F11)');
        add('⏹', CommandIds.DebugStop, 'Stop (Shift+F5)');
        break;
      case 'running':
      case 'starting':
        add('⏸', CommandIds.DebugPause, 'Pause (F6)');
        add('⏹', CommandIds.DebugStop, 'Stop (Shift+F5)');
        break;
      default:
        add('▶ Start', CommandIds.DebugStart, 'Start Debugging');
    }
  }

  private button(text: string, onClick: () => void): HTMLElement {
    const el = document.createElement('button');
    el.className = 'znxstudio-debug-btn';
    el.textContent = text;
    el.addEventListener('click', onClick);
    return el;
  }

  private updateStatus(): void {
    const status = this.context.services.tryGet<StatusService>(ServiceKeys.Status);
    // Contextual (SB-2): the debugger segment is shown only during a live
    // session — idle/terminated go quiet (active:false unmounts it).
    const live = this.currentState !== 'idle' && this.currentState !== 'terminated';
    status?.setItem('debug', {
      text: `${STATE_ICON[this.currentState]} ${STATE_LABEL[this.currentState]}`,
      tooltip: 'Zornux debugger — click for the Debug panel',
      command: CommandIds.ViewDebug,
      side: 'right',
      priority: 13,
      active: live,
    });
  }

  /* ----- helpers ----- */
  private resolveEntry(info: WorkspaceInfo | null): string | null {
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    const active = editor?.currentFile();
    if (active && active.toLowerCase().endsWith('.zx')) return active;
    if (!info) return null;
    const targetsZornux =
      info.detectedType === 'zornux-api' || info.detectedType === 'zornux-zoijs-fullstack';
    return targetsZornux ? `${info.root.replace(/[\\/]+$/, '')}/src/main.zx` : null;
  }

  private workspaceInfo(): WorkspaceInfo | null {
    return this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace)?.currentWorkspace() ?? null;
  }

  /**
   * Prove the rc.4 exception filters against the REAL adapter: a program whose
   * error is caught by `try`/`otherwise` must NOT stop under `uncaught`, and MUST
   * stop under `all`. Anything less would be asserting the capability, not the
   * behaviour.
   */
  private async exceptionFilterSelfTest(logline: (message: string) => void, compilerPath: string | null): Promise<void> {
    const app = await window.znxstudio.app.getInfo();
    const program = `${app.tempDir}\\znxstudio-debug-caught.zx`;
    await window.znxstudio.fs.writeFile(program, 'try\n    show 10 / 0\notherwise\n    show "recovered"\nend\nshow "done"\n');

    /** Run to completion (or 4s) and report whether the adapter ever paused. */
    const run = async (mode: ExceptionBreakMode): Promise<{ stopped: boolean; filters: number }> => {
      const events: string[] = [];
      const off = window.znxstudio.debug.onEvent((event) => events.push(event.event));
      const result = await window.znxstudio.debug.start({
        program,
        compilerPath,
        workspaceRoot: app.tempDir,
        breakpoints: [],
        exceptionFilters: filtersFor(mode),
      });
      const filters = parseExceptionFilters(result.capabilities).length;

      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (events.includes('stopped') || events.includes('terminated')) {
            clearInterval(check);
            resolve();
          }
        }, 50);
        setTimeout(() => {
          clearInterval(check);
          resolve();
        }, 4000);
      });
      const stopped = events.includes('stopped');
      off();
      await window.znxstudio.debug.stop();
      return { stopped, filters };
    };

    const uncaught = await run('uncaught');
    logline(
      `debugger REAL exception filters: adapter advertises ${uncaught.filters} filter(s) ` +
        `(0 would mean Zornux < rc.4 and this test proves nothing)`,
    );
    logline(`debugger REAL 'uncaught': stopped=${uncaught.stopped} (expect false — the try/otherwise recovers)`);

    const all = await run('all');
    logline(`debugger REAL 'all': stopped=${all.stopped} (expect true — break even on a recovered error)`);

    const never = await run('never');
    logline(`debugger REAL 'never': stopped=${never.stopped} (expect false)`);
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
    const logline = (message: string) => console.info(`[selftest] ${message}`);
    try {
      const info = await window.znxstudio.compiler.info();
      if (!info.available) {
        logline('debugger: compiler unavailable, skipping DAP session');
        return;
      }
      try {
        await this.exceptionFilterSelfTest(logline, info.path);
      } catch (error) {
        logline(`debugger REAL exception filters failed: ${(error as Error).message}`);
      }
      const events: string[] = [];
      let resolveDone: () => void = () => undefined;
      const done = new Promise<void>((resolve) => (resolveDone = resolve));
      const unsub = window.znxstudio.debug.onEvent((event) => {
        events.push(event.event);
        if (event.event === 'terminated') resolveDone();
      });

      const program = 'C:\\Studio Apps\\xojin\\examples\\conditionals.zx';
      const result = await window.znxstudio.debug.start({
        program,
        compilerPath: info.path,
        workspaceRoot: 'C:\\Studio Apps\\xojin',
        // Breakpoint on line 5 (inside the if, after `age` is created) → the run
        // must stop with `age` in scope.
        breakpoints: [{ path: program, lines: [{ line: 5 }] }],
      });
      const caps = result.capabilities ? Object.keys(result.capabilities).filter((k) => result.capabilities![k]) : [];
      const verified = (result.breakpoints ?? []).flatMap((s) => s.breakpoints).filter((b) => b.verified).length;
      logline(
        `debugger DAP: start.success=${result.success} verifiedBreakpoints=${verified} capabilities=[${caps.join(', ')}] ${result.error ? `error=${result.error}` : ''}`,
      );

      // Wait to stop at the breakpoint, then continue to completion.
      const stopped = new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (events.includes('stopped')) {
            clearInterval(check);
            resolve();
          }
        }, 50);
        setTimeout(() => {
          clearInterval(check);
          resolve();
        }, 3000);
      });
      await stopped;
      if (events.includes('stopped')) {
        const stack = await window.znxstudio.debug.request('stackTrace', { threadId: 1, startFrame: 0, levels: 20 });
        const rawFrames = ((stack.body as { stackFrames?: DapStackFrame[] })?.stackFrames) ?? [];
        logline(
          `debugger stackTrace: frames=${rawFrames.length} top=${rawFrames[0]?.name ?? 'none'}@L${rawFrames[0]?.line ?? '?'}`,
        );
        const frameId = rawFrames[0]?.id;
        if (frameId !== undefined) {
          const scopesRes = await window.znxstudio.debug.request('scopes', { frameId });
          const scopes = ((scopesRes.body as { scopes?: DapScope[] })?.scopes) ?? [];
          logline(`debugger scopes: [${scopes.map((s) => `${s.name}(ref${s.variablesReference})`).join(', ')}]`);
          const localsRef = scopes[0]?.variablesReference;
          if (localsRef) {
            const varsRes = await window.znxstudio.debug.request('variables', { variablesReference: localsRef });
            const variables = ((varsRes.body as { variables?: DapVariable[] })?.variables) ?? [];
            logline(`debugger variables[${scopes[0].name}]: [${variables.map((v) => `${v.name}=${v.value}`).join(', ') || 'none'}]`);
          }
          // Phase 4E: evaluate a watch expression against the paused frame.
          const evalRes = await window.znxstudio.debug.request('evaluate', { expression: 'age', frameId, context: 'watch' });
          const evalBody = (evalRes.body ?? {}) as DapEvaluate;
          logline(`debugger evaluate(watch 'age'): success=${evalRes.success} result=${evalBody.result ?? evalRes.message ?? 'n/a'}`);
          // Phase 4F: evaluate in hover context (drives the editor hover tooltip).
          const hoverRes = await window.znxstudio.debug.request('evaluate', { expression: 'age', frameId, context: 'hover' });
          const hoverBody = (hoverRes.body ?? {}) as DapEvaluate;
          logline(`debugger evaluate(hover 'age'): success=${hoverRes.success} result=${hoverBody.result ?? hoverRes.message ?? 'n/a'}`);

          // Phase 4G: step over → expect a fresh 'stopped' (or a terminated run).
          const stopsBefore = events.filter((e) => e === 'stopped').length;
          const stepRes = await window.znxstudio.debug.request('next', { threadId: 1 });
          await new Promise<void>((resolve) => {
            const timer = setInterval(() => {
              if (events.filter((e) => e === 'stopped').length > stopsBefore || events.includes('terminated')) {
                clearInterval(timer);
                resolve();
              }
            }, 50);
            setTimeout(() => {
              clearInterval(timer);
              resolve();
            }, 3000);
          });
          logline(
            `debugger step(next): success=${stepRes.success} stops=${events.filter((e) => e === 'stopped').length} terminated=${events.includes('terminated')}`,
          );
        }
        await window.znxstudio.debug.request('continue', { threadId: 1 });
      }
      await Promise.race([done, new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
      logline(`debugger events observed: [${events.join(', ')}]`);
      unsub();
      await window.znxstudio.debug.stop();

      // Phase 4I: run the SAME flow over the real Zornux TCP transport
      // (`zornux dap ... --tcp --port 0`), proving port discovery + socket + DAP.
      {
        const tcpEvents: string[] = [];
        const tcpUnsub = window.znxstudio.debug.onEvent((e) => tcpEvents.push(e.event));
        const tcpResult = await window.znxstudio.debug.start({
          program,
          compilerPath: info.path,
          workspaceRoot: 'C:\\Studio Apps\\xojin',
          transport: 'tcp',
          breakpoints: [{ path: program, lines: [{ line: 5 }] }],
        });
        const tcpVerified = (tcpResult.breakpoints ?? []).flatMap((s) => s.breakpoints).filter((b) => b.verified).length;
        logline(
          `debugger TCP transport: start.success=${tcpResult.success} verifiedBreakpoints=${tcpVerified} ${tcpResult.error ? `error=${tcpResult.error}` : ''}`,
        );
        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            if (tcpEvents.includes('stopped')) {
              clearInterval(timer);
              resolve();
            }
          }, 50);
          setTimeout(() => {
            clearInterval(timer);
            resolve();
          }, 4000);
        });
        if (tcpEvents.includes('stopped')) {
          const stack = await window.znxstudio.debug.request('stackTrace', { threadId: 1, startFrame: 0, levels: 20 });
          const frames = ((stack.body as { stackFrames?: DapStackFrame[] })?.stackFrames) ?? [];
          let vars = 'n/a';
          const fid = frames[0]?.id;
          if (fid !== undefined) {
            const scopesRes = await window.znxstudio.debug.request('scopes', { frameId: fid });
            const scopes = ((scopesRes.body as { scopes?: DapScope[] })?.scopes) ?? [];
            const ref = scopes[0]?.variablesReference;
            if (ref) {
              const varsRes = await window.znxstudio.debug.request('variables', { variablesReference: ref });
              const variables = ((varsRes.body as { variables?: DapVariable[] })?.variables) ?? [];
              vars = variables.map((v) => `${v.name}=${v.value}`).join(', ') || 'none';
            }
          }
          logline(
            `debugger TCP stack: frames=${frames.length} top=${frames[0]?.name ?? 'none'}@L${frames[0]?.line ?? '?'} vars=[${vars}]`,
          );
          await window.znxstudio.debug.request('continue', { threadId: 1 });
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        logline(`debugger TCP events: [${tcpEvents.join(', ')}]`);
        tcpUnsub();
        await window.znxstudio.debug.stop();
      }

      // Phase 4H: a runtime error (undefined variable) must break with reason=exception.
      const excFile = 'C:\\Users\\jerem\\AppData\\Local\\Temp\\znxstudio-exc-selftest.zx';
      await window.znxstudio.fs.writeFile(excFile, 'show missing_variable\n');
      let excReason = '';
      let excDescription = '';
      let excSettled = false;
      const excUnsub = window.znxstudio.debug.onEvent((event) => {
        if (event.event === 'stopped') {
          const body = (event.body ?? {}) as { reason?: string; description?: string; text?: string };
          excReason = body.reason ?? '';
          excDescription = body.description ?? body.text ?? '';
          excSettled = true;
        } else if (event.event === 'terminated') {
          excSettled = true;
        }
      });
      await window.znxstudio.debug.start({ program: excFile, compilerPath: info.path, workspaceRoot: null, breakpoints: [] });
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (excSettled) {
            clearInterval(timer);
            resolve();
          }
        }, 50);
        setTimeout(() => {
          clearInterval(timer);
          resolve();
        }, 3000);
      });
      logline(`debugger exception: reason=${excReason || 'none'} description="${excDescription}"`);
      excUnsub();
      await window.znxstudio.debug.stop();
    } catch (error) {
      logline(`debugger self-test failed: ${(error as Error).message}`);
    }
  }
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
