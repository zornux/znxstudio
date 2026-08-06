import { ServiceKeys, type SettingsService, type StatusService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { showModal } from '../ui/modal';
import type { UpdateChannel, UpdateStatus } from '../../shared/update';

/**
 * Auto-update UI (Phase 20J WI3). Wires the main-process UpdateService to the
 * workbench: a "Check for Updates" command, a startup check governed by
 * `update.mode` (auto / notify / off), a status-bar indicator, and an
 * update-available notification with release notes and Download / Install
 * (or a manual-download fallback when the app isn't packaged with
 * electron-updater). Uses the user's `update.channel` and `update.feedUrl`.
 */
export class UpdateModule implements IModule {
  readonly id = 'znxstudio.update';
  readonly displayName = 'Software Update';

  private context!: ModuleContext;
  private settings: SettingsService | undefined;
  private status: StatusService | undefined;
  private last: UpdateStatus | null = null;

  async activate(context: ModuleContext): Promise<void> {
    this.context = context;
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);

    context.commands.register(CommandIds.CheckForUpdates, () => this.checkForUpdates(true), 'Update: Check for Updates…');

    const off = window.znxstudio.update.onStatus((status) => this.applyStatus(status));
    context.subscriptions.push({ dispose: off });

    // Startup check per policy — but never during the self-test (no network).
    const info = await window.znxstudio.app.getInfo();
    if (info.selftest !== true && this.mode() !== 'off') {
      // A short delay keeps the update probe off the activation critical path.
      setTimeout(() => void this.checkForUpdates(false), 4000);
    }

    void selfTestCoordinator.run('update', () => this.maybeSelfTest());
  }

  private mode(): string {
    return this.settings?.get('update.mode', 'auto') ?? 'auto';
  }
  private channel(): UpdateChannel {
    return (this.settings?.get('update.channel', 'stable') ?? 'stable') as UpdateChannel;
  }
  private feedUrl(): string {
    return this.settings?.get('update.feedUrl', 'https://updates.znxstudio.dev/feed.json') ?? '';
  }

  /** Run a check. `interactive` = surface up-to-date/no-feed toasts (a user asked). */
  private async checkForUpdates(interactive: boolean): Promise<void> {
    const status = await window.znxstudio.update.check({ channel: this.channel(), feedUrl: this.feedUrl() });
    this.applyStatus(status);
    if (status.phase === 'update-available') {
      await this.promptUpdate(status);
    } else if (interactive) {
      const message = status.phase === 'up-to-date' ? 'ZnxStudio is up to date.' : 'No update information is available right now.';
      this.context.layout.showToast(message, 'info');
    }
  }

  private applyStatus(status: UpdateStatus): void {
    this.last = status;
    if (!this.status) return;
    if (status.phase === 'update-available') {
      this.status.setItem('update.status', { text: '⬇ Update available', tooltip: `Version ${status.release?.version} is available`, command: CommandIds.CheckForUpdates, side: 'right', priority: 5 });
    } else if (status.phase === 'downloading') {
      this.status.setItem('update.status', { text: `⬇ Updating… ${status.percent ?? 0}%`, side: 'right', priority: 5 });
    } else if (status.phase === 'downloaded') {
      this.status.setItem('update.status', { text: '↻ Restart to update', tooltip: 'A new version is ready — click to install', command: CommandIds.CheckForUpdates, side: 'right', priority: 5 });
    } else {
      this.status.removeItem('update.status');
    }
  }

  /** Show the update-available dialog with release notes + the right action. */
  private async promptUpdate(status: UpdateStatus): Promise<void> {
    if (status.phase === 'downloaded') {
      const choice = await showModal({
        title: 'Update ready to install',
        body: `ZnxStudio ${status.release?.version} has been downloaded. Restart to install it now?`,
        buttons: [
          { label: 'Restart & Install', value: 'install', primary: true },
          { label: 'Later', value: 'cancel' },
        ],
      });
      if (choice === 'install') await window.znxstudio.update.install();
      return;
    }

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
    const choice = await showModal({
      title: 'A new version of ZnxStudio is available',
      body,
      buttons: [
        { label: canInstall ? 'Download & Install' : 'Download', value: 'download', primary: true },
        { label: 'Release Notes', value: 'notes' },
        { label: 'Later', value: 'cancel' },
      ],
    });
    if (choice === 'notes' && status.release?.url) {
      await window.znxstudio.shell.openExternal(status.release.url);
    } else if (choice === 'download') {
      if (canInstall) {
        await window.znxstudio.update.download();
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
    const status = await window.znxstudio.update.check({ channel: 'stable', feedUrl: 'http://127.0.0.1:1/feed.json' });
    log(`update REAL check (offline feed): phase=${status.phase} canInstall=${status.canInstall} (expect no-feed, no throw)`);
  }
}
