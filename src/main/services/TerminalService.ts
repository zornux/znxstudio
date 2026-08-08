import type { WebContents } from 'electron';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import type { IPty } from '@lydell/node-pty';
import { IpcChannels } from '../../shared/ipc';
import type { TerminalCreateOptions } from '../../shared/types';
import { candidateShells, type ShellProfile } from '../../shared/terminal/shells';

type PtyModule = typeof import('@lydell/node-pty');
/** Native PTY package: prebuilt N-API binaries, no build toolchain required. */
const PTY_MODULE = '@lydell/node-pty';

interface Session {
  pty: IPty;
  sender: WebContents;
}

/**
 * Owns the native PTY sessions. `node-pty` is loaded lazily and defensively:
 * if the native binary is missing (e.g. not rebuilt for Electron) the rest of
 * the app keeps working and the renderer receives a clear error instead.
 */
export class TerminalService {
  private ptyModule: PtyModule | null = null;
  private loadError: Error | null = null;
  private readonly sessions = new Map<string, Session>();

  isAvailable(): boolean {
    try {
      this.load();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The shells actually installed on this machine, in priority order (the first
   * is the platform default). Candidates from the pure discovery module are
   * probed against the filesystem here; anything not found on disk is dropped,
   * and duplicates (same id or same executable) are collapsed.
   */
  listShells(): ShellProfile[] {
    const out: ShellProfile[] = [];
    const seenIds = new Set<string>();
    const seenFiles = new Set<string>();
    for (const candidate of candidateShells(platform(), process.env)) {
      if (seenIds.has(candidate.id)) continue;
      const file = candidate.paths.find((p) => {
        try {
          return existsSync(p);
        } catch {
          return false;
        }
      });
      if (!file) continue;
      const key = file.toLowerCase();
      if (seenFiles.has(key)) continue;
      seenIds.add(candidate.id);
      seenFiles.add(key);
      out.push({ id: candidate.id, label: candidate.label, file, args: candidate.args });
    }
    return out;
  }

  create(options: TerminalCreateOptions, sender: WebContents): void {
    const pty = this.load();
    // Run in Terminal: launch the program itself in the PTY (no shell wrapper),
    // so it gets a real TTY and interactive reads work. Otherwise open a shell.
    const target = options.command
      ? { file: options.command, args: options.args ?? [] }
      : this.resolveShell(options.shellId);

    const child = pty.spawn(target.file, target.args, {
      name: 'xterm-color',
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cwd: options.cwd || defaultCwd(),
      env: process.env as Record<string, string>,
    });

    child.onData((data) => {
      if (!sender.isDestroyed()) {
        sender.send(IpcChannels.TerminalData, { id: options.id, data });
      }
    });
    child.onExit(({ exitCode }) => {
      if (!sender.isDestroyed()) {
        sender.send(IpcChannels.TerminalExit, { id: options.id, exitCode });
      }
      this.sessions.delete(options.id);
    });

    this.sessions.set(options.id, { pty: child, sender });
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.sessions.get(id)?.pty.resize(cols, rows);
    } catch {
      /* resize can race with exit; ignore */
    }
  }

  dispose(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    const pid = session.pty.pid;
    try {
      session.pty.kill();
    } catch {
      /* already gone */
    }
    // On Windows, node-pty's ConPTY shell subtree (powershell + conhost) can
    // outlive pty.kill(); the surviving processes then keep the main process from
    // exiting, so the app hangs on quit. Reap the whole tree by PID — the same
    // treatment TaskService gives spawned tasks. Synchronous on purpose: this also
    // runs from `will-quit`, where the kill must complete before the process exits.
    if (platform() === 'win32' && pid) {
      try {
        execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* already gone */
      }
    }
    this.sessions.delete(id);
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.dispose(id);
  }

  /**
   * Map a requested shell id to a concrete executable. Falls back to the
   * platform default shell, then to the legacy hard-coded default so a terminal
   * always spawns even if discovery finds nothing.
   */
  private resolveShell(shellId?: string): { file: string; args: string[] } {
    const shells = this.listShells();
    if (shellId) {
      const match = shells.find((s) => s.id === shellId);
      if (match) return { file: match.file, args: match.args };
    }
    if (shells.length > 0) return { file: shells[0].file, args: shells[0].args };
    return resolveDefaultShell();
  }

  private load(): PtyModule {
    if (this.ptyModule) return this.ptyModule;
    if (this.loadError) throw this.loadError;
    try {
      // Kept as a runtime require so esbuild leaves it external.
      this.ptyModule = require(PTY_MODULE) as PtyModule;
      return this.ptyModule;
    } catch (error) {
      this.loadError = error as Error;
      throw this.loadError;
    }
  }
}

function resolveDefaultShell(): { file: string; args: string[] } {
  if (platform() === 'win32') {
    return { file: 'powershell.exe', args: [] };
  }
  return { file: process.env.SHELL || '/bin/bash', args: [] };
}

function defaultCwd(): string {
  return process.env.HOME || process.env.USERPROFILE || process.cwd();
}
