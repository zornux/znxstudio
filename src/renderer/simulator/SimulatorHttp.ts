import { Emitter, type Event } from '../core/Emitter';
import type {
  HttpMode,
  MockEndpoint,
  RecordedExchange,
  SimulatorHttpRequest,
  SimulatorHttpResponse,
} from '../../shared/simulatorTypes';
import type { IConnectivityProvider } from './SimulatorCapabilities';

const SLOW_DELAY_MS = 2000;
const SANITIZED_HEADERS = ['authorization'];

export interface HttpErrorEvent {
  request: SimulatorHttpRequest;
  error: string;
}

export interface HttpExchangeEvent {
  request: SimulatorHttpRequest;
  response: SimulatorHttpResponse;
}

export class SimulatorHttp {
  private _mode: HttpMode = 'live';
  private readonly mocks: MockEndpoint[] = [];
  private readonly recorded: RecordedExchange[] = [];
  private _recording = false;

  private readonly _onDidRequest = new Emitter<SimulatorHttpRequest>();
  readonly onDidRequest: Event<SimulatorHttpRequest> = this._onDidRequest.event;

  private readonly _onDidResponse = new Emitter<HttpExchangeEvent>();
  readonly onDidResponse: Event<HttpExchangeEvent> = this._onDidResponse.event;

  private readonly _onDidError = new Emitter<HttpErrorEvent>();
  readonly onDidError: Event<HttpErrorEvent> = this._onDidError.event;

  constructor(private readonly connectivity: IConnectivityProvider) {}

  setMode(mode: HttpMode): void {
    this._mode = mode;
  }

  getMode(): HttpMode {
    return this._mode;
  }

  addMock(endpoint: MockEndpoint): void {
    const idx = this.mocks.findIndex(
      (m) => m.method === endpoint.method && m.path === endpoint.path,
    );
    if (idx !== -1) {
      this.mocks[idx] = endpoint;
    } else {
      this.mocks.push(endpoint);
    }
  }

  removeMock(method: string, path: string): void {
    const idx = this.mocks.findIndex((m) => m.method === method && m.path === path);
    if (idx !== -1) this.mocks.splice(idx, 1);
  }

  clearMocks(): void {
    this.mocks.length = 0;
  }

  getMocks(): MockEndpoint[] {
    return [...this.mocks];
  }

  getRecorded(): RecordedExchange[] {
    return [...this.recorded];
  }

  clearRecorded(): void {
    this.recorded.length = 0;
  }

  setRecording(enabled: boolean): void {
    this._recording = enabled;
  }

  isRecording(): boolean {
    return this._recording;
  }

  async request(req: SimulatorHttpRequest): Promise<SimulatorHttpResponse> {
    this._onDidRequest.fire(req);

    try {
      await this.enforceConnectivity(req);

      const connectivityDelay = this.connectivity.mode() === 'slow' ? SLOW_DELAY_MS : 0;

      let response: SimulatorHttpResponse;

      switch (this._mode) {
        case 'mock':
          response = await this.handleMock(req, connectivityDelay);
          break;
        case 'recorded':
          response = this.handleRecorded(req, connectivityDelay);
          break;
        case 'live':
        default:
          response = await this.handleLive(req, connectivityDelay);
          break;
      }

      this._onDidResponse.fire({ request: req, response });
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._onDidError.fire({ request: req, error: message });
      throw err;
    }
  }

  dispose(): void {
    this._onDidRequest.dispose();
    this._onDidResponse.dispose();
    this._onDidError.dispose();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async enforceConnectivity(req: SimulatorHttpRequest): Promise<void> {
    const mode = this.connectivity.mode();

    if (mode === 'offline') {
      throw new Error(`Network request failed: device is offline (${req.method} ${req.url})`);
    }

    if (mode === 'intermittent' && Math.random() < 0.5) {
      throw new Error(`Network request failed: connection lost (${req.method} ${req.url})`);
    }
  }

  private async handleMock(
    req: SimulatorHttpRequest,
    extraDelayMs: number,
  ): Promise<SimulatorHttpResponse> {
    const url = new URL(req.url, 'http://localhost');
    const mock = this.mocks.find(
      (m) => m.method.toUpperCase() === req.method.toUpperCase() && m.path === url.pathname,
    );

    if (!mock) {
      return { status: 404, headers: {}, body: 'No mock matched', durationMs: 0 };
    }

    const totalDelay = mock.delayMs + extraDelayMs;
    if (totalDelay > 0) {
      await this.delay(totalDelay);
    }

    return {
      status: mock.status,
      headers: mock.headers ? { ...mock.headers } : {},
      body: mock.body,
      durationMs: totalDelay,
    };
  }

  private handleRecorded(
    req: SimulatorHttpRequest,
    extraDelayMs: number,
  ): SimulatorHttpResponse {
    const match = this.recorded.find(
      (r) => r.method.toUpperCase() === req.method.toUpperCase() && r.url === req.url,
    );

    if (!match) {
      return { status: 404, headers: {}, body: 'No recorded exchange matched', durationMs: 0 };
    }

    return {
      status: match.status,
      headers: { ...match.responseHeaders },
      body: match.responseBody,
      durationMs: match.durationMs + extraDelayMs,
    };
  }

  private async handleLive(
    req: SimulatorHttpRequest,
    extraDelayMs: number,
  ): Promise<SimulatorHttpResponse> {
    if (extraDelayMs > 0) {
      await this.delay(extraDelayMs);
    }

    const start = performance.now();

    const fetchResponse = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body ?? undefined,
    });

    const body = await fetchResponse.text();
    const durationMs = Math.round(performance.now() - start) + extraDelayMs;

    const responseHeaders: Record<string, string> = {};
    fetchResponse.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const response: SimulatorHttpResponse = {
      status: fetchResponse.status,
      headers: responseHeaders,
      body,
      durationMs,
    };

    if (this._recording) {
      this.recorded.push({
        method: req.method,
        url: req.url,
        requestHeaders: this.sanitizeHeaders(req.headers),
        requestBody: req.body,
        status: response.status,
        responseHeaders: { ...response.headers },
        responseBody: response.body,
        durationMs: response.durationMs,
        timestamp: Date.now(),
      });
    }

    return response;
  }

  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (SANITIZED_HEADERS.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
