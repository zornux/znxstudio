import { Emitter, type Event } from '../core/Emitter';
import type { PermissionState } from '../../shared/simulatorTypes';

export interface PermissionChangeEvent {
  permission: string;
  state: PermissionState;
}

export interface PermissionDialogEvent {
  permission: string;
}

const ALL_PERMISSIONS = [
  'camera', 'location', 'notifications', 'biometrics',
  'files', 'storage', 'contacts', 'microphone',
] as const;

export class SimulatorPermissions {
  private readonly states = new Map<string, PermissionState>();
  private pendingResolve: ((granted: boolean) => void) | null = null;

  private readonly _onDidChange = new Emitter<PermissionChangeEvent>();
  readonly onDidChange: Event<PermissionChangeEvent> = this._onDidChange.event;

  private readonly _onPermissionDialog = new Emitter<PermissionDialogEvent>();
  readonly onPermissionDialog: Event<PermissionDialogEvent> = this._onPermissionDialog.event;

  constructor() {
    for (const perm of ALL_PERMISSIONS) {
      this.states.set(perm, 'not_requested');
    }
  }

  getState(permission: string): PermissionState {
    return this.states.get(permission) ?? 'unavailable';
  }

  setState(permission: string, state: PermissionState): void {
    this.states.set(permission, state);
    this._onDidChange.fire({ permission, state });
  }

  async request(permission: string): Promise<PermissionState> {
    const current = this.getState(permission);

    if (current !== 'not_requested') {
      return current;
    }

    this._onPermissionDialog.fire({ permission });

    const granted = await new Promise<boolean>((resolve) => {
      this.pendingResolve = resolve;
    });

    const newState: PermissionState = granted ? 'granted' : 'denied';
    this.setState(permission, newState);
    return newState;
  }

  respondToDialog(granted: boolean): void {
    if (!this.pendingResolve) return;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    resolve(granted);
  }

  resetAll(): void {
    for (const perm of ALL_PERMISSIONS) {
      this.states.set(perm, 'not_requested');
    }
  }

  allPermissions(): Array<{ name: string; state: PermissionState }> {
    return ALL_PERMISSIONS.map((name) => ({
      name,
      state: this.getState(name),
    }));
  }

  dispose(): void {
    if (this.pendingResolve) {
      this.pendingResolve(false);
      this.pendingResolve = null;
    }
    this._onDidChange.dispose();
    this._onPermissionDialog.dispose();
  }
}
