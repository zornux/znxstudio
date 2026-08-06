import { ServiceKeys, type EditorService, type StatusService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { LanguageServiceKeys } from '../language/api';
import type { DocumentManager, ManagedDocument } from '../language/DocumentManager';
import { isSymbolScannable, scanSymbols, type SymbolKind } from '../../shared/symbolScan';
import { computeMetrics, type FileMetrics, type Rating } from './metrics';

const RATING_CLASS: Record<Rating, string> = { A: 'a', B: 'b', C: 'c', D: 'd' };

const SUPPORTED = new Set(['zornux', 'javascript', 'typescript', 'javascriptreact', 'typescriptreact']);

/**
 * Code Metrics (Phase 7I). Shows line counts, cyclomatic complexity, max nesting
 * and a maintainability rating for the active file, plus a symbol breakdown, in a
 * bottom-panel view + a status chip. Purely renderer-side over the open document
 * text — no compiler, no new IPC.
 */
export class MetricsModule implements IModule {
  readonly id = 'znxstudio.metrics';
  readonly displayName = 'Code Metrics';

  private context!: ModuleContext;
  private editor!: EditorService;
  private documents!: DocumentManager;
  private status: StatusService | undefined;
  private panel!: HTMLElement;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  activate(context: ModuleContext): void {
    this.context = context;
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);
    this.documents = context.services.get<DocumentManager>(LanguageServiceKeys.Documents);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-metrics';
    context.layout.addPanelView({ id: 'metrics', title: 'Metrics', element: this.panel });

    context.commands.register(CommandIds.MetricsShow, () => this.context.layout.showPanelView('metrics'), 'View: Code Metrics');

    this.editor.onDidChangeActiveFile(() => this.scheduleRefresh(0));
    this.documents.onDidChange((doc) => {
      if (doc.uri === this.documents.getActive()?.uri) this.scheduleRefresh(400);
    });

    this.renderEmpty('Open a file to see its metrics.');
    void selfTestCoordinator.run('metrics', () => this.maybeSelfTest());
  }

  private scheduleRefresh(delay: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), delay);
  }

  private refresh(): void {
    const active = this.documents.getActive();
    if (!active) {
      this.renderEmpty('Open a file to see its metrics.');
      this.status?.removeItem('editor.metrics');
      return;
    }
    if (!SUPPORTED.has(active.languageId)) {
      this.renderEmpty(`No metrics for ${active.languageId}.`);
      this.status?.removeItem('editor.metrics');
      return;
    }
    const text = active.document.getText();
    const metrics = computeMetrics(text, active.languageId);
    const symbols = this.symbolCounts(active, text);
    this.renderMetrics(metrics, symbols);
    this.status?.setItem('editor.metrics', {
      text: `📊 CC ${metrics.cyclomatic} · ${metrics.rating}`,
      tooltip: 'Code metrics — click for details',
      command: CommandIds.MetricsShow,
      side: 'right',
      priority: 23,
    });
  }

  private symbolCounts(active: ManagedDocument, text: string): Map<SymbolKind, number> {
    const ext = active.path.split('.').pop() ?? '';
    const counts = new Map<SymbolKind, number>();
    if (!isSymbolScannable(ext)) return counts;
    for (const symbol of scanSymbols(text, ext)) {
      counts.set(symbol.kind, (counts.get(symbol.kind) ?? 0) + 1);
    }
    return counts;
  }

  private renderEmpty(message: string): void {
    const empty = document.createElement('div');
    empty.className = 'znxstudio-metrics-empty';
    empty.textContent = message;
    this.panel.replaceChildren(empty);
  }

  private renderMetrics(metrics: FileMetrics, symbols: Map<SymbolKind, number>): void {
    this.panel.replaceChildren();

    const score = document.createElement('div');
    score.className = 'znxstudio-metrics-score';
    const badge = document.createElement('span');
    badge.className = `znxstudio-metrics-rating znxstudio-metrics-rating--${RATING_CLASS[metrics.rating]}`;
    badge.textContent = metrics.rating;
    const label = document.createElement('span');
    label.className = 'znxstudio-metrics-mi';
    label.textContent = `Maintainability ${metrics.maintainability}/100`;
    score.append(badge, label);
    this.panel.appendChild(score);

    this.panel.appendChild(
      this.grid([
        ['Cyclomatic complexity', String(metrics.cyclomatic)],
        ['Max nesting depth', String(metrics.maxNesting)],
        ['Lines (total)', String(metrics.total)],
        ['Code', String(metrics.code)],
        ['Comments', String(metrics.comment)],
        ['Blank', String(metrics.blank)],
      ]),
    );

    if (symbols.size > 0) {
      const symbolRows: [string, string][] = [...symbols.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([kind, count]) => [`${kind}s`, String(count)]);
      const header = document.createElement('div');
      header.className = 'znxstudio-metrics-subhead';
      header.textContent = 'Declarations';
      this.panel.appendChild(header);
      this.panel.appendChild(this.grid(symbolRows));
    }
  }

  private grid(rows: [string, string][]): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'znxstudio-metrics-grid';
    for (const [name, value] of rows) {
      const row = document.createElement('div');
      row.className = 'znxstudio-metrics-row';
      const key = document.createElement('span');
      key.className = 'znxstudio-metrics-key';
      key.textContent = name;
      const val = document.createElement('span');
      val.className = 'znxstudio-metrics-val';
      val.textContent = value;
      row.append(key, val);
      grid.appendChild(row);
    }
    return grid;
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

    try {
      const path = 'C:\\Studio Apps\\xojin\\examples\\classes.zx';
      const text = await window.znxstudio.fs.readFile(path);
      const metrics = computeMetrics(text, 'zornux');
      log(`metrics classes.zx: total=${metrics.total} code=${metrics.code} comment=${metrics.comment} cc=${metrics.cyclomatic} nesting=${metrics.maxNesting} mi=${metrics.maintainability} rating=${metrics.rating}`);
      const symbols = scanSymbols(text, 'zx');
      const classes = symbols.filter((s) => s.kind === 'class').length;
      const functions = symbols.filter((s) => s.kind === 'function').length;
      log(`metrics classes.zx symbols: classes=${classes} functions=${functions}`);

      const cond = await window.znxstudio.fs.readFile('C:\\Studio Apps\\xojin\\examples\\conditionals.zx');
      const condMetrics = computeMetrics(cond, 'zornux');
      log(`metrics conditionals.zx: cc=${condMetrics.cyclomatic} (if/else-if/and) code=${condMetrics.code}`);

      // Comment/string stripping: a keyword in a comment/string must not count.
      const tricky = 'create x = "if this then that"\n# if or while here\ncreate y = 1\n';
      log(`metrics stripping: cc(tricky)=${computeMetrics(tricky, 'zornux').cyclomatic} (expect 1)`);
    } catch (error) {
      log(`metrics self-test failed: ${(error as Error).message}`);
    }
  }
}
