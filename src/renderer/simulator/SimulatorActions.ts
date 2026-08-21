import { Emitter, type Event } from '../core/Emitter';
import type { SimulatorStateStore } from './SimulatorStateStore';
import type { SimulatorNavigation } from './SimulatorNavigation';
import type { SimulatorHttp } from './SimulatorHttp';
import type { SimulatorStorage } from './SimulatorStorage';
import type { SimulatorPermissions } from './SimulatorPermissions';
import type { SimulatorCapabilities } from './SimulatorCapabilities';
import type { SimulatorDiagnostics, SimulatorEventLog } from './SimulatorDiagnostics';
import type { SimulatorHttpRequest } from '../../shared/simulatorTypes';

export interface ActionContext {
  screenName: string;
}

export class SimulatorActions {
  constructor(
    private readonly stateStore: SimulatorStateStore,
    private readonly navigation: SimulatorNavigation,
    private readonly http: SimulatorHttp,
    private readonly storage: SimulatorStorage,
    private readonly permissions: SimulatorPermissions,
    private readonly capabilities: SimulatorCapabilities,
    private readonly diagnostics: SimulatorDiagnostics,
    private readonly eventLog: SimulatorEventLog,
    private readonly showToast: (message: string) => void,
  ) {}

  async execute(body: string, context: ActionContext): Promise<void> {
    const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    for (const line of lines) {
      try {
        await this.executeLine(line, context);
      } catch (error) {
        this.diagnostics.error(
          'action_failed',
          `Failed to execute "${line}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  evaluateExpression(expr: string): unknown {
    const trimmed = expr.trim();

    if (trimmed === 'nothing') return null;
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;

    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }

    const num = Number(trimmed);
    if (trimmed !== '' && Number.isFinite(num)) return num;

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // Fall through to variable lookup or operator parsing.
      }
    }

    const concat = this.tryParseConcat(trimmed);
    if (concat !== undefined) return concat;

    const binOp = this.tryParseBinaryOp(trimmed);
    if (binOp !== undefined) return binOp;

    const screenVal = this.stateStore.get(trimmed);
    if (screenVal !== undefined) return screenVal;
    const appVal = this.stateStore.getAppState(trimmed);
    if (appVal !== undefined) return appVal;

    return trimmed;
  }

  dispose(): void {
    // No owned emitters to clean up — diagnostics and eventLog are owned by the runtime.
  }

  // ---------------------------------------------------------------------------

  private async executeLine(line: string, context: ActionContext): Promise<void> {
    if (line.startsWith('set ')) return this.executeSet(line, context);
    if (line === 'go back') return this.executeGoBack(context);
    if (line.startsWith('go to ')) return this.executeGoTo(line, context);
    if (line.startsWith('show ')) return this.executeShow(line, context);
    if (line.startsWith('fetch ')) return this.executeFetch(line, context);
    if (line.startsWith('post ')) return this.executePost(line, context);
    if (line.startsWith('store ')) return this.executeStore(line, context);
    if (line.startsWith('read ')) return this.executeRead(line, context);
    if (line.startsWith('request ')) return this.executePermissionRequest(line, context);
    if (line.startsWith('use ')) return this.executeCapability(line, context);
    if (line.startsWith('log ')) return this.executeLog(line, context);

    this.diagnostics.warning('unsupported_ir', `Unknown action statement: "${line}"`);
  }

  private executeSet(line: string, context: ActionContext): void {
    const match = line.match(/^set\s+(\S+)\s+to\s+(.+)$/);
    if (!match) {
      this.diagnostics.error('action_failed', `Invalid set syntax: "${line}"`);
      return;
    }
    const [, varName, rawExpr] = match;
    const value = this.evaluateExpression(rawExpr);
    this.stateStore.set(varName, value);
    this.eventLog.log('state_changed', `${varName} = ${JSON.stringify(value)}`, {
      variable: varName,
      value,
      screen: context.screenName,
    });
  }

  private executeGoTo(line: string, context: ActionContext): void {
    const withIndex = line.indexOf(' with ');
    let screenName: string;
    let args: Record<string, unknown> = {};

    if (withIndex !== -1) {
      screenName = line.slice(6, withIndex).trim();
      args = this.parseArgs(line.slice(withIndex + 6));
    } else {
      screenName = line.slice(6).trim();
    }

    this.navigation.navigate(screenName, args);
    this.eventLog.log('navigation', `Navigated to ${screenName}`, {
      from: context.screenName,
      to: screenName,
      args,
      action: 'push',
    });
  }

  private executeGoBack(context: ActionContext): void {
    const previous = this.navigation.currentScreen();
    const success = this.navigation.navigateBack();
    if (!success) {
      this.diagnostics.warning('navigation_error', 'Cannot go back: already at root screen');
      return;
    }
    this.eventLog.log('navigation', `Navigated back from ${previous}`, {
      from: context.screenName,
      to: this.navigation.currentScreen(),
      action: 'back',
    });
  }

  private executeShow(line: string, context: ActionContext): void {
    const match = line.match(/^show\s+"([^"]*)"$/);
    const message = match ? match[1] : line.slice(5).trim();
    this.showToast(message);
    this.eventLog.log('lifecycle', `Toast: ${message}`, {
      screen: context.screenName,
      message,
    });
  }

  private async executeFetch(line: string, context: ActionContext): Promise<void> {
    const url = line.slice(6).trim();
    const request: SimulatorHttpRequest = { method: 'GET', url, headers: {} };
    this.eventLog.log('http_request', `GET ${url}`, {
      method: 'GET',
      url,
      screen: context.screenName,
    });
    const response = await this.http.request(request);
    this.eventLog.log('http_response', `${response.status} from ${url}`, {
      status: response.status,
      url,
      durationMs: response.durationMs,
    });
  }

  private async executePost(line: string, context: ActionContext): Promise<void> {
    const withIndex = line.indexOf(' with ');
    let url: string;
    let body: string | undefined;

    if (withIndex !== -1) {
      url = line.slice(5, withIndex).trim();
      body = line.slice(withIndex + 6).trim();
    } else {
      url = line.slice(5).trim();
    }

    const request: SimulatorHttpRequest = {
      method: 'POST',
      url,
      headers: { 'Content-Type': 'application/json' },
      body,
    };
    this.eventLog.log('http_request', `POST ${url}`, {
      method: 'POST',
      url,
      screen: context.screenName,
    });
    const response = await this.http.request(request);
    this.eventLog.log('http_response', `${response.status} from ${url}`, {
      status: response.status,
      url,
      durationMs: response.durationMs,
    });
  }

  private executeStore(line: string, context: ActionContext): void {
    const match = line.match(/^store\s+"([^"]+)"\s*=\s*(.+)$/);
    if (!match) {
      this.diagnostics.error('action_failed', `Invalid store syntax: "${line}"`);
      return;
    }
    const [, key, rawExpr] = match;
    const value = this.evaluateExpression(rawExpr);
    this.storage.set('local', key, typeof value === 'string' ? value : JSON.stringify(value));
    this.eventLog.log('state_changed', `Stored "${key}"`, {
      storage: true,
      key,
      screen: context.screenName,
    });
  }

  private executeRead(line: string, context: ActionContext): void {
    const match = line.match(/^read\s+"([^"]+)"\s+into\s+(\S+)$/);
    if (!match) {
      this.diagnostics.error('action_failed', `Invalid read syntax: "${line}"`);
      return;
    }
    const [, key, varName] = match;
    const raw = this.storage.get('local', key);
    const value = raw !== null ? this.evaluateExpression(raw) : null;
    this.stateStore.set(varName, value);
    this.eventLog.log('state_changed', `Read "${key}" into ${varName}`, {
      storage: true,
      key,
      variable: varName,
      screen: context.screenName,
    });
  }

  private async executePermissionRequest(line: string, context: ActionContext): Promise<void> {
    const permission = line.slice(8).trim();
    this.eventLog.log('permission_requested', `Requesting ${permission}`, {
      permission,
      screen: context.screenName,
    });
    const state = await this.permissions.request(permission);
    const granted = state === 'granted';
    this.eventLog.log('permission_requested', `${permission}: ${state}`, {
      permission,
      state,
      granted,
      screen: context.screenName,
    });
  }

  private async executeCapability(line: string, context: ActionContext): Promise<void> {
    const capability = line.slice(4).trim();
    this.eventLog.log('capability_called', `Using ${capability}`, {
      capability,
      screen: context.screenName,
    });

    let result: unknown;
    switch (capability) {
      case 'camera':
        result = await this.capabilities.camera.capture();
        break;
      case 'location':
        result = await this.capabilities.location.getCurrentLocation();
        break;
      case 'biometrics':
        result = await this.capabilities.biometrics.authenticate();
        break;
      default:
        this.diagnostics.warning('capability_unavailable', `Unknown capability: "${capability}"`);
        return;
    }

    this.eventLog.log('capability_called', `${capability} completed`, {
      capability,
      result: result as Record<string, unknown> | null,
      screen: context.screenName,
    });
  }

  private executeLog(line: string, context: ActionContext): void {
    const rawExpr = line.slice(4).trim();
    const value = this.evaluateExpression(rawExpr);
    console.log(`[Simulator:${context.screenName}]`, value);
    this.eventLog.log('lifecycle', `Log: ${JSON.stringify(value)}`, {
      screen: context.screenName,
      value,
    });
  }

  // ---------------------------------------------------------------------------
  // Expression helpers
  // ---------------------------------------------------------------------------

  private tryParseBinaryOp(expr: string): unknown | undefined {
    // Split on comparison/arithmetic operators, respecting precedence.
    const operators = ['!=', '==', '>=', '<=', '>', '<', '+', '-', '*', '/'] as const;
    for (const op of operators) {
      const index = this.findOperator(expr, op);
      if (index === -1) continue;
      const left = this.evaluateExpression(expr.slice(0, index));
      const right = this.evaluateExpression(expr.slice(index + op.length));
      return this.applyOperator(op, left, right);
    }
    return undefined;
  }

  private findOperator(expr: string, op: string): number {
    let depth = 0;
    let inString: string | null = null;
    const indices: number[] = [];

    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (inString) {
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'") { inString = ch; continue; }
      if (ch === '[' || ch === '{' || ch === '(') { depth++; continue; }
      if (ch === ']' || ch === '}' || ch === ')') { depth--; continue; }
      if (depth === 0 && expr.slice(i, i + op.length) === op) {
        if (op === '-' && (i === 0 || /[+\-*/=<>!]/.test(expr[i - 1]?.trim() ?? ''))) continue;
        indices.push(i);
      }
    }

    if (indices.length === 0) return -1;
    return (op === '*' || op === '/') ? indices[0] : indices[indices.length - 1];
  }

  private applyOperator(op: string, left: unknown, right: unknown): unknown {
    switch (op) {
      case '+': {
        if (typeof left === 'number' && typeof right === 'number') return left + right;
        return String(left) + String(right);
      }
      case '-': return (left as number) - (right as number);
      case '*': return (left as number) * (right as number);
      case '/': {
        if (right === 0) return 0;
        return (left as number) / (right as number);
      }
      case '==': return left === right;
      case '!=': return left !== right;
      case '>': return (left as number) > (right as number);
      case '<': return (left as number) < (right as number);
      case '>=': return (left as number) >= (right as number);
      case '<=': return (left as number) <= (right as number);
      default: return undefined;
    }
  }

  private tryParseConcat(expr: string): string | undefined {
    const index = this.findOperator(expr, ' & ');
    if (index === -1) return undefined;
    const left = this.evaluateExpression(expr.slice(0, index));
    const right = this.evaluateExpression(expr.slice(index + 3));
    return String(left) + String(right);
  }

  private parseArgs(argsStr: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    const pairs = argsStr.split(',');
    for (const pair of pairs) {
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) continue;
      const key = pair.slice(0, eqIndex).trim();
      const rawValue = pair.slice(eqIndex + 1).trim();
      args[key] = this.evaluateExpression(rawValue);
    }
    return args;
  }
}
