import {
  ServiceKeys,
  type EditorDecoration,
  type EditorService,
  type SettingsService,
  type StatusService,
} from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import { CommandIds } from '../commands/CommandIds';
import { LanguageServiceKeys, type Diagnostic, type DiagnosticsReader } from '../language/api';
import {
  countBySeverity,
  nextDiagnostic,
  previousDiagnostic,
  topDiagnosticPerLine,
} from './errorNavigation';

const DECORATION_OWNER = 'znxstudio.liveErrors';

/**
 * Live Error Reporting. Turns the aggregated diagnostics for the active document
 * into an immediate, navigable experience:
 *   - Error Lens — inline messages + line tint in the editor (toggleable),
 *   - Go to Next / Previous Problem (F8 / Shift+F8) + palette commands,
 *   - an active-file problem indicator in the status bar (click → next problem).
 * Consumes the DiagnosticsEngine + EditorService only; owns no diagnostics.
 */
export class LiveErrorsModule implements IModule {
  readonly id = 'znxstudio.liveErrors';
  readonly displayName = 'Live Errors';

  private context!: ModuleContext;
  private engine: DiagnosticsReader | undefined;
  private editor: EditorService | undefined;
  private keyListener: ((event: KeyboardEvent) => void) | undefined;

  activate(context: ModuleContext): void {
    this.context = context;
    this.engine = context.services.tryGet<DiagnosticsReader>(LanguageServiceKeys.Diagnostics);
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);

    context.commands.register(CommandIds.ErrorNext, () => this.goToNext(), 'Go: Next Problem');
    context.commands.register(CommandIds.ErrorPrevious, () => this.goToPrevious(), 'Go: Previous Problem');

    // Repaint when diagnostics for the active file change, or the active file changes.
    this.engine?.onDidChange(({ uri }) => {
      if (uri === this.editor?.currentUri()) this.refresh();
    });
    this.editor?.onDidChangeActiveFile(() => this.refresh());

    const settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    settings?.onDidChange((event) => {
      if (event.key.startsWith('zornux.errorLens.')) this.refresh();
    });

    // F8 / Shift+F8 navigation (capture phase, so Monaco doesn't swallow it).
    this.keyListener = (event: KeyboardEvent) => {
      if (event.key !== 'F8') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) void this.goToPrevious();
      else void this.goToNext();
    };
    document.addEventListener('keydown', this.keyListener, true);

    this.refresh();
    void selfTestCoordinator.run('live-errors', () => this.maybeSelfTest());
  }

  deactivate(): void {
    if (this.keyListener) document.removeEventListener('keydown', this.keyListener, true);
  }

  /* ----- rendering ----- */
  private refresh(): void {
    const uri = this.editor?.currentUri() ?? null;
    const diagnostics = uri ? this.engine?.get(uri) ?? [] : [];

    this.renderErrorLens(diagnostics);
    this.renderStatus(diagnostics);
  }

  private renderErrorLens(diagnostics: Diagnostic[]): void {
    if (!this.editor) return;
    if (!this.errorLensEnabled()) {
      this.editor.clearDecorations(DECORATION_OWNER);
      return;
    }
    const decorations: EditorDecoration[] = topDiagnosticPerLine(diagnostics).map((diagnostic) => ({
      startLine: diagnostic.range.start.line,
      startCharacter: diagnostic.range.start.character,
      endLine: diagnostic.range.end.line,
      endCharacter: diagnostic.range.end.character,
      severity: diagnostic.severity,
      inlineMessage: diagnostic.message,
      wholeLine: true,
    }));
    this.editor.setDecorations(DECORATION_OWNER, decorations);
  }

  private renderStatus(diagnostics: Diagnostic[]): void {
    const status = this.context.services.tryGet<StatusService>(ServiceKeys.Status);
    if (!status) return;
    const { errors, warnings } = countBySeverity(diagnostics);
    if (errors === 0 && warnings === 0) {
      status.removeItem('liveErrors');
      return;
    }
    const parts = [errors ? `⛔ ${errors}` : '', warnings ? `⚠️ ${warnings}` : ''].filter(Boolean);
    status.setItem('liveErrors', {
      text: `${parts.join('  ')}  ⤓`,
      tooltip: 'Problems in this file — click to jump to the next one (F8)',
      command: CommandIds.ErrorNext,
      side: 'left',
      priority: 39,
    });
  }

  /* ----- navigation ----- */
  private goToNext(): void {
    this.navigate(nextDiagnostic);
  }
  private goToPrevious(): void {
    this.navigate(previousDiagnostic);
  }

  private navigate(pick: (diagnostics: Diagnostic[], position: { line: number; character: number }) => Diagnostic | null): void {
    if (!this.editor) return;
    const uri = this.editor.currentUri();
    if (!uri) return;
    const diagnostics = this.engine?.get(uri) ?? [];
    const position = this.editor.cursorPosition() ?? { line: 0, character: 0 };
    const target = pick(diagnostics, position);
    if (target) this.editor.revealPosition(target.range.start.line, target.range.start.character);
  }

  private errorLensEnabled(): boolean {
    const settings = this.context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    return Boolean(settings?.get('zornux.errorLens.enabled', true));
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled || !this.editor) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);
    try {
      // Exercise the Monaco decoration + injected-text path against the live editor.
      this.editor.setDecorations('selftest', [
        {
          startLine: 0,
          startCharacter: 0,
          endLine: 0,
          endCharacter: 1,
          severity: 'error',
          inlineMessage: 'ZX0001 sample inline message',
          wholeLine: true,
        },
      ]);
      this.editor.clearDecorations('selftest');

      const sample: Diagnostic[] = [
        { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } }, severity: 'error', message: 'e' },
      ];
      const nav = nextDiagnostic(sample, { line: 0, character: 0 });
      log(
        `live-errors: decorations applied+cleared ok; next-problem→L${nav ? nav.range.start.line : 'none'}; ` +
          `errorLens=${this.errorLensEnabled()}`,
      );
    } catch (error) {
      log(`live-errors self-test failed: ${(error as Error).message}`);
    }
  }
}
