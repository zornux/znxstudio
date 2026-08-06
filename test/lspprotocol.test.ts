import { describe, expect, test } from './harness';
import { classifyMessage, encodeLspMessage, LspDecoder } from '../src/main/lsp/lspProtocol';

describe('lsp codec: framing', () => {
  test('encodes a Content-Length framed JSON-RPC message', () => {
    const buf = encodeLspMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const text = buf.toString('utf8');
    const body = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}';
    expect(text).toBe(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  });

  test('decoder reassembles a message split across chunks', () => {
    const decoder = new LspDecoder();
    const full = encodeLspMessage({ jsonrpc: '2.0', id: 7, result: { ok: true } });
    const a = full.subarray(0, 10);
    const b = full.subarray(10);
    expect(decoder.push(a)).toHaveLength(0); // not complete yet
    const messages = decoder.push(b);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(7);
  });

  test('decoder yields multiple messages from one chunk', () => {
    const decoder = new LspDecoder();
    const chunk = Buffer.concat([
      encodeLspMessage({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'a' } }),
      encodeLspMessage({ jsonrpc: '2.0', id: 2, result: null }),
    ]);
    const messages = decoder.push(chunk);
    expect(messages).toHaveLength(2);
    expect(messages[0].method).toBe('textDocument/publishDiagnostics');
    expect(messages[1].id).toBe(2);
  });
});

describe('lsp codec: message classification', () => {
  test('a request (id + method) is a server-request', () => {
    expect(classifyMessage({ jsonrpc: '2.0', id: 3, method: 'window/showMessageRequest' })).toBe('server-request');
  });

  test('a notification has a method and no id', () => {
    expect(classifyMessage({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics' })).toBe('notification');
  });

  test('a response has an id and no method — even when the null result is omitted', () => {
    // zornux lsp omits null-valued fields, so a null-result response is just { id }.
    expect(classifyMessage({ jsonrpc: '2.0', id: 9 })).toBe('response');
    expect(classifyMessage({ jsonrpc: '2.0', id: 9, result: null })).toBe('response');
    expect(classifyMessage({ jsonrpc: '2.0', id: 9, error: { code: -1, message: 'x' } })).toBe('response');
  });
});
