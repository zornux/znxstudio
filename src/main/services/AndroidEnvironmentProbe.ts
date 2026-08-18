import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MobileDoctorResult, ToolchainComponent, ToolchainStatus } from '../../shared/types';
import { resolveZornux } from '../util/zornuxRuntime';

interface CommandResult { code: number; stdout: string; stderr: string }

export interface AndroidEnvironmentReport {
  doctor: MobileDoctorResult;
  toolchain: ToolchainStatus;
  sdkRoot: string | null;
}

/** IDE-owned Android environment audit. Zornux remains the application
 * language; these are implementation dependencies of its Android backend. */
export async function probeAndroidEnvironment(): Promise<AndroidEnvironmentReport> {
  const managed = join(homedir(), '.zornux', 'toolchains', 'android');
  const sdkRoot = firstDirectory([
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    join(managed, 'sdk'),
    join(homedir(), 'Android', 'Sdk'),
  ]);
  const java = resolveJava(managed);
  const zornux = resolveZornux().path;
  const platformNames = directoryNames(sdkRoot ? join(sdkRoot, 'platforms') : null);
  const buildToolNames = directoryNames(sdkRoot ? join(sdkRoot, 'build-tools') : null);
  const systemImages = hasNestedContent(sdkRoot ? join(sdkRoot, 'system-images') : null, 4);
  const adb = sdkTool(sdkRoot, 'platform-tools', 'adb');
  const emulator = sdkTool(sdkRoot, 'emulator', 'emulator');

  const javaResult = java ? await run(java, ['-version']) : null;
  const zornuxResult = await run(zornux, ['capabilities', '--json']);
  const adbResult = adb ? await run(adb, ['devices', '-l']) : null;
  const emulatorList = emulator ? await run(emulator, ['-list-avds']) : null;
  const acceleration = emulator ? await run(emulator, ['-accel-check']) : null;
  const readyDevices = countReadyAdbDevices(adbResult?.stdout ?? '');
  const avdNames = (emulatorList?.stdout ?? '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);

  const checks: MobileDoctorResult['checks'] = [
    check('Zornux Android Backend', Boolean(zornuxResult && zornuxResult.code === 0), zornuxResult
      ? `Zornux ${readZornuxVersion(zornuxResult.stdout) ?? 'compiler'} is available to ZnxStudio.`
      : 'The Zornux compiler is not available to ZnxStudio.'),
    check('Android Build Runtime', Boolean(javaResult && javaResult.code === 0), javaResult
      ? firstLine(javaResult.stderr || javaResult.stdout) || 'Android build runtime is ready.'
      : 'Internal Android build runtime is missing.'),
    check('Android SDK', Boolean(sdkRoot), sdkRoot ?? 'Android SDK is not installed.'),
    check('Platform SDK', platformNames.length > 0, platformNames.length ? platformNames.join(', ') : 'No Android platform SDK is installed.'),
    check('Build Tools', buildToolNames.length > 0, buildToolNames.length ? buildToolNames.join(', ') : 'No Android build tools are installed.'),
    check('Platform Tools / ADB', Boolean(adb), adb ?? 'ADB is not installed.'),
    check('Emulator Tools', Boolean(emulator), emulator ?? 'Android Emulator is not installed.'),
    check('Emulator System Image', systemImages, systemImages ? 'An Android system image is installed.' : 'No Android emulator system image is installed.'),
    check('Android Virtual Device', avdNames.length > 0, avdNames.length ? avdNames.join(', ') : 'No Android virtual device is configured.'),
    check('Emulator Acceleration', Boolean(acceleration && acceleration.code === 0), acceleration
      ? summarizeAcceleration(acceleration.stdout || acceleration.stderr)
      : 'Emulator acceleration could not be verified.'),
    check('Deployment Target', readyDevices > 0, readyDevices > 0
      ? `${readyDevices} Android target${readyDevices === 1 ? '' : 's'} ready.`
      : 'No target is running. ZnxStudio can start an installed virtual device when Run is pressed.'),
  ];
  const requiredNames = new Set(['Zornux Android Backend', 'Android Build Runtime', 'Android SDK', 'Platform SDK', 'Build Tools', 'Platform Tools / ADB', 'Emulator Tools', 'Emulator System Image', 'Android Virtual Device']);
  const components: ToolchainComponent[] = checks
    .filter((item) => item.name !== 'Deployment Target' && item.name !== 'Emulator Acceleration')
    .map((item) => ({
      name: item.name,
      required: requiredNames.has(item.name),
      installed: item.passed,
      version: versionFromDetail(item.detail),
      requiredVersion: null,
      updateAvailable: false,
    }));
  const ready = checks.filter((item) => requiredNames.has(item.name)).every((item) => item.passed);
  return {
    doctor: { ok: ready, checks },
    toolchain: { ready, managedPath: existsSync(managed) ? managed : null, components },
    sdkRoot,
  };
}

function check(name: string, passed: boolean, detail: string): MobileDoctorResult['checks'][number] {
  return { name, passed, detail };
}

function firstDirectory(paths: Array<string | undefined>): string | null {
  return paths.find((path): path is string => Boolean(path && existsSync(path))) ?? null;
}

function resolveJava(managed: string): string | null {
  const executable = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [
    process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', executable) : undefined,
    join(managed, 'jdk', 'bin', executable),
    process.platform === 'linux' ? '/usr/bin/java' : undefined,
  ];
  return candidates.find((path): path is string => Boolean(path && existsSync(path))) ?? null;
}

function sdkTool(root: string | null, directory: string, name: string): string | null {
  if (!root) return null;
  const path = join(root, directory, process.platform === 'win32' ? `${name}.exe` : name);
  return existsSync(path) ? path : null;
}

function directoryNames(path: string | null): string[] {
  if (!path || !existsSync(path)) return [];
  try { return readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name); }
  catch { return []; }
}

function hasNestedContent(path: string | null, depth: number): boolean {
  if (!path || !existsSync(path) || depth < 0) return false;
  try {
    const entries = readdirSync(path, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() || (entry.isDirectory() && hasNestedContent(join(path, entry.name), depth - 1)));
  } catch { return false; }
}

function run(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => execFile(command, args, { timeout: 15_000 }, (error, stdout, stderr) => {
    resolve({ code: error ? 1 : 0, stdout: String(stdout), stderr: String(stderr) });
  }));
}

export function countReadyAdbDevices(stdout: string): number {
  return stdout.split(/\r?\n/).slice(1).filter((line) => /^\S+\s+device(?:\s|$)/.test(line.trim())).length;
}

function firstLine(value: string): string { return value.trim().split(/\r?\n/)[0] ?? ''; }
function summarizeAcceleration(value: string): string {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => /KVM|HAXM|Hypervisor|usable|installed/i.test(line))
    ?? lines.find((line) => !/^accel:?$/i.test(line) && line !== '0')
    ?? 'Emulator acceleration is available.';
}
function versionFromDetail(value: string): string | null { return value.match(/\b\d+(?:\.\d+){1,3}\b/)?.[0] ?? null; }
function readZornuxVersion(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { result?: { productVersion?: unknown } };
    return typeof parsed.result?.productVersion === 'string' ? parsed.result.productVersion : null;
  } catch { return null; }
}
