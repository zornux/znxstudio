import { describe, expect, test } from './harness';
import { createStreamParser } from '../src/shared/ai/providers';
import { AiService } from '../src/main/services/AiService';
import { createServer, type Server } from 'node:http';

describe('stream parsers', () => {
  test('openai SSE deltas reassemble across chunk boundaries', () => {
    const parser = createStreamParser('openai');
    const out = [
      ...parser.push('data: {"choices":[{"delta":{"content":"He"}}]}\n\n'),
      ...parser.push('data: {"choices":[{"delta":{"content":"llo"}}]}\n\ndata: {"choices":[{"delta":{'),
      ...parser.push('"content":" world"}}]}\n\ndata: [DONE]\n\n'),
    ];
    expect(out.join('')).toBe('Hello world');
  });

  test('an incomplete frame buffers until its line completes', () => {
    const parser = createStreamParser('openai');
    expect(parser.push('data: {"choices":[{"delta":{"content":"x"')).toEqual([]); // no newline yet
    expect(parser.push('}}]}\n').join('')).toBe('x');
  });

  test('anthropic emits only content_block_delta text', () => {
    const parser = createStreamParser('anthropic');
    const out = [
      ...parser.push('event: message_start\ndata: {"type":"message_start"}\n\n'),
      ...parser.push('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n'),
      ...parser.push('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"!"}}\n\n'),
      ...parser.push('data: {"type":"message_stop"}\n\n'),
    ];
    expect(out.join('')).toBe('Hi!');
  });

  test('google SSE reads candidate part text', () => {
    const parser = createStreamParser('google');
    expect(parser.push('data: {"candidates":[{"content":{"parts":[{"text":"G"}]}}]}\n\n').join('')).toBe('G');
  });

  test('ollama NDJSON reads message.content per line', () => {
    const parser = createStreamParser('ollama');
    const out = parser.push('{"message":{"content":"a"},"done":false}\n{"message":{"content":"b"},"done":true}\n');
    expect(out.join('')).toBe('ab');
  });
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
}

describe('AiService.completeStream — end-to-end over a local SSE server', () => {
  test('streams deltas and resolves the full text', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":", world"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
    const port = await listen(server);
    try {
      const ai = new AiService();
      const deltas: string[] = [];
      const result = await ai.completeStream(
        { config: { provider: 'custom', baseUrl: `http://127.0.0.1:${port}`, model: 'm' }, messages: [{ role: 'user', content: 'hi' }] },
        (delta) => deltas.push(delta),
        new AbortController().signal,
      );
      expect(deltas.join('')).toBe('Hello, world');
      expect(result.ok).toBe(true);
      expect(result.text).toBe('Hello, world');
    } finally {
      server.close();
      server.closeAllConnections?.();
    }
  });

  test('cancel aborts mid-stream and reports cancelled', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
      // Never end — keeps the stream open so the caller can abort.
    });
    const port = await listen(server);
    try {
      const ai = new AiService();
      const controller = new AbortController();
      const deltas: string[] = [];
      const result = await ai.completeStream(
        { config: { provider: 'custom', baseUrl: `http://127.0.0.1:${port}`, model: 'm' }, messages: [{ role: 'user', content: 'hi' }] },
        (delta) => {
          deltas.push(delta);
          controller.abort(); // cancel after the first delta
        },
        controller.signal,
      );
      expect(deltas.join('')).toBe('partial');
      expect(result.cancelled).toBe(true);
      expect(result.ok).toBe(false);
    } finally {
      server.close();
      server.closeAllConnections?.();
    }
  });

  test('a non-2xx response is reported as an error, not a stream', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end('{"error":{"message":"rate limited"}}');
    });
    const port = await listen(server);
    try {
      const ai = new AiService();
      const result = await ai.completeStream(
        { config: { provider: 'custom', baseUrl: `http://127.0.0.1:${port}`, model: 'm' }, messages: [{ role: 'user', content: 'hi' }] },
        () => undefined,
        new AbortController().signal,
      );
      expect(result.ok).toBe(false);
      expect(result.status).toBe(429);
      expect(result.error).toContain('rate limited');
    } finally {
      server.close();
      server.closeAllConnections?.();
    }
  });
});
