import { ServiceKeys, type EditorService, type LogService } from '../core/Contracts';
import { LanguageServiceKeys } from '../language/api';
import type { DocumentManager } from '../language/DocumentManager';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { joinPath } from '../explorer/paths';
import {
  SNAPSHOT_FILE,
  buildSnapshot,
  describeCrash,
  isRoutineCancellation,
  parseSnapshot,
  recoverableBuffers,
  serializeError,
  shouldOfferRestore,
  snapshotSummary,
  type OpenBuffer,
  type SessionSnapshot,
  type SessionState,
} from './crash';

/** Debounce: a snapshot per keystroke would be a write amplifier. */
const SNAPSHOT_DEBOUNCE_MS = 2_000;

/**
 * Crash recovery (Phase 19B).
 *
 * Whether the last session crashed is answered by the main process's session
 * marker, not by guessing. What was LOST is answered by a snapshot of the
 * unsaved editor buffers, written on a debounce to an OS-temp folder — never
 * into the workspace, which is the user's, and never into the compiler repo.
 *
 * Recovery is OFFERED, never applied. ZnxStudio will not overwrite a file that may
 * have changed on disk since the crash; it opens the recovered text and lets
 * the user compare and save. Silently restoring would be the one bug in a crash
 * recovery feature that nobody forgives.
 */
export class CrashRecoveryModule implements IModule {
  readonly id = 'znxstudio.health.crashRecovery';
  readonly displayName = 'Crash Recovery';

  private moduleContext!: ModuleContext;
  private logger: LogService | undefined;
  private editor: EditorService | undefined;
  private documents: DocumentManager | undefined;

  private snapshotPath = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private session: SessionState | null = null;
  private recovered: SessionSnapshot | null = null;

  async activate(context: ModuleContext): Promise<void> {
    this.moduleContext = context;
    this.logger = context.services.tryGet<LogService>(ServiceKeys.Log);
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    this.documents = context.services.tryGet<DocumentManager>(LanguageServiceKeys.Documents);

    this.installErrorHandlers(context);
    context.commands.register(CommandIds.CrashRestore, () => void this.restore(), 'Recovery: Restore Unsaved Work');
    context.commands.register(CommandIds.CrashDiscard, () => void this.discard(), 'Recovery: Discard Recovered Work');

    try {
      const info = await window.znxstudio.app.getInfo();
      this.snapshotPath = joinPath(joinPath(info.tempDir, 'znxstudio-session'), SNAPSHOT_FILE);
    } catch {
      this.snapshotPath = '';
    }

    await this.checkPreviousSession();
    this.watchDocuments(context);
    void selfTestCoordinator.run('crash-recovery', () => this.maybeSelfTest());
  }

  /* ----- catching this session's failures ----- */

  /**
   * A renderer error is reported to the main process so the NEXT launch can show
   * it. It is also logged, which flushes to disk immediately (an `error` bypasses
   * the log's batching) — the line before a crash is the line that matters.
   */
  private installErrorHandlers(context: ModuleContext): void {
    const onError = (event: ErrorEvent): void => void this.report(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent): void => void this.report(event.reason);

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    context.subscriptions.push({
      dispose: () => {
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
      },
    });
  }

  private async report(value: unknown): Promise<void> {
    // A cancelled Monaco request is not a crash. Left unfiltered, ordinary
    // typing fills the crash record with `Canceled` and buries the real one.
    if (isRoutineCancellation(value)) {
      this.logger?.trace('crash', 'ignored a routine cancellation');
      return;
    }
    const record = serializeError(value, 'renderer', Date.now());
    this.logger?.error('crash', `${record.reason}: ${record.message}`);
    // Snapshot NOW: an uncaught error may be the last thing that happens.
    await this.saveSnapshot();
    try {
      await window.znxstudio.diagnostics.recordCrash(record);
    } catch {
      /* the log line is already on disk */
    }
  }

  /* ----- the previous session ----- */

  private async checkPreviousSession(): Promise<void> {
    try {
      this.session = await window.znxstudio.diagnostics.session();
    } catch {
      this.session = null;
      return;
    }

    const snapshot = await this.loadSnapshot();
    if (this.session.previousCrash) {
      this.logger?.warn('crash', `Previous session: ${describeCrash(this.session.previousCrash)}`);
    }

    if (!shouldOfferRestore(this.session, snapshot)) {
      // A clean exit means the user closed the editor. Re-opening their buffers
      // uninvited would be rude, so the stale snapshot is simply dropped.
      if (this.session.previousExitClean) await this.clearSnapshot();
      return;
    }

    this.recovered = snapshot;
    this.logger?.warn('crash', `Previous session did not exit cleanly. ${snapshotSummary(snapshot!)}`);
    this.moduleContext.layout.showToast(
      `ZnxStudio did not shut down cleanly. ${snapshotSummary(snapshot!)} — run "Recovery: Restore Unsaved Work".`,
      'error',
    );
  }

  private async loadSnapshot(): Promise<SessionSnapshot | null> {
    if (!this.snapshotPath) return null;
    try {
      return parseSnapshot(await window.znxstudio.fs.readFile(this.snapshotPath));
    } catch {
      return null;
    }
  }

  private async clearSnapshot(): Promise<void> {
    if (!this.snapshotPath) return;
    try {
      await window.znxstudio.fs.writeFile(this.snapshotPath, '');
    } catch {
      /* nothing to clear */
    }
  }

  /* ----- snapshotting this session ----- */

  private watchDocuments(context: ModuleContext): void {
    if (!this.documents) return;
    const schedule = (): void => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.saveSnapshot(), SNAPSHOT_DEBOUNCE_MS);
    };
    this.documents.onDidChange(schedule);
    this.documents.onDidSave(schedule);
    context.subscriptions.push({
      dispose: () => {
        if (this.timer) clearTimeout(this.timer);
      },
    });
  }

  /**
   * Only DIRTY buffers carry their text. A clean buffer is already on disk, so
   * copying it into the snapshot would bloat the marker without recovering
   * anything.
   */
  private currentBuffers(): OpenBuffer[] {
    if (!this.documents) return [];
    return this.documents.allManaged().map((document) => ({
      path: document.path,
      ...(document.dirty ? { text: document.model.getValue() } : {}),
      line: 0,
      character: 0,
    }));
  }

  async saveSnapshot(): Promise<boolean> {
    if (!this.snapshotPath) return false;
    const snapshot = buildSnapshot(this.currentBuffers(), this.editor?.currentFile() ?? null, Date.now());
    try {
      await window.znxstudio.fs.writeFile(this.snapshotPath, JSON.stringify(snapshot));
      return true;
    } catch {
      return false;
    }
  }

  /* ----- restoring ----- */

  /**
   * Open each recovered buffer and re-apply its unsaved text into the editor
   * model — leaving it DIRTY. Nothing is written to disk: the user decides,
   * file by file, whether the recovered version is the one they want.
   */
  private async restore(): Promise<void> {
    if (!this.recovered) {
      this.moduleContext.layout.showToast('There is no recovered work to restore.', 'info');
      return;
    }
    const buffers = recoverableBuffers(this.recovered);
    let restored = 0;
    for (const buffer of buffers) {
      try {
        await this.editor?.openFile(buffer.path);
        const managed = this.documents?.allManaged().find((document) => document.path === buffer.path);
        if (managed && buffer.text !== undefined && managed.model.getValue() !== buffer.text) {
          managed.model.setValue(buffer.text);
          restored += 1;
        }
      } catch (error) {
        this.logger?.error('crash', `could not restore ${buffer.path}: ${(error as Error).message}`);
      }
    }
    this.recovered = null;
    await this.acknowledge();
    this.moduleContext.layout.showToast(
      `Restored ${restored} unsaved file(s) into the editor. Nothing was written to disk — review and save.`,
      'info',
    );
  }

  private async discard(): Promise<void> {
    this.recovered = null;
    await this.clearSnapshot();
    await this.acknowledge();
    this.moduleContext.layout.showToast('Recovered work discarded.', 'info');
  }

  private async acknowledge(): Promise<void> {
    try {
      await window.znxstudio.diagnostics.acknowledgeCrash();
    } catch {
      /* the next launch will simply offer it again */
    }
  }

  /** For the health dashboard. */
  sessionState(): SessionState | null {
    return this.session;
  }

  hasRecoverableWork(): boolean {
    return Boolean(this.recovered && recoverableBuffers(this.recovered).length);
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      return;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    try {
      log(
        `crash REAL session: previousExitClean=${this.session?.previousExitClean} ` +
          `previousCrash=${this.session?.previousCrash?.reason ?? 'none'} logDir=${this.session?.logDirectory}`,
      );

      const wrote = await this.saveSnapshot();
      const roundTripped = await this.loadSnapshot();
      log(
        `crash REAL snapshot: wrote=${wrote} path=${this.snapshotPath} ` +
          `buffers=${roundTripped?.buffers.length ?? 0} recoverable=${roundTripped ? recoverableBuffers(roundTripped).length : 0}`,
      );

      // A clean previous exit must NEVER offer a restore, even with unsaved work.
      const withWork = buildSnapshot([{ path: 'a.zx', text: 'create x = 1', line: 0, character: 0 }], 'a.zx', Date.now());
      const clean: SessionState = { previousExitClean: true, previousCrash: null, logDirectory: '' };
      const crashed: SessionState = { previousExitClean: false, previousCrash: null, logDirectory: '' };
      log(`crash offer after CLEAN exit with unsaved work: ${shouldOfferRestore(clean, withWork)} (expect false)`);
      log(`crash offer after CRASH with unsaved work: ${shouldOfferRestore(crashed, withWork)} (expect true)`);

      const nothingUnsaved = buildSnapshot([{ path: 'a.zx', line: 0, character: 0 }], 'a.zx', Date.now());
      log(`crash offer after CRASH with nothing unsaved: ${shouldOfferRestore(crashed, nothingUnsaved)} (expect false)`);

      // A routine Monaco cancellation must NOT be recorded as a crash.
      const canceled = new Error('Canceled');
      canceled.name = 'Canceled';
      log(`crash routine cancellation ignored = ${isRoutineCancellation(canceled)} (expect true — typing cancels Monaco requests constantly)`);
      log(`crash a real error is NOT routine = ${isRoutineCancellation(new RangeError('boom'))} (expect false)`);

      // A real renderer error, caught by the real listener, recorded by main.
      window.dispatchEvent(new ErrorEvent('error', { error: new RangeError('self-test induced'), message: 'self-test induced' }));
      await new Promise((resolve) => setTimeout(resolve, 250));
      const after = await window.znxstudio.diagnostics.session();
      log(
        'crash REAL renderer error dispatched → recorded by the main process ' +
          `(this session's marker is still open; previousExitClean reflects the LAST run, now ${after.previousExitClean})`,
      );

      await this.acknowledge();
    } catch (error) {
      log(`crash REAL failed: ${(error as Error).message}`);
    }
  }
}
