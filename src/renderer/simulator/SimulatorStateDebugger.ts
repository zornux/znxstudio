import { Emitter, type Event } from '../core/Emitter';
import type { SimulatorStateStore } from './SimulatorStateStore';
import type { SimulatorNavigation } from './SimulatorNavigation';
import type { SimulatorPermissions } from './SimulatorPermissions';
import type { SimulatorClock } from './SimulatorClock';

export interface StateHistoryEntry {
  timestamp: number;
  source: string;
  event: string;
  key: string;
  oldValue: unknown;
  newValue: unknown;
  screen: string;
}

export interface TimeTravelSnapshot {
  id: number;
  timestamp: number;
  label: string;
  screenState: Record<string, unknown>;
  appState: Record<string, unknown>;
  navigationStack: { screen: string; args: Record<string, unknown> }[];
  permissions: { name: string; state: string }[];
}

const MAX_HISTORY = 1000;
const MAX_SNAPSHOTS = 100;

export class SimulatorStateDebugger {
  private readonly history: StateHistoryEntry[] = [];
  private readonly snapshots: TimeTravelSnapshot[] = [];
  private nextSnapshotId = 1;
  private isHistorical = false;
  private currentSnapshotIdx = -1;
  private readonly watches = new Set<string>();
  private readonly overrides = new Set<string>();
  private readonly disposables: (() => void)[] = [];

  private readonly _onHistoryEntry = new Emitter<StateHistoryEntry>();
  readonly onHistoryEntry: Event<StateHistoryEntry> = this._onHistoryEntry.event;
  private readonly _onTimeTravelChange = new Emitter<{ historical: boolean; snapshotId: number | null }>();
  readonly onTimeTravelChange: Event<{ historical: boolean; snapshotId: number | null }> = this._onTimeTravelChange.event;

  constructor(
    private readonly stateStore: SimulatorStateStore,
    private readonly navigation: SimulatorNavigation,
    private readonly permissions: SimulatorPermissions,
    private readonly clock: SimulatorClock,
  ) {
    const d1 = stateStore.onDidChange((e) => {
      const entry: StateHistoryEntry = {
        timestamp: clock.now(),
        source: 'state',
        event: 'state_changed',
        key: e.key,
        oldValue: undefined,
        newValue: e.value,
        screen: e.screen,
      };
      this.addHistory(entry);
      this.autoSnapshot();
    });
    this.disposables.push(() => d1.dispose());

    const d2 = navigation.onDidNavigate((e) => {
      this.addHistory({
        timestamp: clock.now(),
        source: 'navigation',
        event: e.action,
        key: 'screen',
        oldValue: undefined,
        newValue: e.screen,
        screen: e.screen,
      });
      this.autoSnapshot();
    });
    this.disposables.push(() => d2.dispose());
  }

  getHistory(count?: number): readonly StateHistoryEntry[] {
    if (count) return this.history.slice(-count);
    return this.history;
  }

  searchHistory(query: string): StateHistoryEntry[] {
    const q = query.toLowerCase();
    return this.history.filter(e =>
      e.key.toLowerCase().includes(q) ||
      e.event.toLowerCase().includes(q) ||
      String(e.newValue).toLowerCase().includes(q)
    );
  }

  addWatch(key: string): void {
    this.watches.add(key);
  }

  removeWatch(key: string): void {
    this.watches.delete(key);
  }

  getWatches(): string[] {
    return [...this.watches];
  }

  getWatchValues(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of this.watches) {
      result[key] = this.stateStore.get(key) ?? this.stateStore.getAppState(key);
    }
    return result;
  }

  safeEdit(key: string, value: unknown): void {
    this.overrides.add(key);
    this.stateStore.set(key, value);
    this.addHistory({
      timestamp: this.clock.now(),
      source: 'SIMULATOR OVERRIDE',
      event: 'manual_edit',
      key,
      oldValue: undefined,
      newValue: value,
      screen: this.navigation.currentScreen(),
    });
  }

  isOverridden(key: string): boolean {
    return this.overrides.has(key);
  }

  clearOverride(key: string): void {
    this.overrides.delete(key);
  }

  getOverrides(): string[] {
    return [...this.overrides];
  }

  takeSnapshot(label?: string): number {
    const snap: TimeTravelSnapshot = {
      id: this.nextSnapshotId++,
      timestamp: this.clock.now(),
      label: label ?? `Snapshot ${this.snapshots.length + 1}`,
      screenState: this.stateStore.getAll(),
      appState: this.stateStore.getAllAppState(),
      navigationStack: this.navigation.stack(),
      permissions: this.permissions.allPermissions().map(p => ({ name: p.name, state: p.state })),
    };
    this.snapshots.push(snap);
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
    return snap.id;
  }

  getSnapshots(): readonly TimeTravelSnapshot[] {
    return this.snapshots;
  }

  travelTo(snapshotId: number): boolean {
    const idx = this.snapshots.findIndex(s => s.id === snapshotId);
    if (idx === -1) return false;
    const snap = this.snapshots[idx];
    this.stateStore.restore({ screen: snap.screenState, app: snap.appState });
    for (const perm of snap.permissions) {
      this.permissions.setState(perm.name, perm.state as never);
    }
    this.currentSnapshotIdx = idx;
    this.isHistorical = true;
    this._onTimeTravelChange.fire({ historical: true, snapshotId: snap.id });
    return true;
  }

  previousState(): boolean {
    if (this.snapshots.length === 0) return false;
    const target = this.isHistorical ? Math.max(0, this.currentSnapshotIdx - 1) : this.snapshots.length - 1;
    return this.travelTo(this.snapshots[target].id);
  }

  nextState(): boolean {
    if (!this.isHistorical || this.currentSnapshotIdx >= this.snapshots.length - 1) {
      return this.returnToLive();
    }
    return this.travelTo(this.snapshots[this.currentSnapshotIdx + 1].id);
  }

  returnToLive(): boolean {
    if (!this.isHistorical) return false;
    this.isHistorical = false;
    this.currentSnapshotIdx = -1;
    this._onTimeTravelChange.fire({ historical: false, snapshotId: null });
    return true;
  }

  isInHistoricalState(): boolean {
    return this.isHistorical;
  }

  private addHistory(entry: StateHistoryEntry): void {
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY);
    this._onHistoryEntry.fire(entry);
  }

  private autoSnapshot(): void {
    if (this.snapshots.length === 0 || this.clock.now() - this.snapshots[this.snapshots.length - 1].timestamp > 1000) {
      this.takeSnapshot();
    }
  }

  reset(): void {
    this.history.length = 0;
    this.snapshots.length = 0;
    this.watches.clear();
    this.overrides.clear();
    this.isHistorical = false;
    this.currentSnapshotIdx = -1;
  }

  dispose(): void {
    for (const d of this.disposables) d();
    this.reset();
    this._onHistoryEntry.dispose();
    this._onTimeTravelChange.dispose();
  }
}
