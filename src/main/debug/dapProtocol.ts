/**
 * Debug Adapter Protocol wire codec — the same `Content-Length: N\r\n\r\n<json>`
 * framing LSP uses. Pure (only the Node `Buffer` global), so it is unit-testable.
 * The `zornux dap` server speaks standard DAP; this encodes outgoing messages and
 * a streaming decoder reassembles incoming ones across arbitrary chunk boundaries.
 */

export interface DapMessage {
  seq?: number;
  type: 'request' | 'response' | 'event';
  // Responses:
  request_seq?: number;
  success?: boolean;
  command?: string;
  message?: string;
  body?: unknown;
  // Events:
  event?: string;
  // Requests:
  arguments?: unknown;
}

const HEADER_SEPARATOR = '\r\n\r\n';

export function encodeMessage(message: object): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}${HEADER_SEPARATOR}`, 'ascii');
  return Buffer.concat([header, body]);
}

/** Accumulates stdout chunks and yields complete DAP messages as they arrive. */
export class DapDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): DapMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: DapMessage[] = [];

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
        messages.push(JSON.parse(body) as DapMessage);
      } catch {
        // ignore a malformed body; framing stays intact
      }
    }
    return messages;
  }
}
