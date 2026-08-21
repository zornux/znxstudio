import { Emitter, type Event } from '../core/Emitter';
import type {
  SimulatorDiagnostic,
  SimulatorDiagnosticSeverity,
  SimulatorDiagnosticCategory,
  SimulatorEvent,
  SimulatorEventType,
} from '../../shared/simulatorTypes';

export class SimulatorDiagnostics {
  private readonly items: SimulatorDiagnostic[] = [];
  private readonly _onDiagnostic = new Emitter<SimulatorDiagnostic>();
  readonly onDiagnostic: Event<SimulatorDiagnostic> = this._onDiagnostic.event;

  private readonly _onDidChange = new Emitter<void>();
  readonly onDidChange: Event<void> = this._onDidChange.event;

  report(
    severity: SimulatorDiagnosticSeverity,
    category: SimulatorDiagnosticCategory,
    message: string,
    extra?: { nodeId?: string; sourceFile?: string; sourceLine?: number },
  ): void {
    const diagnostic: SimulatorDiagnostic = {
      severity,
      category,
      message,
      ...extra,
    };
    this.items.push(diagnostic);
    this._onDiagnostic.fire(diagnostic);
    this._onDidChange.fire();
  }

  error(category: SimulatorDiagnosticCategory, message: string, extra?: { nodeId?: string; sourceFile?: string; sourceLine?: number }): void {
    this.report('error', category, message, extra);
  }

  warning(category: SimulatorDiagnosticCategory, message: string, extra?: { nodeId?: string; sourceFile?: string; sourceLine?: number }): void {
    this.report('warning', category, message, extra);
  }

  info(category: SimulatorDiagnosticCategory, message: string, extra?: { nodeId?: string; sourceFile?: string; sourceLine?: number }): void {
    this.report('info', category, message, extra);
  }

  simulatorLimitation(message: string, nodeId?: string): void {
    this.report('info', 'simulator_limitation', message, { nodeId });
  }

  unsupportedIR(kind: string, nodeId?: string): void {
    this.report('warning', 'unsupported_ir', `Unsupported Mobile IR node: '${kind}'. This capability requires a real Android environment.`, { nodeId });
  }

  all(): readonly SimulatorDiagnostic[] {
    return this.items;
  }

  byCategory(category: SimulatorDiagnosticCategory): SimulatorDiagnostic[] {
    return this.items.filter((d) => d.category === category);
  }

  bySeverity(severity: SimulatorDiagnosticSeverity): SimulatorDiagnostic[] {
    return this.items.filter((d) => d.severity === severity);
  }

  hasErrors(): boolean {
    return this.items.some((d) => d.severity === 'error');
  }

  clear(): void {
    this.items.length = 0;
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDiagnostic.dispose();
    this._onDidChange.dispose();
  }
}

export class SimulatorEventLog {
  private readonly entries: SimulatorEvent[] = [];
  private static readonly MAX_ENTRIES = 5000;

  private readonly _onEvent = new Emitter<SimulatorEvent>();
  readonly onEvent: Event<SimulatorEvent> = this._onEvent.event;

  log(type: SimulatorEventType, detail: string, data?: Record<string, unknown>): void {
    const entry: SimulatorEvent = { type, timestamp: Date.now(), detail, data };
    this.entries.push(entry);
    if (this.entries.length > SimulatorEventLog.MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - SimulatorEventLog.MAX_ENTRIES);
    }
    this._onEvent.fire(entry);
  }

  all(): readonly SimulatorEvent[] {
    return this.entries;
  }

  filter(type: SimulatorEventType): SimulatorEvent[] {
    return this.entries.filter((e) => e.type === type);
  }

  recent(count = 50): SimulatorEvent[] {
    return this.entries.slice(-count);
  }

  clear(): void {
    this.entries.length = 0;
  }

  dispose(): void {
    this._onEvent.dispose();
  }
}
