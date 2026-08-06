import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import { DiagnosticsService } from '../services/DiagnosticsService';
import { LogService } from '../services/LogService';
import { serializeError, type CrashRecord } from '../../shared/health';

/**
 * Logging, crash detection and process metrics (Phase 19).
 *
 * This is the ONLY main-process surface Phase 19 adds, and it opens no socket:
 * the log is a file under `userData`, the metrics come from Electron itself.
 * Performance data never leaves the machine.
 *
 * The services are constructed at registration — `DiagnosticsService` must read
 * the previous session's crash marker BEFORE anything overwrites it.
 */
let logs: LogService | null = null;
let diagnostics: DiagnosticsService | null = null;

export function registerHealthIpc(): void {
  logs = new LogService();
  diagnostics = new DiagnosticsService(app.getPath('userData'), logs.logDirectory);

  const log = logs;
  const diag = diagnostics;

  // A clean quit is what makes the NEXT launch able to say "no crash".
  app.on('before-quit', () => diag.markClean());

  // The main process dying takes the app with it; record it first, so the next
  // launch can show the user what happened rather than a silent restart.
  process.on('uncaughtException', (error) => {
    const record = serializeError(error, 'main', Date.now());
    diag.recordCrash(record);
    log.append([`${new Date().toISOString()} [error] [main] uncaught: ${record.reason}: ${record.message}`]);
    // Re-raise the original behaviour: a process in an unknown state is not one
    // to keep running. `before-quit` will not fire, which is correct — this
    // session did not exit cleanly.
    app.exit(1);
  });

  // Unhandled rejections don't take the app down, but they can leave state
  // inconsistent. Record + log each; after a threshold, escalate a visible
  // "may be unstable" warning into the app log the user can inspect.
  let rejectionCount = 0;
  const REJECTION_ALERT_THRESHOLD = 5;
  process.on('unhandledRejection', (reason) => {
    const record = serializeError(reason, 'main', Date.now());
    diag.recordCrash(record);
    rejectionCount += 1;
    log.append([`${new Date().toISOString()} [error] [main] unhandled rejection (#${rejectionCount}): ${record.message}`]);
    if (rejectionCount === REJECTION_ALERT_THRESHOLD) {
      log.append([
        `${new Date().toISOString()} [warning] [main] ${REJECTION_ALERT_THRESHOLD} unhandled rejections this session — the app may be unstable; consider restarting.`,
      ]);
    }
  });

  // A renderer that dies never gets to report it itself.
  app.on('render-process-gone', (_event, contents, details) => {
    const record: CrashRecord = {
      time: Date.now(),
      origin: 'renderer',
      reason: details.reason,
      message: `renderer ${contents.id} gone (exit ${details.exitCode})`,
    };
    diag.recordCrash(record);
    log.append([`${new Date().toISOString()} [error] [renderer] ${record.reason} exit=${details.exitCode}`]);
  });

  app.on('child-process-gone', (_event, details) => {
    diag.recordCrash({
      time: Date.now(),
      origin: details.type === 'GPU' ? 'gpu' : 'unknown',
      reason: details.reason,
      message: `${details.type} process gone (exit ${details.exitCode})`,
    });
  });

  ipcMain.handle(IpcChannels.LogAppend, (_event, lines: string[]) => {
    log.append(Array.isArray(lines) ? lines.filter((line) => typeof line === 'string') : []);
  });
  ipcMain.handle(IpcChannels.LogRead, (_event, limit?: number) => log.read(limit ?? 500));
  ipcMain.handle(IpcChannels.LogPath, () => log.path);
  ipcMain.handle(IpcChannels.LogClear, () => log.clear());

  ipcMain.handle(IpcChannels.DiagSession, () => diag.session());
  ipcMain.handle(IpcChannels.DiagRecordCrash, (_event, record: CrashRecord) => diag.recordCrash(record));
  ipcMain.handle(IpcChannels.DiagAcknowledgeCrash, () => diag.acknowledgeCrash());
  ipcMain.handle(IpcChannels.DiagProcessMetrics, () => diag.processSnapshot());
}
