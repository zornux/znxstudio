import {
  ServiceKeys,
  type AiService,
  type CompilerService,
  type EditorService,
  type TrustService,
  type WorkspaceService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { LanguageServiceKeys, type Diagnostic, type DiagnosticsReader } from '../language/api';
import {
  applyFix,
  buildFixContext,
  buildFixMessages,
  extractRegion,
  parseFixResponse,
  summarizeFix,
  type FixContext,
  type FixProposal,
} from './fixassist';
import { type DiffLine } from './refactor';

/**
 * Fix with AI (Phase 10I). Bridges the compiler's real diagnostics and the AI
 * assistant: the user selects a diagnostic — from the Problems panel, from the
 * inline error lens, or from the nearest-to-cursor position — and AI proposes
 * a concrete fix as a reviewable diff. The compiler remains authoritative; AI
 * explains and proposes, the developer reviews.
 */
export class FixAssistModule implements IModule {
  readonly id = 'znxstudio.ai.fix';
  readonly displayName = 'Fix with AI';

  private context!: ModuleContext;
  private ai!: AiService;
  private editor!: EditorService;
  private overlay: HTMLElement | undefined;
  private running = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.ai = context.services.get<AiService>(ServiceKeys.Ai);
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);

    context.commands.register(CommandIds.AiFixError, () => this.fixNearest(), 'AI: Fix Error');
    void selfTestCoordinator.run('ai-fix', () => this.maybeSelfTest());
  }

  /** Fix the diagnostic nearest the cursor in the active file. */
  async fixNearest(): Promise<void> {
    if (this.running) {
      this.context.layout.showToast('A fix is already being generated.', 'info');
      return;
    }
    if (!this.ai.isEnabled()) {
      this.context.layout.showToast('AI is off — configure a provider to fix errors.', 'info');
      return;
    }

    const source = this.editor.activeText();
    const filePath = this.editor.currentFile();
    if (!source || !filePath) {
      this.context.layout.showToast('Open a file to fix an error.', 'info');
      return;
    }

    const diagnostic = await this.findNearestDiagnostic(source, filePath);
    if (!diagnostic) {
      this.context.layout.showToast('No compiler errors to fix in this file.', 'success');
      return;
    }

    await this.proposeFix(diagnostic, source, filePath);
  }

  /** Fix a specific diagnostic (called from Problems panel integration). */
  async fixDiagnostic(
    code: string,
    message: string,
    severity: string,
    file: string,
    line1: number,
    hint?: string,
  ): Promise<void> {
    if (this.running) return;
    if (!this.ai.isEnabled()) {
      this.context.layout.showToast('AI is off — configure a provider.', 'info');
      return;
    }

    // Open the file and read its source
    await this.editor.openFile(file);
    const source = this.editor.activeText();
    if (!source) {
      this.context.layout.showToast('Could not read file source.', 'error');
      return;
    }

    const ctx = buildFixContext(code, message, severity, file, line1, source, hint);
    await this.generateFix(ctx);
  }

  private async findNearestDiagnostic(
    source: string,
    filePath: string,
  ): Promise<FixContext | null> {
    // Try the live language diagnostics first
    const engine = this.context.services.tryGet<DiagnosticsReader>(LanguageServiceKeys.Diagnostics);
    const uri = this.editor.currentUri();
    if (engine && uri) {
      const diagnostics = engine.get(uri);
      const errors = diagnostics.filter((d) => d.severity === 'error');
      const pool = errors.length ? errors : diagnostics;
      if (pool.length) {
        const cursor = this.editor.cursorPosition();
        const cursorLine = (cursor?.line ?? 0) + 1;
        let best = pool[0];
        let bestDist = Math.abs(pool[0].range.start.line + 1 - cursorLine);
        for (const d of pool) {
          const dist = Math.abs(d.range.start.line + 1 - cursorLine);
          if (dist < bestDist) {
            best = d;
            bestDist = dist;
          }
        }
        return buildFixContext(
          best.code ?? 'unknown',
          best.message,
          best.severity,
          filePath,
          best.range.start.line + 1,
          source,
          best.hint,
        );
      }
    }

    // Fall back to a fresh compiler check
    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    if (!compiler) return null;
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    const result = await compiler.check({
      uri: uri ?? 'inmemory://fix',
      path: filePath,
      source,
      isDirty: true,
      workspaceRoot: workspace?.currentFolder() ?? null,
    });
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    const pool = errors.length ? errors : result.diagnostics;
    if (!pool.length) return null;
    const cursor = this.editor.cursorPosition();
    const cursorLine = (cursor?.line ?? 0) + 1;
    let best = pool[0];
    let bestDist = Math.abs(pool[0].range.start.line - cursorLine);
    for (const d of pool) {
      const dist = Math.abs(d.range.start.line - cursorLine);
      if (dist < bestDist) {
        best = d;
        bestDist = dist;
      }
    }
    return buildFixContext(
      best.code,
      best.message,
      best.severity,
      filePath,
      best.range.start.line,
      source,
      best.help,
    );
  }

  private async proposeFix(ctx: FixContext, source: string, filePath: string): Promise<void> {
    await this.generateFix(ctx);
  }

  private async generateFix(ctx: FixContext): Promise<void> {
    this.running = true;
    const progress = this.makeModal(`Fixing [${ctx.code}]…`);
    const status = document.createElement('div');
    status.className = 'znxstudio-ai-diff-status';
    status.textContent = `Asking ${this.ai.providerLabel()} for a fix…`;
    progress.box.appendChild(status);
    document.body.appendChild(progress.overlay);

    const { system, messages } = buildFixMessages(ctx);
    let result;
    try {
      result = await this.ai.complete(messages, { system, temperature: 0, maxTokens: 1200 });
    } catch (error) {
      this.running = false;
      this.close();
      this.context.layout.showToast(`Fix failed: ${(error as Error).message}`, 'error');
      return;
    }

    this.running = false;
    this.close();

    if (!result.ok) {
      this.context.layout.showToast(`Fix failed: ${result.error ?? 'unknown error'}`, 'error');
      return;
    }

    const originalRegion = extractRegion(ctx.source, ctx.line);
    const proposal = parseFixResponse(result.text, originalRegion);

    if (proposal.added === 0 && proposal.removed === 0) {
      this.context.layout.showToast('AI could not find a fix for this diagnostic.', 'info');
      return;
    }

    this.showFixPreview(ctx, proposal);
  }

  private showFixPreview(ctx: FixContext, proposal: FixProposal): void {
    const { overlay, box } = this.makeModal(`Fix [${ctx.code}] — preview`);
    box.classList.add('is-wide');

    // Explanation
    const explanation = document.createElement('div');
    explanation.className = 'znxstudio-fixai-explanation';
    explanation.textContent = proposal.explanation;
    box.appendChild(explanation);

    // Diff stats
    const meta = document.createElement('div');
    meta.className = 'znxstudio-ai-diff-meta';
    meta.innerHTML = `<span class="znxstudio-ai-diff-add">+${proposal.added}</span> <span class="znxstudio-ai-diff-del">−${proposal.removed}</span> · ${this.ai.providerLabel()}`;
    box.appendChild(meta);

    // Diff view
    box.appendChild(this.renderDiff(proposal.diff));

    // Actions
    const actions = document.createElement('div');
    actions.className = 'znxstudio-ai-diff-actions';

    const apply = document.createElement('button');
    apply.className = 'znxstudio-btn primary';
    apply.textContent = 'Apply Fix';
    apply.addEventListener('click', () => {
      this.applyFixToEditor(ctx, proposal);
      this.close();
    });

    const cancel = document.createElement('button');
    cancel.className = 'znxstudio-btn';
    cancel.textContent = 'Dismiss';
    cancel.addEventListener('click', () => this.close());

    const copy = document.createElement('button');
    copy.className = 'znxstudio-btn';
    copy.textContent = 'Copy Fix';
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(proposal.rewritten);
      this.context.layout.showToast('Fixed code copied.', 'success');
    });

    actions.append(cancel, copy, apply);
    box.appendChild(actions);

    document.body.appendChild(overlay);
    apply.focus();
  }

  private applyFixToEditor(ctx: FixContext, proposal: FixProposal): void {
    const currentSource = this.editor.activeText();
    if (!currentSource) {
      this.context.layout.showToast('File is no longer open.', 'error');
      return;
    }
    if (currentSource !== ctx.source) {
      this.context.layout.showToast('File has changed since the fix was generated. Please regenerate.', 'error');
      return;
    }

    const originalRegion = extractRegion(ctx.source, ctx.line);
    const fixed = applyFix(currentSource, ctx.line, originalRegion, proposal.rewritten);

    // Select all and replace — single undo step
    const lines = currentSource.split('\n');
    this.editor.setSelections([{
      startLine: 0,
      startCharacter: 0,
      endLine: lines.length - 1,
      endCharacter: lines[lines.length - 1].length,
    }]);
    this.editor.insertText(fixed);

    this.context.layout.showToast(`Applied fix for [${ctx.code}].`, 'success');
  }

  private renderDiff(diff: DiffLine[]): HTMLElement {
    const pre = document.createElement('div');
    pre.className = 'znxstudio-ai-diff';
    for (const line of diff) {
      const row = document.createElement('div');
      row.className = `znxstudio-ai-diff-line is-${line.type}`;
      const gutter = document.createElement('span');
      gutter.className = 'znxstudio-ai-diff-gutter';
      gutter.textContent = line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ';
      const text = document.createElement('span');
      text.className = 'znxstudio-ai-diff-text';
      text.textContent = line.text.length ? line.text : ' ';
      row.append(gutter, text);
      pre.appendChild(row);
    }
    return pre;
  }

  /* ----- modal plumbing ----- */
  private makeModal(title: string): { overlay: HTMLElement; box: HTMLElement } {
    this.close();
    const overlay = document.createElement('div');
    overlay.className = 'znxstudio-ai-modal';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) this.close();
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
    const box = document.createElement('div');
    box.className = 'znxstudio-ai-modal-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const heading = document.createElement('div');
    heading.className = 'znxstudio-ai-modal-title';
    heading.textContent = title;
    box.appendChild(heading);
    overlay.appendChild(box);
    this.overlay = overlay;
    return { overlay, box };
  }

  private close(): void {
    this.overlay?.remove();
    this.overlay = undefined;
  }

  /* ----- optional self-test ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    const ctx = buildFixContext(
      'ZX0110',
      'reserved word used as identifier',
      'error',
      'test.zx',
      1,
      'function add with a\n    give back a\nend',
    );
    log(`fixai context: code=${ctx.code} line=${ctx.line} hasSnippet=${Boolean(ctx.snippet)}`);

    const { system, messages } = buildFixMessages(ctx);
    log(`fixai prompt: hasCode=${messages[0].content.includes('ZX0110')} hasFix=${system.includes('FIXED')}`);

    const region = extractRegion(ctx.source, 1);
    const proposal = parseFixResponse(
      'EXPLANATION: The function name `add` is reserved.\n\n```\nfunction sum with a\n    give back a\nend\n```',
      region,
    );
    log(`fixai parse: explanation=${JSON.stringify(proposal.explanation.slice(0, 40))} added=${proposal.added} removed=${proposal.removed} hasDiff=${proposal.diff.length > 0}`);
    log(`fixai summary: ${summarizeFix(proposal)}`);
  }
}
