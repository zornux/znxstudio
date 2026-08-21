import { Emitter, type Event } from '../core/Emitter';

export interface FocusChangeEvent {
  previous: string | null;
  current: string | null;
  reason: FocusReason;
}

export type FocusReason = 'user' | 'programmatic' | 'navigation' | 'dialog_open' | 'dialog_close' | 'hot_reload' | 'disabled' | 'removed';

interface FocusableEntry {
  nodeId: string;
  element: HTMLElement;
  order: number;
  trapGroup: string | null;
}

export class SimulatorFocusManager {
  private readonly focusables: FocusableEntry[] = [];
  private currentFocusId: string | null = null;
  private trapStack: string[] = [];
  private enabled = true;

  private readonly _onFocusChange = new Emitter<FocusChangeEvent>();
  readonly onFocusChange: Event<FocusChangeEvent> = this._onFocusChange.event;

  register(nodeId: string, element: HTMLElement, order?: number, trapGroup?: string): () => void {
    const entry: FocusableEntry = { nodeId, element, order: order ?? this.focusables.length, trapGroup: trapGroup ?? null };
    this.focusables.push(entry);
    this.focusables.sort((a, b) => a.order - b.order);
    return () => {
      const idx = this.focusables.indexOf(entry);
      if (idx !== -1) {
        this.focusables.splice(idx, 1);
        if (this.currentFocusId === nodeId) {
          this.clearFocus('removed');
        }
      }
    };
  }

  requestFocus(nodeId: string, reason: FocusReason = 'programmatic'): boolean {
    if (!this.enabled) return false;
    const entry = this.focusables.find(f => f.nodeId === nodeId);
    if (!entry) return false;
    const activeTrap = this.activeTrap();
    if (activeTrap && entry.trapGroup !== activeTrap) return false;
    this.setFocus(entry, reason);
    return true;
  }

  clearFocus(reason: FocusReason = 'programmatic'): void {
    if (this.currentFocusId === null) return;
    const previous = this.currentFocusId;
    this.currentFocusId = null;
    this._onFocusChange.fire({ previous, current: null, reason });
  }

  nextFocus(): boolean {
    return this.moveFocus(1);
  }

  previousFocus(): boolean {
    return this.moveFocus(-1);
  }

  currentFocus(): string | null {
    return this.currentFocusId;
  }

  pushTrap(groupId: string): void {
    this.trapStack.push(groupId);
    const firstInTrap = this.focusables.find(f => f.trapGroup === groupId);
    if (firstInTrap) this.setFocus(firstInTrap, 'dialog_open');
  }

  popTrap(): void {
    this.trapStack.pop();
    if (this.currentFocusId) {
      const entry = this.focusables.find(f => f.nodeId === this.currentFocusId);
      const activeTrap = this.activeTrap();
      if (entry && activeTrap && entry.trapGroup !== activeTrap) {
        const firstInTrap = this.focusables.find(f => f.trapGroup === activeTrap);
        if (firstInTrap) this.setFocus(firstInTrap, 'dialog_close');
        else this.clearFocus('dialog_close');
      }
    }
  }

  onScreenOpen(): void {
    const first = this.availableFocusables()[0];
    if (first) this.setFocus(first, 'navigation');
  }

  onHotReload(): void {
    if (this.currentFocusId) {
      const still = this.focusables.find(f => f.nodeId === this.currentFocusId);
      if (!still) this.clearFocus('hot_reload');
    }
  }

  onNodeDisabled(nodeId: string): void {
    if (this.currentFocusId === nodeId) {
      this.clearFocus('disabled');
      this.nextFocus();
    }
  }

  getFocusOrder(): string[] {
    return this.availableFocusables().map(f => f.nodeId);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clearFocus('programmatic');
  }

  private moveFocus(direction: 1 | -1): boolean {
    const available = this.availableFocusables();
    if (available.length === 0) return false;
    const currentIdx = this.currentFocusId ? available.findIndex(f => f.nodeId === this.currentFocusId) : -1;
    let nextIdx: number;
    if (currentIdx === -1) {
      nextIdx = direction === 1 ? 0 : available.length - 1;
    } else {
      nextIdx = currentIdx + direction;
      if (nextIdx < 0) nextIdx = available.length - 1;
      if (nextIdx >= available.length) nextIdx = 0;
    }
    this.setFocus(available[nextIdx], 'user');
    return true;
  }

  private availableFocusables(): FocusableEntry[] {
    const activeTrap = this.activeTrap();
    if (activeTrap) return this.focusables.filter(f => f.trapGroup === activeTrap);
    return this.focusables.filter(f => f.trapGroup === null);
  }

  private activeTrap(): string | null {
    return this.trapStack.length > 0 ? this.trapStack[this.trapStack.length - 1] : null;
  }

  private setFocus(entry: FocusableEntry, reason: FocusReason): void {
    const previous = this.currentFocusId;
    if (previous === entry.nodeId) return;
    this.currentFocusId = entry.nodeId;
    entry.element?.focus({ preventScroll: false });
    this._onFocusChange.fire({ previous, current: entry.nodeId, reason });
  }

  reset(): void {
    this.focusables.length = 0;
    this.currentFocusId = null;
    this.trapStack.length = 0;
  }

  dispose(): void {
    this.reset();
    this._onFocusChange.dispose();
  }
}
