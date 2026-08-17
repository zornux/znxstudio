import { execFile, spawn, type ChildProcess } from 'node:child_process';
import type { WebContents } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type {
  AndroidDevice,
  AndroidEmulator,
  MobileDebugConfig,
  MobileDebugStatus,
  MobileDoctorResult,
  MobileRunStatus,
  MobileTestConfig,
  MobileTestReport,
} from '../../shared/types';
import { ZORNUX_EXE, zornuxCandidates } from '../util/zornuxRuntime';
import { existsSync } from 'node:fs';

const CLI_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 120_000;

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
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

  /** List connected Android devices (physical + running emulators). */
  async devices(): Promise<AndroidDevice[]> {
    const { code, stdout } = await this.exec(['mobile', 'devices', '--json']);
    if (code !== 0) return [];

    try {
      const parsed = JSON.parse(stdout);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((entry: Record<string, unknown>) => ({
        id: String(entry.id ?? ''),
        name: String(entry.name ?? entry.id ?? ''),
        type: entry.type === 'emulator' ? 'emulator' as const : 'physical' as const,
        apiLevel: typeof entry.apiLevel === 'string' ? entry.apiLevel : null,
        status: entry.status === 'offline' ? 'offline' as const
          : entry.status === 'unauthorized' ? 'unauthorized' as const
          : 'device' as const,
      }));
    } catch {
      return [];
    }
  }

  /** List available Android emulator AVDs. */
  async emulators(): Promise<AndroidEmulator[]> {
    const { code, stdout } = await this.exec(['mobile', 'emulators', '--json']);
    if (code !== 0) return [];

    try {
      const parsed = JSON.parse(stdout);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((entry: Record<string, unknown>) => ({
        name: String(entry.name ?? ''),
        apiLevel: typeof entry.apiLevel === 'string' ? entry.apiLevel : null,
      }));
    } catch {
      return [];
    }
  }

  /** Start an emulator by AVD name. Fire-and-forget: the emulator boots asynchronously. */
  async startEmulator(name: string): Promise<void> {
    await this.exec(['mobile', 'emulator', 'start', name]);
  }

  /** Run `zornux mobile doctor android` and return structured results. */
  async doctor(platform: string): Promise<MobileDoctorResult> {
    const { code, stdout } = await this.exec(['mobile', 'doctor', platform, '--json']);

    try {
      const parsed = JSON.parse(stdout);
      if (typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.checks)) {
        return {
          ok: code === 0,
          checks: parsed.checks.map((check: Record<string, unknown>) => ({
            name: String(check.name ?? ''),
            passed: Boolean(check.passed),
            detail: String(check.detail ?? ''),
          })),
        };
      }
    } catch {
      // Parse failure — return a single failed check with the raw output.
    }

    return {
      ok: false,
      checks: [{ name: 'doctor', passed: false, detail: stdout.trim() || 'Doctor check failed.' }],
    };
  }

  /** Start `zornux mobile run android --device <id> --watch`. Kills any previous run. */
  runStart(deviceId: string, workspaceRoot: string, sender: WebContents): void {
    this.runStop();

    const compilerPath = this.locateCompiler();
    const child = spawn(compilerPath, ['mobile', 'run', 'android', '--device', deviceId, '--watch'], {
      cwd: workspaceRoot,
      windowsHide: true,
    });

    this.runProcess = child;
    this.runDeviceId = deviceId;
    this.logSender = sender;

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
      this.runProcess = null;
      this.runDeviceId = null;
    });
  }

  /** Stop the current mobile run process. */
  runStop(): void {
    const child = this.runProcess;
    if (!child) return;

    this.runProcess = null;
    this.runDeviceId = null;

    if (process.platform === 'win32' && child.pid !== undefined) {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {
        /* best-effort */
      });
    } else {
      child.kill();
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
    });

    this.debugProcess = child;
    this.debugDeviceId = config.deviceId;
    this.debugState = 'launching';
    this.debugSender = sender;

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
    });
    child.on('close', (code) => {
      this.debugState = 'terminated';
      emitEvent('terminated', { message: `exited with code ${code ?? '—'}` });
      this.debugProcess = null;
      this.debugDeviceId = null;
    });
  }

  /** Stop the current mobile debug session. */
  debugStop(): void {
    const child = this.debugProcess;
    if (!child) return;

    this.debugProcess = null;
    this.debugDeviceId = null;
    this.debugState = 'idle';

    if (process.platform === 'win32' && child.pid !== undefined) {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    } else {
      child.kill();
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

    const args = ['mobile', 'test', 'android', '--json'];
    if (config.filter) args.push('--filter', config.filter);
    if (config.deviceId) args.push('--device', config.deviceId);
    if (config.verbose) args.push('--verbose');

    const { code, stdout, stderr } = await this.execWithTimeout(args, config.workspaceRoot, TEST_TIMEOUT_MS);

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

    this.testProcess = null;
    if (process.platform === 'win32' && child.pid !== undefined) {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    } else {
      child.kill();
    }
  }

  /** Kill the run process on app quit. */
  dispose(): void {
    this.runStop();
    this.debugStop();
    this.testStop();
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
      const child = spawn(command, args, { cwd, windowsHide: true });
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
}
