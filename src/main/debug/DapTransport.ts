import { spawn, type ChildProcess } from 'node:child_process';
import { connect, type Socket } from 'node:net';

/**
 * A byte-stream transport for the Debug Adapter Protocol. DAP framing is the same
 * regardless of how the bytes travel, so the DapClient is transport-agnostic:
 *   - StdioTransport spawns a local `zornux dap` and pipes its stdio,
 *   - TcpLaunchTransport spawns a local `zornux dap --tcp --port 0`, discovers the
 *     port it announces, and connects a socket (local, over the real TCP path),
 *   - SocketTransport connects to a DAP server listening on host:port (remote).
 */
export interface DapTransport {
  onData(handler: (chunk: Buffer) => void): void;
  onClose(handler: (code: number | null) => void): void;
  onError(handler: (error: Error) => void): void;
  write(data: Buffer): void;
  /** Adapter stderr text (stdio only; '' for sockets). */
  stderrText(): string;
  dispose(): void;
}

const noop = (): void => undefined;

/** Local transport: spawns the adapter and pipes its stdin/stdout/stderr. */
export class StdioTransport implements DapTransport {
  private readonly child: ChildProcess;
  private stderr = '';
  private dataHandler: (chunk: Buffer) => void = noop;
  private closeHandler: (code: number | null) => void = noop;
  private errorHandler: (error: Error) => void = noop;

  constructor(command: string, args: string[], cwd: string) {
    this.child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child.stdout?.on('data', (chunk: Buffer) => this.dataHandler(chunk));
    this.child.stderr?.on('data', (chunk: Buffer) => (this.stderr += chunk.toString()));
    this.child.on('error', (error) => this.errorHandler(error));
    this.child.on('close', (code) => this.closeHandler(code));
  }

  onData(handler: (chunk: Buffer) => void): void {
    this.dataHandler = handler;
  }
  onClose(handler: (code: number | null) => void): void {
    this.closeHandler = handler;
  }
  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }
  write(data: Buffer): void {
    this.child.stdin?.write(data);
  }
  stderrText(): string {
    return this.stderr.trim();
  }
  dispose(): void {
    try {
      this.child.kill();
    } catch {
      /* already gone */
    }
  }
}

/**
 * Local transport over TCP. Spawns `zornux dap <file> --tcp --host <h> --port 0`,
 * waits for the adapter to announce its bound port on stdout ("... listening on
 * <h> port <N>."), then connects a socket and speaks DAP over it. The protocol
 * flows over the socket; the child's stdout carries only human status lines and
 * its stderr carries warnings/errors. Exercises the real Zornux TCP transport
 * end-to-end without needing an externally-managed adapter process.
 */
export class TcpLaunchTransport implements DapTransport {
  private readonly child: ChildProcess;
  private socket: Socket | null = null;
  private stderr = '';
  private announce = '';
  private connected = false;
  private closed = false;
  private portFound = false;
  private readonly outbox: Buffer[] = [];
  private dataHandler: (chunk: Buffer) => void = noop;
  private closeHandler: (code: number | null) => void = noop;
  private errorHandler: (error: Error) => void = noop;
  private readonly portTimer: ReturnType<typeof setTimeout>;

  constructor(command: string, args: string[], cwd: string, private readonly host: string) {
    // stdin is unused in TCP mode — the protocol travels over the socket.
    this.child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child.stderr?.on('data', (chunk: Buffer) => (this.stderr += chunk.toString()));
    this.child.stdout?.on('data', (chunk: Buffer) => this.onAnnounce(chunk));
    this.child.on('error', (error) => this.errorHandler(error));
    this.child.on('close', (code) => this.onChildClose(code));
    // Don't hang forever if the adapter never reports a port (e.g. bind failure).
    // The window is generous: a cold .NET start under load can take many seconds
    // to load, parse and build the program before it binds and announces.
    this.portTimer = setTimeout(() => {
      if (!this.portFound && !this.closed) {
        const detail = this.stderr.trim();
        this.errorHandler(new Error(`Timed out waiting for the debug adapter's TCP port.${detail ? ` — ${detail}` : ''}`));
      }
    }, 20_000);
  }

  private onAnnounce(chunk: Buffer): void {
    this.announce += chunk.toString();
    if (this.portFound) return;
    const match = /listening on \S+ port (\d+)/i.exec(this.announce);
    if (!match) return;
    this.portFound = true;
    clearTimeout(this.portTimer);
    this.connectSocket(Number(match[1]));
  }

  private connectSocket(port: number): void {
    const socket = connect({ host: this.host, port });
    this.socket = socket;
    socket.on('connect', () => {
      this.connected = true;
      for (const buffered of this.outbox.splice(0)) socket.write(buffered);
    });
    socket.on('data', (chunk: Buffer) => this.dataHandler(chunk));
    socket.on('error', (error) => this.errorHandler(error));
    // The child's exit is the authoritative end-of-session, so socket 'close' is
    // not forwarded — onChildClose drives the close handler.
  }

  private onChildClose(code: number | null): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.portTimer);
    if (!this.portFound) {
      // Exited before it ever listened — surface why (bind failure, load error…).
      const detail = this.stderr.trim() || this.announce.trim();
      this.errorHandler(new Error(detail || `Debug adapter exited (code ${code ?? 'null'}) before listening.`));
      return;
    }
    this.closeHandler(code);
  }

  onData(handler: (chunk: Buffer) => void): void {
    this.dataHandler = handler;
  }
  onClose(handler: (code: number | null) => void): void {
    this.closeHandler = handler;
  }
  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }
  write(data: Buffer): void {
    if (this.connected && this.socket) this.socket.write(data);
    else this.outbox.push(data); // buffer until the socket is up
  }
  stderrText(): string {
    return this.stderr.trim();
  }
  dispose(): void {
    clearTimeout(this.portTimer);
    try {
      this.socket?.destroy();
    } catch {
      /* already gone */
    }
    try {
      this.child.kill();
    } catch {
      /* already gone */
    }
  }
}

/** Remote transport: connects to a DAP server over TCP. */
export class SocketTransport implements DapTransport {
  private readonly socket: Socket;
  private dataHandler: (chunk: Buffer) => void = noop;
  private closeHandler: (code: number | null) => void = noop;
  private errorHandler: (error: Error) => void = noop;

  constructor(host: string, port: number) {
    this.socket = connect({ host, port });
    this.socket.on('data', (chunk: Buffer) => this.dataHandler(chunk));
    this.socket.on('close', () => this.closeHandler(null));
    this.socket.on('error', (error) => this.errorHandler(error));
  }

  onData(handler: (chunk: Buffer) => void): void {
    this.dataHandler = handler;
  }
  onClose(handler: (code: number | null) => void): void {
    this.closeHandler = handler;
  }
  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }
  write(data: Buffer): void {
    this.socket.write(data);
  }
  stderrText(): string {
    return '';
  }
  dispose(): void {
    this.socket.destroy();
  }
}
