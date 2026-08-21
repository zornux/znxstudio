import { Emitter, type Event } from '../core/Emitter';

export type ClockMode = 'realtime' | 'frozen' | 'custom';

export interface ClockTickEvent {
  now: number;
  delta: number;
}

export class SimulatorClock {
  private _mode: ClockMode = 'realtime';
  private _frozenTime = 0;
  private _customOffset = 0;
  private readonly timers = new Map<number, { callback: () => void; fireAt: number; interval: number | null }>();
  private nextTimerId = 1;
  private readonly _onTick = new Emitter<ClockTickEvent>();
  readonly onTick: Event<ClockTickEvent> = this._onTick.event;
  private readonly _onModeChange = new Emitter<ClockMode>();
  readonly onModeChange: Event<ClockMode> = this._onModeChange.event;

  now(): number {
    switch (this._mode) {
      case 'realtime': return Date.now();
      case 'frozen': return this._frozenTime;
      case 'custom': return Date.now() + this._customOffset;
    }
  }

  mode(): ClockMode { return this._mode; }

  setRealtime(): void {
    this._mode = 'realtime';
    this._onModeChange.fire('realtime');
  }

  freeze(at?: number): void {
    this._frozenTime = at ?? this.now();
    this._mode = 'frozen';
    this._onModeChange.fire('frozen');
  }

  setCustomTime(epochMs: number): void {
    this._customOffset = epochMs - Date.now();
    this._mode = 'custom';
    this._onModeChange.fire('custom');
  }

  advance(ms: number): void {
    if (ms <= 0) return;
    const before = this.now();
    if (this._mode === 'frozen') {
      this._frozenTime += ms;
    } else if (this._mode === 'custom') {
      this._customOffset += ms;
    }
    const after = this.now();
    this.fireTimers(before, after);
    this._onTick.fire({ now: after, delta: ms });
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextTimerId++;
    this.timers.set(id, { callback, fireAt: this.now() + delayMs, interval: null });
    return id;
  }

  setInterval(callback: () => void, intervalMs: number): number {
    const id = this.nextTimerId++;
    this.timers.set(id, { callback, fireAt: this.now() + intervalMs, interval: intervalMs });
    return id;
  }

  clearTimeout(id: number): void {
    this.timers.delete(id);
  }

  clearInterval(id: number): void {
    this.timers.delete(id);
  }

  clearAllTimers(): void {
    this.timers.clear();
  }

  private fireTimers(before: number, after: number): void {
    const fired: number[] = [];
    for (const [id, timer] of this.timers) {
      if (timer.fireAt > before && timer.fireAt <= after) {
        timer.callback();
        if (timer.interval !== null) {
          timer.fireAt += timer.interval;
        } else {
          fired.push(id);
        }
      }
    }
    for (const id of fired) this.timers.delete(id);
  }

  reset(): void {
    this._mode = 'realtime';
    this._frozenTime = 0;
    this._customOffset = 0;
    this.timers.clear();
    this.nextTimerId = 1;
  }

  dispose(): void {
    this.timers.clear();
    this._onTick.dispose();
    this._onModeChange.dispose();
  }
}
