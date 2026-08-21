import { Emitter, type Event } from '../core/Emitter';
import type { StorageEntry } from '../../shared/simulatorTypes';

export type StoreKind = 'local' | 'secure' | 'preferences';

export interface StorageChangeEvent {
  store: StoreKind;
  key: string;
  value: string | null;
}

export class SimulatorStorage {
  private readonly stores: Record<StoreKind, Map<string, string>> = {
    local: new Map(),
    secure: new Map(),
    preferences: new Map(),
  };

  private readonly _onDidChange = new Emitter<StorageChangeEvent>();
  readonly onDidChange: Event<StorageChangeEvent> = this._onDidChange.event;

  get(store: StoreKind, key: string): string | null {
    return this.stores[store].get(key) ?? null;
  }

  set(store: StoreKind, key: string, value: string): void {
    this.stores[store].set(key, value);
    this._onDidChange.fire({ store, key, value });
  }

  remove(store: StoreKind, key: string): void {
    if (!this.stores[store].has(key)) return;
    this.stores[store].delete(key);
    this._onDidChange.fire({ store, key, value: null });
  }

  clear(store: StoreKind): void {
    this.stores[store].clear();
  }

  clearAll(): void {
    this.stores.local.clear();
    this.stores.secure.clear();
    this.stores.preferences.clear();
  }

  entries(store: StoreKind): StorageEntry[] {
    return Array.from(this.stores[store].entries(), ([key, value]) => ({ key, value, store }));
  }

  allEntries(): StorageEntry[] {
    return [
      ...this.entries('local'),
      ...this.entries('secure'),
      ...this.entries('preferences'),
    ];
  }

  exportSafe(): StorageEntry[] {
    return [
      ...this.entries('local'),
      ...this.entries('preferences'),
    ];
  }

  dispose(): void {
    this.clearAll();
    this._onDidChange.dispose();
  }
}
