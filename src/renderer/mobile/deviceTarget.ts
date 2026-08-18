import type { AndroidDevice, AndroidEmulator } from '../../shared/types';

export interface AndroidTargetApi {
  devices(): Promise<AndroidDevice[]>;
  emulators(): Promise<AndroidEmulator[]>;
  startEmulator(name: string): Promise<void>;
}

export interface AndroidTargetOptions {
  api: AndroidTargetApi;
  pickDevice?: (devices: AndroidDevice[]) => Promise<string | null | undefined>;
  pickEmulator?: (emulators: AndroidEmulator[]) => Promise<string | null | undefined>;
  onProgress?: (message: string) => void;
  attempts?: number;
  retryDelayMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
}

/**
 * Resolve a ready Android target. When no device is connected, automatically
 * launch an installed AVD and wait for it to become available through ADB.
 */
export async function ensureAndroidRunTarget(options: AndroidTargetOptions): Promise<string | null> {
  const ready = (await options.api.devices()).filter((device) => device.status === 'device');
  if (ready.length === 1) return ready[0].id;
  if (ready.length > 1) return options.pickDevice ? (await options.pickDevice(ready) ?? null) : ready[0].id;

  const emulators = await options.api.emulators();
  if (emulators.length === 0) return null;

  const avdName = emulators.length === 1
    ? emulators[0].name
    : options.pickEmulator
      ? await options.pickEmulator(emulators)
      : emulators[0].name;
  if (!avdName) return null;

  options.onProgress?.(`Starting virtual device ${avdName}…`);
  await options.api.startEmulator(avdName);

  const attempts = options.attempts ?? 60;
  const retryDelayMs = options.retryDelayMs ?? 1500;
  const delay = options.delay ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const devices = await options.api.devices();
    const runningEmulators = devices.filter(
      (device) => device.type === 'emulator' && device.status === 'device',
    );
    const matching = runningEmulators.find((device) => namesLikelyMatch(device.name, avdName));
    if (matching) return matching.id;
    if (runningEmulators.length === 1) return runningEmulators[0].id;
    options.onProgress?.(`Waiting for ${avdName} to finish booting…`);
    await delay(retryDelayMs);
  }

  throw new Error(`Virtual device ${avdName} did not become ready in time.`);
}

function namesLikelyMatch(deviceName: string, avdName: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const device = normalize(deviceName);
  const avd = normalize(avdName);
  return device === avd || device.includes(avd) || avd.includes(device);
}
