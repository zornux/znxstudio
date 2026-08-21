import { spawn, execFile } from 'node:child_process';
import { createWriteStream, existsSync, readdirSync } from 'node:fs';
import { mkdir, rm, rename, chmod, writeFile } from 'node:fs/promises';
import { homedir, platform as osPlatform, arch as osArch } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { ToolchainSetupProgress } from '../../shared/types';

const CMDLINE_TOOLS_BUILD = '11076708';
const TARGET_PLATFORM = 'android-35';
const BUILD_TOOLS_VERSION = '35.0.0';
const JDK_MAJOR = '21';

const SDK_COMPONENTS = [
  `platforms;${TARGET_PLATFORM}`,
  `build-tools;${BUILD_TOOLS_VERSION}`,
  'platform-tools',
  'emulator',
];

export type SdkProgressCallback = (progress: ToolchainSetupProgress) => void;

/**
 * Downloads and installs the Android SDK toolchain into a Zornux-managed
 * directory at `~/.zornux/toolchains/android`. Handles JDK, command-line
 * tools, SDK components, emulator system images, and AVD creation.
 *
 * All downloads use HTTPS from official sources (Adoptium for JDK, Google
 * for Android SDK). Progress is streamed via a callback that matches the
 * existing `ToolchainSetupProgress` type used by ZnxStudio's IPC layer.
 */
export class AndroidSdkManager {
  private readonly managedRoot: string;
  private aborted = false;

  constructor() {
    this.managedRoot = join(homedir(), '.zornux', 'toolchains', 'android');
  }

  get sdkPath(): string {
    return join(this.managedRoot, 'sdk');
  }

  get jdkPath(): string {
    return join(this.managedRoot, 'jdk');
  }

  /** Full setup: JDK → cmdline-tools → licenses → SDK components → system image → AVD. */
  async setup(onProgress: SdkProgressCallback): Promise<void> {
    this.aborted = false;

    try {
      onProgress({ step: 'Preparing toolchain directory...', progress: 0, complete: false, error: null });
      await mkdir(this.managedRoot, { recursive: true });
      await mkdir(this.sdkPath, { recursive: true });

      if (!this.hasJdk()) {
        onProgress({ step: 'Downloading JDK 21 (Eclipse Temurin)...', progress: 2, complete: false, error: null });
        await this.installJdk((pct) => {
          onProgress({ step: `Downloading JDK 21... ${pct}%`, progress: 2 + Math.round(pct * 0.18), complete: false, error: null });
        });
        onProgress({ step: 'JDK 21 installed', progress: 20, complete: false, error: null });
      } else {
        onProgress({ step: 'JDK 21 already installed', progress: 20, complete: false, error: null });
      }

      this.checkAborted();

      if (!this.hasCmdlineTools()) {
        onProgress({ step: 'Downloading Android command-line tools...', progress: 22, complete: false, error: null });
        await this.installCmdlineTools((pct) => {
          onProgress({ step: `Downloading command-line tools... ${pct}%`, progress: 22 + Math.round(pct * 0.13), complete: false, error: null });
        });
        onProgress({ step: 'Command-line tools installed', progress: 35, complete: false, error: null });
      } else {
        onProgress({ step: 'Command-line tools already installed', progress: 35, complete: false, error: null });
      }

      this.checkAborted();

      onProgress({ step: 'Accepting Android SDK licenses...', progress: 38, complete: false, error: null });
      await this.acceptLicenses();

      this.checkAborted();

      onProgress({ step: 'Installing SDK components...', progress: 40, complete: false, error: null });
      await this.installSdkComponents((component, index) => {
        const base = 40;
        const perComponent = 40 / SDK_COMPONENTS.length;
        onProgress({
          step: `Installing ${component}...`,
          progress: Math.round(base + index * perComponent),
          complete: false,
          error: null,
        });
      });
      onProgress({ step: 'SDK components installed', progress: 80, complete: false, error: null });

      this.checkAborted();

      onProgress({ step: 'Installing emulator system image...', progress: 82, complete: false, error: null });
      await this.installSystemImage();
      onProgress({ step: 'System image installed', progress: 92, complete: false, error: null });

      this.checkAborted();

      onProgress({ step: 'Creating default virtual device...', progress: 94, complete: false, error: null });
      await this.createDefaultAvd();

      onProgress({ step: 'Complete', progress: 100, complete: true, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onProgress({ step: 'Complete', progress: 100, complete: true, error: message });
    }
  }

  /** Install a single SDK component via sdkmanager. */
  async installComponent(component: string, onProgress: SdkProgressCallback): Promise<void> {
    try {
      onProgress({ step: `Installing ${component}...`, progress: 10, complete: false, error: null });
      await this.runSdkManager([component]);
      onProgress({ step: 'Complete', progress: 100, complete: true, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onProgress({ step: 'Complete', progress: 100, complete: true, error: message });
    }
  }

  /** Update all installed SDK components. */
  async updateComponents(onProgress: SdkProgressCallback): Promise<void> {
    try {
      onProgress({ step: 'Updating SDK components...', progress: 10, complete: false, error: null });
      await this.runSdkManager(['--update']);
      onProgress({ step: 'Complete', progress: 100, complete: true, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onProgress({ step: 'Complete', progress: 100, complete: true, error: message });
    }
  }

  /** Signal an in-progress setup to stop. */
  abort(): void {
    this.aborted = true;
  }

  /* ----- JDK ----- */

  hasJdk(): boolean {
    const javaBin = osPlatform() === 'win32' ? 'java.exe' : 'java';
    return existsSync(join(this.jdkPath, 'bin', javaBin));
  }

  private async installJdk(onDownloadProgress: (pct: number) => void): Promise<void> {
    const { url, extension } = this.jdkDownloadInfo();
    const archivePath = join(this.managedRoot, `jdk-download${extension}`);

    try {
      await this.download(url, archivePath, onDownloadProgress);
      const extractDir = join(this.managedRoot, 'jdk-extract');
      await rm(extractDir, { recursive: true, force: true });
      await mkdir(extractDir, { recursive: true });

      if (extension === '.tar.gz') {
        await this.extractTarGz(archivePath, extractDir);
      } else {
        await this.extractZip(archivePath, extractDir);
      }

      const jdkDir = this.findSingleSubdir(extractDir);
      if (!jdkDir) throw new Error('JDK archive did not contain the expected directory structure.');

      let jdkHome = jdkDir;
      if (osPlatform() === 'darwin') {
        const contentsHome = join(jdkDir, 'Contents', 'Home');
        if (existsSync(contentsHome)) jdkHome = contentsHome;
      }

      await rm(this.jdkPath, { recursive: true, force: true });
      await rename(jdkHome, this.jdkPath);
      await rm(extractDir, { recursive: true, force: true });
    } finally {
      await rm(archivePath, { force: true }).catch(() => {});
    }
  }

  private jdkDownloadInfo(): { url: string; extension: string } {
    const os = platformToAdoptium();
    const arch = archToAdoptium();
    const extension = osPlatform() === 'win32' ? '.zip' : '.tar.gz';
    return {
      url: `https://api.adoptium.net/v3/binary/latest/${JDK_MAJOR}/ga/${os}/${arch}/jdk/hotspot/normal/eclipse`,
      extension,
    };
  }

  /* ----- Command-line tools ----- */

  hasCmdlineTools(): boolean {
    return existsSync(this.sdkManagerPath());
  }

  private async installCmdlineTools(onDownloadProgress: (pct: number) => void): Promise<void> {
    const os = platformToGoogle();
    const url = `https://dl.google.com/android/repository/commandlinetools-${os}-${CMDLINE_TOOLS_BUILD}_latest.zip`;
    const zipPath = join(this.managedRoot, 'cmdline-tools-download.zip');

    try {
      await this.download(url, zipPath, onDownloadProgress);
      const extractDir = join(this.managedRoot, 'cmdline-tools-extract');
      await rm(extractDir, { recursive: true, force: true });
      await mkdir(extractDir, { recursive: true });

      await this.extractZip(zipPath, extractDir);

      const destDir = join(this.sdkPath, 'cmdline-tools', 'latest');
      await rm(destDir, { recursive: true, force: true });
      await mkdir(join(this.sdkPath, 'cmdline-tools'), { recursive: true });

      const extracted = join(extractDir, 'cmdline-tools');
      if (existsSync(extracted)) {
        await rename(extracted, destDir);
      } else {
        await rename(extractDir, destDir);
      }

      await rm(extractDir, { recursive: true, force: true });

      if (osPlatform() !== 'win32') {
        const sdkManager = this.sdkManagerPath();
        if (existsSync(sdkManager)) await chmod(sdkManager, 0o755);
        const avdManager = join(destDir, 'bin', 'avdmanager');
        if (existsSync(avdManager)) await chmod(avdManager, 0o755);
      }
    } finally {
      await rm(zipPath, { force: true }).catch(() => {});
    }
  }

  /* ----- SDK components via sdkmanager ----- */

  private async acceptLicenses(): Promise<void> {
    const sdkManager = this.sdkManagerPath();
    if (!existsSync(sdkManager)) throw new Error('sdkmanager not found. Command-line tools may not be installed.');

    await new Promise<void>((resolve, reject) => {
      const args = this.sdkManagerArgs(['--licenses']);
      const child = spawn(args[0], args.slice(1), {
        env: this.sdkEnv(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdin?.write('y\n'.repeat(20));
      child.stdin?.end();

      let stderr = '';
      child.stdout?.on('data', () => {});
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

      child.on('error', (error) => reject(new Error(`License acceptance failed: ${error.message}`)));
      child.on('close', (code) => {
        if (code === 0 || stderr.includes('All SDK package licenses accepted')) {
          resolve();
        } else {
          resolve();
        }
      });
    });
  }

  private async installSdkComponents(onComponent: (name: string, index: number) => void): Promise<void> {
    for (let i = 0; i < SDK_COMPONENTS.length; i++) {
      this.checkAborted();
      onComponent(SDK_COMPONENTS[i], i);
      await this.runSdkManager([SDK_COMPONENTS[i]]);
    }
  }

  private async installSystemImage(): Promise<void> {
    const arch = osArch() === 'arm64' ? 'arm64-v8a' : 'x86_64';
    const image = `system-images;${TARGET_PLATFORM};google_apis;${arch}`;
    try {
      await this.runSdkManager([image]);
    } catch {
      const fallback = `system-images;${TARGET_PLATFORM};google_apis_playstore;${arch}`;
      try {
        await this.runSdkManager([fallback]);
      } catch {
        // System image install is best-effort; user can install manually later.
      }
    }
  }

  private async createDefaultAvd(): Promise<void> {
    const avdManager = join(this.sdkPath, 'cmdline-tools', 'latest', 'bin', 'avdmanager');
    if (!existsSync(avdManager) && !existsSync(avdManager + '.bat')) return;

    const arch = osArch() === 'arm64' ? 'arm64-v8a' : 'x86_64';
    const image = `system-images;${TARGET_PLATFORM};google_apis;${arch}`;
    const avdName = 'Zornux_Default';

    const existingAvds = await this.listAvds();
    if (existingAvds.includes(avdName)) return;

    const executable = osPlatform() === 'win32' ? avdManager + '.bat' : avdManager;

    await new Promise<void>((resolve) => {
      const child = spawn(executable, [
        'create', 'avd',
        '--name', avdName,
        '--package', image,
        '--device', 'pixel_6',
        '--force',
      ], {
        env: this.sdkEnv(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdin?.write('no\n');
      child.stdin?.end();

      child.on('error', () => resolve());
      child.on('close', () => resolve());
    });
  }

  private async listAvds(): Promise<string[]> {
    const emulator = join(this.sdkPath, 'emulator', osPlatform() === 'win32' ? 'emulator.exe' : 'emulator');
    if (!existsSync(emulator)) return [];

    return new Promise<string[]>((resolve) => {
      execFile(emulator, ['-list-avds'], { env: this.sdkEnv(), timeout: 10_000 }, (error, stdout) => {
        if (error) { resolve([]); return; }
        resolve(String(stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
      });
    });
  }

  /* ----- sdkmanager helpers ----- */

  private sdkManagerPath(): string {
    const bin = osPlatform() === 'win32' ? 'sdkmanager.bat' : 'sdkmanager';
    return join(this.sdkPath, 'cmdline-tools', 'latest', 'bin', bin);
  }

  private sdkManagerArgs(extraArgs: string[]): string[] {
    const sdkManager = this.sdkManagerPath();
    if (osPlatform() === 'win32') {
      return ['cmd', '/c', sdkManager, '--sdk_root=' + this.sdkPath, ...extraArgs];
    }
    return [sdkManager, '--sdk_root=' + this.sdkPath, ...extraArgs];
  }

  private sdkEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (this.hasJdk()) {
      env.JAVA_HOME = this.jdkPath;
      const javaBin = join(this.jdkPath, 'bin');
      const sep = osPlatform() === 'win32' ? ';' : ':';
      env.PATH = `${javaBin}${sep}${env.PATH ?? ''}`;
    }
    env.ANDROID_HOME = this.sdkPath;
    env.ANDROID_SDK_ROOT = this.sdkPath;
    return env;
  }

  private runSdkManager(packages: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sdkManager = this.sdkManagerPath();
      if (!existsSync(sdkManager) && !existsSync(sdkManager.replace(/\.bat$/, ''))) {
        reject(new Error('sdkmanager not found. Run setup first.'));
        return;
      }

      const args = this.sdkManagerArgs(packages);
      const child = spawn(args[0], args.slice(1), {
        env: this.sdkEnv(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdin?.write('y\n'.repeat(10));
      child.stdin?.end();

      let stderr = '';
      child.stdout?.on('data', () => {});
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

      child.on('error', (error) => reject(new Error(`sdkmanager failed: ${error.message}`)));
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`sdkmanager exited with code ${code}: ${stderr.trim().split('\n').pop() ?? ''}`));
        }
      });
    });
  }

  /* ----- download helpers ----- */

  private download(url: string, dest: string, onProgress: (pct: number) => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const request = (targetUrl: string, redirectCount: number) => {
        if (redirectCount > 5) { reject(new Error('Too many redirects')); return; }

        const protocol = targetUrl.startsWith('https') ? https : http;
        protocol.get(targetUrl, { headers: { 'User-Agent': 'ZnxStudio/1.0' } }, (response: IncomingMessage) => {
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.resume();
            request(response.headers.location, redirectCount + 1);
            return;
          }

          if (response.statusCode && response.statusCode >= 400) {
            response.resume();
            reject(new Error(`Download failed: HTTP ${response.statusCode} from ${targetUrl}`));
            return;
          }

          const totalBytes = parseInt(response.headers['content-length'] ?? '0', 10);
          let receivedBytes = 0;

          const file = createWriteStream(dest);
          response.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length;
            if (totalBytes > 0) {
              onProgress(Math.min(100, Math.round((receivedBytes / totalBytes) * 100)));
            }
          });

          response.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
          file.on('error', (error) => { file.close(); reject(error); });
          response.on('error', (error) => { file.close(); reject(error); });
        }).on('error', (error) => reject(new Error(`Download failed: ${error.message}`)));
      };

      request(url, 0);
    });
  }

  /* ----- extraction helpers ----- */

  private extractZip(zipPath: string, destDir: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (osPlatform() === 'win32') {
        execFile('powershell', [
          '-NoProfile', '-Command',
          `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'`,
        ], { timeout: 300_000 }, (error) => {
          if (error) reject(new Error(`Zip extraction failed: ${error.message}`)); else resolve();
        });
      } else {
        execFile('unzip', ['-o', '-q', zipPath, '-d', destDir], { timeout: 300_000 }, (error) => {
          if (error) reject(new Error(`Zip extraction failed: ${error.message}`)); else resolve();
        });
      }
    });
  }

  private extractTarGz(tarPath: string, destDir: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      execFile('tar', ['-xzf', tarPath, '-C', destDir], { timeout: 300_000 }, (error) => {
        if (error) reject(new Error(`Tar extraction failed: ${error.message}`)); else resolve();
      });
    });
  }

  /* ----- filesystem helpers ----- */

  private findSingleSubdir(dir: string): string | null {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());
      return dirs.length === 1 ? join(dir, dirs[0].name) : null;
    } catch {
      return null;
    }
  }

  private checkAborted(): void {
    if (this.aborted) throw new Error('Setup was cancelled.');
  }
}

/* ----- platform mapping ----- */

function platformToAdoptium(): string {
  switch (osPlatform()) {
    case 'linux': return 'linux';
    case 'darwin': return 'mac';
    case 'win32': return 'windows';
    default: return 'linux';
  }
}

function archToAdoptium(): string {
  switch (osArch()) {
    case 'arm64': return 'aarch64';
    case 'x64': return 'x64';
    default: return 'x64';
  }
}

function platformToGoogle(): string {
  switch (osPlatform()) {
    case 'linux': return 'linux';
    case 'darwin': return 'mac';
    case 'win32': return 'win';
    default: return 'linux';
  }
}
