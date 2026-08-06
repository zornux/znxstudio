/**
 * Language Server Protocol wire codec — JSON-RPC 2.0 over the same
 * `Content-Length: N\r\n\r\n<json>` framing DAP/LSP share. Pure (only the Node
 * `Buffer` global), so it is unit-testable. `zornux lsp` speaks standard LSP;
 * this encodes outgoing messages and a streaming decoder reassembles incoming
 * ones across arbitrary chunk boundaries.
 */

export interface LspMessage {
  jsonrpc?: string;
  /** Present on requests and responses; absent on notifications. */
  id?: number | string;
  /** Present on requests and notifications; absent on responses. */
  method?: string;
  params?: unknown;
  /** Present on a successful response (may be null). */
  result?: unknown;
  /** Present on a failed response. */
  error?: { code: number; message: string; data?: unknown };
}

const HEADER_SEPARATOR = '\r\n\r\n';

export function encodeLspMessage(message: object): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}${HEADER_SEPARATOR}`, 'ascii');
  return Buffer.concat([header, body]);
}

/** Accumulates stdout chunks and yields complete LSP messages as they arrive. */
export class LspDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): LspMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: LspMessage[] = [];

    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR);
      if (headerEnd === -1) break; // headers not complete yet

      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Malformed header block — drop it so we don't spin forever.
        this.buffer = this.buffer.subarray(headerEnd + HEADER_SEPARATOR.length);
        continue;
      }

      const length = Number(match[1]);
      const bodyStart = headerEnd + HEADER_SEPARATOR.length;
      if (this.buffer.length < bodyStart + length) break; // body not fully arrived

      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        messages.push(JSON.parse(body) as LspMessage);
      } catch {
        // ignore a malformed body; framing stays intact
      }
    }
    return messages;
  }
}

/**
 * Classifies a decoded message. `zornux lsp` omits null-valued fields (its
 * serializer ignores nulls), so a response whose result is null arrives as just
 * `{ jsonrpc, id }` — the presence of `method` is the reliable discriminator,
 * NOT the presence of `result`.
 */
export type LspMessageKind = 'response' | 'notification' | 'server-request';

export function classifyMessage(message: LspMessage): LspMessageKind {
  if (message.method !== undefined) {
    return message.id !== undefined ? 'server-request' : 'notification';
  }
  return 'response';
}
