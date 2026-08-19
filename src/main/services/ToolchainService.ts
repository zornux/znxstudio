import { execFile, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { WebContents } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { ToolchainComponent, ToolchainStatus, ToolchainSetupProgress } from '../../shared/types';
import { probeAndroidEnvironment } from './AndroidEnvironmentProbe';
import { AndroidSdkManager } from './AndroidSdkManager';

/**
 * Manages the Android toolchain for ZnxStudio. Uses the built-in
 * {@link AndroidSdkManager} to auto-download the JDK, command-line tools,
 * and SDK components into `~/.zornux/toolchains/android`.
 *
 * Everything degrades gracefully when downloads or tools are unavailable.
 */
export class ToolchainService {
  private readonly sdkManager = new AndroidSdkManager();

  /** Canonical location for the Zornux-managed Android toolchain. */
  static managedPath(): string {
    return join(homedir(), '.zornux', 'toolchains', 'android');
  }

  /** IDE-owned status probe; it does not depend on compiler-formatted output. */
  async status(): Promise<ToolchainStatus> {
    return (await probeAndroidEnvironment()).toolchain;
  }

  /**
   * Auto-download and install the full Android toolchain: JDK 21,
   * command-line tools, SDK platforms, build tools, emulator, and a
   * default AVD. Streams progress events to the renderer via
   * `IpcChannels.AndroidToolchainSetupProgress`.
   */
  async setup(sender: WebContents): Promise<void> {
    const emitProgress = (progress: ToolchainSetupProgress) => {
      if (!sender.isDestroyed()) {
        sender.send(IpcChannels.AndroidToolchainSetupProgress, progress);
      }
    };

    await this.sdkManager.setup(emitProgress);
  }

  /** List components from the IDE-owned environment probe. */
  async sdkList(): Promise<ToolchainComponent[]> {
    return (await probeAndroidEnvironment()).toolchain.components;
  }

  /**
   * Install a specific SDK component (e.g. `platforms;android-36`,
   * `build-tools;35.0.1`). Streams progress to the renderer.
   */
  async sdkInstall(component: string, sender: WebContents): Promise<void> {
    const emitProgress = (progress: ToolchainSetupProgress) => {
      if (!sender.isDestroyed()) {
        sender.send(IpcChannels.AndroidToolchainSetupProgress, progress);
      }
    };

    await this.sdkManager.installComponent(component, emitProgress);
  }

  /**
   * Update all managed SDK components to their latest versions.
   * Streams progress to the renderer.
   */
  async update(sender: WebContents): Promise<void> {
    const emitProgress = (progress: ToolchainSetupProgress) => {
      if (!sender.isDestroyed()) {
        sender.send(IpcChannels.AndroidToolchainSetupProgress, progress);
      }
    };

    await this.sdkManager.updateComponents(emitProgress);
  }

  /**
   * Return environment variables pointing at the managed toolchain. Only includes
   * variables for components that exist on disk.
   */
  managedEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const managed = ToolchainService.managedPath();

    const jdkPath = join(managed, 'jdk');
    if (existsSync(jdkPath)) {
      env.JAVA_HOME = jdkPath;
    } else if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) {
      env.JAVA_HOME = process.env.JAVA_HOME;
    }

    const sdkPath = join(managed, 'sdk');
    if (existsSync(sdkPath)) {
      env.ANDROID_HOME = sdkPath;

      const pathAdditions: string[] = [];
      const platformTools = join(sdkPath, 'platform-tools');
      if (existsSync(platformTools)) pathAdditions.push(platformTools);

      const cmdlineTools = join(sdkPath, 'cmdline-tools', 'latest', 'bin');
      if (existsSync(cmdlineTools)) pathAdditions.push(cmdlineTools);

      const emulatorDir = join(sdkPath, 'emulator');
      if (existsSync(emulatorDir)) pathAdditions.push(emulatorDir);

      if (pathAdditions.length > 0) {
        const sep = process.platform === 'win32' ? ';' : ':';
        env.PATH = `${pathAdditions.join(sep)}${sep}${process.env.PATH ?? ''}`;
      }
    }

    return env;
  }

  /** Cancel any running setup and release resources. */
  dispose(): void {
    this.sdkManager.abort();
  }
}
