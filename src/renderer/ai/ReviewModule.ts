import {
  ServiceKeys,
  type AiService,
  type EditorService,
  type StatusService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import {
  buildReviewMessages,
  countBySeverity,
  findingsToDecorations,
  parseReviewFindings,
  type ReviewFinding,
  type ReviewSeverity,
} from './review';

const DECORATION_OWNER = 'ai.review';
const SEVERITY_ICON: Record<ReviewSeverity, string> = { error: '⛔', warning: '⚠', info: 'ℹ', suggestion: '💡' };

/**
 * AI Review (Phase 10D). Reviews the selection (or the whole active file) through
 * the vendor-neutral AiService and turns the reply into structured findings —
 * shown inline as error-lens decorations AND listed in a panel, each click-to-
 * reveal. Grounded entirely in whatever provider the user configured.
 */
export class ReviewModule implements IModule {
  readonly id = 'znxstudio.ai.review';
  readonly displayName = 'AI Review';

  private context!: ModuleContext;
  private ai!: AiService;
  private editor!: EditorService;
  private status: StatusService | undefined;
  private panel!: HTMLElement;
  private findings: ReviewFinding[] = [];
  private reviewedFile: string | null = null;
  private running = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.ai = context.services.get<AiService>(ServiceKeys.Ai);
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-review';
    context.layout.addPanelView({ id: 'ai-review', title: 'AI Review', element: this.panel });

    context.commands.register(CommandIds.AiReview, () => this.review(), 'AI: Review Code');
    context.commands.register(CommandIds.AiReviewClear, () => this.clear(), 'AI: Clear Review');

    // Findings pin to the file they were produced for; clear when switching away.
    this.editor.onDidChangeActiveFile((file) => {
      if (file !== this.reviewedFile && this.findings.length) this.clear();
    });

    this.render();
    void selfTestCoordinator.run('ai-review', () => this.maybeSelfTest());
  }

  private async review(): Promise<void> {
    if (!this.ai.isEnabled()) {
      this.context.layout.showToast('AI is off — configure a provider to review code.', 'info');
      return;
    }
    if (this.running) return;
    const text = this.editor.activeText();
    if (!text || !text.trim()) {
      this.context.layout.showToast('Open a file to review.', 'info');
      return;
    }

    // Review the selection when there is one, else the whole file.
    const selection = this.editor.getSelections().find((s) => s.startLine !== s.endLine || s.startCharacter !== s.endCharacter);
    const lines = text.split('\n');
    let code = text;
    let baseLine = 1;
    if (selection) {
      baseLine = selection.startLine + 1;
      code = lines.slice(selection.startLine, selection.endLine + 1).join('\n');
    }

    this.running = true;
    this.reviewedFile = this.editor.currentFile();
    this.render();
    this.context.layout.showPanelView('ai-review');

    const fileName = this.baseName(this.reviewedFile);
    const { system, messages } = buildReviewMessages(code, fileName, baseLine);
    const result = await this.ai.complete(messages, { system, temperature: 0, maxTokens: 1500 });
    this.running = false;

    if (!result.ok) {
      this.render();
      this.context.layout.showToast(`Review failed: ${result.error ?? 'unknown error'}`, 'error');
      return;
    }

    const maxLine = baseLine + code.split('\n').length - 1;
    this.findings = parseReviewFindings(result.text, { minLine: baseLine, maxLine });
    this.editor.setDecorations(DECORATION_OWNER, findingsToDecorations(this.findings));
    this.render();
    this.updateStatus();
    if (this.findings.length === 0) {
      this.context.layout.showToast('AI review found no issues.', 'success');
    }
  }

  private clear(): void {
    this.findings = [];
    this.reviewedFile = null;
    this.editor.clearDecorations(DECORATION_OWNER);
    this.render();
    this.updateStatus();
  }

  private updateStatus(): void {
    if (!this.status) return;
    if (this.findings.length === 0) {
      this.status.removeItem('editor.aiReview');
      return;
    }
    const counts = countBySeverity(this.findings);
    this.status.setItem('editor.aiReview', {
      text: `🔎 ${counts.error}⛔ ${counts.warning}⚠ ${counts.info + counts.suggestion}💡`,
      tooltip: 'AI review findings — click to open the panel',
      command: CommandIds.AiReview,
      side: 'right',
      priority: 24,
    });
  }

  private render(): void {
    this.panel.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-review-toolbar';
    const run = document.createElement('button');
    run.className = 'znxstudio-btn-small';
    run.textContent = this.running ? 'Reviewing…' : '🔎 Review';
    run.disabled = this.running;
    run.addEventListener('click', () => void this.review());
    const clear = document.createElement('button');
    clear.className = 'znxstudio-btn-small';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => this.clear());
    const provider = document.createElement('span');
    provider.className = 'znxstudio-review-provider';
    provider.textContent = this.ai.isEnabled() ? this.ai.providerLabel() : 'AI off';
    toolbar.append(run, clear, provider);
    this.panel.appendChild(toolbar);

    if (this.running) {
      this.panel.appendChild(this.message(`Reviewing with ${this.ai.providerLabel()}…`));
      return;
    }
    if (!this.reviewedFile && this.findings.length === 0) {
      this.panel.appendChild(this.message('Run a review on the active file or selection.'));
      return;
    }
    if (this.findings.length === 0) {
      this.panel.appendChild(this.message('No issues found. 🎉'));
      return;
    }

    const counts = countBySeverity(this.findings);
    const summary = document.createElement('div');
    summary.className = 'znxstudio-review-summary';
    summary.textContent = `${this.findings.length} finding${this.findings.length === 1 ? '' : 's'} · ${counts.error} error · ${counts.warning} warning · ${counts.info + counts.suggestion} note in ${this.baseName(this.reviewedFile) ?? 'file'}`;
    this.panel.appendChild(summary);

    for (const finding of this.findings) {
      const row = document.createElement('div');
      row.className = `znxstudio-review-row is-${finding.severity}`;
      const icon = document.createElement('span');
      icon.className = 'znxstudio-review-icon';
      icon.textContent = SEVERITY_ICON[finding.severity];
      const line = document.createElement('span');
      line.className = 'znxstudio-review-line';
      line.textContent = `L${finding.line}`;
      const body = document.createElement('div');
      body.className = 'znxstudio-review-body';
      const title = document.createElement('div');
      title.className = 'znxstudio-review-title';
      title.textContent = finding.title;
      body.appendChild(title);
      if (finding.detail) {
        const detail = document.createElement('div');
        detail.className = 'znxstudio-review-detail';
        detail.textContent = finding.detail;
        body.appendChild(detail);
      }
      row.append(icon, line, body);
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Line ${finding.line}: ${finding.title}`);
      const reveal = (): void => this.editor.revealPosition(Math.max(0, finding.line - 1), 0);
      row.addEventListener('click', reveal);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          reveal();
        }
      });
      this.panel.appendChild(row);
    }
  }

  private message(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-review-empty';
    el.textContent = text;
    return el;
  }

  private baseName(path: string | null): string | null {
    return path ? path.split(/[\\/]/).pop() ?? path : null;
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

    const numbered = buildReviewMessages('function f\n    give back 1\nend', 'm.zx', 5);
    log(`review prompt startsAt5=${numbered.messages[0].content.includes('5: function f')} strictJson=${numbered.system.includes('ONLY a JSON array')}`);
    const noisy = 'Here are the findings:\n```json\n[{"line": 6, "severity": "Bug", "title": "off by one", "detail": "x"}, {"title":"", "line":1}]\n``` done';
    const parsed = parseReviewFindings(noisy, { minLine: 5, maxLine: 7 });
    log(`review parse: n=${parsed.length} first=${parsed[0]?.severity}@L${parsed[0]?.line} (Bug→error, blank dropped)`);
    const clamped = parseReviewFindings('[{"line":999,"severity":"nit","title":"t"}]', { minLine: 1, maxLine: 3 });
    log(`review clamp: line=${clamped[0]?.line} sev=${clamped[0]?.severity} decos=${findingsToDecorations(clamped).length}`);

    // REAL review — only if a provider is configured; otherwise honest skip.
    try {
      if (this.ai.isEnabled()) {
        const { system, messages } = buildReviewMessages('function divide with a, b\n    give back a / b\nend', 'm.zx', 1);
        const result = await this.ai.complete(messages, { system, temperature: 0, maxTokens: 600 });
        const findings = result.ok ? parseReviewFindings(result.text, { minLine: 1, maxLine: 3 }) : [];
        log(`review REAL: provider=${this.ai.providerId()} ok=${result.ok} findings=${findings.length} first=${JSON.stringify(findings[0]?.title ?? result.error ?? '')}`);
      } else {
        log('review REAL: no provider configured — skipped');
      }
    } catch (error) {
      log(`review REAL failed: ${(error as Error).message}`);
    }
  }
}
