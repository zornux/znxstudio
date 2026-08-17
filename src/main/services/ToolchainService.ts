import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { WebContents } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { ToolchainComponent, ToolchainStatus, ToolchainSetupProgress } from '../../shared/types';
import { ZORNUX_EXE, zornuxCandidates } from '../util/zornuxRuntime';

const CLI_TIMEOUT_MS = 30_000;

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Maps a `zornux mobile doctor android` check name to a display component. */
const DOCTOR_CHECK_MAP: Record<string, { name: string; required: boolean }> = {
  jdk: { name: 'JDK', required: true },
  sdk: { name: 'Android SDK', required: true },
  platforms: { name: 'Platform SDK', required: true },
  'build-tools': { name: 'Build Tools', required: true },
  'platform-tools': { name: 'Platform Tools / ADB', required: true },
  emulator: { name: 'Emulator Tools', required: false },
};

/**
 * Manages the Android toolchain for ZnxStudio. Bridges to `zornux mobile doctor`
 * and `zornux mobile setup` CLI commands, and manages a Zornux-owned Android
 * toolchain directory at `~/.zornux/toolchains/android`.
 *
 * Everything degrades gracefully when the CLI is absent.
 */
export class ToolchainService {
  private setupProcess: ChildProcess | null = null;

  /** Canonical location for the Zornux-managed Android toolchain. */
  static managedPath(): string {
    return join(homedir(), '.zornux', 'toolchains', 'android');
  }

  /**
   * Run `zornux mobile doctor android --json` and return structured toolchain
   * status. Determines readiness from whether all required checks pass.
   */
  async status(): Promise<ToolchainStatus> {
    let code: number | null = null;
    let stdout = '';
    try {
      const result = await this.exec(['mobile', 'doctor', 'android', '--json']);
      code = result.code;
      stdout = result.stdout;
    } catch {
      return { ready: false, managedPath: existsSync(ToolchainService.managedPath()) ? ToolchainService.managedPath() : null, components: [] };
    }
    const managed = ToolchainService.managedPath();
    const managedExists = existsSync(managed);

    try {
      const parsed = JSON.parse(stdout);
      if (typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.checks)) {
        const components = this.mapChecksToComponents(parsed.checks);
        const ready = code === 0 && components
          .filter((c) => c.required)
          .every((c) => c.installed);
        return {
          ready,
          managedPath: managedExists ? managed : null,
          components,
        };
      }
    } catch {
      // Parse failure — fall through to default.
    }

    return {
      ready: false,
      managedPath: managedExists ? managed : null,
      components: [],
    };
  }

  /**
   * Spawn `zornux mobile setup android --json` to install/configure the
   * managed Android toolchain. Streams progress events to the renderer via
   * `IpcChannels.AndroidToolchainSetupProgress`.
   */
  async setup(sender: WebContents): Promise<void> {
    this.killSetup();

    const compilerPath = this.locateCompiler();
    const child = spawn(compilerPath, ['mobile', 'setup', 'android', '--json'], {
      windowsHide: true,
    });
    this.setupProcess = child;

    const emitProgress = (progress: ToolchainSetupProgress) => {
      if (!sender.isDestroyed()) {
        sender.send(IpcChannels.AndroidToolchainSetupProgress, progress);
      }
    };

    return new Promise<void>((resolve) => {
      let buffer = '';

      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.length === 0) continue;
          try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            emitProgress({
              step: String(obj.step ?? ''),
              progress: typeof obj.progress === 'number' ? obj.progress : 0,
              complete: Boolean(obj.complete),
              error: obj.error != null ? String(obj.error) : null,
            });
          } catch {
            // Non-JSON line — ignore.
          }
        }
      });

      child.stderr?.on('data', () => {
        /* captured but not surfaced during setup */
      });

      child.on('error', (error) => {
        this.setupProcess = null;
        emitProgress({ step: 'Complete', progress: 100, complete: true, error: error.message });
        resolve();
      });

      child.on('close', (exitCode) => {
        this.setupProcess = null;
        if (exitCode === 0) {
          emitProgress({ step: 'Complete', progress: 100, complete: true, error: null });
        } else {
          emitProgress({
            step: 'Complete',
            progress: 100,
            complete: true,
            error: `Setup exited with code ${exitCode ?? '—'}`,
          });
        }
        resolve();
      });
    });
  }

  /**
   * List installable/installed SDK components. Runs doctor and maps the results
   * to components with install status. Falls back to a static list based on
   * what exists in the managed path.
   */
  async sdkList(): Promise<ToolchainComponent[]> {
    let stdout = '';
    try {
      const result = await this.exec(['mobile', 'doctor', 'android', '--json']);
      stdout = result.stdout;
    } catch {
      return this.staticComponentProbe();
    }

    try {
      const parsed = JSON.parse(stdout);
      if (typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.checks)) {
        return this.mapChecksToComponents(parsed.checks);
      }
    } catch {
      // Parse failure — fall back to static probing.
    }

    return this.staticComponentProbe();
  }

  /**
   * Install a specific SDK component via `zornux mobile setup android --component <name>`.
   * Streams progress to the renderer.
   */
  async sdkInstall(component: string, sender: WebContents): Promise<void> {
    this.killSetup();

    const compilerPath = this.locateCompiler();
    const child = spawn(
      compilerPath,
      ['mobile', 'setup', 'android', '--component', component],
      { windowsHide: true },
    );
    this.setupProcess = child;

    const emitProgress = (progress: ToolchainSetupProgress) => {
      if (!sender.isDestroyed()) {
        sender.send(IpcChannels.AndroidToolchainSetupProgress, progress);
      }
    };

    return new Promise<void>((resolve) => {
      child.stdout?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          if (line.length > 0) {
            emitProgress({
              step: line.trim(),
              progress: 0,
              complete: false,
              error: null,
            });
          }
        }
      });

      child.stderr?.on('data', () => {});

      child.on('error', (error) => {
        this.setupProcess = null;
        emitProgress({ step: 'Complete', progress: 100, complete: true, error: error.message });
        resolve();
      });

      child.on('close', (exitCode) => {
        this.setupProcess = null;
        if (exitCode === 0) {
          emitProgress({ step: 'Complete', progress: 100, complete: true, error: null });
        } else {
          emitProgress({
            step: 'Complete',
            progress: 100,
            complete: true,
            error: `Install exited with code ${exitCode ?? '—'}`,
          });
        }
        resolve();
      });
    });
  }

  /**
   * Update the managed toolchain via `zornux mobile setup android --update --json`.
   * Streams progress to the renderer.
   */
  async update(sender: WebContents): Promise<void> {
    this.killSetup();

    const compilerPath = this.locateCompiler();
    const child = spawn(
      compilerPath,
      ['mobile', 'setup', 'android', '--update', '--json'],
      { windowsHide: true },
    );
    this.setupProcess = child;

    const emitProgress = (progress: ToolchainSetupProgress) => {
      if (!sender.isDestroyed()) {
        sender.send(IpcChannels.AndroidToolchainSetupProgress, progress);
      }
    };

    return new Promise<void>((resolve) => {
      let buffer = '';

      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.length === 0) continue;
          try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            emitProgress({
              step: String(obj.step ?? ''),
              progress: typeof obj.progress === 'number' ? obj.progress : 0,
              complete: Boolean(obj.complete),
              error: obj.error != null ? String(obj.error) : null,
            });
          } catch {
            // Non-JSON line — ignore.
          }
        }
      });

      child.stderr?.on('data', () => {});

      child.on('error', (error) => {
        this.setupProcess = null;
        emitProgress({ step: 'Complete', progress: 100, complete: true, error: error.message });
        resolve();
      });

      child.on('close', (exitCode) => {
        this.setupProcess = null;
        if (exitCode === 0) {
          emitProgress({ step: 'Complete', progress: 100, complete: true, error: null });
        } else {
          emitProgress({
            step: 'Complete',
            progress: 100,
            complete: true,
            error: `Update exited with code ${exitCode ?? '—'}`,
          });
        }
        resolve();
      });
    });
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
        env.PATH = pathAdditions.join(sep);
      }
    }

    return env;
  }

  /** Kill any running setup process on app quit. */
  dispose(): void {
    this.killSetup();
  }

  /* ----- internals ----- */

  private locateCompiler(): string {
    for (const candidate of zornuxCandidates()) {
      if (existsSync(candidate.path)) return candidate.path;
    }
    return ZORNUX_EXE;
  }

  private exec(args: string[]): Promise<ExecResult> {
    const command = this.locateCompiler();
    return new Promise<ExecResult>((resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true });
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error(`zornux mobile timed out after ${CLI_TIMEOUT_MS}ms`));
      }, CLI_TIMEOUT_MS);

      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  }

  private killSetup(): void {
    const child = this.setupProcess;
    if (!child) return;

    this.setupProcess = null;

    if (process.platform === 'win32' && child.pid !== undefined) {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {
        /* best-effort */
      });
    } else {
      child.kill();
    }
  }

  /**
   * Map raw doctor check objects to `ToolchainComponent` using the known
   * check-name-to-display-name mapping. Parses version info from the detail
   * string when available.
   */
  private mapChecksToComponents(checks: Record<string, unknown>[]): ToolchainComponent[] {
    return checks.map((check) => {
      const checkName = String(check.name ?? '');
      const mapping = DOCTOR_CHECK_MAP[checkName] ?? { name: checkName, required: true };
      const detail = String(check.detail ?? '');
      const { version, requiredVersion } = this.parseVersions(detail);

      return {
        name: mapping.name,
        required: mapping.required,
        installed: Boolean(check.passed),
        version,
        requiredVersion,
        updateAvailable: false,
      };
    });
  }

  /** Extract version and required version from a doctor detail string. */
  private parseVersions(detail: string): { version: string | null; requiredVersion: string | null } {
    let version: string | null = null;
    let requiredVersion: string | null = null;

    // Pattern: "Found version X.Y.Z" or "version: X.Y.Z" or "X.Y.Z installed"
    const versionMatch = detail.match(/(?:Found version|version[:\s]+|^)([\d]+(?:\.[\d]+)*)/i);
    if (versionMatch) version = versionMatch[1];

    // Pattern: "requires X.Y.Z" or "minimum X.Y.Z" or ">= X.Y.Z"
    const requiredMatch = detail.match(/(?:requires|minimum|>=)\s*([\d]+(?:\.[\d]+)*)/i);
    if (requiredMatch) requiredVersion = requiredMatch[1];

    return { version, requiredVersion };
  }

  /**
   * Probe the managed toolchain directory to build a static component list when
   * the CLI doctor output is unavailable.
   */
  private staticComponentProbe(): ToolchainComponent[] {
    const managed = ToolchainService.managedPath();
    const components: ToolchainComponent[] = [];

    const probes: Array<{ name: string; required: boolean; subPath: string }> = [
      { name: 'JDK', required: true, subPath: 'jdk' },
      { name: 'Android SDK', required: true, subPath: 'sdk' },
      { name: 'Platform SDK', required: true, subPath: join('sdk', 'platforms') },
      { name: 'Build Tools', required: true, subPath: join('sdk', 'build-tools') },
      { name: 'Platform Tools / ADB', required: true, subPath: join('sdk', 'platform-tools') },
      { name: 'Emulator Tools', required: false, subPath: join('sdk', 'emulator') },
    ];

    for (const probe of probes) {
      components.push({
        name: probe.name,
        required: probe.required,
        installed: existsSync(join(managed, probe.subPath)),
        version: null,
        requiredVersion: null,
        updateAvailable: false,
      });
    }

    return components;
  }
}
