import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The on-disk log (Phase 19D). Lines arrive already REDACTED from the renderer;
 * this service only decides where they go and when the file rolls over.
 *
 * Appends are synchronous on purpose. The one moment a log matters most is the
 * moment before a crash, and an async write queued behind a dying event loop is
 * a log line that never reaches the disk.
 */
const LOG_DIRECTORY = 'logs';
const LOG_FILE = 'znxstudio.log';
const PREVIOUS_LOG_FILE = 'znxstudio.previous.log';
/** Roll at 2 MB, keeping exactly one previous file. */
const MAX_LOG_BYTES = 2 * 1024 * 1024;

export class LogService {
  private readonly directory: string;

  constructor(userDataPath = app.getPath('userData')) {
    this.directory = join(userDataPath, LOG_DIRECTORY);
    mkdirSync(this.directory, { recursive: true });
  }

  get path(): string {
    return join(this.directory, LOG_FILE);
  }

  get previousPath(): string {
    return join(this.directory, PREVIOUS_LOG_FILE);
  }

  get logDirectory(): string {
    return this.directory;
  }

  append(lines: string[]): void {
    if (!lines.length) return;
    this.rollIfNeeded();
    try {
      appendFileSync(this.path, `${lines.join('\n')}\n`, 'utf8');
    } catch {
      // A log that cannot be written must never take the IDE down with it.
    }
  }

  /** The last `limit` lines, oldest first. */
  read(limit = 500): string[] {
    try {
      if (!existsSync(this.path)) return [];
      const lines = readFileSync(this.path, 'utf8').split('\n').filter(Boolean);
      return lines.slice(-Math.max(1, limit));
    } catch {
      return [];
    }
  }

  clear(): void {
    try {
      rmSync(this.path, { force: true });
    } catch {
      // Nothing to do; the next append recreates it.
    }
  }

  /**
   * Roll the file when it grows past the cap. Exactly one generation is kept:
   * enough to survive a crash-then-restart, bounded enough that a log left
   * running for a month cannot fill a disk.
   */
  private rollIfNeeded(): void {
    try {
      if (!existsSync(this.path)) return;
      if (statSync(this.path).size < MAX_LOG_BYTES) return;
      rmSync(this.previousPath, { force: true });
      renameSync(this.path, this.previousPath);
    } catch {
      // If the roll fails, keep appending to the current file rather than losing lines.
    }
  }
}
