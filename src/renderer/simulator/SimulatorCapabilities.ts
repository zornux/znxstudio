import { Emitter, type Event } from '../core/Emitter';
import type {
  CameraResult,
  CameraMode,
  LocationResult,
  LocationConfig,
  BiometricResult,
  NotificationConfig,
  PermissionState,
  ShareResult,
  ConnectivityMode,
} from '../../shared/simulatorTypes';

// ---------------------------------------------------------------------------
// Provider contracts
// ---------------------------------------------------------------------------

export interface ICameraProvider {
  capture(): Promise<CameraResult>;
  setMode(mode: CameraMode): void;
}

export interface ILocationProvider {
  getCurrentLocation(): Promise<LocationResult | null>;
  configure(config: LocationConfig): void;
  getConfig(): LocationConfig;
}

export interface IBiometricsProvider {
  authenticate(): Promise<BiometricResult>;
  setResult(result: BiometricResult): void;
}

export interface INotificationProvider {
  show(config: NotificationConfig): void;
  schedule(config: NotificationConfig): void;
  cancel(id: string): void;
  pending(): NotificationConfig[];
  setPermissionState(state: PermissionState): void;
}

export interface IFileProvider {
  pick(): Promise<{ name: string; size: number; type: string } | null>;
}

export interface ISharingProvider {
  share(data: { title?: string; text?: string; url?: string }): Promise<ShareResult>;
  setResult(result: ShareResult): void;
}

export interface IConnectivityProvider {
  isOnline(): boolean;
  mode(): ConnectivityMode;
  setMode(mode: ConnectivityMode): void;
  onDidChange: Event<ConnectivityMode>;
}

// ---------------------------------------------------------------------------
// Default implementations
// ---------------------------------------------------------------------------

// 1x1 transparent PNG as a stable sample capture
const SAMPLE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQIHWNgAAIABgABzQoNkgAAAABJRU5ErkJggg==';

class DefaultCameraProvider implements ICameraProvider {
  private _mode: CameraMode = 'sample';

  async capture(): Promise<CameraResult> {
    switch (this._mode) {
      case 'cancel':
        return { success: false, cancelled: true };
      case 'unavailable':
        return { success: false, error: 'Camera unavailable' };
      case 'failure':
        return { success: false, error: 'Camera failure' };
      default:
        return { success: true, imageData: SAMPLE_PNG };
    }
  }

  setMode(mode: CameraMode): void {
    this._mode = mode;
  }
}

class DefaultLocationProvider implements ILocationProvider {
  private config: LocationConfig = {
    mode: 'fixed',
    latitude: 37.4220,
    longitude: -122.0841,
    accuracy: 10,
    altitude: 0,
    permissionState: 'granted',
  };

  async getCurrentLocation(): Promise<LocationResult | null> {
    if (this.config.mode === 'unavailable') return null;
    return {
      latitude: this.config.latitude,
      longitude: this.config.longitude,
      accuracy: this.config.accuracy,
      altitude: this.config.altitude,
    };
  }

  configure(config: LocationConfig): void {
    this.config = { ...config };
  }

  getConfig(): LocationConfig {
    return { ...this.config };
  }
}

class DefaultBiometricsProvider implements IBiometricsProvider {
  private _result: BiometricResult = 'success';

  async authenticate(): Promise<BiometricResult> {
    return this._result;
  }

  setResult(result: BiometricResult): void {
    this._result = result;
  }
}

class DefaultNotificationProvider implements INotificationProvider {
  private readonly _pending: NotificationConfig[] = [];
  private _permissionState: PermissionState = 'granted';

  show(_config: NotificationConfig): void {
    // In simulator, show is a no-op visual event; notifications aren't rendered
  }

  schedule(config: NotificationConfig): void {
    if (this._permissionState !== 'granted') return;
    this._pending.push({ ...config });
  }

  cancel(id: string): void {
    const idx = this._pending.findIndex((n) => n.id === id);
    if (idx !== -1) this._pending.splice(idx, 1);
  }

  pending(): NotificationConfig[] {
    return [...this._pending];
  }

  setPermissionState(state: PermissionState): void {
    this._permissionState = state;
  }
}

class DefaultFileProvider implements IFileProvider {
  async pick(): Promise<{ name: string; size: number; type: string } | null> {
    return null;
  }
}

class DefaultSharingProvider implements ISharingProvider {
  private _result: ShareResult = 'completed';

  async share(_data: { title?: string; text?: string; url?: string }): Promise<ShareResult> {
    return this._result;
  }

  setResult(result: ShareResult): void {
    this._result = result;
  }
}

class DefaultConnectivityProvider implements IConnectivityProvider {
  private _mode: ConnectivityMode = 'online';
  private readonly _onDidChange = new Emitter<ConnectivityMode>();
  readonly onDidChange: Event<ConnectivityMode> = this._onDidChange.event;

  isOnline(): boolean {
    return this._mode === 'online' || this._mode === 'slow';
  }

  mode(): ConnectivityMode {
    return this._mode;
  }

  setMode(mode: ConnectivityMode): void {
    if (this._mode === mode) return;
    this._mode = mode;
    this._onDidChange.fire(mode);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

// ---------------------------------------------------------------------------
// Aggregated capabilities
// ---------------------------------------------------------------------------

export class SimulatorCapabilities {
  readonly camera: ICameraProvider;
  readonly location: ILocationProvider;
  readonly biometrics: IBiometricsProvider;
  readonly notifications: INotificationProvider;
  readonly files: IFileProvider;
  readonly sharing: ISharingProvider;
  readonly connectivity: IConnectivityProvider;

  private _connectivityOwned: DefaultConnectivityProvider;

  constructor() {
    this.camera = new DefaultCameraProvider();
    this.location = new DefaultLocationProvider();
    this.biometrics = new DefaultBiometricsProvider();
    this.notifications = new DefaultNotificationProvider();
    this.files = new DefaultFileProvider();
    this.sharing = new DefaultSharingProvider();

    const conn = new DefaultConnectivityProvider();
    this._connectivityOwned = conn;
    this.connectivity = conn;
  }

  reset(): void {
    (this.camera as DefaultCameraProvider).setMode('sample');
    (this.location as DefaultLocationProvider).configure({
      mode: 'fixed',
      latitude: 37.4220,
      longitude: -122.0841,
      accuracy: 10,
      altitude: 0,
      permissionState: 'granted',
    });
    (this.biometrics as DefaultBiometricsProvider).setResult('success');
    (this.notifications as DefaultNotificationProvider).setPermissionState('granted');
    (this.sharing as DefaultSharingProvider).setResult('completed');
    this._connectivityOwned.setMode('online');
  }

  dispose(): void {
    this._connectivityOwned.dispose();
  }
}
