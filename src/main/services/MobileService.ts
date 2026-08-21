import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { WebContents } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type {
  AndroidDevice,
  AndroidEmulator,
  AndroidProjectConfig,
  MobileBuildConfig,
  MobileBuildResult,
  MobileDebugConfig,
  MobileDebugStatus,
  MobileDoctorResult,
  MobileProfileConfig,
  MobileProfileMetric,
  MobileProfileReport,
  MobileReleaseCheckResult,
  MobileRunStatus,
  MobileSessionState,
  MobileTestConfig,
  MobileTestReport,
} from '../../shared/types';
import { ZORNUX_EXE, zornuxCandidates } from '../util/zornuxRuntime';
import { existsSync } from 'node:fs';
import { probeAndroidEnvironment } from './AndroidEnvironmentProbe';

const CLI_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 120_000;

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const ANDROID_APPLICATION_ID = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/;
const ANDROID_PERMISSION = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const SAFE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,99}$/;

/** Validate renderer-provided values before writing line-oriented project config. */
export function validateAndroidProjectConfig(updates: Partial<AndroidProjectConfig>): void {
  if (updates.applicationId != null && !ANDROID_APPLICATION_ID.test(updates.applicationId)) {
    throw new Error('Application ID must be a dot-separated Android package name.');
  }
  if (updates.version != null && !SAFE_VERSION.test(updates.version)) {
    throw new Error('Version must contain only letters, numbers, dots, plus signs, hyphens, or underscores.');
  }
  const integerFields: Array<[string, number | undefined]> = [
    ['Version code', updates.versionCode],
    ['Minimum SDK', updates.minSdk],
    ['Target SDK', updates.targetSdk],
    ['Compile SDK', updates.compileSdk],
  ];
  for (const [label, value] of integerFields) {
    if (value != null && (!Number.isSafeInteger(value) || value < 1 || value > 999)) {
      throw new Error(`${label} must be a whole number from 1 to 999.`);
    }
  }
  if (updates.minSdk != null && updates.targetSdk != null && updates.minSdk > updates.targetSdk) {
    throw new Error('Minimum SDK cannot be higher than target SDK.');
  }
  if (updates.targetSdk != null && updates.compileSdk != null && updates.targetSdk > updates.compileSdk) {
    throw new Error('Target SDK cannot be higher than compile SDK.');
  }
  if (updates.permissions != null) {
    if (!Array.isArray(updates.permissions) || updates.permissions.some((permission) =>
      typeof permission !== 'string' || !ANDROID_PERMISSION.test(permission))) {
      throw new Error('Permissions must be valid Android permission identifiers.');
    }
  }
}

/** Find the final build-result object even when progress or trailing logs surround it. */
export function parseMobileBuildOutput(stdout: string, stderr: string, code: number | null): MobileBuildResult {
  const parsedLines: Record<string, unknown>[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsedLines.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Progress and compiler text are allowed around the final JSON record.
    }
  }
  const parsed = [...parsedLines].reverse().find((entry) =>
    'success' in entry || 'artifactPath' in entry || 'diagnostics' in entry);
  if (!parsed) {
    return {
      success: false,
      artifactPath: null,
      artifactSizeBytes: null,
      diagnostics: [stderr.trim() || `Build exited with code ${code ?? '—'}`],
    };
  }
  return {
    success: Boolean(parsed.success),
    artifactPath: parsed.artifactPath != null ? String(parsed.artifactPath) : null,
    artifactSizeBytes: typeof parsed.artifactSizeBytes === 'number' ? parsed.artifactSizeBytes : null,
    diagnostics: Array.isArray(parsed.diagnostics)
      ? parsed.diagnostics.map((diagnostic) => String(diagnostic))
      : code === 0 ? [] : [stderr.trim() || `Build exited with code ${code ?? '—'}`],
  };
}

/**
 * Bridges the IDE to the `zornux mobile` CLI subcommands for Android
 * development. Manages device/emulator discovery, doctor checks, and the
 * persistent `zornux mobile run android --watch` process with log streaming.
 * Everything degrades gracefully when the CLI is absent.
 */
export class MobileService {
  private runProcess: ChildProcess | null = null;
  private runDeviceId: string | null = null;
  private logSender: WebContents | null = null;
  private debugProcess: ChildProcess | null = null;
  private debugDeviceId: string | null = null;
  private debugState: MobileDebugStatus['state'] = 'idle';
  private debugSender: WebContents | null = null;
  private testProcess: ChildProcess | null = null;
  private testSender: WebContents | null = null;
  private profileProcess: ChildProcess | null = null;
  private profileSender: WebContents | null = null;
  private profileMetrics: MobileProfileMetric[] = [];
  private buildProcess: ChildProcess | null = null;
  private buildSender: WebContents | null = null;
  private sessionState: MobileSessionState = 'idle';
  private selectedDeviceId: string | null = null;
  private generation = 0;

  selectDevice(id: string): void {
    this.selectedDeviceId = id;
  }

  /** List connected Android devices (physical + running emulators). */
  async devices(): Promise<AndroidDevice[]> {
    const { code, stdout } = await this.exec(['mobile', 'devices', '--json']);
    if (code === 0) {
      try {
        const parsed = JSON.parse(stdout);
        if (Array.isArray(parsed)) {
          return parsed.map((entry: Record<string, unknown>) => ({
            id: String(entry.id ?? ''),
            name: String(entry.name ?? entry.id ?? ''),
            type: entry.type === 'emulator' ? 'emulator' as const : 'physical' as const,
            apiLevel: typeof entry.apiLevel === 'string' ? entry.apiLevel : null,
            status: entry.status === 'offline' ? 'offline' as const
              : entry.status === 'unauthorized' ? 'unauthorized' as const
              : 'device' as const,
          })).filter((device: AndroidDevice) => device.id.length > 0);
        }
      } catch {
        // Older compilers may not expose mobile JSON; use ADB directly below.
      }
    }
    return this.adbDevices();
  }

  /** List available Android emulator AVDs. */
  async emulators(): Promise<AndroidEmulator[]> {
    const { code, stdout } = await this.exec(['mobile', 'emulators', '--json']);
    if (code === 0) {
      try {
        const parsed = JSON.parse(stdout);
        if (Array.isArray(parsed)) {
          return parsed.map((entry: Record<string, unknown>) => ({
            name: String(entry.name ?? ''),
            apiLevel: typeof entry.apiLevel === 'string' ? entry.apiLevel : null,
          })).filter((emulator: AndroidEmulator) => emulator.name.length > 0);
        }
      } catch {
        // Fall through to the installed emulator binary.
      }
    }
    const emulator = this.androidTool('emulator', 'emulator');
    if (!emulator) return [];
    const result = await this.execFile(emulator, ['-list-avds']);
    return parseAvdNames(result.stdout);
  }

  /** Start an emulator by AVD name. Fire-and-forget: the emulator boots asynchronously. */
  async startEmulator(name: string): Promise<void> {
    const result = await this.exec(['mobile', 'emulator', 'start', name]);
    if (result.code === 0) return;
    const emulator = this.androidTool('emulator', 'emulator');
    if (!emulator) throw new Error('Android Emulator is not installed.');
    const child = spawn(emulator, [`@${name}`, '-no-metrics'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: this.androidEnv(),
    });
    child.unref();
  }

  /** Run `zornux mobile doctor android` and return structured results. */
  async doctor(platform: string): Promise<MobileDoctorResult> {
    if (platform !== 'android') {
      return { ok: false, checks: [{ name: 'platform', passed: false, detail: `Unsupported mobile platform: ${platform}` }] };
    }
    return (await probeAndroidEnvironment()).doctor;
  }

  /** Start `zornux mobile run android --device <id> --watch`. Kills any previous run. */
  runStart(deviceId: string, workspaceRoot: string, sender: WebContents): void {
    this.runStop();

    const compilerPath = this.locateCompiler();
    const child = spawn(compilerPath, ['mobile', 'run', 'android', '--device', deviceId, '--watch'], {
      cwd: workspaceRoot,
      windowsHide: true,
      env: this.androidEnv(),
    });

    this.runProcess = child;
    this.runDeviceId = deviceId;
    this.logSender = sender;
    const gen = ++this.generation;
    this.setSessionState('running', sender);

    const emitLog = (line: string) => {
      if (this.logSender && !this.logSender.isDestroyed()) {
        this.logSender.send(IpcChannels.MobileLogs, { line });
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.length > 0) emitLog(line);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.length > 0) emitLog(`[stderr] ${line}`);
      }
    });
    child.on('error', (error) => emitLog(`[error] ${error.message}`));
    child.on('close', (code) => {
      emitLog(`[process exited with code ${code ?? '—'}]`);
      if (this.generation === gen) {
        this.runProcess = null;
        this.runDeviceId = null;
        this.setSessionState(code === 0 ? 'idle' : 'failed');
      }
    });
  }

  /** Stop the current mobile run process. */
  runStop(): void {
    const child = this.runProcess;
    if (!child) return;

    const gen = ++this.generation;
    this.runProcess = null;
    this.runDeviceId = null;
    this.setSessionState('stopping');

    const settle = () => {
      if (this.generation === gen) this.setSessionState('idle');
    };

    if (process.platform === 'win32' && child.pid !== undefined) {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => settle());
    } else {
      child.once('close', () => settle());
      child.kill();
      setTimeout(() => settle(), 3000);
    }
  }

  /** Current run status. */
  status(): MobileRunStatus {
    return {
      running: this.runProcess !== null,
      deviceId: this.runDeviceId,
    };
  }

  /** Start `zornux mobile debug android --device <id>`. Kills any previous debug session. */
  debugStart(config: MobileDebugConfig, sender: WebContents): void {
    this.debugStop();

    const compilerPath = this.locateCompiler();
    const args = ['mobile', 'debug', 'android', '--device', config.deviceId];
    const child = spawn(compilerPath, args, {
      cwd: config.workspaceRoot,
      windowsHide: true,
      env: this.androidEnv(),
    });

    this.debugProcess = child;
    this.debugDeviceId = config.deviceId;
    this.debugState = 'launching';
    this.debugSender = sender;
    this.logSender = sender;
    const gen = ++this.generation;
    this.setSessionState('debugging', sender);

    const emitEvent = (type: string, data?: Record<string, unknown>) => {
      if (this.debugSender && !this.debugSender.isDestroyed()) {
        this.debugSender.send(IpcChannels.MobileDebugEvent, { type, ...data });
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.length === 0) continue;
        if (line.includes('Debug session active')) {
          this.debugState = 'running';
          emitEvent('continued');
        } else if (line.includes('Stopped at')) {
          this.debugState = 'stopped';
          const match = line.match(/Stopped at (.+):(\d+)\s+\((\w+)\)/);
          emitEvent('stopped', {
            file: match?.[1],
            line: match?.[2] ? parseInt(match[2], 10) : undefined,
            reason: match?.[3],
          });
        } else if (line.includes('Screen:')) {
          const screenMatch = line.match(/Screen:\s+(.+)/);
          if (screenMatch) emitEvent('output', { message: `Screen: ${screenMatch[1]}` });
        } else if (line.includes('Debug session terminated') || line.includes('Debug session ended')) {
          this.debugState = 'terminated';
          emitEvent('terminated');
        } else if (line.startsWith('  [app]')) {
          emitEvent('output', { message: line.replace('  [app] ', '') });
        }
        if (this.logSender && !this.logSender.isDestroyed()) {
          this.logSender.send(IpcChannels.MobileLogs, { line });
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.length > 0) emitEvent('output', { message: `[stderr] ${line}` });
      }
    });
    child.on('error', (error) => {
      this.debugState = 'error';
      emitEvent('output', { message: `[error] ${error.message}` });
      if (this.generation === gen) {
        this.setSessionState('failed');
      }
    });
    child.on('close', (code) => {
      this.debugState = 'terminated';
      emitEvent('terminated', { message: `exited with code ${code ?? '—'}` });
      if (this.generation === gen) {
        this.debugProcess = null;
        this.debugDeviceId = null;
        this.setSessionState(code === 0 ? 'idle' : 'failed');
      }
    });
  }

  /** Stop the current mobile debug session. */
  debugStop(): void {
    const child = this.debugProcess;
    if (!child) return;

    const gen = ++this.generation;
    this.debugProcess = null;
    this.debugDeviceId = null;
    this.debugState = 'idle';
    this.setSessionState('stopping');

    const settle = () => {
      if (this.generation === gen) this.setSessionState('idle');
    };

    if (process.platform === 'win32' && child.pid !== undefined) {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => settle());
    } else {
      child.once('close', () => settle());
      child.kill();
      setTimeout(() => settle(), 3000);
    }
  }

  /** Current debug status. */
  debugStatus(): MobileDebugStatus {
    return {
      active: this.debugProcess !== null,
      deviceId: this.debugDeviceId,
      state: this.debugState,
    };
  }

  /** Run `zornux mobile test android` and return structured results. */
  async testRun(config: MobileTestConfig, sender: WebContents): Promise<MobileTestReport> {
    this.testStop();
    this.testSender = sender;
    const gen = ++this.generation;
    this.setSessionState('testing', sender);

    const args = ['mobile', 'test', 'android', '--json'];
    if (config.filter) args.push('--filter', config.filter);
    if (config.deviceId) args.push('--device', config.deviceId);
    if (config.verbose) args.push('--verbose');

    let code: number | null = null;
    let stdout = '';
    let stderr = '';

    try {
      const result = await this.execWithTimeout(args, config.workspaceRoot, TEST_TIMEOUT_MS);
      code = result.code;
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (err) {
      if (this.generation === gen) this.setSessionState('failed');
      return {
        passed: 0,
        failed: 1,
        skipped: 0,
        durationMs: 0,
        results: [{ name: 'test-run', passed: false, message: err instanceof Error ? err.message : 'Test execution failed' }],
      };
    }

    if (this.generation === gen) this.setSessionState('idle');

    try {
      const parsed = JSON.parse(stdout);
      const report: MobileTestReport = {
        passed: typeof parsed.passed === 'number' ? parsed.passed : 0,
        failed: typeof parsed.failed === 'number' ? parsed.failed : 0,
        skipped: typeof parsed.skipped === 'number' ? parsed.skipped : 0,
        durationMs: typeof parsed.duration_ms === 'number' ? parsed.duration_ms : 0,
        results: Array.isArray(parsed.results)
          ? parsed.results.map((r: Record<string, unknown>) => ({
              name: String(r.name ?? ''),
              passed: Boolean(r.passed),
              message: r.message != null ? String(r.message) : undefined,
              file: r.file != null ? String(r.file) : undefined,
              line: typeof r.line === 'number' ? r.line : undefined,
              durationMs: typeof r.duration_ms === 'number' ? r.duration_ms : undefined,
            }))
          : [],
      };
      if (this.testSender && !this.testSender.isDestroyed()) {
        this.testSender.send(IpcChannels.MobileTestResult, report);
      }
      return report;
    } catch {
      return {
        passed: 0,
        failed: 1,
        skipped: 0,
        durationMs: 0,
        results: [{ name: 'test-run', passed: false, message: stderr.trim() || `exit code ${code}` }],
      };
    }
  }

  /** Kill the current test process. */
  testStop(): void {
    const child = this.testProcess;
    if (!child) return;

    ++this.generation;
    this.testProcess = null;
    if (process.platform === 'win32' && child.pid !== undefined) {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    } else {
      child.kill();
    }
    this.setSessionState('idle');
  }

  /* ----- session state ----- */

  /** Update session state and notify the renderer. */
  setSessionState(state: MobileSessionState, sender?: WebContents): void {
    this.sessionState = state;
    const target = sender ?? this.logSender ?? this.profileSender ?? this.buildSender;
    if (target && !target.isDestroyed()) {
      target.send(IpcChannels.MobileSessionState, state);
    }
  }

  /** Return the current session state. */
  getSessionState(): MobileSessionState {
    return this.sessionState;
  }

  /* ----- profiling ----- */

  /** Start `zornux mobile profile android --device <id> --json`. Kills any previous profile. */
  profileStart(config: MobileProfileConfig, sender: WebContents): void {
    this.profileStop();
    this.profileMetrics = [];

    const compilerPath = this.locateCompiler();
    const args = ['mobile', 'profile', 'android', '--json'];
    if (config.deviceId) args.push('--device', config.deviceId);
    if (config.durationMs != null) args.push('--duration', String(config.durationMs));

    const child = spawn(compilerPath, args, {
      cwd: config.workspaceRoot,
      windowsHide: true,
      env: this.androidEnv(),
    });

    this.profileProcess = child;
    this.profileSender = sender;
    const gen = ++this.generation;
    this.setSessionState('profiling', sender);

    const emitEvent = (data: Record<string, unknown>) => {
      if (this.profileSender && !this.profileSender.isDestroyed()) {
        this.profileSender.send(IpcChannels.MobileProfileEvent, data);
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.length === 0) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === 'object' && parsed.type === 'metric') {
            this.profileMetrics.push({
              name: String(parsed.name ?? ''),
              value: typeof parsed.value === 'number' ? parsed.value : 0,
              unit: String(parsed.unit ?? ''),
              budget: typeof parsed.budget === 'number' ? parsed.budget : undefined,
              file: parsed.file != null ? String(parsed.file) : undefined,
              line: typeof parsed.line === 'number' ? parsed.line : undefined,
            });
            emitEvent(parsed);
          }
        } catch {
          // Not JSON — ignore.
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.length > 0) emitEvent({ type: 'error', message: line });
      }
    });
    child.on('error', (error) => emitEvent({ type: 'error', message: error.message }));
    child.on('close', () => {
      emitEvent({ type: 'complete' });
      if (this.generation === gen) {
        this.profileProcess = null;
        this.setSessionState('idle');
      }
    });
  }

  /** Kill the profile process and return collected metrics. */
  profileStop(): MobileProfileReport {
    const child = this.profileProcess;
    const report: MobileProfileReport = {
      durationMs: 0,
      metrics: [...this.profileMetrics],
      events: [],
    };

    if (!child) return report;

    ++this.generation;
    this.profileProcess = null;
    this.setSessionState('idle');
    if (process.platform === 'win32' && child.pid !== undefined) {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    } else {
      child.kill();
    }

    return report;
  }

  /* ----- build ----- */

  /** Build an APK via `zornux mobile build android --json`. */
  async buildApk(config: MobileBuildConfig, sender: WebContents): Promise<MobileBuildResult> {
    const args = ['mobile', 'build', 'android', '--json'];
    if (config.mode === 'release') args.push('--release');
    return this.execBuildAndParse(args, config.workspaceRoot, sender);
  }

  /** Build an AAB via `zornux mobile release build android --format aab --json`. */
  async buildAab(config: MobileBuildConfig, sender: WebContents): Promise<MobileBuildResult> {
    const args = ['mobile', 'release', 'build', 'android', '--format', 'aab', '--json'];
    if (config.mode === 'release') args.push('--release');
    return this.execBuildAndParse(args, config.workspaceRoot, sender);
  }

  /* ----- release ----- */

  /** Run `zornux mobile release check android --json` and return structured results. */
  async releaseCheck(workspaceRoot: string): Promise<MobileReleaseCheckResult> {
    const { code, stdout, stderr } = await this.exec(['mobile', 'release', 'check', 'android', '--json'], workspaceRoot);

    try {
      const parsed = JSON.parse(stdout);
      return {
        ready: Boolean(parsed.ready),
        applicationId: parsed.applicationId != null ? String(parsed.applicationId) : null,
        version: parsed.version != null ? String(parsed.version) : null,
        versionCode: typeof parsed.versionCode === 'number' ? parsed.versionCode : null,
        signing: parsed.signing != null
          ? { configured: Boolean(parsed.signing.configured), detail: String(parsed.signing.detail ?? '') }
          : null,
        issues: Array.isArray(parsed.issues)
          ? parsed.issues.map((i: Record<string, unknown>) => ({
              code: String(i.code ?? ''),
              severity: i.severity === 'warning' ? 'warning' as const
                : i.severity === 'info' ? 'info' as const
                : 'error' as const,
              message: String(i.message ?? ''),
              file: i.file != null ? String(i.file) : undefined,
              line: typeof i.line === 'number' ? i.line : undefined,
            }))
          : [],
      };
    } catch {
      return {
        ready: false,
        applicationId: null,
        version: null,
        versionCode: null,
        signing: null,
        issues: [{ code: 'PARSE_ERROR', severity: 'error', message: stderr.trim() || stdout.trim() || `exit code ${code}` }],
      };
    }
  }

  /** Run `zornux mobile clean android` in the project directory. */
  async clean(workspaceRoot: string): Promise<void> {
    const result = await this.exec(['mobile', 'clean', 'android'], workspaceRoot);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `Clean failed (exit ${result.code ?? '—'}).`);
    }
  }

  /* ----- project config ----- */

  /** Read `zornux.project` and parse android.* keys into an AndroidProjectConfig. */
  async projectConfig(workspaceRoot: string): Promise<AndroidProjectConfig | null> {
    const filePath = join(workspaceRoot, 'zornux.project');
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }

    const get = (...keys: string[]): string | undefined => {
      for (const key of keys) {
        const match = content.match(new RegExp(`^android\\.${key}\\s*=\\s*(.+)$`, 'm'));
        if (match) return match[1].trim();
      }
      return undefined;
    };

    const rootValue = (key: string): string | undefined => {
      const match = content.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'));
      return match ? match[1].trim() : undefined;
    };
    const applicationId = get('application_id', 'applicationId');
    // Current compiler manifests keep the application version at the project
    // root. Accept the older android.version spelling for compatibility.
    const version = rootValue('version') ?? get('version');
    if (!applicationId || !version) return null;

    const permissionsRaw = get('permissions');
    const positiveInteger = (value: string | undefined, fallback: number): number => {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
    };
    return {
      applicationId,
      version,
      versionCode: get('version_code', 'versionCode') != null ? positiveInteger(get('version_code', 'versionCode'), 1) : undefined,
      minSdk: positiveInteger(get('min_sdk', 'minSdk'), 21),
      targetSdk: positiveInteger(get('target_sdk', 'targetSdk'), 34),
      compileSdk: positiveInteger(get('compile_sdk', 'compileSdk'), 34),
      permissions: permissionsRaw ? permissionsRaw.split(',').map((p) => p.trim()) : [],
    };
  }

  /** Update android.* keys in `zornux.project`. */
  async updateProjectConfig(workspaceRoot: string, updates: Partial<AndroidProjectConfig>): Promise<void> {
    validateAndroidProjectConfig(updates);
    const current = await this.projectConfig(workspaceRoot);
    if (current) validateAndroidProjectConfig({ ...current, ...updates });
    const filePath = join(workspaceRoot, 'zornux.project');
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      content = '';
    }

    const set = (key: string, value: string, legacyKey?: string) => {
      const existingKey = legacyKey && new RegExp(`^android\\.${legacyKey}\\s*=`, 'm').test(content) ? legacyKey : key;
      const regex = new RegExp(`^(android\\.${existingKey}\\s*=)\\s*.+$`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `$1 ${value}`);
      } else {
        content += `${content.endsWith('\n') || content.length === 0 ? '' : '\n'}android.${existingKey} = ${value}\n`;
      }
    };

    const setRoot = (key: string, value: string) => {
      const regex = new RegExp(`^(${key}\\s*=)\\s*.+$`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `$1 ${value}`);
      } else {
        content += `${content.endsWith('\n') || content.length === 0 ? '' : '\n'}${key} = ${value}\n`;
      }
    };

    if (updates.applicationId != null) set('application_id', updates.applicationId, 'applicationId');
    if (updates.version != null) setRoot('version', updates.version);
    if (updates.versionCode != null) set('version_code', String(updates.versionCode), 'versionCode');
    if (updates.minSdk != null) set('min_sdk', String(updates.minSdk), 'minSdk');
    if (updates.targetSdk != null) set('target_sdk', String(updates.targetSdk), 'targetSdk');
    if (updates.compileSdk != null) set('compile_sdk', String(updates.compileSdk), 'compileSdk');
    if (updates.permissions != null) set('permissions', updates.permissions.join(', '));

    await writeFile(filePath, content, 'utf-8');
  }

  /** Kill all active processes on app quit. */
  dispose(): void {
    this.runStop();
    this.debugStop();
    this.testStop();
    this.profileStop();
    this.buildStop();
  }

  /* ----- internals ----- */

  private locateCompiler(): string {
    for (const candidate of zornuxCandidates()) {
      if (existsSync(candidate.path)) return candidate.path;
    }
    return ZORNUX_EXE;
  }

  private execWithTimeout(args: string[], cwd: string, timeoutMs: number): Promise<ExecResult> {
    const command = this.locateCompiler();
    return new Promise<ExecResult>((resolve, reject) => {
      const child = spawn(command, args, { cwd, windowsHide: true, env: this.androidEnv() });
      this.testProcess = child;
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error(`zornux mobile test timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.testProcess = null;
        reject(error);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.testProcess = null;
        resolve({ code, stdout, stderr });
      });
    });
  }

  /** Kill the current build process. */
  buildStop(): void {
    const child = this.buildProcess;
    if (!child) return;

    ++this.generation;
    this.buildProcess = null;
    this.setSessionState('idle');
    if (process.platform === 'win32' && child.pid !== undefined) {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    } else {
      child.kill();
    }
  }

  /**
   * Like execWithTimeout but tracks the child as `buildProcess`, streams
   * build progress events, and parses the final JSON result.
   */
  private execBuildAndParse(args: string[], cwd: string, sender: WebContents): Promise<MobileBuildResult> {
    this.buildStop();
    this.buildSender = sender;
    const gen = ++this.generation;
    this.setSessionState('building', sender);

    const BUILD_TIMEOUT_MS = 300_000;
    const command = this.locateCompiler();

    return new Promise<MobileBuildResult>((resolve) => {
      const child = spawn(command, args, { cwd, windowsHide: true, env: this.androidEnv() });
      this.buildProcess = child;
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        if (this.generation === gen) {
          this.buildProcess = null;
          this.setSessionState('idle');
        }
        resolve({
          success: false,
          artifactPath: null,
          artifactSizeBytes: null,
          diagnostics: [`Build timed out after ${BUILD_TIMEOUT_MS}ms`],
        });
      }, BUILD_TIMEOUT_MS);

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        for (const line of text.split('\n')) {
          if (line.length === 0) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed && typeof parsed === 'object' && parsed.phase != null) {
              if (this.buildSender && !this.buildSender.isDestroyed()) {
                this.buildSender.send(IpcChannels.MobileBuildProgress, parsed);
              }
            }
          } catch {
            // Not JSON — ignore.
          }
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.generation === gen) {
          this.buildProcess = null;
          this.setSessionState('failed');
        }
        resolve({
          success: false,
          artifactPath: null,
          artifactSizeBytes: null,
          diagnostics: [error.message],
        });
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.generation === gen) {
          this.buildProcess = null;
          this.setSessionState('idle');
        }

        resolve(parseMobileBuildOutput(stdout, stderr, code));
      });
    });
  }

  private async adbDevices(): Promise<AndroidDevice[]> {
    const adb = this.androidTool('platform-tools', 'adb');
    if (!adb) return [];
    const result = await this.execFile(adb, ['devices', '-l']);
    return result.code === 0 ? parseAdbDevices(result.stdout) : [];
  }

  private androidSdkRoot(): string | null {
    const candidates = [
      process.env.ANDROID_SDK_ROOT,
      process.env.ANDROID_HOME,
      join(homedir(), '.zornux', 'toolchains', 'android', 'sdk'),
      join(homedir(), 'Android', 'Sdk'),
    ];
    return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? null;
  }

  private androidTool(directory: string, executable: string): string | null {
    const root = this.androidSdkRoot();
    if (!root) return null;
    const suffix = process.platform === 'win32' ? '.exe' : '';
    const path = join(root, directory, `${executable}${suffix}`);
    return existsSync(path) ? path : null;
  }

  private androidEnv(): NodeJS.ProcessEnv {
    const root = this.androidSdkRoot();
    if (!root) return { ...process.env };
    const sep = process.platform === 'win32' ? ';' : ':';
    const additions = [
      join(root, 'platform-tools'),
      join(root, 'emulator'),
      join(root, 'cmdline-tools', 'latest', 'bin'),
    ];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ANDROID_HOME: root,
      ANDROID_SDK_ROOT: root,
      PATH: `${additions.join(sep)}${sep}${process.env.PATH ?? ''}`,
    };
    const managedJdk = join(homedir(), '.zornux', 'toolchains', 'android', 'jdk');
    if (existsSync(join(managedJdk, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))) {
      env.JAVA_HOME = managedJdk;
      env.PATH = `${join(managedJdk, 'bin')}${sep}${env.PATH}`;
    } else if (process.env.JAVA_HOME) {
      env.JAVA_HOME = process.env.JAVA_HOME;
    }
    return env;
  }

  private execFile(command: string, args: string[]): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve) => {
      execFile(command, args, { env: this.androidEnv(), timeout: CLI_TIMEOUT_MS }, (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      });
    });
  }

  private exec(args: string[], cwd?: string): Promise<ExecResult> {
    const command = this.locateCompiler();
    return new Promise<ExecResult>((resolve, reject) => {
      const child = spawn(command, args, { cwd, windowsHide: true, env: this.androidEnv() });
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
}

export function parseAdbDevices(stdout: string): AndroidDevice[] {
  const devices: AndroidDevice[] = [];
  for (const rawLine of stdout.split(/\r?\n/).slice(1)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('*')) continue;
    const [id, rawStatus, ...details] = line.split(/\s+/);
    if (!id || !rawStatus) continue;
    const modelField = details.find((detail) => detail.startsWith('model:'));
    const model = modelField?.slice('model:'.length).replace(/_/g, ' ') || id;
    const status: AndroidDevice['status'] = rawStatus === 'unauthorized'
      ? 'unauthorized'
      : rawStatus === 'device'
        ? 'device'
        : 'offline';
    devices.push({
      id,
      name: model,
      type: id.startsWith('emulator-') ? 'emulator' : 'physical',
      apiLevel: null,
      status,
    });
  }
  return devices;
}

export function parseAvdNames(stdout: string): AndroidEmulator[] {
  return stdout.split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name, apiLevel: inferApiLevel(name) }));
}

function inferApiLevel(name: string): string | null {
  return name.match(/(?:API[_ -]?)(\d{2,3})/i)?.[1] ?? null;
}
