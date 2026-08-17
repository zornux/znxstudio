import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { MobileDebugConfig, MobileTestConfig } from '../../shared/types';
import { MobileService } from '../services/MobileService';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';

/**
 * Mobile development IPC (Android). All execution channels are gated by
 * workspace trust — a restricted workspace cannot spawn mobile CLI commands.
 */
export function registerMobileIpc(): void {
  const mobile = new MobileService();
  const trust = sharedWorkspaceTrust();

  // Device discovery is read-only — no trust gate needed.
  ipcMain.handle(IpcChannels.MobileDeviceList, () => mobile.devices());
  ipcMain.handle(IpcChannels.MobileDeviceSelect, (_event, id: string) => {
    // Selection is renderer-side state; this channel exists for future
    // persistence or cross-window sync. Currently a no-op in the service.
    void id;
  });
  ipcMain.handle(IpcChannels.MobileEmulatorList, () => mobile.emulators());

  // Execution channels require trust.
  ipcMain.handle(IpcChannels.MobileEmulatorStart, (_event, name: string) => {
    trust.assertTrusted('Start Emulator');
    return mobile.startEmulator(name);
  });
  ipcMain.handle(IpcChannels.MobileDoctor, (_event, platform: string) => {
    trust.assertTrusted('Mobile Doctor');
    return mobile.doctor(platform);
  });
  ipcMain.handle(IpcChannels.MobileRunStart, (event, deviceId: string, workspaceRoot: string) => {
    trust.assertTrusted('Mobile Run');
    mobile.runStart(deviceId, workspaceRoot, event.sender);
  });
  ipcMain.handle(IpcChannels.MobileRunStop, () => {
    mobile.runStop();
  });
  ipcMain.handle(IpcChannels.MobileRunStatus, () => mobile.status());

  // Mobile debug channels require trust.
  ipcMain.handle(IpcChannels.MobileDebugStart, (event, config: MobileDebugConfig) => {
    trust.assertTrusted('Mobile Debug');
    mobile.debugStart(config, event.sender);
  });
  ipcMain.handle(IpcChannels.MobileDebugStop, () => {
    mobile.debugStop();
  });
  ipcMain.handle(IpcChannels.MobileDebugStatus, () => mobile.debugStatus());

  // Mobile test channels require trust.
  ipcMain.handle(IpcChannels.MobileTestRun, (event, config: MobileTestConfig) => {
    trust.assertTrusted('Mobile Test');
    return mobile.testRun(config, event.sender);
  });
  ipcMain.handle(IpcChannels.MobileTestStop, () => {
    mobile.testStop();
  });
}
