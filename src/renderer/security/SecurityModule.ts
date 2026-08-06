import {
  ServiceKeys,
  type CompilerService,
  type EditorService,
  type SecurityScanState,
  type SecurityService,
  type SettingsService,
  type StatusService,
  type ToolchainService,
  type WorkspaceService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import { capabilityEnabled, capabilityStatus } from '../toolchain/capabilityGuard';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { captureTask } from '../database/runCapture';
import { LIVE_SECURITY_CAVEAT } from '../language/lsp/lspSecurity';
import { ADVISORY_FEED_FILE } from './advisories';
import {
  blocksBuild,
  buildSecurityArgs,
  countBySeverity,
  parseScanResult,
  sortFindings,
  type ScanResult,
  type SecurityFinding,
} from './findings';

/** Cap a workspace scan so a huge tree cannot spawn thousands of subprocesses. */
const MAX_WORKSPACE_FILES = 200;

/**
 * Security hub (Phase 15). Drives the REAL
 * `zornux check <file> --security [--advisories <feed>] --json` CLI (rc.4),
 * parses its findings, and shares them with the Secrets / Scanner /
 * Dependencies / Rules / Dashboard views. Nothing is simulated: every finding
 * shown came from the Zornux security analyzer.
 *
 * The analyzer runs only on programs that compile, so a file with errors is
 * reported as UNANALYZED rather than clean — the views say so plainly.
 *
 * This CLI scan is the AUTHORITY (it is what fails a build). The live
 * as-you-type findings from `zornux lsp` are a preview with different rules —
 * see `language/lsp/lspSecurity.ts` — and the toggle here says so.
 */
export class SecurityModule implements IModule, SecurityService {
  readonly id = 'znxstudio.security';
  readonly displayName = 'Security';

  private moduleContext!: ModuleContext;
  private editor: EditorService | undefined;
  private workspace: WorkspaceService | undefined;
  private statusBar: StatusService | undefined;
  private view!: HTMLElement;
  private scans: ScanResult[] = [];
  private scanState: SecurityScanState = { running: false, scope: null, scanned: 0 };
  private readonly changeEmitter = new Emitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    this.workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    this.statusBar = context.services.tryGet<StatusService>(ServiceKeys.Status);
    context.services.register(ServiceKeys.Security, this);

    this.view = document.createElement('div');
    this.view.className = 'znxstudio-security';
    context.layout.addActivityItem({ id: 'security', label: 'Security', icon: '🛡', onSelect: () => this.reveal() });
    context.commands.register(CommandIds.SecurityShow, () => this.reveal(), 'Security: Show');
    context.commands.register(CommandIds.SecurityScanFile, () => void this.scanActiveFile(), 'Security: Scan File');
    context.commands.register(CommandIds.SecurityScanWorkspace, () => void this.scanWorkspace(), 'Security: Scan Workspace');

    this.render();
    void selfTestCoordinator.run('security', () => this.maybeSelfTest());
  }

  /* ----- SecurityService ----- */
  results(): ScanResult[] {
    return this.scans;
  }

  findings(): SecurityFinding[] {
    return sortFindings(this.scans.flatMap((s) => s.findings));
  }

  state(): SecurityScanState {
    return this.scanState;
  }

  async scanFile(file: string): Promise<ScanResult | null> {
    const result = await this.runScan([file], 'file');
    return result[0] ?? null;
  }

  async scanWorkspace(): Promise<ScanResult[]> {
    const root = this.workspace?.currentFolder();
    if (!root) {
      this.moduleContext.layout.showToast('Open a folder to scan.', 'info');
      return [];
    }
    let files: string[] = [];
    try {
      files = (await window.znxstudio.search.files(root)).filter((f) => f.toLowerCase().endsWith('.zx'));
    } catch {
      files = [];
    }
    if (!files.length) {
      this.moduleContext.layout.showToast('No .zx programs found in this folder.', 'info');
      return [];
    }
    const capped = files.slice(0, MAX_WORKSPACE_FILES);
    if (capped.length < files.length) {
      this.moduleContext.layout.showToast(`Scanning the first ${MAX_WORKSPACE_FILES} of ${files.length} programs.`, 'info');
    }
    return this.runScan(capped, 'workspace');
  }

  private async scanActiveFile(): Promise<void> {
    const file = this.editor?.currentFile();
    if (!file || !file.toLowerCase().endsWith('.zx')) {
      this.moduleContext.layout.showToast('Open a .zx program to scan.', 'info');
      return;
    }
    await this.scanFile(file);
  }

  /**
   * The workspace's advisory feed, or null. Passing it makes the compiler run its
   * ZX3709 rule (rc.4); without it the rule never runs, and ZnxStudio must not
   * pretend to have audited dependencies.
   */
  private async advisoryFeed(): Promise<string | null> {
    const root = this.workspace?.currentFolder();
    if (!root) return null;
    const path = `${root}\\${ADVISORY_FEED_FILE}`;
    try {
      await window.znxstudio.fs.readFile(path);
      return path;
    } catch {
      return null;
    }
  }

  /**
   * Run the real CLI once per file. `check` reads `security.*` settings from the
   * `zornux.project` beside the program, so each scan runs in that program's
   * own directory.
   */
  private async runScan(files: string[], scope: 'file' | 'workspace'): Promise<ScanResult[]> {
    if (this.scanState.running) return [];
    const compiler = this.moduleContext.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const info = compiler ? await compiler.info() : null;
    if (!info?.available || !info.path) {
      this.moduleContext.layout.showToast('Zornux compiler unavailable.', 'error');
      return [];
    }

    // Capability gate: the security analyzer must be advertised by the toolchain.
    const toolchain = this.moduleContext.services.tryGet<ToolchainService>(ServiceKeys.Toolchain);
    const tc = toolchain ? await toolchain.info() : null;
    if (tc) {
      const status = capabilityStatus(tc, 'securityDiagnostics', 'Security analysis');
      if (!status.enabled) {
        this.moduleContext.layout.showToast(status.reason ?? 'Security analysis is unavailable.', 'error');
        return [];
      }
    }

    this.scanState = { running: true, scope, scanned: 0 };
    this.render();
    this.updateStatusBar(); // show "scanning…" progress while it runs
    this.changeEmitter.fire();

    // The dependency advisory audit (ZX3709 via --advisories) is a separate
    // capability; only pass the feed when the toolchain supports it.
    const feed = capabilityEnabled(tc, 'advisoryAudit') ? await this.advisoryFeed() : null;
    const quote = (arg: string) => (arg.includes(' ') ? `"${arg}"` : arg);
    const results: ScanResult[] = [];
    for (const file of files) {
      const cwd = file.replace(/[\\/][^\\/]*$/, '');
      const command = `"${info.path}" ${buildSecurityArgs(file, true, feed).map(quote).join(' ')}`;
      const { output } = await captureTask(command, cwd);
      results.push(parseScanResult(output, file));
      this.scanState = { ...this.scanState, scanned: results.length };
    }

    this.scans = results;
    this.scanState = { running: false, scope, scanned: results.length };
    this.render();
    this.updateStatusBar();
    this.changeEmitter.fire();
    return results;
  }

  /* ----- UI ----- */
  private reveal(): void {
    this.render();
    this.moduleContext.layout.setSideBar('Security', this.view);
    this.moduleContext.layout.focusSideBar();
  }

  private updateStatusBar(): void {
    if (!this.statusBar) return;
    // Contextual (SB-2): the status bar shows scan PROGRESS only while a scan is
    // running. Results live in the Security dashboard (workspace / palette), not
    // as a permanent status-bar chip.
    if (!this.scanState.running) {
      this.statusBar.removeItem('editor.security');
      return;
    }
    const scope = this.scanState.scope === 'workspace' ? 'workspace' : 'file';
    this.statusBar.setItem('editor.security', {
      text: `🛡 scanning ${scope}… (${this.scanState.scanned})`,
      tooltip: 'Security scan in progress',
      command: CommandIds.SecurityShow,
      side: 'right',
      priority: 24,
    });
  }

  private render(): void {
    if (!this.view) return;
    this.view.replaceChildren();

    const header = document.createElement('div');
    header.className = 'znxstudio-security-header';
    header.textContent = '🛡 Security';
    this.view.appendChild(header);

    for (const { label, run } of [
      { label: '🔍 Scan File', run: () => void this.scanActiveFile() },
      { label: '📂 Scan Workspace', run: () => void this.scanWorkspace() },
    ]) {
      const button = document.createElement('button');
      button.className = 'znxstudio-btn-small znxstudio-security-action';
      button.textContent = this.scanState.running ? `Scanning… (${this.scanState.scanned})` : label;
      button.disabled = this.scanState.running;
      button.addEventListener('click', run);
      this.view.appendChild(button);
    }

    this.view.appendChild(this.renderLiveToggle());

    const summary = document.createElement('div');
    summary.className = 'znxstudio-security-summary';
    if (!this.scans.length) {
      summary.textContent =
        'Scan a program to run the Zornux security analyzer. Findings appear in the Secrets / Scanner / Dependencies / Dashboard panels.';
    } else {
      const findings = this.findings();
      const counts = countBySeverity(findings);
      const unanalyzed = this.scans.filter((s) => !s.analyzed).length;
      summary.textContent = findings.length
        ? `${this.scans.length} file(s) · ${counts.Critical} critical · ${counts.Error} error · ${counts.Warning} warning · ${counts.Info} info`
        : `${this.scans.length} file(s) scanned · no findings`;
      if (unanalyzed) {
        const note = document.createElement('div');
        note.className = 'znxstudio-security-note';
        note.textContent = `${unanalyzed} file(s) did not compile — the security analyzer never ran on them.`;
        this.view.appendChild(summary);
        this.view.appendChild(note);
        this.appendVerdict(findings);
        return;
      }
    }
    this.view.appendChild(summary);
    this.appendVerdict(this.findings());
  }

  /**
   * Live findings come from `zornux lsp`, not from this panel's CLI scan. They
   * are a fast preview: the server never reads `zornux.project`, so every rule
   * runs at its authored severity, and it never reports a vulnerable dependency.
   * Say that here rather than let the two disagree silently.
   */
  private renderLiveToggle(): HTMLElement {
    const settings = this.moduleContext.services.tryGet<SettingsService>(ServiceKeys.Settings);
    const wrapper = document.createElement('div');
    wrapper.className = 'znxstudio-security-live';

    const label = document.createElement('label');
    label.className = 'znxstudio-security-toggle';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = settings?.get<boolean>('zornux.lsp.security', false) ?? false;
    box.addEventListener('change', () => void this.moduleContext.commands.execute(CommandIds.LspToggleSecurity));
    const text = document.createElement('span');
    text.textContent = 'Live diagnostics as you type';
    label.append(box, text);
    wrapper.appendChild(label);

    const caveat = document.createElement('div');
    caveat.className = 'znxstudio-security-note';
    caveat.textContent = LIVE_SECURITY_CAVEAT;
    wrapper.appendChild(caveat);
    return wrapper;
  }

  private appendVerdict(findings: SecurityFinding[]): void {
    if (!this.scans.length) return;
    const verdict = document.createElement('div');
    verdict.className = `znxstudio-security-verdict ${blocksBuild(findings) ? 'is-blocking' : 'is-clean'}`;
    verdict.textContent = blocksBuild(findings)
      ? '`zornux check --security` would fail on these findings.'
      : '`zornux check --security` would pass.';
    this.view.appendChild(verdict);
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
    if (!enabled || !tempDir) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    try {
      const compiler = this.moduleContext.services.tryGet<CompilerService>(ServiceKeys.Compiler);
      const info = compiler ? await compiler.info() : null;
      if (!info?.available || !info.path) {
        log('security REAL: compiler unavailable — skipped');
        return;
      }
      const version = (await captureTask(`"${info.path}" --version`, tempDir)).output.trim();
      log(`security REAL compiler: ${version} (--security needs >= 1.0.0-rc.3)`);

      const secretFile = `${tempDir}\\znxstudio-security-secret.zx`;
      await window.znxstudio.fs.writeFile(secretFile, 'import crypto\nshow crypto.hmac("s3cr3t-signing-key", "message")\n');
      const secret = await this.scanFile(secretFile);
      const first = secret?.findings[0];
      log(
        `security REAL secret: analyzed=${secret?.analyzed} findings=${secret?.findings.length} ` +
          `${first?.code}/${first?.severity}/${first?.confidence} @${first?.startLine}:${first?.startColumn} category=${first?.category}`,
      );

      const cleanFile = `${tempDir}\\znxstudio-security-clean.zx`;
      await window.znxstudio.fs.writeFile(cleanFile, 'create total = 0\nrepeat 3 times\n    total = total + 1\nend\nshow total\n');
      const clean = await this.scanFile(cleanFile);
      log(`security REAL clean: analyzed=${clean?.analyzed} findings=${clean?.findings.length} (expect analyzed=true findings=0)`);

      const brokenFile = `${tempDir}\\znxstudio-security-broken.zx`;
      await window.znxstudio.fs.writeFile(brokenFile, 'create x = \n');
      const broken = await this.scanFile(brokenFile);
      log(
        `security REAL broken: analyzed=${broken?.analyzed} diagnostics=${broken?.diagnostics.length} ` +
          `first=${broken?.diagnostics[0]?.code} (expect analyzed=false — the analyzer never ran)`,
      );
    } catch (error) {
      log(`security REAL failed: ${(error as Error).message}`);
    }
  }
}
