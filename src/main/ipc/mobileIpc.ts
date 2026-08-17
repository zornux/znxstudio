import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type {
  AndroidProjectConfig,
  MobileBuildConfig,
  MobileDebugConfig,
  MobileProfileConfig,
  MobileTestConfig,
} from '../../shared/types';
import { MobileService } from '../services/MobileService';
import { ToolchainService } from '../services/ToolchainService';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';
import { confineToRoots } from '../util/pathBoundary';

/**
 * Mobile development IPC (Android). All execution channels are gated by
 * workspace trust — a restricted workspace cannot spawn mobile CLI commands.
 * Read-only channels (device list, status, project config) are ungated.
 *
 * Every IPC handler that accepts a workspace path confines it to the active
 * workspace roots via `confineToRoots` before passing it to the service layer.
 * String arguments (device IDs, component names, platform names) are validated
 * to prevent injection.
 */
export function registerMobileIpc(): void {
  const mobile = new MobileService();
  const toolchain = new ToolchainService();
  const trust = sharedWorkspaceTrust();

  /** Confine a renderer-supplied path to workspace roots, or throw. */
  function confineWorkspace(rawPath: string): string {
    const safe = confineToRoots(rawPath, trust.getRoots());
    if (!safe) throw new Error('Path is outside workspace boundaries.');
    return safe;
  }

  /** Reject strings containing shell metacharacters or control characters. */
  function assertSafeId(value: string, label: string): void {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
      throw new Error(`Invalid ${label}.`);
    }
    if (/[\x00-\x1f;|&`$"'\\<>(){}[\]]/.test(value)) {
      throw new Error(`Invalid characters in ${label}.`);
    }
  }

  /* ----- device / emulator discovery (trust-gated — spawns CLI) ----- */

  ipcMain.handle(IpcChannels.MobileDeviceList, () => {
    trust.assertTrusted('Device List');
    return mobile.devices();
  });
  ipcMain.handle(IpcChannels.MobileDeviceSelect, (_event, id: string) => {
    assertSafeId(id, 'device ID');
  });
  ipcMain.handle(IpcChannels.MobileEmulatorList, () => {
    trust.assertTrusted('Emulator List');
    return mobile.emulators();
  });

  /* ----- execution channels (trust-gated) ----- */

  ipcMain.handle(IpcChannels.MobileEmulatorStart, (_event, name: string) => {
    trust.assertTrusted('Start Emulator');
    assertSafeId(name, 'emulator name');
    return mobile.startEmulator(name);
  });

  ipcMain.handle(IpcChannels.MobileDoctor, (_event, platform: string) => {
    trust.assertTrusted('Mobile Doctor');
    assertSafeId(platform, 'platform');
    return mobile.doctor(platform);
  });

  ipcMain.handle(IpcChannels.MobileRunStart, (event, deviceId: string, workspaceRoot: string) => {
    trust.assertTrusted('Mobile Run');
    assertSafeId(deviceId, 'device ID');
    const root = confineWorkspace(workspaceRoot);
    mobile.runStart(deviceId, root, event.sender);
  });

  ipcMain.handle(IpcChannels.MobileRunStop, () => {
    mobile.runStop();
  });

  ipcMain.handle(IpcChannels.MobileRunStatus, () => mobile.status());

  /* ----- debug ----- */

  ipcMain.handle(IpcChannels.MobileDebugStart, (event, config: MobileDebugConfig) => {
    trust.assertTrusted('Mobile Debug');
    assertSafeId(config.deviceId, 'device ID');
    config = { ...config, workspaceRoot: confineWorkspace(config.workspaceRoot) };
    mobile.debugStart(config, event.sender);
  });

  ipcMain.handle(IpcChannels.MobileDebugStop, () => {
    mobile.debugStop();
  });

  ipcMain.handle(IpcChannels.MobileDebugStatus, () => mobile.debugStatus());

  /* ----- tests ----- */

  ipcMain.handle(IpcChannels.MobileTestRun, (event, config: MobileTestConfig) => {
    trust.assertTrusted('Mobile Test');
    config = { ...config, workspaceRoot: confineWorkspace(config.workspaceRoot) };
    if (config.deviceId) assertSafeId(config.deviceId, 'device ID');
    if (config.filter) assertSafeId(config.filter, 'test filter');
    return mobile.testRun(config, event.sender);
  });

  ipcMain.handle(IpcChannels.MobileTestStop, () => {
    mobile.testStop();
  });

  /* ----- profiling ----- */

  ipcMain.handle(IpcChannels.MobileProfileStart, (event, config: MobileProfileConfig) => {
    trust.assertTrusted('Mobile Profile');
    config = { ...config, workspaceRoot: confineWorkspace(config.workspaceRoot) };
    if (config.deviceId) assertSafeId(config.deviceId, 'device ID');
    mobile.profileStart(config, event.sender);
  });

  ipcMain.handle(IpcChannels.MobileProfileStop, () => {
    return mobile.profileStop();
  });

  /* ----- build ----- */

  ipcMain.handle(IpcChannels.MobileBuildApk, (event, config: MobileBuildConfig) => {
    trust.assertTrusted('Mobile Build APK');
    config = { ...config, workspaceRoot: confineWorkspace(config.workspaceRoot) };
    return mobile.buildApk(config, event.sender);
  });

  ipcMain.handle(IpcChannels.MobileBuildAab, (event, config: MobileBuildConfig) => {
    trust.assertTrusted('Mobile Build AAB');
    config = { ...config, workspaceRoot: confineWorkspace(config.workspaceRoot) };
    return mobile.buildAab(config, event.sender);
  });

  ipcMain.handle(IpcChannels.MobileBuildStop, () => {
    mobile.buildStop();
  });

  /* ----- release ----- */

  ipcMain.handle(IpcChannels.MobileReleaseCheck, (_event, workspaceRoot: string) => {
    trust.assertTrusted('Mobile Release Check');
    return mobile.releaseCheck(confineWorkspace(workspaceRoot));
  });

  /* ----- clean ----- */

  ipcMain.handle(IpcChannels.MobileClean, (_event, workspaceRoot: string) => {
    trust.assertTrusted('Mobile Clean');
    return mobile.clean(confineWorkspace(workspaceRoot));
  });

  /* ----- session state (read-only query) ----- */

  ipcMain.handle(IpcChannels.MobileSessionState, () => {
    return mobile.getSessionState();
  });

  /* ----- project config ----- */

  ipcMain.handle(IpcChannels.MobileProjectConfig, (_event, workspaceRoot: string) => {
    trust.assertTrusted('Read Project Config');
    return mobile.projectConfig(confineWorkspace(workspaceRoot));
  });

  ipcMain.handle(IpcChannels.MobileProjectConfigUpdate, (_event, workspaceRoot: string, updates: Partial<AndroidProjectConfig>) => {
    trust.assertTrusted('Update Project Config');
    return mobile.updateProjectConfig(confineWorkspace(workspaceRoot), updates);
  });

  /* ----- Android toolchain ----- */

  ipcMain.handle(IpcChannels.AndroidToolchainStatus, () => {
    trust.assertTrusted('Android Toolchain Status');
    return toolchain.status();
  });

  ipcMain.handle(IpcChannels.AndroidToolchainSetup, (event) => {
    trust.assertTrusted('Android Toolchain Setup');
    return toolchain.setup(event.sender);
  });

  ipcMain.handle(IpcChannels.AndroidToolchainSdkList, () => {
    trust.assertTrusted('Android SDK List');
    return toolchain.sdkList();
  });

  ipcMain.handle(IpcChannels.AndroidToolchainSdkInstall, (event, component: string) => {
    trust.assertTrusted('Android SDK Install');
    assertSafeId(component, 'SDK component');
    return toolchain.sdkInstall(component, event.sender);
  });

  ipcMain.handle(IpcChannels.AndroidToolchainUpdate, (event) => {
    trust.assertTrusted('Android Toolchain Update');
    return toolchain.update(event.sender);
  });

  app.on('will-quit', () => {
    mobile.dispose();
    toolchain.dispose();
  });
}
