import { DapDecoder, encodeMessage, type DapMessage } from './dapProtocol';
import type { DapTransport } from './DapTransport';

export interface DapResponse {
  success: boolean;
  command?: string;
  body?: unknown;
  message?: string;
}

type EventHandler = (event: string, body: unknown) => void;
type ExitHandler = (code: number | null) => void;

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * A live Debug Adapter Protocol connection over a pluggable transport (local
 * stdio or a remote socket). Frames requests, correlates responses by seq, and
 * surfaces events + transport close. One instance == one debug session.
 */
export class DapClient {
  private readonly decoder = new DapDecoder();
  private readonly pending = new Map<number, { resolve: (r: DapResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private seq = 1;
  private eventHandler: EventHandler = () => undefined;
  private exitHandler: ExitHandler = () => undefined;

  constructor(private readonly transport: DapTransport) {
    transport.onData((chunk) => {
      for (const message of this.decoder.push(chunk)) this.dispatch(message);
    });
    transport.onError((error) => {
      this.failAll(error);
      this.exitHandler(null);
    });
    transport.onClose((code) => {
      this.failAll(new Error('The debug adapter connection closed.'));
      this.exitHandler(code);
    });
  }

  onEvent(handler: EventHandler): void {
    this.eventHandler = handler;
  }
  onExit(handler: ExitHandler): void {
    this.exitHandler = handler;
  }
  stderrText(): string {
    return this.transport.stderrText();
  }

  sendRequest(command: string, args?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<DapResponse> {
    return new Promise<DapResponse>((resolve, reject) => {
      const seq = this.seq++;
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`Debug request '${command}' timed out.`));
      }, timeoutMs);
      this.pending.set(seq, { resolve, reject, timer });
      try {
        this.transport.write(encodeMessage({ seq, type: 'request', command, arguments: args ?? {} }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(seq);
        reject(error as Error);
      }
    });
  }

  dispose(): void {
    this.eventHandler = () => undefined;
    this.exitHandler = () => undefined;
    this.transport.dispose();
  }

  private dispatch(message: DapMessage): void {
    if (message.type === 'response') {
      const seq = message.request_seq;
      const entry = seq !== undefined ? this.pending.get(seq) : undefined;
      if (entry && seq !== undefined) {
        clearTimeout(entry.timer);
        this.pending.delete(seq);
        entry.resolve({ success: !!message.success, command: message.command, body: message.body, message: message.message });
      }
    } else if (message.type === 'event' && message.event) {
      this.eventHandler(message.event, message.body);
    }
    // Reverse-requests (e.g. runInTerminal) aren't expected — we decline that capability.
  }

  private failAll(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}
