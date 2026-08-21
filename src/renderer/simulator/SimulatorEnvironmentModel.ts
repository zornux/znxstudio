import { Emitter, type Event } from '../core/Emitter';
import type {
  SimulatorTheme,
  SimulatorOrientation,
  SimulatorDeviceProfile,
  ConnectivityMode,
  PermissionState,
  LocationConfig,
  BiometricResult,
  CameraMode,
} from '../../shared/simulatorTypes';
import { DEFAULT_DEVICE_PROFILE } from './SimulatorDeviceProfile';

export interface EnvironmentState {
  device: SimulatorDeviceProfile;
  orientation: SimulatorOrientation;
  theme: SimulatorTheme;
  fontScale: number;
  network: ConnectivityMode;
  battery: { level: number; charging: boolean };
  location: LocationConfig;
  permissions: Record<string, PermissionState>;
  camera: CameraMode;
  biometrics: BiometricResult;
  keyboard: { visible: boolean; height: number; mode: KeyboardInputMode };
  reducedMotion: boolean;
  highContrast: boolean;
  signalStrength: number;
  airplaneMode: boolean;
  wifiEnabled: boolean;
}

export type KeyboardInputMode = 'text' | 'email' | 'number' | 'phone' | 'password' | 'multiline' | 'search';

export interface EnvironmentChangeEvent {
  key: string;
  value: unknown;
  previous: unknown;
}

export interface EnvironmentPreset {
  name: string;
  description: string;
  overrides: Partial<EnvironmentState>;
}

const DEFAULT_ENV: EnvironmentState = {
  device: DEFAULT_DEVICE_PROFILE,
  orientation: 'portrait',
  theme: 'light',
  fontScale: 1,
  network: 'online',
  battery: { level: 100, charging: false },
  location: { mode: 'fixed', latitude: 37.4220, longitude: -122.0841, accuracy: 10, altitude: 0, permissionState: 'granted' },
  permissions: {},
  camera: 'sample',
  biometrics: 'success',
  keyboard: { visible: false, height: 0, mode: 'text' },
  reducedMotion: false,
  highContrast: false,
  signalStrength: 4,
  airplaneMode: false,
  wifiEnabled: true,
};

const BUILTIN_PRESETS: EnvironmentPreset[] = [
  { name: 'Offline User', description: 'No network connectivity', overrides: { network: 'offline' } },
  { name: 'Slow Network', description: 'Simulated slow connection', overrides: { network: 'slow' } },
  { name: 'Permission Denied', description: 'All permissions denied', overrides: { camera: 'unavailable', biometrics: 'unavailable' } },
  { name: 'Dark Mode Tablet', description: 'Large tablet in dark mode', overrides: { theme: 'dark' } },
  { name: 'Large Text', description: 'Font scale 2x', overrides: { fontScale: 2 } },
  { name: 'No Location', description: 'Location unavailable', overrides: { location: { ...DEFAULT_ENV.location, mode: 'unavailable' } } },
  { name: 'Biometric Failure', description: 'Biometric auth fails', overrides: { biometrics: 'failure' } },
  { name: 'Low Battery', description: 'Battery at 5%', overrides: { battery: { level: 5, charging: false } } },
  { name: 'Airplane Mode', description: 'Airplane mode enabled', overrides: { airplaneMode: true, network: 'offline', wifiEnabled: false } },
  { name: 'Reduced Motion', description: 'Accessibility reduced motion', overrides: { reducedMotion: true } },
];

export class SimulatorEnvironmentModel {
  private state: EnvironmentState = { ...DEFAULT_ENV, battery: { ...DEFAULT_ENV.battery }, location: { ...DEFAULT_ENV.location }, keyboard: { ...DEFAULT_ENV.keyboard }, permissions: {} };
  private readonly customPresets: EnvironmentPreset[] = [];

  private readonly _onChange = new Emitter<EnvironmentChangeEvent>();
  readonly onChange: Event<EnvironmentChangeEvent> = this._onChange.event;

  get(): EnvironmentState {
    return this.state;
  }

  set<K extends keyof EnvironmentState>(key: K, value: EnvironmentState[K]): void {
    const previous = this.state[key];
    this.state = { ...this.state, [key]: value };
    this._onChange.fire({ key, value, previous });
  }

  patch(overrides: Partial<EnvironmentState>): void {
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        this.set(key as keyof EnvironmentState, value as never);
      }
    }
  }

  applyPreset(name: string): boolean {
    const preset = this.allPresets().find(p => p.name === name);
    if (!preset) return false;
    this.patch(preset.overrides);
    return true;
  }

  addPreset(preset: EnvironmentPreset): void {
    const idx = this.customPresets.findIndex(p => p.name === preset.name);
    if (idx !== -1) this.customPresets[idx] = preset;
    else this.customPresets.push(preset);
  }

  removePreset(name: string): boolean {
    const idx = this.customPresets.findIndex(p => p.name === name);
    if (idx === -1) return false;
    this.customPresets.splice(idx, 1);
    return true;
  }

  builtinPresets(): readonly EnvironmentPreset[] {
    return BUILTIN_PRESETS;
  }

  allPresets(): EnvironmentPreset[] {
    return [...BUILTIN_PRESETS, ...this.customPresets];
  }

  reset(): void {
    this.state = { ...DEFAULT_ENV, battery: { ...DEFAULT_ENV.battery }, location: { ...DEFAULT_ENV.location }, keyboard: { ...DEFAULT_ENV.keyboard }, permissions: {} };
  }

  snapshot(): EnvironmentState {
    return JSON.parse(JSON.stringify(this.state));
  }

  restore(snap: EnvironmentState): void {
    const old = this.state;
    this.state = JSON.parse(JSON.stringify(snap));
    for (const key of Object.keys(this.state) as (keyof EnvironmentState)[]) {
      if (JSON.stringify(old[key]) !== JSON.stringify(this.state[key])) {
        this._onChange.fire({ key, value: this.state[key], previous: old[key] });
      }
    }
  }

  dispose(): void {
    this._onChange.dispose();
  }
}
