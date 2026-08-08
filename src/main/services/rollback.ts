import { join } from 'node:path';

/**
 * Update rollback / last-known-good (Phase 20J WI3).
 *
 * `electron-updater` moves forward only — it has no way back once a bad update
 * installs. This adds one: before an update installs, the CURRENT app artifact is
 * snapshotted and a record is persisted OUTSIDE the install directory (so the
 * update can't wipe it). The freshly-updated app reads that record and, on the
 * user's request, restores the snapshot and relaunches into the previous version.
 *
 * Only the AppImage (Linux) install form can be swapped in place today. Windows
 * (NSIS) and macOS (.app bundle) have no single-file artifact to snapshot here, so
 * their controller reports unsupported and `available()` stays null — the UI then
 * never offers rollback rather than offering one that can't work.
 */

export interface RollbackRecord {
  /** The version a rollback restores — the one running when the update installed. */
  previousVersion: string;
  /** The version installed over it. A rollback is valid only while THIS version runs. */
  updatedToVersion: string;
  /** Absolute path of the snapshotted artifact. */
  backupPath: string;
  /** ISO timestamp the snapshot was taken. */
  createdAt: string;
  platform: string;
}

/** Snapshot/restore the platform's install artifact and track the rollback point. */
export interface RollbackController {
  /** Snapshot the current install + record a rollback point before installing `toVersion`. */
  prepare(fromVersion: string, toVersion: string): boolean;
  /** The valid rollback record for the running version, or null (stale points are discarded). */
  available(currentVersion: string): RollbackRecord | null;
  /** Restore the snapshot and relaunch into the previous version. */
  perform(currentVersion: string): boolean;
  /** Discard the rollback point (record + snapshot). */
  clear(): void;
}

/** A controller that never offers rollback — dev/unpackaged, or an unsupported install form. */
export const noopRollbackController: RollbackController = {
  prepare: () => false,
  available: () => null,
  perform: () => false,
  clear: () => {},
};

/** Filesystem primitives the controller needs, injected so it is unit-testable without disk. */
export interface RollbackIo {
  existsSync(path: string): boolean;
  readFileSync(path: string): string;
  writeFileSync(path: string, data: string): void;
  copyFileSync(src: string, dest: string): void;
  /** Atomically move `src` onto `dest`, replacing it. */
  renameSync(src: string, dest: string): void;
  mkdirSync(path: string): void;
  rmSync(path: string): void;
  /** Make a restored artifact executable again. */
  chmod(path: string): void;
}

export interface RollbackOptions {
  /** Directory (outside the install) holding the record + snapshots — e.g. userData. */
  stateDir: string;
  /** The current install artifact to snapshot/restore, or null when unsupported. */
  artifactPath: string | null;
  platform: string;
  io: RollbackIo;
  /** Relaunch into `execPath` (the restored artifact) and exit the current process. */
  relaunch: (execPath: string) => void;
  /** Injected clock so records stay deterministic in tests. */
  now: () => string;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

const RECORD_FILE = 'rollback.json';
const BACKUP_DIR = 'rollback';

/**
 * A filesystem-backed rollback controller. All IO is injected, so the same logic
 * is exercised in unit tests with fakes and in the app with node `fs` + electron.
 */
export class FsRollbackController implements RollbackController {
  private readonly recordPath: string;
  private readonly backupDir: string;
  private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void;

  constructor(private readonly o: RollbackOptions) {
    this.recordPath = join(o.stateDir, RECORD_FILE);
    this.backupDir = join(o.stateDir, BACKUP_DIR);
    this.log = o.log ?? (() => {});
  }

  prepare(fromVersion: string, toVersion: string): boolean {
    if (!this.o.artifactPath) {
      this.log('info', 'rollback: install form does not support snapshots; none taken');
      return false;
    }
    try {
      // Snapshots are large (a whole app image); keep only the most recent point.
      this.clear();
      if (!this.o.io.existsSync(this.backupDir)) this.o.io.mkdirSync(this.backupDir);
      const backupPath = join(this.backupDir, `${sanitize(fromVersion)}.bak`);
      this.o.io.copyFileSync(this.o.artifactPath, backupPath);
      const record: RollbackRecord = {
        previousVersion: fromVersion,
        updatedToVersion: toVersion,
        backupPath,
        createdAt: this.o.now(),
        platform: this.o.platform,
      };
      this.o.io.writeFileSync(this.recordPath, JSON.stringify(record, null, 2));
      this.log('info', `rollback: snapshotted ${fromVersion} before installing ${toVersion}`);
      return true;
    } catch (error) {
      this.log('warn', `rollback: snapshot failed: ${(error as Error).message}`);
      return false;
    }
  }

  available(currentVersion: string): RollbackRecord | null {
    const record = this.read();
    if (!record) return null;
    // A rollback point is valid ONLY while the exact version it was made for runs,
    // and only while its snapshot still exists. Anything else is stale — discard it
    // so a superseded 100s-of-MB snapshot never lingers.
    if (record.updatedToVersion !== currentVersion || !this.o.io.existsSync(record.backupPath)) {
      this.clear();
      return null;
    }
    return record;
  }

  perform(currentVersion: string): boolean {
    const record = this.available(currentVersion);
    if (!record || !this.o.artifactPath) return false;
    try {
      // Overwriting the RUNNING artifact in place fails with ETXTBSY (the mapped
      // executable is "busy"). Stage the snapshot beside it, then rename over the
      // target — rename swaps the directory entry without touching the running
      // inode, which is exactly how electron-updater applies its own AppImage swap.
      const staged = `${this.o.artifactPath}.rollback-tmp`;
      this.o.io.copyFileSync(record.backupPath, staged);
      this.o.io.chmod(staged);
      this.o.io.renameSync(staged, this.o.artifactPath);
      this.log('info', `rollback: restored ${record.previousVersion} over ${currentVersion}`);
      // The snapshot is now the running artifact again; drop the (consumed) point
      // before relaunching so the restored version starts with a clean slate.
      this.clear();
      this.o.relaunch(this.o.artifactPath);
      return true;
    } catch (error) {
      this.log('error', `rollback: restore failed: ${(error as Error).message}`);
      return false;
    }
  }

  clear(): void {
    try {
      const record = this.read();
      if (record?.backupPath && this.o.io.existsSync(record.backupPath)) this.o.io.rmSync(record.backupPath);
      if (this.o.io.existsSync(this.recordPath)) this.o.io.rmSync(this.recordPath);
    } catch (error) {
      this.log('warn', `rollback: clear failed: ${(error as Error).message}`);
    }
  }

  private read(): RollbackRecord | null {
    try {
      if (!this.o.io.existsSync(this.recordPath)) return null;
      const parsed = JSON.parse(this.o.io.readFileSync(this.recordPath)) as RollbackRecord;
      if (
        !parsed ||
        typeof parsed.previousVersion !== 'string' ||
        typeof parsed.updatedToVersion !== 'string' ||
        typeof parsed.backupPath !== 'string'
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}

/** Keep a version string safe for use as a filename (rc/nightly tags contain dots). */
function sanitize(version: string): string {
  return version.replace(/[^0-9A-Za-z._-]/g, '_');
}
