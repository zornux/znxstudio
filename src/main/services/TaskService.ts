import { execFile, spawn, type ChildProcess } from 'node:child_process';
import type { WebContents } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { TaskRunOptions } from '../../shared/types';

/**
 * Spawns arbitrary CLI tasks (from a project's manifest scripts) and streams
 * their stdout/stderr back to the renderer's Output channel. Uses a shell so
 * script strings like "npm run build" work verbatim per platform.
 */
export class TaskService {
  private readonly tasks = new Map<string, ChildProcess>();

  run(options: TaskRunOptions, sender: WebContents): void {
    this.kill(options.id);

    const child = spawn(options.command, {
      cwd: options.cwd,
      shell: true,
      env: process.env,
      windowsHide: true,
    });
    this.tasks.set(options.id, child);

    const emit = (stream: 'stdout' | 'stderr', data: string) => {
      if (!sender.isDestroyed()) {
        sender.send(IpcChannels.TaskOutput, { id: options.id, stream, data });
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => emit('stdout', chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => emit('stderr', chunk.toString()));
    child.on('error', (error) => emit('stderr', `\n[task error] ${error.message}\n`));
    child.on('close', (code) => {
      if (!sender.isDestroyed()) {
        sender.send(IpcChannels.TaskExit, { id: options.id, code });
      }
      this.tasks.delete(options.id);
    });
  }

  kill(id: string): void {
    const child = this.tasks.get(id);
    if (!child) return;
    this.tasks.delete(id);
    // `shell: true` makes child.pid the shell (cmd.exe/sh), so child.kill() leaves
    // the tool the script launched (dotnet/node/dev-server) orphaned. On Windows,
    // taskkill /T terminates the whole process tree.
    if (process.platform === 'win32' && child.pid !== undefined) {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {
        /* best-effort; process may have already exited */
      });
    } else {
      child.kill();
    }
  }

  /** Kill every running task — called on app quit so no task is orphaned. */
  killAll(): void {
    for (const id of [...this.tasks.keys()]) this.kill(id);
  }
}
