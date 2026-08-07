import {
  channelForVersion,
  compareSemVer,
  type UpdateChannel,
  type UpdatePhase,
  type UpdateRelease,
  type UpdateStatus,
} from '../../shared/update';

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
}

export class UpdateService {
  private status: UpdateStatus;
  private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void;
  private readonly loadUpdater: () => AutoUpdaterLike | null;
  private updater: AutoUpdaterLike | null = null;
  private onStatus: ((status: UpdateStatus) => void) | undefined;

  constructor(private readonly options: UpdateServiceOptions) {
    this.log = options.log ?? (() => {});
    this.loadUpdater = options.loadUpdater ?? defaultLoadUpdater;
    this.status = {
      phase: 'idle',
      currentVersion: options.currentVersion,
      channel: options.channel,
      release: null,
      canInstall: false,
    };
  }

  /** Subscribe to status changes (the renderer mirrors these into its UI). */
  onDidChangeStatus(listener: (status: UpdateStatus) => void): void {
    this.onStatus = listener;
  }

  current(): UpdateStatus {
    return { ...this.status };
  }

  /**
   * Ask electron-updater whether a newer build exists. Never throws: an
   * unreachable feed (offline) or an unpackaged run without electron-updater
   * both resolve to a 'no-feed' status.
   */
  async check(): Promise<UpdateStatus> {
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
    if (this.status.phase !== 'update-available' || !this.status.release) return this.status;
    const updater = this.ensureUpdater();
    if (!updater) {
      this.log('info', 'update download: electron-updater unavailable — manual download required');
      return this.status; // caller opens release.url
    }
    this.set({ phase: 'downloading', percent: 0 });
    this.log('info', `update download started: ${this.status.release.version}`);
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
  install(): void {
    const updater = this.ensureUpdater();
    if (!updater || this.status.phase !== 'downloaded') {
      this.log('warn', 'update install requested but no downloaded update is ready');
      return;
    }
    this.log('info', 'update install: quitting to install');
    updater.quitAndInstall();
  }

  /** Map electron-updater's UpdateInfo onto our channel-tagged release shape. */
  private toRelease(info: UpdateInfoLike): UpdateRelease {
    const file = info.files?.[0];
    return {
      channel: this.status.channel,
      version: info.version,
      url: '', // electron-updater resolves the real download URL from its provider
      sha512: file?.sha512 ?? '',
      size: typeof file?.size === 'number' ? file.size : undefined,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
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
    // A stable subscriber must not be offered an rc/beta/nightly build.
    updater.allowPrerelease = this.status.channel !== 'stable';
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

  private set(patch: Partial<UpdateStatus>): UpdateStatus {
    this.status = { ...this.status, ...patch };
    this.onStatus?.(this.current());
    return this.current();
  }
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
