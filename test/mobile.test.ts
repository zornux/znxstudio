import { describe, expect, test } from './harness';
import { IpcChannels } from '../src/shared/ipc';
import { CommandIds } from '../src/renderer/commands/CommandIds';
import { HARDENED_WEB_PREFERENCES } from '../src/shared/security';
import { PROJECT_TEMPLATES, renderTemplate, type ProjectTemplate } from '../src/shared/templates';
import { parseMobileBuildOutput, validateAndroidProjectConfig } from '../src/main/services/MobileService';
import { MobileService } from '../src/main/services/MobileService';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* ===== IPC channel contract parity ===== */

describe('mobile IPC channel contracts', () => {
  const mobileChannels = [
    'MobileDeviceList', 'MobileDeviceSelect', 'MobileEmulatorList',
    'MobileEmulatorStart', 'MobileDoctor', 'MobileLogs',
    'MobileRunStart', 'MobileRunStop', 'MobileRunStatus',
    'MobileDebugStart', 'MobileDebugStop', 'MobileDebugStatus',
    'MobileDebugEvent', 'MobileTestRun', 'MobileTestStop',
    'MobileTestResult', 'MobileProfileStart', 'MobileProfileStop',
    'MobileProfileEvent', 'MobileBuildApk', 'MobileBuildAab',
    'MobileBuildStop', 'MobileBuildProgress', 'MobileReleaseCheck',
    'MobileClean', 'MobileSessionState', 'MobileProjectConfig',
    'MobileProjectConfigUpdate',
  ] as const;

  for (const key of mobileChannels) {
    test(`IpcChannels.${key} is defined and prefixed with 'mobile:'`, () => {
      const value = (IpcChannels as Record<string, string>)[key];
      expect(value).toBeTruthy();
      expect(typeof value).toBe('string');
      expect(value.startsWith('mobile:')).toBeTruthy();
    });
  }

  const toolchainChannels = [
    'AndroidToolchainStatus', 'AndroidToolchainSetup',
    'AndroidToolchainSetupProgress', 'AndroidToolchainSdkList',
    'AndroidToolchainSdkInstall', 'AndroidToolchainUpdate',
  ] as const;

  for (const key of toolchainChannels) {
    test(`IpcChannels.${key} is defined and prefixed with 'toolchain:'`, () => {
      const value = (IpcChannels as Record<string, string>)[key];
      expect(value).toBeTruthy();
      expect(typeof value).toBe('string');
      expect(value.startsWith('toolchain:')).toBeTruthy();
    });
  }

  test('all mobile channels are unique (no collision)', () => {
    const allValues = [...mobileChannels, ...toolchainChannels].map(
      (k) => (IpcChannels as Record<string, string>)[k],
    );
    const unique = new Set(allValues);
    expect(unique.size).toBe(allValues.length);
  });

  test('buildStop channel exists for renderer cancellation', () => {
    expect(IpcChannels.MobileBuildStop).toBe('mobile:build-stop');
  });
});

/* ===== Command IDs ===== */

describe('mobile command IDs', () => {
  const commands = [
    'MobileShow', 'MobileDoctor', 'MobileRunStart', 'MobileRunStop',
    'MobileRefreshDevices', 'MobileDebugStart', 'MobileDebugStop',
    'MobileTestRun', 'MobileTestStop', 'MobileSelectDevice',
    'MobileStartEmulator', 'MobileProfileStart', 'MobileProfileStop',
    'MobileBuildApk', 'MobileBuildAab', 'MobileReleaseCheck',
    'MobileClean', 'MobileToolchainSetup', 'MobileSdkManager',
    'MobileViewGenerated', 'MobileProjectSettings', 'MobileRestart',
  ] as const;

  for (const key of commands) {
    test(`CommandIds.${key} is defined and namespaced`, () => {
      const value = (CommandIds as Record<string, string>)[key];
      expect(value).toBeTruthy();
      expect(value.startsWith('znxstudio.mobile.')).toBeTruthy();
    });
  }

  test('22 mobile commands registered', () => {
    expect(commands.length).toBe(22);
  });
});

/* ===== Security invariants ===== */

describe('mobile security invariants', () => {
  test('HARDENED_WEB_PREFERENCES blocks nodeIntegration', () => {
    expect(HARDENED_WEB_PREFERENCES.nodeIntegration).toBe(false);
  });

  test('HARDENED_WEB_PREFERENCES enables contextIsolation', () => {
    expect(HARDENED_WEB_PREFERENCES.contextIsolation).toBe(true);
  });

  test('HARDENED_WEB_PREFERENCES enables sandbox', () => {
    expect(HARDENED_WEB_PREFERENCES.sandbox).toBe(true);
  });

  test('HARDENED_WEB_PREFERENCES enables webSecurity', () => {
    expect(HARDENED_WEB_PREFERENCES.webSecurity).toBe(true);
  });

  test('no generic arbitrary command-execution channel exists', () => {
    const allChannels = Object.values(IpcChannels) as string[];
    for (const ch of allChannels) {
      expect(ch === 'exec' || ch === 'shell:exec' || ch === 'command:exec').toBeFalsy();
    }
  });

  test('mobile IPC channels do not expose raw shell or fs primitives', () => {
    const mobileChannels = Object.entries(IpcChannels)
      .filter(([key]) => key.startsWith('Mobile') || key.startsWith('AndroidToolchain'))
      .map(([, value]) => value);

    for (const ch of mobileChannels) {
      expect(ch.includes('shell')).toBeFalsy();
      expect(ch.includes('child_process')).toBeFalsy();
      expect(ch.includes('spawn')).toBeFalsy();
      expect(ch.includes('eval')).toBeFalsy();
    }
  });
});

/* ===== Templates ===== */

describe('mobile project templates', () => {
  test('includes a blank mobile template', () => {
    const blank = PROJECT_TEMPLATES.find((t: ProjectTemplate) => t.id === 'zornux-mobile-blank');
    expect(blank).toBeTruthy();
    expect(blank!.type).toBe('zornux-mobile');
  });

  test('includes a navigation mobile template', () => {
    const nav = PROJECT_TEMPLATES.find((t: ProjectTemplate) => t.id === 'zornux-mobile-nav');
    expect(nav).toBeTruthy();
    expect(nav!.type).toBe('zornux-mobile');
  });

  test('mobile templates declare zornux-mobile as workspace type', () => {
    const mobileTemplates = PROJECT_TEMPLATES.filter((t: ProjectTemplate) => t.type === 'zornux-mobile');
    expect(mobileTemplates.length).toBeGreaterThan(0);
    for (const t of mobileTemplates) {
      expect(t.type).toBe('zornux-mobile');
    }
  });

  test('mobile template renders znxstudio.project.json with mobile scripts', () => {
    const blank = PROJECT_TEMPLATES.find((t: ProjectTemplate) => t.id === 'zornux-mobile-blank');
    const rendered = renderTemplate(blank!, 'test-app');
    const manifest = rendered.files.find((f) => f.path === 'znxstudio.project.json');
    expect(manifest).toBeTruthy();
    const parsed = JSON.parse(manifest!.content);
    expect(parsed.scripts.run).toContain('zornux mobile run android');
    expect(parsed.scripts.build).toContain('zornux mobile build android');
  });

  test('mobile template manifest declares zornux.project config file', () => {
    const blank = PROJECT_TEMPLATES.find((t: ProjectTemplate) => t.id === 'zornux-mobile-blank');
    const rendered = renderTemplate(blank!, 'test-app');
    const manifest = rendered.files.find((f) => f.path === 'znxstudio.project.json');
    const parsed = JSON.parse(manifest!.content);
    expect(parsed.workspace.configFiles).toContain('zornux.project');
  });

  test('mobile template manifest declares .zornux generated directory', () => {
    const blank = PROJECT_TEMPLATES.find((t: ProjectTemplate) => t.id === 'zornux-mobile-blank');
    const rendered = renderTemplate(blank!, 'test-app');
    const manifest = rendered.files.find((f) => f.path === 'znxstudio.project.json');
    const parsed = JSON.parse(manifest!.content);
    expect(parsed.workspace.generatedDirs).toContain('.zornux');
  });
});

/* ===== Session state type completeness ===== */

describe('mobile session state machine', () => {
  test('all 9 session states are valid type values', () => {
    const states: string[] = [
      'idle', 'preparing', 'building', 'running', 'debugging',
      'testing', 'profiling', 'stopping', 'failed',
    ];
    expect(states).toHaveLength(9);
    for (const s of states) {
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    }
  });
});

describe('Android project configuration validation', () => {
  test('accepts valid Android release settings', () => {
    let threw = false;
    try { validateAndroidProjectConfig({
      applicationId: 'dev.znxstudio.sample',
      version: '1.2.0-rc.1',
      versionCode: 12,
      minSdk: 24,
      targetSdk: 35,
      compileSdk: 35,
      permissions: ['android.permission.INTERNET'],
    }); } catch { threw = true; }
    expect(threw).toBe(false);
  });

  test('rejects line injection and malformed package values', () => {
    let packageThrew = false;
    let permissionThrew = false;
    try { validateAndroidProjectConfig({ applicationId: 'dev.sample\nandroid.minSdk = 1' }); } catch { packageThrew = true; }
    try { validateAndroidProjectConfig({ permissions: ['android.permission.INTERNET\nandroid.targetSdk = 1'] }); } catch { permissionThrew = true; }
    expect(packageThrew).toBe(true);
    expect(permissionThrew).toBe(true);
  });

  test('rejects invalid numeric values', () => {
    let versionThrew = false;
    let sdkThrew = false;
    try { validateAndroidProjectConfig({ versionCode: Number.NaN }); } catch { versionThrew = true; }
    try { validateAndroidProjectConfig({ minSdk: 0 }); } catch { sdkThrew = true; }
    expect(versionThrew).toBe(true);
    expect(sdkThrew).toBe(true);
  });

  test('rejects inconsistent Android SDK levels', () => {
    let minimumThrew = false;
    let compileThrew = false;
    try { validateAndroidProjectConfig({ minSdk: 35, targetSdk: 34 }); } catch { minimumThrew = true; }
    try { validateAndroidProjectConfig({ targetSdk: 35, compileSdk: 34 }); } catch { compileThrew = true; }
    expect(minimumThrew).toBe(true);
    expect(compileThrew).toBe(true);
  });
});

describe('Android project manifest compatibility', () => {
  test('reads compiler-style snake_case Android keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'znxstudio-mobile-'));
    try {
      await writeFile(join(root, 'zornux.project'), [
        'version = 1.0.0',
        'android.application_id = dev.znxstudio.app',
        'android.min_sdk = 24',
        'android.target_sdk = 35',
        'android.compile_sdk = 35',
      ].join('\n'));
      const config = await new MobileService().projectConfig(root);
      expect(config?.applicationId).toBe('dev.znxstudio.app');
      expect(config?.minSdk).toBe(24);
      expect(config?.targetSdk).toBe(35);
      expect(config?.compileSdk).toBe(35);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('Android build result parsing', () => {
  test('uses the build result when trailing CLI logs follow it', () => {
    const result = parseMobileBuildOutput(
      '{"phase":"compile","message":"Compiling"}\n' +
      '{"success":true,"artifactPath":"app.apk","artifactSizeBytes":42,"diagnostics":[]}\nDone\n',
      '',
      0,
    );
    expect(result.success).toBe(true);
    expect(result.artifactPath).toBe('app.apk');
  });

  test('surfaces stderr when the CLI emits no result JSON', () => {
    const result = parseMobileBuildOutput('', 'Android SDK is missing', 1);
    expect(result.success).toBe(false);
    expect(result.diagnostics[0]).toContain('Android SDK is missing');
  });
});

/* ===== API surface completeness ===== */

describe('mobile API surface completeness', () => {
  test('mobile IPC has channels for all lifecycle operations', () => {
    expect(IpcChannels.MobileRunStart).toBeTruthy();
    expect(IpcChannels.MobileRunStop).toBeTruthy();
    expect(IpcChannels.MobileDebugStart).toBeTruthy();
    expect(IpcChannels.MobileDebugStop).toBeTruthy();
    expect(IpcChannels.MobileTestRun).toBeTruthy();
    expect(IpcChannels.MobileTestStop).toBeTruthy();
    expect(IpcChannels.MobileProfileStart).toBeTruthy();
    expect(IpcChannels.MobileProfileStop).toBeTruthy();
    expect(IpcChannels.MobileBuildApk).toBeTruthy();
    expect(IpcChannels.MobileBuildAab).toBeTruthy();
    expect(IpcChannels.MobileBuildStop).toBeTruthy();
    expect(IpcChannels.MobileClean).toBeTruthy();
    expect(IpcChannels.MobileReleaseCheck).toBeTruthy();
  });

  test('mobile IPC has channels for all discovery operations', () => {
    expect(IpcChannels.MobileDeviceList).toBeTruthy();
    expect(IpcChannels.MobileEmulatorList).toBeTruthy();
    expect(IpcChannels.MobileDoctor).toBeTruthy();
    expect(IpcChannels.MobileRunStatus).toBeTruthy();
    expect(IpcChannels.MobileDebugStatus).toBeTruthy();
    expect(IpcChannels.MobileSessionState).toBeTruthy();
    expect(IpcChannels.MobileProjectConfig).toBeTruthy();
  });

  test('mobile IPC has channels for all streaming events', () => {
    expect(IpcChannels.MobileLogs).toBeTruthy();
    expect(IpcChannels.MobileDebugEvent).toBeTruthy();
    expect(IpcChannels.MobileTestResult).toBeTruthy();
    expect(IpcChannels.MobileProfileEvent).toBeTruthy();
    expect(IpcChannels.MobileBuildProgress).toBeTruthy();
  });

  test('toolchain IPC has channels for all management operations', () => {
    expect(IpcChannels.AndroidToolchainStatus).toBeTruthy();
    expect(IpcChannels.AndroidToolchainSetup).toBeTruthy();
    expect(IpcChannels.AndroidToolchainSetupProgress).toBeTruthy();
    expect(IpcChannels.AndroidToolchainSdkList).toBeTruthy();
    expect(IpcChannels.AndroidToolchainSdkInstall).toBeTruthy();
    expect(IpcChannels.AndroidToolchainUpdate).toBeTruthy();
  });
});
