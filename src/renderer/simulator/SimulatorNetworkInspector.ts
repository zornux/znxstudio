import { Emitter, type Event } from '../core/Emitter';
import type { SimulatorHttp } from './SimulatorHttp';
import type { SimulatorHttpRequest, SimulatorHttpResponse, MockEndpoint } from '../../shared/simulatorTypes';
import type { SimulatorClock } from './SimulatorClock';

const SENSITIVE_HEADERS = new Set([
  'authorization', 'cookie', 'set-cookie', 'x-api-key',
  'x-auth-token', 'proxy-authorization', 'www-authenticate',
]);
const SENSITIVE_BODY_KEYS = ['password', 'secret', 'token', 'apiKey', 'api_key', 'access_token', 'refresh_token', 'private_key'];
const MAX_ENTRIES = 500;

export interface NetworkEntry {
  id: number;
  method: string;
  url: string;
  requestTime: number;
  duration: number;
  status: number;
  requestSize: number;
  responseSize: number;
  mode: 'live' | 'mock' | 'recorded';
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody: string | undefined;
  responseBody: string;
  timing: NetworkTiming;
  error?: string;
}

export interface NetworkTiming {
  queued: number;
  requestStart: number;
  serverWait: number;
  response: number;
  total: number;
  simulated: boolean;
}

export interface RequestOverride {
  id: string;
  method: string;
  pathPattern: string;
  action: OverrideAction;
  active: boolean;
}

export type OverrideAction =
  | { type: 'status'; status: number }
  | { type: 'delay'; delayMs: number }
  | { type: 'timeout' }
  | { type: 'offline' }
  | { type: 'custom'; status: number; body: string; headers?: Record<string, string> };

export class SimulatorNetworkInspector {
  private readonly entries: NetworkEntry[] = [];
  private readonly overrides: RequestOverride[] = [];
  private nextId = 1;
  private nextOverrideId = 1;
  private readonly http: SimulatorHttp;
  private readonly clock: SimulatorClock;
  private readonly disposables: (() => void)[] = [];

  private readonly _onEntry = new Emitter<NetworkEntry>();
  readonly onEntry: Event<NetworkEntry> = this._onEntry.event;
  private readonly _onOverrideChange = new Emitter<void>();
  readonly onOverrideChange: Event<void> = this._onOverrideChange.event;

  constructor(http: SimulatorHttp, clock: SimulatorClock) {
    this.http = http;
    this.clock = clock;

    const d1 = http.onDidResponse(({ request, response }) => {
      this.addEntry(request, response);
    });
    this.disposables.push(() => d1.dispose());

    const d2 = http.onDidError(({ request, error }) => {
      this.addErrorEntry(request, error);
    });
    this.disposables.push(() => d2.dispose());
  }

  getEntries(): readonly NetworkEntry[] {
    return this.entries;
  }

  getEntry(id: number): NetworkEntry | undefined {
    return this.entries.find(e => e.id === id);
  }

  clear(): void {
    this.entries.length = 0;
  }

  addOverride(override: Omit<RequestOverride, 'id'>): string {
    const id = `override-${this.nextOverrideId++}`;
    this.overrides.push({ ...override, id });
    this.syncOverridesToMocks();
    this._onOverrideChange.fire();
    return id;
  }

  removeOverride(id: string): void {
    const idx = this.overrides.findIndex(o => o.id === id);
    if (idx !== -1) {
      this.overrides.splice(idx, 1);
      this.syncOverridesToMocks();
      this._onOverrideChange.fire();
    }
  }

  toggleOverride(id: string, active: boolean): void {
    const override = this.overrides.find(o => o.id === id);
    if (override) {
      override.active = active;
      this.syncOverridesToMocks();
      this._onOverrideChange.fire();
    }
  }

  getOverrides(): readonly RequestOverride[] {
    return this.overrides;
  }

  saveAsMock(entryId: number): MockEndpoint | null {
    const entry = this.entries.find(e => e.id === entryId);
    if (!entry || entry.error) return null;
    const url = new URL(entry.url, 'http://localhost');
    const responseHeaders = this.redactHeaders(entry.responseHeaders);
    let body = entry.responseBody;
    const warned = this.detectSensitiveBody(body);
    if (warned.length > 0) {
      body = this.redactBodyFields(body, warned);
    }
    const mock: MockEndpoint = {
      method: entry.method,
      path: url.pathname,
      status: entry.status,
      delayMs: 0,
      headers: responseHeaders,
      body,
    };
    this.http.addMock(mock);
    return mock;
  }

  redactHeaders(headers: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      result[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[REDACTED]' : value;
    }
    return result;
  }

  private addEntry(request: SimulatorHttpRequest, response: SimulatorHttpResponse): void {
    const entry: NetworkEntry = {
      id: this.nextId++,
      method: request.method,
      url: request.url,
      requestTime: this.clock.now(),
      duration: response.durationMs,
      status: response.status,
      requestSize: (request.body ?? '').length,
      responseSize: response.body.length,
      mode: this.http.getMode(),
      requestHeaders: this.redactHeaders(request.headers),
      responseHeaders: this.redactHeaders(response.headers),
      requestBody: request.body,
      responseBody: response.body,
      timing: {
        queued: 0,
        requestStart: 0,
        serverWait: response.durationMs * 0.6,
        response: response.durationMs * 0.4,
        total: response.durationMs,
        simulated: this.http.getMode() !== 'live',
      },
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this._onEntry.fire(entry);
  }

  private addErrorEntry(request: SimulatorHttpRequest, error: string): void {
    const entry: NetworkEntry = {
      id: this.nextId++,
      method: request.method,
      url: request.url,
      requestTime: this.clock.now(),
      duration: 0,
      status: 0,
      requestSize: (request.body ?? '').length,
      responseSize: 0,
      mode: this.http.getMode(),
      requestHeaders: this.redactHeaders(request.headers),
      responseHeaders: {},
      requestBody: request.body,
      responseBody: '',
      timing: { queued: 0, requestStart: 0, serverWait: 0, response: 0, total: 0, simulated: false },
      error,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this._onEntry.fire(entry);
  }

  private detectSensitiveBody(body: string): string[] {
    const found: string[] = [];
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed === 'object' && parsed !== null) {
        for (const key of SENSITIVE_BODY_KEYS) {
          if (key in parsed) found.push(key);
        }
      }
    } catch { /* not JSON */ }
    return found;
  }

  private redactBodyFields(body: string, fields: string[]): string {
    try {
      const parsed = JSON.parse(body);
      for (const f of fields) {
        if (f in parsed) parsed[f] = '[REDACTED]';
      }
      return JSON.stringify(parsed, null, 2);
    } catch {
      return body;
    }
  }

  private syncOverridesToMocks(): void {
    for (const override of this.overrides) {
      if (!override.active) {
        this.http.removeMock(override.method, override.pathPattern);
        continue;
      }
      const action = override.action;
      let mock: MockEndpoint;
      switch (action.type) {
        case 'status':
          mock = { method: override.method, path: override.pathPattern, status: action.status, delayMs: 0, body: '' };
          break;
        case 'delay':
          mock = { method: override.method, path: override.pathPattern, status: 200, delayMs: action.delayMs, body: '' };
          break;
        case 'timeout':
          mock = { method: override.method, path: override.pathPattern, status: 0, delayMs: 30000, body: '' };
          break;
        case 'offline':
          mock = { method: override.method, path: override.pathPattern, status: 0, delayMs: 0, body: '' };
          break;
        case 'custom':
          mock = { method: override.method, path: override.pathPattern, status: action.status, delayMs: 0, headers: action.headers, body: action.body };
          break;
      }
      this.http.addMock(mock!);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d();
    this._onEntry.dispose();
    this._onOverrideChange.dispose();
  }
}
