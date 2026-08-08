import { ServiceKeys, type EditorService, type InputBoxService, type SecurityService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import type { SecurityFinding } from './findings';
import { buildSuppressionComment, indentOf, parseSuppressions, unjustifiedSuppressions } from './suppression';
import { needsRevocation, remediationSnippet, secretsOnly, secretsSummary, suggestedFieldName } from './secrets';

/**
 * Secrets (Phase 15A). Surfaces the two real secret rules — ZX3701 (a literal in
 * a key position, or a `secret` field with a literal default) and ZX3707 (a
 * literal shaped exactly like a provider credential) — and offers the two
 * actions the compiler can only describe in prose:
 *
 *   • Fix    — the `configuration … has x as secret` + `reveal` snippet.
 *   • Ignore — a `# zornux:suppress ZX37xx <reason>` directive, which the
 *              compiler honours ONLY when a justification is given.
 */
export class SecretsModule implements IModule {
  readonly id = 'znxstudio.security.secrets';
  readonly displayName = 'Secrets';

  private moduleContext!: ModuleContext;
  private security: SecurityService | undefined;
  private editor: EditorService | undefined;
  private panel!: HTMLElement;
  private readonly suppressing = new Set<string>();

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.security = context.services.tryGet<SecurityService>(ServiceKeys.Security);
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-secrets';
    context.layout.addPanelView({ id: 'security-secrets', title: 'Secrets', element: this.panel });

    context.commands.register(CommandIds.SecuritySecretsShow, () => this.reveal(), 'Security: Show Secrets');
    context.commands.register(CommandIds.SecuritySuppress, () => this.suppressAtCursor(), 'Security: Suppress Finding at Cursor');

    if (this.security) context.subscriptions.push(this.security.onDidChange(() => this.render()));
    this.render();
    void selfTestCoordinator.run('security-secrets', () => this.maybeSelfTest());
  }

  private reveal(): void {
    this.render();
    this.moduleContext.layout.showPanelView('security-secrets');
  }

  private secrets(): SecurityFinding[] {
    return secretsOnly(this.security?.findings() ?? []);
  }

  /** Insert a justified suppression directive on the line above a finding. */
  private async suppress(finding: SecurityFinding): Promise<void> {
    if (!this.editor) {
      this.moduleContext.layout.showToast('The editor is not available.', 'error');
      return;
    }
    const key = findingKey(finding);
    if (this.suppressing.has(key)) return;
    this.suppressing.add(key);
    this.render();
    try {
      const input = this.moduleContext.services.get<InputBoxService>(ServiceKeys.InputBox);
      const justification = await input.prompt({
        title: `Suppress ${finding.code}`,
        label: 'Why is this finding safe to ignore?',
        placeholder: 'Document the specific reason for this exception',
        submitLabel: 'Add Suppression',
        validate: (value) => value.trim().length >= 3
          ? null
          : 'Enter a meaningful justification (at least 3 characters).',
      });
      if (justification === null) return;

      const stillCurrent = this.security?.findings().some((entry) => findingKey(entry) === key) ?? false;
      if (!stillCurrent) {
        this.moduleContext.layout.showToast('This finding changed during the scan. Review the latest results before suppressing it.', 'info');
        return;
      }

      if (this.editor.currentFile() !== finding.file) await this.editor.openFile(finding.file);
      if (this.editor.currentFile() !== finding.file) throw new Error('The finding file could not be opened.');
      const text = this.editor.activeText() ?? '';
      const comment = buildSuppressionComment(finding.code, justification, indentOf(text, finding.startLine));

      // Put the caret at the start of the offending line; the inserted text ends
      // with a newline, so the directive lands on the line ABOVE it.
      this.editor.revealPosition(finding.startLine - 1, 0);
      this.editor.setSelections([
        { startLine: finding.startLine - 1, startCharacter: 0, endLine: finding.startLine - 1, endCharacter: 0 },
      ]);
      this.editor.insertText(`${comment}\n`);
      this.moduleContext.layout.showToast(`${finding.code} suppressed — rescan to confirm.`, 'info');
    } catch (error) {
      this.moduleContext.layout.showToast(`Could not add suppression: ${(error as Error).message}`, 'error');
    } finally {
      this.suppressing.delete(key);
      this.render();
    }
  }

  /** Palette entry point: suppress whichever finding sits on the caret's line. */
  private async suppressAtCursor(): Promise<void> {
    const file = this.editor?.currentFile();
    const position = this.editor?.cursorPosition();
    if (!file || !position) {
      this.moduleContext.layout.showToast('Open a file and place the caret on a finding.', 'info');
      return;
    }
    const line = position.line + 1;
    const finding = (this.security?.findings() ?? []).find((f) => f.file === file && f.startLine === line);
    if (!finding) {
      this.moduleContext.layout.showToast('No security finding on this line.', 'info');
      return;
    }
    await this.suppress(finding);
  }

  private render(): void {
    if (!this.panel) return;
    this.panel.replaceChildren();

    const secrets = this.secrets();
    const summary = secretsSummary(this.security?.findings() ?? []);

    const header = document.createElement('div');
    header.className = 'znxstudio-secrets-summary';
    header.textContent = secrets.length
      ? `${summary.total} secret(s) in ${summary.files} file(s) · ${summary.hardcoded} hardcoded · ${summary.patterns} recognizable credential(s)`
      : 'No secrets found. Scan a program from the Security panel.';
    this.panel.appendChild(header);

    if (summary.needRevocation) {
      const alert = document.createElement('div');
      alert.className = 'znxstudio-secrets-alert';
      alert.textContent = `${summary.needRevocation} live credential(s) found in source — treat them as leaked and revoke them, not just delete them.`;
      this.panel.appendChild(alert);
    }

    for (const finding of secrets) {
      this.panel.appendChild(this.renderFinding(finding));
    }

    this.appendSuppressionAudit();
  }

  private renderFinding(finding: SecurityFinding): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-secrets-row';

    const title = document.createElement('div');
    title.className = 'znxstudio-secrets-title';
    const badge = document.createElement('span');
    badge.className = `znxstudio-severity znxstudio-severity-${finding.severity.toLowerCase()}`;
    badge.textContent = finding.severity;
    const code = document.createElement('span');
    code.className = 'znxstudio-secrets-code';
    code.textContent = finding.code;
    const message = document.createElement('span');
    message.textContent = finding.message;
    title.append(badge, code, message);
    row.appendChild(title);

    const location = document.createElement('button');
    location.className = 'znxstudio-secrets-location';
    location.textContent = `${basename(finding.file)}:${finding.startLine}:${finding.startColumn}`;
    location.addEventListener('click', () => {
      void this.editor?.revealLocation(toUri(finding.file), finding.startLine - 1, finding.startColumn - 1);
    });
    row.appendChild(location);

    const why = document.createElement('div');
    why.className = 'znxstudio-secrets-why';
    why.textContent = finding.explanation;
    row.appendChild(why);

    const fix = document.createElement('div');
    fix.className = 'znxstudio-secrets-fix';
    fix.textContent = finding.suggestedFix;
    row.appendChild(fix);

    if (needsRevocation(finding)) {
      const revoke = document.createElement('div');
      revoke.className = 'znxstudio-secrets-revoke';
      revoke.textContent = '⚠ Revoke this credential — it must be treated as leaked.';
      row.appendChild(revoke);
    }

    const actions = document.createElement('div');
    actions.className = 'znxstudio-secrets-actions';

    const snippet = document.createElement('button');
    snippet.className = 'znxstudio-btn-small';
    snippet.textContent = 'Insert secret field';
    snippet.addEventListener('click', () => {
      const line = (this.editor?.activeText() ?? '').split('\n')[finding.startLine - 1];
      this.editor?.insertSnippet(remediationSnippet(suggestedFieldName(finding, line)));
    });

    const ignore = document.createElement('button');
    ignore.className = 'znxstudio-btn-small';
    ignore.textContent = this.suppressing.has(findingKey(finding)) ? 'Suppressing…' : 'Suppress…';
    ignore.disabled = this.suppressing.has(findingKey(finding));
    ignore.addEventListener('click', () => void this.suppress(finding));

    const docs = document.createElement('a');
    docs.className = 'znxstudio-secrets-docs';
    docs.textContent = 'docs';
    docs.href = finding.documentationUrl;
    docs.target = '_blank';
    docs.rel = 'noreferrer';

    actions.append(snippet, ignore, docs);
    row.appendChild(actions);
    return row;
  }

  /**
   * Directives that name a rule but give no reason silence nothing — the author
   * almost certainly believes they do, so say it out loud.
   */
  private appendSuppressionAudit(): void {
    const text = this.editor?.activeText();
    if (!text) return;
    const unjustified = unjustifiedSuppressions(parseSuppressions(text));
    if (!unjustified.length) return;

    const warning = document.createElement('div');
    warning.className = 'znxstudio-secrets-alert';
    warning.textContent = unjustified
      .map((s) => `Line ${s.directiveLine}: '${s.ruleId}' is suppressed without a reason, so it is NOT suppressed.`)
      .join(' ');
    this.panel.appendChild(warning);
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

    const source = [
      'import crypto',
      '# zornux:suppress ZX3701 fixture key, never shipped',
      'show crypto.hmac("first", "m")',
      'show crypto.hmac("second", "m") # zornux:suppress ZX3701 also a fixture',
      '# zornux:suppress ZX3702',
      'show 1',
    ].join('\n');
    const suppressions = parseSuppressions(source);
    log(
      `secrets suppression parse: ${suppressions.length} directives ` +
        `own-line→line ${suppressions[0]?.line}, inline→line ${suppressions[1]?.line}, ` +
        `unjustified=${unjustifiedSuppressions(suppressions).length} (silences nothing)`,
    );
    log(`secrets remediation: ${remediationSnippet('api_key').split('\n')[1].trim()}`);
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function toUri(path: string): string {
  return `file:///${path.replace(/\\/g, '/')}`;
}

function findingKey(finding: SecurityFinding): string {
  return `${finding.file}:${finding.startLine}:${finding.startColumn}:${finding.code}`;
}
