import {
  channelForVersion,
  compareSemVer,
  providerChannel,
  type UpdateChannel,
  type UpdatePhase,
  type UpdateRelease,
  type UpdateStatus,
} from '../../shared/update';
import { noopRollbackController, type RollbackController } from './rollback';

/**
 * Auto-update runtime (Phase 20J WI3; GitHub-native since 2026-08).
 *
 * Both the update *check* and the *download/install* are delegated to
 * electron-updater's `autoUpdater`, which reads `latest.yml` from the app's
 * configured provider — GitHub Releases (see electron-builder.yml `publish`).
 * `checkForUpdates()` populates electron-updater's internal update info, which is
 * a prerequisite for `downloadUpdate()`; doing both here keeps them consistent.
 *
 * The check never throws: an unreachable feed (offline) degrades to 'no-feed',
 * as does an unpackaged/dev run where electron-updater isn't present. A SIGNED
 * end-to-end install + rollback needs a packaged, signed app and is a release
 * gate verified against a real release, not in unit tests.
 */

export type { UpdatePhase, UpdateStatus } from '../../shared/update';

/** The `updateInfo` electron-updater returns from a check. */
export interface UpdateInfoLike {
  version: string;
  files?: Array<{ sha512?: string; size?: number }>;
  releaseNotes?: string | null | unknown;
}

export interface UpdateCheckResultLike {
  updateInfo?: UpdateInfoLike;
}

/** The minimal slice of electron-updater's autoUpdater this service drives. */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  channel: string | null;
  /** Preview/nightly subscribers accept prereleases; stable does not. */
  allowPrerelease: boolean;
  on(event: string, listener: (...args: unknown[]) => void): void;
  checkForUpdates(): Promise<UpdateCheckResultLike | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface UpdateServiceOptions {
  currentVersion: string;
  channel: UpdateChannel;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** Injected for tests; defaults to an optional electron-updater require. */
  loadUpdater?: () => AutoUpdaterLike | null;
  releasePageBase?: string;
  /**
   * Last-known-good rollback. Snapshots the current install before an update and
   * restores it on request. Defaults to a no-op (dev/unpackaged, or an install
   * form that can't be swapped in place), so rollback is simply never offered.
   */
  rollback?: RollbackController;
}

export class UpdateService {
  private status: UpdateStatus;
  private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void;
  private readonly loadUpdater: () => AutoUpdaterLike | null;
  private updater: AutoUpdaterLike | null = null;
  private onStatus: ((status: UpdateStatus) => void) | undefined;
  private checkInFlight: Promise<UpdateStatus> | null = null;
  private downloadInFlight: Promise<UpdateStatus> | null = null;
  private readonly rollbackController: RollbackController;

  constructor(private readonly options: UpdateServiceOptions) {
    this.log = options.log ?? (() => {});
    this.loadUpdater = options.loadUpdater ?? defaultLoadUpdater;
    this.rollbackController = options.rollback ?? noopRollbackController;
    // A rollback point is available only if one was recorded for exactly this
    // running version (i.e. we are the build a prior update installed).
    const point = this.rollbackController.available(options.currentVersion);
    this.status = {
      phase: 'idle',
      currentVersion: options.currentVersion,
      channel: options.channel,
      release: null,
      canInstall: false,
      canRollback: point !== null,
      rollbackVersion: point?.previousVersion ?? null,
    };
  }

  /** Subscribe to status changes (the renderer mirrors these into its UI). */
  onDidChangeStatus(listener: (status: UpdateStatus) => void): void {
    this.onStatus = listener;
  }

  current(): UpdateStatus {
    return { ...this.status };
  }

  /** Change subscription channel without replacing the updater or its listeners. */
  setChannel(channel: UpdateChannel): void {
    if (this.status.channel === channel) return;
    this.status = { ...this.status, channel };
    if (this.updater) this.configureChannel(this.updater);
  }

  /**
   * Ask electron-updater whether a newer build exists. Never throws: an
   * unreachable feed (offline) or an unpackaged run without electron-updater
   * both resolve to a 'no-feed' status.
   */
  async check(): Promise<UpdateStatus> {
    // Never disturb an update that is already transferring or waiting for the
    // user's explicit restart decision.
    if (this.status.phase === 'downloading' || this.status.phase === 'downloaded') return this.current();
    if (this.checkInFlight) return this.checkInFlight;
    this.checkInFlight = this.performCheck();
    try {
      return await this.checkInFlight;
    } finally {
      this.checkInFlight = null;
    }
  }

  private async performCheck(): Promise<UpdateStatus> {
    this.set({ phase: 'checking', error: undefined });
    this.log('info', `update check: current=${this.status.currentVersion} channel=${this.status.channel}`);
    const updater = this.ensureUpdater();
    if (!updater) {
      this.log('info', 'update check: electron-updater unavailable (dev/unpackaged)');
      return this.set({ phase: 'no-feed', release: null });
    }
    let result: UpdateCheckResultLike | null;
    try {
      result = await updater.checkForUpdates();
    } catch (error) {
      this.log('warn', `update check failed (offline?): ${(error as Error).message}`);
      return this.set({ phase: 'no-feed', release: null });
    }
    const info = result?.updateInfo;
    if (!info || !info.version) {
      this.log('info', 'update check: up to date');
      return this.set({ phase: 'up-to-date', release: null });
    }
    if (compareSemVer(info.version, this.status.currentVersion) > 0) {
      this.log('info', `update available: ${info.version}`);
      return this.set({ phase: 'update-available', release: this.toRelease(info) });
    }
    this.log('info', 'update check: up to date');
    return this.set({ phase: 'up-to-date', release: this.toRelease(info) });
  }

  /**
   * Download the available update via electron-updater (real in-app update with
   * progress). Without electron-updater (dev/unpackaged) this is a no-op and the
   * caller opens `release.url` for a manual download.
   */
  async download(): Promise<UpdateStatus> {
    if (this.downloadInFlight) return this.downloadInFlight;
    if (this.status.phase !== 'update-available' || !this.status.release) return this.status;
    this.downloadInFlight = this.performDownload();
    try {
      return await this.downloadInFlight;
    } finally {
      this.downloadInFlight = null;
    }
  }

  private async performDownload(): Promise<UpdateStatus> {
    const release = this.status.release;
    if (!release) return this.status;
    const updater = this.ensureUpdater();
    if (!updater) {
      this.log('info', 'update download: electron-updater unavailable — manual download required');
      return this.status; // caller opens release.url
    }
    this.set({ phase: 'downloading', percent: 0 });
    this.log('info', `update download started: ${release.version}`);
    try {
      updater.autoDownload = false;
      await updater.downloadUpdate();
    } catch (error) {
      this.log('error', `update download failed: ${(error as Error).message}`);
      return this.set({ phase: 'error', error: (error as Error).message });
    }
    return this.status;
  }

  /** Install a downloaded update by relaunching into it. No-op without electron-updater. */
  install(): UpdateStatus {
    const updater = this.ensureUpdater();
    if (!updater || this.status.phase !== 'downloaded') {
      this.log('warn', 'update install requested but no downloaded update is ready');
      return this.current();
    }
    // Snapshot the current build as a rollback point BEFORE it is replaced. This
    // is best-effort: a failure here must not block a legitimate install.
    this.rollbackController.prepare(this.status.currentVersion, this.status.release?.version ?? '');
    this.log('info', 'update install: quitting to install');
    try {
      updater.quitAndInstall();
    } catch (error) {
      this.log('error', `update install failed: ${(error as Error).message}`);
      return this.set({ phase: 'error', error: (error as Error).message });
    }
    return this.current();
  }

  /**
   * Restore the previously-installed version from its snapshot and relaunch into
   * it. Available only when a rollback point was recorded for the running build
   * (see {@link UpdateStatus.canRollback}); a no-op otherwise. `perform` relaunches
   * on success, so a returned status only matters on failure.
   */
  rollback(): UpdateStatus {
    const point = this.rollbackController.available(this.status.currentVersion);
    if (!point) {
      this.log('warn', 'rollback requested but no rollback point is available');
      return this.current();
    }
    this.log('info', `rollback: restoring ${point.previousVersion}`);
    const ok = this.rollbackController.perform(this.status.currentVersion);
    if (!ok) return this.set({ phase: 'error', error: 'Rollback failed to restore the previous version.' });
    return this.current();
  }

  /** Map electron-updater's UpdateInfo onto our channel-tagged release shape. */
  private toRelease(info: UpdateInfoLike): UpdateRelease {
    const file = info.files?.[0];
    return {
      channel: this.status.channel,
      version: info.version,
      url: `${this.options.releasePageBase ?? 'https://github.com/jay-m2/ZnxStudio/releases/tag'}/v${encodeURIComponent(info.version)}`,
      sha512: file?.sha512 ?? '',
      size: typeof file?.size === 'number' ? file.size : undefined,
      notes: normalizeReleaseNotes(info.releaseNotes),
    };
  }

  private ensureUpdater(): AutoUpdaterLike | null {
    if (this.updater) return this.updater;
    const updater = this.loadUpdater();
    if (!updater) {
      this.status.canInstall = false;
      return null;
    }
    this.updater = updater;
    this.status.canInstall = true;
    updater.autoDownload = false;
    // A user who chooses "Later" must not discover that a normal quit installed
    // the update anyway. Installation happens only through the explicit action.
    updater.autoInstallOnAppQuit = false;
    // A stable subscriber must not be offered an rc/beta/nightly build.
    this.configureChannel(updater);
    // Forward the real downloader's lifecycle into our status.
    updater.on('download-progress', (info: unknown) => {
      const percent = typeof (info as { percent?: number })?.percent === 'number' ? (info as { percent: number }).percent : 0;
      this.set({ phase: 'downloading', percent: Math.round(percent) });
    });
    updater.on('update-downloaded', () => {
      this.log('info', 'update downloaded: ready to install');
      this.set({ phase: 'downloaded', percent: 100 });
    });
    updater.on('error', (error: unknown) => {
      this.log('error', `updater error: ${String((error as Error)?.message ?? error)}`);
      this.set({ phase: 'error', error: String((error as Error)?.message ?? error) });
    });
    return updater;
  }

  private configureChannel(updater: AutoUpdaterLike): void {
    updater.allowPrerelease = this.status.channel !== 'stable';
    // Explicit feeds prevent Preview from accidentally selecting a Nightly.
    updater.channel = providerChannel(this.status.channel);
  }

  private set(patch: Partial<UpdateStatus>): UpdateStatus {
    this.status = { ...this.status, ...patch };
    this.onStatus?.(this.current());
    return this.current();
  }
}

function normalizeReleaseNotes(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return undefined;
  const notes = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const item = entry as { version?: unknown; note?: unknown };
      if (typeof item.note !== 'string') return '';
      return typeof item.version === 'string' ? `${item.version}\n${item.note}` : item.note;
    })
    .filter(Boolean);
  return notes.length ? notes.join('\n\n') : undefined;
}

/** Optionally load electron-updater's autoUpdater; null when it isn't installed (dev/unpackaged). */
function defaultLoadUpdater(): AutoUpdaterLike | null {
  try {
    // Indirection keeps esbuild from bundling/resolving electron-updater at build
    // time — it stays an optional runtime dependency (installed only in packaged CI).
    const req = eval('require') as NodeRequire;
    const mod = req('electron-updater') as { autoUpdater: AutoUpdaterLike };
    return mod.autoUpdater ?? null;
  } catch {
    return null;
  }
}

/** The channel a build belongs to (re-exported for the IPC layer's convenience). */
export { channelForVersion };
