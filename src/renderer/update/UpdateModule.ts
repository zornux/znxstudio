import { ServiceKeys, type SettingsService, type StatusService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { showModal } from '../ui/modal';
import type { UpdateChannel, UpdateStatus } from '../../shared/update';
import { shouldCheckAfterConnectivity, updateActionForPhase } from './updateActions';

/**
 * Auto-update UI (Phase 20J WI3). Wires the main-process UpdateService to the
 * workbench: a "Check for Updates" command, a startup check governed by
 * `update.mode` (auto / notify / off), a status-bar indicator, and an
 * update-available notification with release notes and Download / Install
 * (or a manual-download fallback when the app isn't packaged with
 * electron-updater). Uses the user's `update.channel`.
 */
export class UpdateModule implements IModule {
  readonly id = 'znxstudio.update';
  readonly displayName = 'Software Update';

  private context!: ModuleContext;
  private settings: SettingsService | undefined;
  private status: StatusService | undefined;
  private last: UpdateStatus | null = null;
  private promptedReadyVersion = '';
  private promptedAvailableVersion = '';
  private periodicCheck: ReturnType<typeof setInterval> | undefined;
  private startupCheck: ReturnType<typeof setTimeout> | undefined;
  private lastCheckAt = 0;

  async activate(context: ModuleContext): Promise<void> {
    this.context = context;
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);

    context.commands.register(CommandIds.CheckForUpdates, () => this.checkForUpdates(true), 'Update: Check for Updates…');
    context.commands.register(CommandIds.UpdateDownload, () => this.downloadAvailableUpdate(), 'Update: Download Available Update');
    context.commands.register(CommandIds.UpdateInstall, () => this.confirmInstall(), 'Update: Restart and Install');
    context.commands.register(CommandIds.UpdateRollback, () => this.confirmRollback(), 'Update: Roll Back to Previous Version…');

    const off = window.znxstudio.update.onStatus((status) => void this.handleStatus(status));
    context.subscriptions.push({ dispose: off });

    // Startup check per policy — but never during the self-test (no network).
    const info = await window.znxstudio.app.getInfo();
    if (info.selftest !== true && this.mode() !== 'off') {
      // A short delay keeps the update probe off the activation critical path.
      this.startupCheck = setTimeout(() => void this.checkForUpdates(false), 4000);
      // Keep long-running IDE sessions current. Only the focused window probes;
      // the main process also coalesces overlapping requests from all windows.
      this.periodicCheck = setInterval(() => {
        this.checkAfterConnectivityChange();
      }, 6 * 60 * 60 * 1000);
      const onOnline = () => this.checkAfterConnectivityChange();
      const onVisible = () => {
        if (document.visibilityState === 'visible') this.checkAfterConnectivityChange();
      };
      window.addEventListener('online', onOnline);
      document.addEventListener('visibilitychange', onVisible);
      context.subscriptions.push({
        dispose: () => {
          clearTimeout(this.startupCheck);
          clearInterval(this.periodicCheck);
          window.removeEventListener('online', onOnline);
          document.removeEventListener('visibilitychange', onVisible);
        },
      });
    }

    void selfTestCoordinator.run('update', () => this.maybeSelfTest());
  }

  private mode(): string {
    return this.settings?.get('update.mode', 'auto') ?? 'auto';
  }
  private channel(): UpdateChannel {
    return (this.settings?.get('update.channel', 'stable') ?? 'stable') as UpdateChannel;
  }
  /** Run a check. `interactive` = surface up-to-date/no-feed toasts (a user asked). */
  private async checkForUpdates(interactive: boolean): Promise<void> {
    this.lastCheckAt = Date.now();
    const status = await window.znxstudio.update.check({ channel: this.channel() });
    this.applyStatus(status);
    if (status.phase === 'update-available') {
      if (!interactive && this.mode() === 'auto' && status.canInstall) {
        // Auto mode downloads a verified package in the background, but never restarts
        // without consent. Notify mode and interactive checks show the Download button.
        await this.downloadAvailableUpdate();
      } else if (interactive || status.release?.version !== this.promptedAvailableVersion) {
        this.promptedAvailableVersion = status.release?.version ?? '';
        await this.promptUpdate(status);
      }
    } else if (interactive) {
      const message = status.phase === 'up-to-date' ? 'ZnxStudio is up to date.' : 'No update information is available right now.';
      this.context.layout.showToast(message, 'info');
    }
  }

  /** Re-check after resume/network recovery, bounded to avoid event storms. */
  private checkAfterConnectivityChange(): void {
    if (!shouldCheckAfterConnectivity({
      mode: this.mode(),
      online: navigator.onLine,
      focused: document.hasFocus(),
      elapsedMs: Date.now() - this.lastCheckAt,
    })) return;
    void this.checkForUpdates(false);
  }

  private async handleStatus(status: UpdateStatus): Promise<void> {
    this.applyStatus(status);
    if (status.phase === 'downloaded' && document.hasFocus() && status.release?.version !== this.promptedReadyVersion) {
      this.promptedReadyVersion = status.release?.version ?? '';
      await this.confirmInstall();
    }
  }

  private applyStatus(status: UpdateStatus): void {
    this.last = status;
    if (!this.status) return;
    if (status.phase === 'update-available') {
      this.status.setItem('update.status', {
        text: `Update to ${status.release?.version ?? 'latest'}`,
        tooltip: 'Download the verified update',
        command: CommandIds.UpdateDownload,
        side: 'right',
        priority: 5,
      });
    } else if (status.phase === 'downloading') {
      this.status.setItem('update.status', { text: `Downloading update… ${status.percent ?? 0}%`, tooltip: 'The update is downloading in the background', side: 'right', priority: 5 });
    } else if (status.phase === 'downloaded') {
      this.status.setItem('update.status', { text: 'Restart & Install', tooltip: 'The verified update is ready to install', command: CommandIds.UpdateInstall, side: 'right', priority: 5 });
    } else if (status.phase === 'error') {
      this.status.setItem('update.status', { text: 'Update failed — Retry', tooltip: status.error ?? 'Retry the update check', command: CommandIds.CheckForUpdates, side: 'right', priority: 5 });
    } else {
      this.status.removeItem('update.status');
    }

    // Offer rollback (last-known-good) whenever a snapshot of the previous version
    // exists and we're not mid-update — that's exactly when a bad update is noticed.
    const rollbackReady =
      status.canRollback && (status.phase === 'idle' || status.phase === 'up-to-date' || status.phase === 'error');
    if (rollbackReady) {
      this.status.setItem('update.rollback', {
        text: `↩ Roll back ${status.rollbackVersion ?? ''}`.trimEnd(),
        tooltip: `Restore the previous version (${status.rollbackVersion ?? 'previous'}) and restart`,
        command: CommandIds.UpdateRollback,
        side: 'right',
        priority: 4,
      });
    } else {
      this.status.removeItem('update.rollback');
    }
  }

  private async downloadAvailableUpdate(): Promise<void> {
    if (this.last?.phase !== 'update-available') {
      await this.checkForUpdates(true);
      return;
    }
    if (!this.last.canInstall) {
      if (this.last.release?.url) await window.znxstudio.shell.openExternal(this.last.release.url);
      else this.context.layout.showToast('An in-app update is unavailable for this build.', 'error');
      return;
    }
    const status = await window.znxstudio.update.download();
    if (status?.phase === 'error') {
      this.context.layout.showToast(`Update download failed: ${status.error ?? 'Unknown error'}`, 'error');
    }
  }

  private async confirmInstall(): Promise<void> {
    const status = this.last ?? await window.znxstudio.update.status();
    if (!status || updateActionForPhase(status.phase) !== 'install') return;
    const choice = await showModal({
      title: 'Update ready to install',
      body: `ZnxStudio ${status.release?.version ?? ''} is ready. Restart now to finish installing the update?`,
      buttons: [
        { label: 'Restart & Install', value: 'install', primary: true },
        { label: 'Later', value: 'cancel' },
      ],
    });
    if (choice === 'install') {
      const result = await window.znxstudio.update.install();
      if (result?.phase === 'error') this.context.layout.showToast(`Update installation failed: ${result.error ?? 'Unknown error'}`, 'error');
    }
  }

  /** Confirm and perform a rollback to the previously-installed version. */
  private async confirmRollback(): Promise<void> {
    const status = this.last ?? (await window.znxstudio.update.status());
    if (!status?.canRollback) {
      this.context.layout.showToast('No previous version is available to roll back to.', 'info');
      return;
    }
    const choice = await showModal({
      title: 'Roll back to previous version',
      body: `Restore ZnxStudio ${status.rollbackVersion ?? ''} and restart? You can update again afterwards.`,
      buttons: [
        { label: 'Roll Back & Restart', value: 'rollback', primary: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    });
    if (choice === 'rollback') {
      const result = await window.znxstudio.update.rollback();
      if (result?.phase === 'error') this.context.layout.showToast(`Rollback failed: ${result.error ?? 'Unknown error'}`, 'error');
    }
  }

  /** Show the update-available dialog with release notes + the right action. */
  private async promptUpdate(status: UpdateStatus): Promise<void> {
    const body = document.createElement('div');
    const line = document.createElement('p');
    line.textContent = `ZnxStudio ${status.release?.version} is available (you have ${status.currentVersion}).`;
    body.appendChild(line);
    if (status.release?.notes) {
      const notes = document.createElement('p');
      notes.className = 'znxstudio-modal-muted';
      notes.textContent = status.release.notes;
      body.appendChild(notes);
    }

    // In a packaged build the updater downloads in-app; otherwise offer the
    // installer for a manual download.
    const canInstall = status.canInstall;
    const buttons = [
      { label: canInstall ? 'Download Update' : 'Open Download Page', value: 'download', primary: true },
      ...(status.release?.url ? [{ label: 'Release Notes', value: 'notes' }] : []),
      { label: 'Later', value: 'cancel' },
    ];
    const choice = await showModal({
      title: 'A new version of ZnxStudio is available',
      body,
      buttons,
    });
    if (choice === 'notes' && status.release?.url) {
      await window.znxstudio.shell.openExternal(status.release.url);
    } else if (choice === 'download') {
      if (canInstall) {
        await this.downloadAvailableUpdate();
      } else if (status.release?.url) {
        await window.znxstudio.shell.openExternal(status.release.url);
      }
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
    // Check against an unreachable feed → must degrade to no-feed, never throw.
    const status = await window.znxstudio.update.check({ channel: 'stable' });
    log(`update REAL check (offline feed): phase=${status.phase} canInstall=${status.canInstall} (expect no-feed, no throw)`);
  }
}
