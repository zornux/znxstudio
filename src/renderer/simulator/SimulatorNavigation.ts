import { Emitter, type Event } from '../core/Emitter';
import type { NavigationStackEntry } from '../../shared/simulatorTypes';

export type NavigationAction = 'push' | 'back' | 'replace' | 'clear';

export interface NavigationEvent {
  screen: string;
  args: Record<string, unknown>;
  action: NavigationAction;
}

export class SimulatorNavigation {
  private readonly entries: NavigationStackEntry[] = [];

  private readonly _onDidNavigate = new Emitter<NavigationEvent>();
  readonly onDidNavigate: Event<NavigationEvent> = this._onDidNavigate.event;

  navigate(screen: string, args: Record<string, unknown> = {}): void {
    this.entries.push({ screen, args });
    this._onDidNavigate.fire({ screen, args, action: 'push' });
  }

  navigateBack(): boolean {
    if (this.entries.length <= 1) return false;
    this.entries.pop();
    const top = this.entries[this.entries.length - 1];
    this._onDidNavigate.fire({ screen: top.screen, args: top.args, action: 'back' });
    return true;
  }

  replace(screen: string, args: Record<string, unknown> = {}): void {
    if (this.entries.length > 0) {
      this.entries[this.entries.length - 1] = { screen, args };
    } else {
      this.entries.push({ screen, args });
    }
    this._onDidNavigate.fire({ screen, args, action: 'replace' });
  }

  clearStack(screen: string, args: Record<string, unknown> = {}): void {
    this.entries.length = 0;
    this.entries.push({ screen, args });
    this._onDidNavigate.fire({ screen, args, action: 'clear' });
  }

  currentScreen(): string {
    return this.entries[this.entries.length - 1].screen;
  }

  currentArgs(): Record<string, unknown> {
    return this.entries[this.entries.length - 1].args;
  }

  stack(): NavigationStackEntry[] {
    return [...this.entries];
  }

  stackDepth(): number {
    return this.entries.length;
  }

  canGoBack(): boolean {
    return this.entries.length > 1;
  }

  reset(startScreen: string): void {
    this.entries.length = 0;
    this.entries.push({ screen: startScreen, args: {} });
  }

  dispose(): void {
    this.entries.length = 0;
    this._onDidNavigate.dispose();
  }
}
