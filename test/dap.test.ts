import { describe, expect, test } from './harness';
import { DapDecoder, encodeMessage } from '../src/main/debug/dapProtocol';

describe('dap protocol: encoding', () => {
  test('frames a message with a Content-Length header', () => {
    const buffer = encodeMessage({ seq: 1, type: 'request', command: 'initialize' });
    const text = buffer.toString('utf8');
    expect(text.startsWith('Content-Length: ')).toBeTruthy();
    expect(text.includes('\r\n\r\n')).toBeTruthy();
    const body = text.slice(text.indexOf('\r\n\r\n') + 4);
    expect(JSON.parse(body).command).toBe('initialize');
  });

  test('header length matches the utf-8 body byte length', () => {
    const buffer = encodeMessage({ type: 'event', event: 'stopped', body: { reason: 'café' } });
    const text = buffer.toString('utf8');
    const declared = Number(/Content-Length: (\d+)/.exec(text)![1]);
    const body = Buffer.from(text.slice(text.indexOf('\r\n\r\n') + 4), 'utf8');
    expect(body.length).toBe(declared);
  });
});

describe('dap protocol: decoding', () => {
  test('round-trips a single message', () => {
    const decoder = new DapDecoder();
    const messages = decoder.push(encodeMessage({ type: 'response', request_seq: 1, success: true, command: 'launch' }));
    expect(messages).toHaveLength(1);
    expect(messages[0].command).toBe('launch');
    expect(messages[0].success).toBeTruthy();
  });

  test('splits two messages arriving in one chunk', () => {
    const decoder = new DapDecoder();
    const chunk = Buffer.concat([
      encodeMessage({ type: 'event', event: 'initialized' }),
      encodeMessage({ type: 'event', event: 'terminated' }),
    ]);
    const messages = decoder.push(chunk);
    expect(messages.map((m) => m.event)).toEqual(['initialized', 'terminated']);
  });

  test('reassembles a message split across chunks', () => {
    const decoder = new DapDecoder();
    const full = encodeMessage({ type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1 } });
    const first = decoder.push(full.subarray(0, 20));
    expect(first).toHaveLength(0); // incomplete
    const rest = decoder.push(full.subarray(20));
    expect(rest).toHaveLength(1);
    expect((rest[0].body as { reason: string }).reason).toBe('breakpoint');
  });

  test('handles a header split from its body', () => {
    const decoder = new DapDecoder();
    const full = encodeMessage({ type: 'response', request_seq: 3, success: true, command: 'threads' });
    const sep = full.indexOf('\r\n\r\n') + 4;
    expect(decoder.push(full.subarray(0, sep))).toHaveLength(0);
    expect(decoder.push(full.subarray(sep))).toHaveLength(1);
  });
});
