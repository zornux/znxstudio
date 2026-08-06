import { spawn, type ChildProcess } from 'node:child_process';
import { classifyMessage, encodeLspMessage, LspDecoder, type LspMessage } from './lspProtocol';

type NotificationHandler = (method: string, params: unknown) => void;
type ExitHandler = (code: number | null) => void;

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * A live Language Server Protocol connection to a spawned `zornux lsp` process
 * (stdio-only — the server has no TCP mode). Frames JSON-RPC requests,
 * correlates responses by id, surfaces server→client notifications
 * (publishDiagnostics, window/logMessage…), and declines the rare server→client
 * request so the server is never left hanging. One instance == one server.
 */
export class LspClient {
  private readonly child: ChildProcess;
  private readonly decoder = new LspDecoder();
  private readonly pending = new Map<
    number,
    { resolve: (m: LspMessage) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private nextId = 1;
  private stderr = '';
  private notificationHandler: NotificationHandler = () => undefined;
  private exitHandler: ExitHandler = () => undefined;

  constructor(command: string, args: string[], cwd: string) {
    this.child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child.stdout?.on('data', (chunk: Buffer) => {
      for (const message of this.decoder.push(chunk)) this.dispatch(message);
    });
    this.child.stderr?.on('data', (chunk: Buffer) => (this.stderr += chunk.toString()));
    this.child.on('error', (error) => {
      this.failAll(error);
      this.exitHandler(null);
    });
    this.child.on('close', (code) => {
      this.failAll(new Error('The language server connection closed.'));
      this.exitHandler(code);
    });
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }
  onExit(handler: ExitHandler): void {
    this.exitHandler = handler;
  }
  stderrText(): string {
    return this.stderr.trim();
  }

  sendRequest(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<LspMessage> {
    return new Promise<LspMessage>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Language server request '${method}' timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin?.write(encodeLspMessage({ jsonrpc: '2.0', id, method, params: params ?? {} }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  sendNotification(method: string, params?: unknown): void {
    try {
      this.child.stdin?.write(encodeLspMessage({ jsonrpc: '2.0', method, params: params ?? {} }));
    } catch {
      /* server gone */
    }
  }

  dispose(): void {
    this.notificationHandler = () => undefined;
    this.exitHandler = () => undefined;
    try {
      this.child.kill();
    } catch {
      /* already gone */
    }
  }

  private dispatch(message: LspMessage): void {
    switch (classifyMessage(message)) {
      case 'notification':
        this.notificationHandler(message.method as string, message.params);
        return;
      case 'server-request':
        // We advertise no client capabilities that invite server→client requests;
        // decline politely so the server doesn't block waiting on a reply.
        this.child.stdin?.write(
          encodeLspMessage({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `Unsupported request '${message.method}'.` },
          }),
        );
        return;
      case 'response': {
        const id = typeof message.id === 'number' ? message.id : undefined;
        const entry = id !== undefined ? this.pending.get(id) : undefined;
        if (entry && id !== undefined) {
          clearTimeout(entry.timer);
          this.pending.delete(id);
          entry.resolve(message);
        }
        return;
      }
    }
  }

  private failAll(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}
