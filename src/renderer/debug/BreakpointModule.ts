import * as monaco from 'monaco-editor';
import {
  ServiceKeys,
  type BreakpointGlyph,
  type BreakpointService,
  type DebuggerService,
  type DebugState,
  type EditorService,
} from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import type { DebugSourceBreakpoints, DebugSourceVerified, DebugVerifiedBreakpoint } from '../../shared/types';
import { BreakpointStore } from './breakpointStore';

/**
 * Breakpoint management (Phase 4B). Owns the breakpoint model, renders glyphs in
 * the editor gutter, toggles on gutter-click / F9, and keeps the adapter in sync:
 * the initial set is installed by the debug session before launch (so the run
 * can stop); edits during a live session are pushed via the DAP request
 * pass-through and their verified verdicts flow back to the gutter.
 */
export class BreakpointModule implements IModule, BreakpointService {
  readonly id = 'znxstudio.breakpoints';
  readonly displayName = 'Breakpoints';

  private context!: ModuleContext;
  private readonly store = new BreakpointStore();
  private keyListener: ((event: KeyboardEvent) => void) | undefined;

  activate(context: ModuleContext): void {
    this.context = context;
    context.services.register<BreakpointService>(ServiceKeys.Breakpoints, this);

    const editor = this.editor();
    editor?.onDidClickGutter((line) => this.toggleAt(line));
    editor?.onDidChangeActiveFile(() => this.render(this.editor()?.currentUri() ?? null));

    context.commands.register(
      CommandIds.ToggleBreakpoint,
      () => {
        const position = this.editor()?.cursorPosition();
        if (position) this.toggleAt(position.line);
      },
      'Debug: Toggle Breakpoint',
    );

    // F9 toggles a breakpoint at the caret (capture phase, ahead of Monaco).
    this.keyListener = (event: KeyboardEvent) => {
      if (event.key !== 'F9') return;
      event.preventDefault();
      const position = this.editor()?.cursorPosition();
      if (position) this.toggleAt(position.line);
    };
    document.addEventListener('keydown', this.keyListener, true);

    // When a session ends, breakpoints are no longer verified against a run.
    this.debugger()?.onDidChangeState((state) => {
      if (!sessionActive(state)) {
        this.store.resetVerified();
        this.render(this.editor()?.currentUri() ?? null);
      }
    });
  }

  deactivate(): void {
    if (this.keyListener) document.removeEventListener('keydown', this.keyListener, true);
  }

  /* ----- BreakpointService ----- */
  toggle(uri: string, line: number): void {
    this.store.toggle(uri, line);
    this.render(uri);
    void this.syncIfActive(uri);
  }

  launchList(): DebugSourceBreakpoints[] {
    return this.store.launchList((uri) => monaco.Uri.parse(uri).fsPath);
  }

  applyVerified(results: DebugSourceVerified[]): void {
    this.store.applyVerified((path) => monaco.Uri.file(path).toString(), results);
    this.render(this.editor()?.currentUri() ?? null);
  }

  /* ----- internals ----- */
  private toggleAt(line: number): void {
    const uri = this.editor()?.currentUri();
    if (uri) this.toggle(uri, line);
  }

  private async syncIfActive(uri: string): Promise<void> {
    const debuggerService = this.debugger();
    if (!debuggerService || !sessionActive(debuggerService.state())) return;
    const path = monaco.Uri.parse(uri).fsPath;
    const list = this.store.forUri(uri);
    const response = await debuggerService.request('setBreakpoints', {
      source: { path },
      breakpoints: list.map((bp) => ({ line: bp.line + 1, condition: bp.condition })),
      lines: list.map((bp) => bp.line + 1),
    });
    if (!response.success) return;
    const bps = ((response.body as { breakpoints?: DebugVerifiedBreakpoint[] })?.breakpoints) ?? [];
    this.store.applyVerified((p) => monaco.Uri.file(p).toString(), [{ path, breakpoints: bps }]);
    this.render(uri);
  }

  private render(uri: string | null): void {
    const editor = this.editor();
    if (!editor || !uri || uri !== editor.currentUri()) return;
    const glyphs: BreakpointGlyph[] = this.store.forUri(uri).map((bp) => ({
      line: bp.line,
      state: bp.condition ? 'conditional' : bp.verified ? 'verified' : 'unverified',
      hover: bp.condition ? `Conditional breakpoint: ${bp.condition}` : undefined,
    }));
    editor.setBreakpointGlyphs(glyphs);
  }

  private editor(): EditorService | undefined {
    return this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
  }

  private debugger(): DebuggerService | undefined {
    return this.context.services.tryGet<DebuggerService>(ServiceKeys.Debugger);
  }
}

function sessionActive(state: DebugState): boolean {
  return state === 'running' || state === 'stopped';
}
