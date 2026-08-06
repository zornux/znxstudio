import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { TaskRunOptions } from '../../shared/types';
import { TaskService } from '../services/TaskService';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';

/** Run/Build task execution with streamed output. */
export function registerTaskIpc(): void {
  const tasks = new TaskService();

  ipcMain.handle(IpcChannels.TaskRun, (event, options: TaskRunOptions) => {
    // Trust gate: an untrusted workspace must never execute a manifest script.
    sharedWorkspaceTrust().assertTrusted('running tasks');
    return tasks.run(options, event.sender);
  });
  ipcMain.on(IpcChannels.TaskKill, (_event, { id }: { id: string }) => tasks.kill(id));
  // Never orphan a running task when the app exits.
  app.on('will-quit', () => tasks.killAll());
}
