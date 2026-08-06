import { describe, expect, test } from './harness';
import { createServer, type AddressInfo } from 'node:net';
import { DapClient } from '../src/main/debug/DapClient';
import { SocketTransport } from '../src/main/debug/DapTransport';
import { DapDecoder, encodeMessage } from '../src/main/debug/dapProtocol';

/**
 * Verifies the remote-debug transport: a DapClient over a TCP SocketTransport
 * completes the DAP handshake against a minimal mock adapter server, exercising
 * the real socket + Content-Length framing end-to-end (the local stdio path is
 * covered by the app self-tests).
 */
describe('dap client: remote socket transport', () => {
  test('handshakes with a DAP server over TCP', async () => {
    const server = createServer((socket) => {
      const decoder = new DapDecoder();
      socket.on('data', (chunk) => {
        for (const message of decoder.push(chunk)) {
          if (message.command === 'initialize') {
            socket.write(
              encodeMessage({
                seq: 1,
                type: 'response',
                request_seq: message.seq,
                success: true,
                command: 'initialize',
                body: { supportsConfigurationDoneRequest: true },
              }),
            );
            socket.write(encodeMessage({ seq: 2, type: 'event', event: 'initialized' }));
          } else if (message.command === 'disconnect') {
            socket.write(
              encodeMessage({ seq: 3, type: 'response', request_seq: message.seq, success: true, command: 'disconnect' }),
            );
            socket.end();
          }
        }
      });
    });

    const port = await new Promise<number>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
    );

    const events: string[] = [];
    const client = new DapClient(new SocketTransport('127.0.0.1', port));
    client.onEvent((event) => events.push(event));

    const initialize = await client.sendRequest('initialize', { clientID: 'znxstudio-test' });
    expect(initialize.success).toBeTruthy();
    expect((initialize.body as { supportsConfigurationDoneRequest?: boolean }).supportsConfigurationDoneRequest).toBeTruthy();

    await new Promise<void>((resolve) => setTimeout(resolve, 50)); // let the event settle
    expect(events).toContain('initialized');

    client.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
