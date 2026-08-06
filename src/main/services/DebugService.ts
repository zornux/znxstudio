import type { WebContents } from 'electron';
import { dirname } from 'node:path';
import { IpcChannels } from '../../shared/ipc';
import type {
  DebugLaunchConfig,
  DebugRequestResult,
  DebugSourceVerified,
  DebugStartResult,
} from '../../shared/types';
import { DapClient } from '../debug/DapClient';
import { SocketTransport, StdioTransport, TcpLaunchTransport, type DapTransport } from '../debug/DapTransport';
import { resolveZornux } from '../util/zornuxRuntime';

const LOOPBACK = '127.0.0.1';

/**
 * Debug session manager. Bridges the renderer to a `zornux dap` adapter: spawns
 * it, runs the DAP handshake (initialize → configurationDone → launch), forwards
 * every adapter event to the renderer, and pass-throughs arbitrary DAP requests
 * (so later phases add breakpoints/stack/variables without new IPC). One session
 * at a time. Never throws to the renderer.
 */
export class DebugService {
  private client: DapClient | null = null;
  private sender: WebContents | null = null;
  private initialized = false;
  private resolveInitialized: (() => void) | null = null;

  async start(config: DebugLaunchConfig, sender: WebContents): Promise<DebugStartResult> {
    this.stop(); // dispose any prior session
    this.sender = sender;
    this.initialized = false;

    let transport: DapTransport;
    try {
      if (config.connection) {
        // Remote: attach to a DAP server already listening on host:port.
        transport = new SocketTransport(config.connection.host, config.connection.port);
      } else {
        const command = config.compilerPath?.trim() || resolveZornux().path;
        const cwd = config.workspaceRoot ?? dirname(config.program || '.');
        if (config.transport === 'tcp') {
          // Local over TCP: spawn `zornux dap <file> --tcp --port 0`, then connect
          // to the port it announces. Uses the real Zornux TCP transport.
          const args = ['dap', config.program, '--tcp', '--host', LOOPBACK, '--port', '0'];
          if (config.engine === 'vm') args.push('--engine', 'vm');
          transport = new TcpLaunchTransport(command, args, cwd, LOOPBACK);
        } else {
          // Local over stdio (default): spawn `zornux dap <file>` and pipe its stdio.
          const args = ['dap', config.program];
          if (config.engine === 'vm') args.push('--engine', 'vm');
          transport = new StdioTransport(command, args, cwd);
        }
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
    const client = new DapClient(transport);
    this.client = client;

    client.onEvent((event, body) => this.onEvent(client, event, body));
    client.onExit((code) => {
      if (this.client === client) this.client = null;
      this.send(IpcChannels.DebugClosed, { code });
    });

    try {
      const init = await client.sendRequest(
        'initialize',
        {
          clientID: 'znxstudio',
          clientName: 'ZnxStudio',
          adapterID: 'zornux',
          locale: 'en',
          linesStartAt1: true,
          columnsStartAt1: true,
          pathFormat: 'path',
          supportsRunInTerminalRequest: false,
          supportsVariableType: true,
        },
        // The adapter must fully load, parse and build the program before it can
        // answer initialize; a cold .NET start under load needs more than the
        // default request budget, so give this first request extra headroom.
        30_000,
      );
      if (!init.success) {
        return this.fail(init.message || client.stderrText() || 'initialize failed');
      }

      await this.waitForInitialized(1500);

      // Install breakpoints BEFORE launch (launch triggers the run), collecting
      // the adapter's verified verdicts in request order.
      const verified: DebugSourceVerified[] = [];
      for (const source of config.breakpoints ?? []) {
        const response = await client.sendRequest('setBreakpoints', {
          source: { path: source.path },
          breakpoints: source.lines.map((line) => ({ line: line.line, condition: line.condition })),
          lines: source.lines.map((line) => line.line),
        });
        const bps = ((response.body as { breakpoints?: Array<{ verified?: boolean; line?: number; message?: string }> })?.breakpoints) ?? [];
        verified.push({
          path: source.path,
          breakpoints: bps.map((b) => ({ verified: !!b.verified, line: b.line, message: b.message })),
        });
      }

      // Exception filters, when the caller chose a mode. Sent before
      // configurationDone, as DAP requires, and only when asked: an adapter left
      // alone keeps its own default (rc.4 breaks on uncaught errors).
      if (config.exceptionFilters) {
        await client.sendRequest('setExceptionBreakpoints', { filters: config.exceptionFilters });
      }

      await client.sendRequest('configurationDone', {});
      const launch = await client.sendRequest('launch', { program: config.program });
      if (!launch.success) {
        return this.fail(launch.message || client.stderrText() || 'launch failed');
      }
      return { success: true, capabilities: (init.body as Record<string, unknown>) ?? {}, breakpoints: verified };
    } catch (error) {
      const detail = client.stderrText();
      return this.fail(`${(error as Error).message}${detail ? ` — ${detail}` : ''}`);
    }
  }

  async request(command: string, args?: unknown): Promise<DebugRequestResult> {
    if (!this.client) return { success: false, message: 'No active debug session.' };
    try {
      const response = await this.client.sendRequest(command, args);
      return { success: response.success, body: response.body, message: response.message };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  /** Gracefully disconnect and dispose the active session. */
  stop(): void {
    const client = this.client;
    if (!client) return;
    this.client = null;
    client.onEvent(() => undefined);
    client.onExit(() => undefined);
    client.sendRequest('disconnect', { terminateDebuggee: true }).catch(() => undefined);
    setTimeout(() => client.dispose(), 300);
  }

  private onEvent(client: DapClient, event: string, body: unknown): void {
    if (this.client !== client) return; // stale client
    if (event === 'initialized') {
      this.initialized = true;
      this.resolveInitialized?.();
    }
    this.send(IpcChannels.DebugEvent, { event, body });
    if (event === 'terminated') this.stop();
  }

  private waitForInitialized(timeoutMs: number): Promise<void> {
    if (this.initialized) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.resolveInitialized = resolve;
      setTimeout(resolve, timeoutMs);
    });
  }

  private fail(error: string): DebugStartResult {
    this.stop();
    return { success: false, error };
  }

  private send(channel: string, payload: unknown): void {
    if (this.sender && !this.sender.isDestroyed()) this.sender.send(channel, payload);
  }
}
