import { Emitter, type Event } from '../core/Emitter';
import type {
  SimulatorSessionState,
  MobileIRApp,
  SimulatorCompileResult,
  SimulatorStartResult,
  SimulatorDiagnostic,
} from '../../shared/simulatorTypes';
import { SimulatorRuntime } from './SimulatorRuntime';
import { SimulatorRenderer } from './SimulatorRenderer';

export class SimulatorSession {
  private state: SimulatorSessionState = 'idle';
  private sessionId = '';
  private lastApp: MobileIRApp | null = null;

  readonly runtime: SimulatorRuntime;
  readonly renderer: SimulatorRenderer;

  private readonly _onDidChangeState = new Emitter<SimulatorSessionState>();
  readonly onDidChangeState: Event<SimulatorSessionState> = this._onDidChangeState.event;

  private readonly _onDidCompile = new Emitter<SimulatorCompileResult>();
  readonly onDidCompile: Event<SimulatorCompileResult> = this._onDidCompile.event;

  private readonly _onError = new Emitter<string>();
  readonly onError: Event<string> = this._onError.event;

  constructor() {
    this.runtime = new SimulatorRuntime();
    this.renderer = new SimulatorRenderer();
  }

  async start(app: MobileIRApp): Promise<void> {
    this.lastApp = app;
    this.sessionId = 'sim-' + Date.now();

    this.setState('compiling');
    this.setState('starting');

    try {
      this.runtime.loadApp(app);
      this.renderer.bind(this.runtime);
      this.setState('running');
    } catch (err) {
      this.setState('failed');
      this._onError.fire(err instanceof Error ? err.message : String(err));
    }
  }

  async reload(app: MobileIRApp): Promise<void> {
    if (this.state !== 'running') return;
    this.lastApp = app;
    this.setState('reloading');

    try {
      this.runtime.reload(app);
      this.setState('running');
    } catch (err) {
      this.setState('running');
      this._onError.fire(err instanceof Error ? err.message : String(err));
    }
  }

  pause(): void {
    if (this.state === 'running') {
      this.runtime.clock.freeze();
      this.runtime.animationScheduler.cancelAll();
      this.setState('paused');
    }
  }

  resume(): void {
    if (this.state === 'paused') {
      this.runtime.clock.setRealtime();
      this.setState('running');
    }
  }

  stop(): void {
    this.runtime.reset();
    this.setState('stopped');
  }

  async restart(): Promise<void> {
    const app = this.lastApp;
    this.stop();
    if (app) {
      await this.start(app);
    }
  }

  reset(): void {
    this.stop();
    this.sessionId = '';
    this.setState('idle');
  }

  getState(): SimulatorSessionState {
    return this.state;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getRuntime(): SimulatorRuntime {
    return this.runtime;
  }

  getRenderer(): SimulatorRenderer {
    return this.renderer;
  }

  dispose(): void {
    this.runtime.dispose();
    this.renderer.dispose();
    this._onDidChangeState.dispose();
    this._onDidCompile.dispose();
    this._onError.dispose();
  }

  private setState(state: SimulatorSessionState): void {
    this.state = state;
    this._onDidChangeState.fire(state);
  }
}
