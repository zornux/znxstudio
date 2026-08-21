import { Emitter, type Event } from '../core/Emitter';
import type { MobileIRStateDeclaration } from '../../shared/simulatorTypes';

export interface StateChangeEvent {
  key: string;
  value: unknown;
  screen: string;
}

export class SimulatorStateStore {
  private currentScreen = '';
  private readonly screenStates = new Map<string, Map<string, unknown>>();
  private readonly appState = new Map<string, unknown>();

  private readonly _onDidChange = new Emitter<StateChangeEvent>();
  readonly onDidChange: Event<StateChangeEvent> = this._onDidChange.event;

  initScreen(screenName: string, declarations: MobileIRStateDeclaration[]): void {
    const state = new Map<string, unknown>();
    for (const decl of declarations) {
      state.set(decl.name, this.parseInitialValue(decl.initialValue, decl.type));
    }
    this.screenStates.set(screenName, state);
    this.currentScreen = screenName;
  }

  get(key: string): unknown {
    return this.screenStates.get(this.currentScreen)?.get(key);
  }

  set(key: string, value: unknown): void {
    const screen = this.screenStates.get(this.currentScreen);
    if (!screen) return;
    screen.set(key, value);
    this._onDidChange.fire({ key, value, screen: this.currentScreen });
  }

  getAll(): Record<string, unknown> {
    const screen = this.screenStates.get(this.currentScreen);
    if (!screen) return {};
    return Object.fromEntries(screen);
  }

  setAppState(key: string, value: unknown): void {
    this.appState.set(key, value);
    this._onDidChange.fire({ key, value, screen: '@app' });
  }

  getAppState(key: string): unknown {
    return this.appState.get(key);
  }

  getAllAppState(): Record<string, unknown> {
    return Object.fromEntries(this.appState);
  }

  switchScreen(screenName: string): void {
    if (!this.screenStates.has(screenName)) {
      this.screenStates.set(screenName, new Map());
    }
    this.currentScreen = screenName;
  }

  snapshot(): { screen: Record<string, unknown>; app: Record<string, unknown> } {
    return {
      screen: this.getAll(),
      app: this.getAllAppState(),
    };
  }

  restore(snap: { screen: Record<string, unknown>; app: Record<string, unknown> }): void {
    const screen = this.screenStates.get(this.currentScreen);
    if (screen) {
      screen.clear();
      for (const [key, value] of Object.entries(snap.screen)) {
        screen.set(key, value);
      }
    }
    this.appState.clear();
    for (const [key, value] of Object.entries(snap.app)) {
      this.appState.set(key, value);
    }
  }

  reset(): void {
    this.screenStates.clear();
    this.appState.clear();
    this.currentScreen = '';
  }

  dispose(): void {
    this.reset();
    this._onDidChange.dispose();
  }

  private parseInitialValue(raw: string, type: MobileIRStateDeclaration['type']): unknown {
    if (raw === 'nothing') return null;

    switch (type) {
      case 'truth':
        return raw === 'true';
      case 'whole':
        return this.tryParseNumber(raw) ?? 0;
      case 'decimal':
        return this.tryParseNumber(raw) ?? 0.0;
      case 'list':
        return this.tryParseJson(raw) ?? [];
      case 'record':
        return this.tryParseJson(raw) ?? {};
      case 'text':
        return raw;
      case 'any':
        return this.inferValue(raw);
      default:
        return this.inferValue(raw);
    }
  }

  private inferValue(raw: string): unknown {
    if (raw === 'true') return true;
    if (raw === 'false') return false;

    const num = this.tryParseNumber(raw);
    if (num !== undefined) return num;

    if (raw.startsWith('[') || raw.startsWith('{')) {
      const parsed = this.tryParseJson(raw);
      if (parsed !== undefined) return parsed;
    }

    return raw;
  }

  private tryParseNumber(raw: string): number | undefined {
    if (raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  private tryParseJson(raw: string): unknown | undefined {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
}
