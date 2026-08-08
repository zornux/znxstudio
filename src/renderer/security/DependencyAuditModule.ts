import { ServiceKeys, type EditorService, type SecurityService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { joinPath } from '../explorer/paths';
import type { SecurityFinding } from './findings';
import {
  ADVISORY_FEED_FILE,
  auditSummary,
  dependencyFindings,
  parseAdvisoryFeed,
  parseAuditNotes,
  parseDeclaredDependencies,
  parseLockFile,
  renderAdvisoryFeed,
  resolveDependencies,
  upgradeCommandFor,
  type Advisory,
  type AuditNotes,
  type ResolvedDependency,
} from './advisories';

const PROJECT_FILE = 'zornux.project';
const LOCK_FILE = 'zornux.lock';

/**
 * Dependency audit (Phase 15C), rebuilt on Zornux rc.4.
 *
 * The compiler now owns the audit: `zornux check --security --advisories <feed>`
 * matches the resolved lockfile against the feed and emits real ZX3709 findings,
 * and exits non-zero on them. This panel READS those findings — it no longer
 * matches versions itself, because two implementations of the same rule would
 * eventually disagree, and the compiler is the one that fails a build.
 *
 * What it still owns: showing the dependency list, showing what is in the feed,
 * and surfacing the notes the CLI writes to stderr about what it could NOT audit.
 */
export class DependencyAuditModule implements IModule {
  readonly id = 'znxstudio.security.dependencies';
  readonly displayName = 'Dependencies';

  private moduleContext!: ModuleContext;
  private workspace: WorkspaceService | undefined;
  private editor: EditorService | undefined;
  private security: SecurityService | undefined;
  private panel!: HTMLElement;
  private dependencies: ResolvedDependency[] = [];
  private feed: Advisory[] = [];
  private notes: AuditNotes = { unaudited: [], problems: [] };
  private feedFound = false;
  private projectFound = false;
  private lockFound = false;
  private scanned = false;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    this.security = context.services.tryGet<SecurityService>(ServiceKeys.Security);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-depaudit';
    context.layout.addPanelView({ id: 'security-dependencies', title: 'Dependencies', element: this.panel });

    context.commands.register(CommandIds.SecurityDependenciesShow, () => this.reveal(), 'Security: Show Dependency Audit');
    context.commands.register(CommandIds.SecurityDependencyAudit, () => this.audit(), 'Security: Audit Dependencies');

    this.workspace?.onDidChangeWorkspace(() => void this.reload());
    // Findings arrive with every scan, so the panel follows the scanner.
    if (this.security) context.subscriptions.push(this.security.onDidChange(() => void this.reload()));

    this.render();
    void this.reload();
    void selfTestCoordinator.run('security-dependencies', () => this.maybeSelfTest());
  }

  /** The ZX3709 findings the COMPILER reported in the last scan. */
  vulnerabilities(): SecurityFinding[] {
    return dependencyFindings(this.security?.findings() ?? []);
  }

  private reveal(): void {
    this.render();
    this.moduleContext.layout.showPanelView('security-dependencies');
  }

  private async readFile(root: string, name: string): Promise<string | null> {
    try {
      return await window.znxstudio.fs.readFile(joinPath(root, name));
    } catch {
      return null;
    }
  }

  /** Read the workspace files the panel displays. The audit itself is the compiler's. */
  private async reload(): Promise<void> {
    const root = this.workspace?.currentFolder();
    this.dependencies = [];
    this.feed = [];
    this.projectFound = false;
    this.lockFound = false;
    this.feedFound = false;

    if (root) {
      const [project, lock, feed] = await Promise.all([
        this.readFile(root, PROJECT_FILE),
        this.readFile(root, LOCK_FILE),
        this.readFile(root, ADVISORY_FEED_FILE),
      ]);
      this.projectFound = project !== null;
      this.lockFound = lock !== null;
      this.feedFound = feed !== null;
      if (project) this.dependencies = resolveDependencies(parseDeclaredDependencies(project), lock ? parseLockFile(lock) : []);
      if (feed) this.feed = parseAdvisoryFeed(feed);
    }

    // The CLI's "could not audit" notes live on stderr, once per scanned file.
    const results = this.security?.results() ?? [];
    this.scanned = results.length > 0;
    const unaudited = new Set<string>();
    const problems = new Set<string>();
    for (const result of results) {
      const notes = parseAuditNotes(result.output);
      for (const name of notes.unaudited) unaudited.add(name);
      for (const problem of notes.problems) problems.add(problem);
    }
    this.notes = { unaudited: [...unaudited], problems: [...problems] };

    this.render();
  }

  /** Auditing means scanning: the compiler does it, so ask the scanner to run. */
  private async audit(): Promise<void> {
    if (!this.feedFound) {
      this.moduleContext.layout.showToast(`Add a ${ADVISORY_FEED_FILE} to audit dependencies.`, 'info');
      return;
    }
    await this.security?.scanWorkspace();
  }

  private render(): void {
    if (!this.panel) return;
    this.panel.replaceChildren();

    if (!this.projectFound) {
      this.panel.appendChild(note(`No ${PROJECT_FILE} in this folder — nothing to audit.`, 'znxstudio-depaudit-note'));
      return;
    }

    const findings = this.vulnerabilities();
    const summary = auditSummary(this.dependencies, findings, this.notes);
    this.panel.appendChild(
      note(
        `${summary.dependencies} declared dependency(ies) · ${summary.vulnerable} vulnerable · ` +
          `${summary.blocking} would fail the build · ${summary.fixable} fixable`,
        'znxstudio-depaudit-summary',
      ),
    );

    // Say exactly why an audit may be incomplete, rather than reporting a
    // reassuring zero.
    if (!this.feedFound) {
      this.panel.appendChild(
        note(
          `No ${ADVISORY_FEED_FILE} — the compiler runs its ZX3709 rule only when given an advisory feed, ` +
            'so no dependency was checked. Add a feed and rescan.',
          'znxstudio-depaudit-warn',
        ),
      );
      this.panel.appendChild(button('＋ Create an advisory feed', () => void this.createFeed()));
    } else {
      this.panel.appendChild(
        note(`Advisory feed: ${this.feed.length} advisory(ies) from ${ADVISORY_FEED_FILE}, passed to the compiler.`, 'znxstudio-depaudit-note'),
      );
    }

    if (!this.lockFound) {
      this.panel.appendChild(
        note(`No ${LOCK_FILE} — run \`zornux restore\` so the compiler knows which versions resolved.`, 'znxstudio-depaudit-warn'),
      );
    }

    // The compiler's own words about what it could not judge.
    for (const name of this.notes.unaudited) {
      this.panel.appendChild(
        note(`'${name}' has no ${LOCK_FILE} entry, so it was not audited — not judged safe.`, 'znxstudio-depaudit-warn'),
      );
    }
    for (const problem of this.notes.problems) {
      this.panel.appendChild(note(`Feed problem: ${problem}`, 'znxstudio-depaudit-warn'));
    }

    const refresh = document.createElement('button');
    refresh.className = 'znxstudio-btn-small';
    refresh.textContent = this.feedFound ? '⟳ Re-audit (runs the compiler)' : '⟳ Refresh';
    refresh.addEventListener('click', () => void (this.feedFound ? this.audit() : this.reload()));
    this.panel.appendChild(refresh);

    for (const finding of findings) this.panel.appendChild(this.renderFinding(finding));

    if (this.feedFound && this.scanned && !findings.length) {
      this.panel.appendChild(note('The compiler matched no dependency against this feed.', 'znxstudio-depaudit-note'));
    } else if (this.feedFound && !this.scanned) {
      this.panel.appendChild(note('Not scanned yet — run the audit to let the compiler check the lockfile.', 'znxstudio-depaudit-note'));
    }

    this.panel.appendChild(this.renderDependencyList(findings));
  }

  private renderFinding(finding: SecurityFinding): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-depaudit-row';

    const title = document.createElement('div');
    title.className = 'znxstudio-depaudit-title';
    const badge = document.createElement('span');
    badge.className = `znxstudio-severity znxstudio-severity-${finding.severity.toLowerCase()}`;
    badge.textContent = finding.severity;
    const code = document.createElement('span');
    code.className = 'znxstudio-depaudit-code';
    code.textContent = finding.code;
    const message = document.createElement('span');
    message.textContent = finding.message;
    title.append(badge, code, message);
    row.appendChild(title);

    row.appendChild(note(finding.explanation, 'znxstudio-depaudit-why'));
    row.appendChild(note(finding.suggestedFix, 'znxstudio-depaudit-fix'));

    const actions = document.createElement('div');
    actions.className = 'znxstudio-depaudit-actions';

    // A ZX3709 finding has no meaningful source span — it is about the project,
    // not a line of code — so there is nothing honest to reveal. Show the
    // manifest instead.
    const reveal = document.createElement('button');
    reveal.className = 'znxstudio-btn-small';
    reveal.textContent = `Open ${PROJECT_FILE}`;
    reveal.addEventListener('click', () => void this.openManifest());
    actions.appendChild(reveal);

    const upgrade = upgradeCommandFor(finding);
    if (upgrade) {
      const command = document.createElement('code');
      command.className = 'znxstudio-depaudit-command';
      command.textContent = upgrade;
      command.title = 'Run this in a terminal to upgrade.';
      actions.appendChild(command);
    }

    const docs = document.createElement('a');
    docs.className = 'znxstudio-depaudit-docs';
    docs.textContent = 'advisory';
    docs.href = finding.documentationUrl;
    docs.target = '_blank';
    docs.rel = 'noreferrer';
    actions.appendChild(docs);

    row.appendChild(actions);
    return row;
  }

  private renderDependencyList(findings: SecurityFinding[]): HTMLElement {
    const vulnerable = new Set(findings.map((f) => /^'([^']+)'/.exec(f.message)?.[1]?.toLowerCase()));
    const unaudited = new Set(this.notes.unaudited.map((n) => n.toLowerCase()));

    const list = document.createElement('div');
    list.className = 'znxstudio-depaudit-list';
    for (const dependency of this.dependencies) {
      const item = document.createElement('button');
      item.className = 'znxstudio-depaudit-dep';
      const key = dependency.name.toLowerCase();
      const mark = vulnerable.has(key) ? '⚠' : unaudited.has(key) ? '?' : '•';
      item.textContent = `${mark} ${dependency.name} ${dependency.constraint} → ${dependency.version ?? 'unresolved'}`;
      item.addEventListener('click', () => void this.openManifest(dependency.line));
      list.appendChild(item);
    }
    return list;
  }

  private async openManifest(line = 1): Promise<void> {
    const root = this.workspace?.currentFolder();
    if (!root || !this.editor) return;
    await this.editor.revealLocation(`file:///${`${root}\\${PROJECT_FILE}`.replace(/\\/g, '/')}`, line - 1, 0);
  }

  private async createFeed(): Promise<void> {
    const root = this.workspace?.currentFolder();
    if (!root) return;
    const content = renderAdvisoryFeed([
      {
        package: 'ExamplePackage',
        affected: '<1.2.0',
        severity: 'error',
        id: 'CVE-0000-0000',
        summary: 'Replace this entry with advisories from your organisation.',
        url: 'https://zornux.dev/security/advisories',
        fixed: '1.2.0',
      },
    ]);
    try {
      await window.znxstudio.fs.writeFile(joinPath(root, ADVISORY_FEED_FILE), content);
      this.moduleContext.layout.showToast(`Wrote ${ADVISORY_FEED_FILE}. It is read from disk, never fetched.`, 'info');
      await this.reload();
    } catch (error) {
      this.moduleContext.layout.showToast(`Could not write the feed: ${(error as Error).message}`, 'error');
    }
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    let tempDir = '';
    try {
      const info = await window.znxstudio.app.getInfo();
      enabled = info.selftest === true;
      tempDir = info.tempDir;
    } catch {
      enabled = false;
    }
    if (!enabled || !tempDir || !this.security) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    // Pure parsers first: the compiler's feed schema, and the notes it writes to stderr.
    const feed = parseAdvisoryFeed(
      JSON.stringify({
        advisories: [
          { Package: 'Greetings', Affected: '<1.2.0', Severity: 'Error', Id: 'CVE-2026-0001', Summary: 's', Fixed: '1.2.0' },
          { package: 'NoRange' },
        ],
      }),
    );
    log(`dependency feed (compiler schema, case-insensitive): parsed=${feed.length} first=${feed[0]?.package}@${feed[0]?.affected} fixed=${feed[0]?.fixed}`);

    const notes = parseAuditNotes(
      "note: 'Greetings' has no 'zornux.lock' entry, so its version is unknown - it was not audited for advisories, not judged safe.\n" +
        "warning: advisory 'CVE-1' for 'X' has an affected range '< 1.2.0' I couldn't parse - it matched nothing.\n",
    );
    log(`dependency CLI notes: unaudited=[${notes.unaudited}] problems=${notes.problems.length}`);

    log('dependency audit: ZnxStudio NO LONGER matches versions — `zornux check --security --advisories` does, and it fails the build.');
  }
}

function note(text: string, className: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}

function button(label: string, onClick: () => void): HTMLElement {
  const element = document.createElement('button');
  element.className = 'znxstudio-btn-small';
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}
