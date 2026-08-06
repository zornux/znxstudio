import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import {
  channelForVersion,
  checkForUpdate,
  parseUpdateFeed,
  type UpdateChannel,
  type UpdatePhase,
  type UpdateRelease,
  type UpdateStatus,
} from '../../shared/update';

/**
 * Auto-update runtime (Phase 20J WI3).
 *
 * The pure decision logic lives in shared/update.ts; this service performs the
 * actual runtime work: it fetches the update feed over HTTP, decides whether a
 * newer build exists for the user's channel, and drives the download/install.
 *
 * The feed check is fully self-contained and testable against a mock HTTP server
 * — it never throws (a network failure or malformed feed degrades to "no feed").
 * The binary download+install is delegated to electron-updater's `autoUpdater`
 * when it is present (a packaged build); when it is absent (dev, or an unpackaged
 * run) the service falls back to handing the installer URL to the caller for a
 * manual download. A SIGNED end-to-end install + rollback is release-gate work
 * that requires a packaged, signed app and is verified in CI, not here.
 */

export type { UpdatePhase, UpdateStatus } from '../../shared/update';

/** The minimal slice of electron-updater's autoUpdater this service drives. */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  on(event: string, listener: (...args: unknown[]) => void): void;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface UpdateServiceOptions {
  currentVersion: string;
  /** The URL of the JSON update feed (a single document covering every channel). */
  feedUrl: string;
  channel: UpdateChannel;
  /** Injected for tests; defaults to a real http/https GET. */
  fetchText?: (url: string) => Promise<string>;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** Injected for tests; defaults to an optional electron-updater require. */
  loadUpdater?: () => AutoUpdaterLike | null;
}

export class UpdateService {
  private status: UpdateStatus;
  private readonly fetchText: (url: string) => Promise<string>;
  private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void;
  private readonly loadUpdater: () => AutoUpdaterLike | null;
  private updater: AutoUpdaterLike | null = null;
  private onStatus: ((status: UpdateStatus) => void) | undefined;

  constructor(private readonly options: UpdateServiceOptions) {
    this.fetchText = options.fetchText ?? defaultFetchText;
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
   * Check the feed for a newer build. Never throws: an unreachable feed (offline)
   * or malformed feed both resolve to a 'no-feed' status.
   */
  async check(): Promise<UpdateStatus> {
    this.set({ phase: 'checking', error: undefined });
    this.log('info', `update check: current=${this.status.currentVersion} channel=${this.status.channel}`);
    let raw: string;
    try {
      raw = await this.fetchText(this.options.feedUrl);
    } catch (error) {
      this.log('warn', `update check failed (offline?): ${(error as Error).message}`);
      return this.set({ phase: 'no-feed', release: null });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.log('warn', 'update check: feed is not valid JSON');
      return this.set({ phase: 'no-feed', release: null });
    }
    const result = checkForUpdate(this.status.currentVersion, parseUpdateFeed(parsed), this.status.channel);
    if (result.reason === 'no-feed') return this.set({ phase: 'no-feed', release: null });
    if (result.available) {
      this.log('info', `update available: ${result.release?.version}`);
      return this.set({ phase: 'update-available', release: result.release });
    }
    this.log('info', 'update check: up to date');
    return this.set({ phase: 'up-to-date', release: result.release });
  }

  /**
   * Download the available update. Uses electron-updater when present (real
   * in-app update with progress); otherwise reports that a manual download is
   * required and the caller opens `release.url` in the browser.
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

  private ensureUpdater(): AutoUpdaterLike | null {
    if (this.updater) return this.updater;
    const updater = this.loadUpdater();
    if (!updater) {
      this.status.canInstall = false;
      return null;
    }
    this.updater = updater;
    this.status.canInstall = true;
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

/** Default feed fetch over http/https; rejects on network error or non-2xx. */
function defaultFetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith('https:') ? httpsGet : httpGet;
    const request = getter(url, (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`feed HTTP ${status}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolve(body));
    });
    request.on('error', reject);
    request.setTimeout(10_000, () => request.destroy(new Error('feed request timed out')));
  });
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
