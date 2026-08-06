import { ipcMain, type WebContents } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { AiCompletionRequest } from '../../shared/ai/providers';
import { AiService } from '../services/AiService';

/** Vendor-neutral AI completions (Phase 10). The only place calls leave the machine. */
export function registerAiIpc(): void {
  const ai = new AiService();
  ipcMain.handle(IpcChannels.AiComplete, (_event, request: AiCompletionRequest) => ai.complete(request));
  ipcMain.handle(IpcChannels.AiProbe, (_event, request: AiCompletionRequest) => ai.probe(request));

  // Streaming: event-based (invoke can't stream). The renderer starts a stream
  // with an id; we push `AiStreamData` deltas and a final `AiStreamDone`, and
  // honor `AiStreamCancel`. Controllers are keyed by "<webContentsId>:<id>" so
  // one window can't cancel another's stream.
  const active = new Map<string, AbortController>();
  const streamKey = (sender: WebContents, id: string): string => `${sender.id}:${id}`;

  ipcMain.on(IpcChannels.AiStreamStart, (event, payload: { id: string; request: AiCompletionRequest }) => {
    const { id, request } = payload;
    const key = streamKey(event.sender, id);
    const controller = new AbortController();
    active.set(key, controller);
    const send = (channel: string, data: unknown): void => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, data);
    };
    void ai
      .completeStream(request, (delta) => send(IpcChannels.AiStreamData, { id, delta }), controller.signal)
      .then((result) => send(IpcChannels.AiStreamDone, { id, result }))
      .catch((error: unknown) =>
        send(IpcChannels.AiStreamDone, { id, result: { ok: false, text: '', error: (error as Error).message } }),
      )
      .finally(() => active.delete(key));
  });

  ipcMain.on(IpcChannels.AiStreamCancel, (event, payload: { id: string }) => {
    active.get(streamKey(event.sender, payload.id))?.abort();
  });
}
