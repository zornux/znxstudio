import { ServiceKeys, type TrustService, type WorkspaceService } from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { showModal } from '../ui/modal';
import type { TrustState } from '../../shared/workspaceTrust';

/**
 * Workspace Trust (Phase 20J WI1) — renderer surface.
 *
 * The main process is the trust AUTHORITY: every execution IPC (task, terminal,
 * debug, packages, tools) refuses in Restricted Mode, so trust cannot be
 * bypassed from the renderer. This module drives the user-facing side: it reports
 * the open workspace roots to main, shows the trust dialog for an undecided
 * workspace, keeps a persistent Restricted-Mode banner, exposes commands (Trust /
 * Trust Parent / Remove Trust / Manage), and publishes a `TrustService` so other
 * modules can reflect trust and pre-check actions.
 */
// Commands that run project code and are therefore refused in Restricted Mode. Kept conservative and
// unambiguous (build/run/debug-start/test-run): the IPC layer is the security authority for every
// execution path, so this set only drives whether the UI shows a command disabled — under-inclusion is
// safe (IPC still blocks it), over-inclusion would wrongly disable a command that is fine while untrusted.
const TRUST_GATED_COMMANDS: ReadonlySet<string> = new Set([
  CommandIds.RunStart,
  CommandIds.BuildStart,
  CommandIds.BuildRebuild,
  CommandIds.DebugStart,
  CommandIds.DebugAttach,
  CommandIds.TestRunAll,
]);

export class TrustModule implements IModule, TrustService {
  readonly id = 'znxstudio.trust';
  readonly displayName = 'Workspace Trust';

  private context!: ModuleContext;
  private workspace: WorkspaceService | undefined;
  private current: TrustState = { trusted: true, decided: true, roots: [], trustedFolders: [] };
  private banner: HTMLElement | undefined;
  private readonly changeEmitter = new Emitter<TrustState>();
  readonly onDidChange = this.changeEmitter.event;

  async activate(context: ModuleContext): Promise<void> {
    this.context = context;
    this.workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    context.services.register<TrustService>(ServiceKeys.Trust, this);

    context.commands.register(CommandIds.TrustManage, () => this.promptTrust(true), 'Workspace: Manage Workspace Trust');
    context.commands.register(CommandIds.TrustWorkspace, () => void this.trustWorkspace(), 'Workspace: Trust Workspace');
    context.commands.register(CommandIds.TrustParentFolder, () => void this.trustParent(), 'Workspace: Trust Parent Folder');
    context.commands.register(CommandIds.TrustRevoke, () => void this.revoke(), 'Workspace: Remove Workspace Trust');

    // Reflect trust in the UI: execution-class commands show disabled in Restricted Mode instead of only
    // failing once invoked. They re-enable automatically when trust is granted (surfaces read isEnabled
    // fresh: the palette on each open, the editor toolbar via onDidChange below).
    context.commands.addEnablementRule((id) => (TRUST_GATED_COMMANDS.has(id) ? this.isTrusted() : undefined));

    // Track the open folders → tell main → reflect state. Fires on multi-root changes.
    if (this.workspace) {
      context.subscriptions.push(this.workspace.onDidChangeFolders(() => void this.syncWorkspace(true)));
    }
    const unsubscribeChanged = window.znxstudio.trust.onChanged((state) => this.applyState(state));
    context.subscriptions.push({ dispose: unsubscribeChanged });

    await this.syncWorkspace(true);
    void selfTestCoordinator.run('trust', () => this.maybeSelfTest());
  }

  /* ----- TrustService ----- */
  isTrusted(): boolean {
    return this.current.trusted;
  }

  state(): TrustState {
    return this.current;
  }

  requireTrust(action: string): boolean {
    if (this.current.trusted) return true;
    this.context.layout.showToast(`${action} is disabled in Restricted Mode. Trust this workspace to enable it.`, 'error');
    void this.promptTrust(false);
    return false;
  }

  /* ----- state sync ----- */
  private roots(): string[] {
    return (this.workspace?.folders() ?? []).map((folder) => folder.root);
  }

  private async syncWorkspace(promptIfUndecided: boolean): Promise<void> {
    const state = await window.znxstudio.trust.setWorkspace(this.roots());
    this.applyState(state);
    if (promptIfUndecided && !state.decided && state.roots.length > 0) {
      await this.promptTrust(false);
    }
  }

  private applyState(state: TrustState): void {
    const wasTrusted = this.current.trusted;
    this.current = state;
    this.renderBanner();
    // Trust flipping changes which execution commands are enabled — refresh the surfaces that reflect it.
    if (wasTrusted !== state.trusted) this.context.commands.notifyEnablementChanged();
    this.changeEmitter.fire(state);
  }

  /* ----- trust operations ----- */
  private async trustWorkspace(): Promise<void> {
    this.applyState(await window.znxstudio.trust.trustWorkspace());
  }
  private async trustParent(): Promise<void> {
    this.applyState(await window.znxstudio.trust.trustParent());
  }
  private async revoke(): Promise<void> {
    this.applyState(await window.znxstudio.trust.revoke());
  }

  /* ----- UI ----- */
  private async promptTrust(fromManage: boolean): Promise<void> {
    if (this.current.roots.length === 0) {
      this.context.layout.showToast('No folder is open, so there is nothing to trust.', 'info');
      return;
    }
    const alreadyTrusted = this.current.trusted;
    const body = document.createElement('div');
    const p1 = document.createElement('p');
    p1.textContent = alreadyTrusted
      ? 'You trust the authors of the files in this workspace. Code execution (tasks, terminal, debugging) is enabled.'
      : 'Do you trust the authors of the files in this workspace? Trusting it enables running tasks, the integrated terminal, debugging, package operations, and external tools. In Restricted Mode you can still edit, search, and browse safely.';
    const p2 = document.createElement('p');
    p2.className = 'znxstudio-modal-muted';
    p2.textContent = this.current.roots.join('\n');
    body.append(p1, p2);

    const buttons = alreadyTrusted
      ? [
          { label: 'Remove Trust', value: 'revoke', primary: false },
          { label: 'Close', value: 'cancel', primary: true },
        ]
      : [
          // Trusting enables code execution, so it must never be the Enter/default action. The safe
          // choice is primary (focused + default); the user has to deliberately pick Trust.
          { label: 'Trust Workspace', value: 'trust' },
          { label: 'Trust Parent Folder', value: 'parent' },
          { label: 'Continue in Restricted Mode', value: 'restricted', primary: true },
        ];

    const choice = await showModal({
      title: fromManage ? 'Workspace Trust' : 'Do you trust this workspace?',
      body,
      buttons,
      dismissValue: alreadyTrusted ? 'cancel' : 'restricted',
    });

    if (choice === 'trust') await this.trustWorkspace();
    else if (choice === 'parent') await this.trustParent();
    else if (choice === 'revoke') await this.revoke();
    else if (choice === 'restricted') this.applyState(await window.znxstudio.trust.continueRestricted());
  }

  private renderBanner(): void {
    const root = document.getElementById('znxstudio-root') ?? document.body;
    if (this.current.trusted) {
      this.banner?.remove();
      this.banner = undefined;
      return;
    }
    if (!this.banner) {
      const banner = document.createElement('div');
      banner.className = 'znxstudio-trust-banner';
      banner.setAttribute('role', 'status');
      const text = document.createElement('span');
      text.textContent = '🔒 Restricted Mode — code execution is disabled because this workspace is not trusted.';
      const manage = document.createElement('button');
      manage.className = 'znxstudio-trust-banner-btn';
      manage.textContent = 'Manage Trust';
      manage.addEventListener('click', () => void this.promptTrust(true));
      banner.append(text, manage);
      root.prepend(banner);
      this.banner = banner;
    }
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

    // Under self-test the main-process gate is intentionally open, so the state
    // is trusted; assert the service surface + main round-trip are wired.
    const state = await window.znxstudio.trust.state();
    log(`trust REAL state: trusted=${state.trusted} decided=${state.decided} roots=${state.roots.length}`);
    log(`trust service: isTrusted=${this.isTrusted()} requireTrust('run')=${this.requireTrust('Running')}`);
    const round = await window.znxstudio.trust.setWorkspace(this.roots());
    log(`trust setWorkspace round-trip: trusted=${round.trusted} (self-test bypass keeps execution enabled)`);
  }
}
