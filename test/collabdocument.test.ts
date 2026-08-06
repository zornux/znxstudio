import { describe, expect, test } from './harness';
import { CollabClient, CollabServer } from '../src/renderer/collab/document';
import { opsToEdits, replaceRange } from '../src/renderer/collab/ot';

describe('CollabServer', () => {
  test('applies an operation and advances the revision', () => {
    const server = new CollabServer('abc');
    const canonical = server.receive({ revision: 0, ops: [{ retain: 3 }, { insert: 'd' }], author: 'ana' });
    expect(server.document).toBe('abcd');
    expect(server.revision).toBe(1);
    expect(canonical.revision).toBe(0);
  });

  test('transforms a stale operation past everything committed since', () => {
    const server = new CollabServer('abc');
    server.receive({ revision: 0, ops: [{ insert: 'X' }, { retain: 3 }], author: 'ana' });
    // Ben still thinks the document is 'abc' and appends 'd' at the end.
    server.receive({ revision: 0, ops: [{ retain: 3 }, { insert: 'd' }], author: 'ben' });
    expect(server.document).toBe('Xabcd');
  });

  test('an operation against a future revision is rejected', () => {
    const server = new CollabServer('abc');
    let threw = false;
    try {
      server.receive({ revision: 5, ops: [{ retain: 3 }], author: 'ana' });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test('since() returns exactly what a client has not seen', () => {
    const server = new CollabServer('abc');
    server.receive({ revision: 0, ops: [{ retain: 3 }, { insert: 'd' }], author: 'ana' });
    server.receive({ revision: 1, ops: [{ retain: 4 }, { insert: 'e' }], author: 'ana' });
    expect(server.since(1)).toHaveLength(1);
    expect(server.since(0)).toHaveLength(2);
    expect(server.since(2)).toHaveLength(0);
  });
});

describe('CollabClient states', () => {
  test('a fresh client is synchronized', () => {
    expect(new CollabClient('abc', 0, 'me').state).toBe('synchronized');
  });

  test('the first local edit goes out and leaves the client awaiting confirmation', () => {
    const client = new CollabClient('abc', 0, 'me');
    const effect = client.applyLocal(replaceRange(3, 3, 3, 'd'));
    expect(effect.send?.revision).toBe(0);
    expect(effect.send?.author).toBe('me');
    expect(client.state).toBe('awaiting-confirmation');
    expect(client.document).toBe('abcd');
  });

  test('typing while an operation is in flight buffers instead of sending', () => {
    const client = new CollabClient('abc', 0, 'me');
    client.applyLocal(replaceRange(3, 3, 3, 'd'));
    const effect = client.applyLocal(replaceRange(4, 4, 4, 'e'));
    expect(effect.send).toBe(undefined);
    expect(client.state).toBe('awaiting-with-buffer');
    expect(client.document).toBe('abcde');
  });

  test('several buffered edits fold into one operation', () => {
    const client = new CollabClient('abc', 0, 'me');
    client.applyLocal(replaceRange(3, 3, 3, 'd'));
    client.applyLocal(replaceRange(4, 4, 4, 'e'));
    client.applyLocal(replaceRange(5, 5, 5, 'f'));
    const flushed = client.acknowledge();
    expect(client.state).toBe('awaiting-confirmation');
    // One send carries 'ef', not two.
    expect(flushed.send?.ops).toEqual([{ retain: 4 }, { insert: 'ef' }]);
  });

  test('acknowledging returns to synchronized when nothing was buffered', () => {
    const client = new CollabClient('abc', 0, 'me');
    client.applyLocal(replaceRange(3, 3, 3, 'd'));
    expect(client.acknowledge().send).toBe(undefined);
    expect(client.state).toBe('synchronized');
    expect(client.revision).toBe(1);
  });

  test('acknowledging nothing is an error, never a silent no-op', () => {
    let threw = false;
    try {
      new CollabClient('abc', 0, 'me').acknowledge();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test('a remote operation advances the revision and the document', () => {
    const client = new CollabClient('abc', 0, 'me');
    const effect = client.applyRemote({ revision: 0, ops: [{ insert: 'X' }, { retain: 3 }], author: 'other' });
    expect(client.document).toBe('Xabc');
    expect(client.revision).toBe(1);
    expect(effect.applyLocally).toEqual([{ insert: 'X' }, { retain: 3 }]);
  });

  test('a remote operation is transformed past what we still have in flight', () => {
    const client = new CollabClient('abc', 0, 'me');
    client.applyLocal(replaceRange(3, 0, 0, 'L')); // "Labc", in flight
    const effect = client.applyRemote({ revision: 0, ops: [{ retain: 3 }, { insert: 'R' }], author: 'other' });
    // The remote insert must land after our own, at offset 4, not 3.
    expect(client.document).toBe('LabcR');
    expect(effect.applyLocally).toEqual([{ retain: 4 }, { insert: 'R' }]);
  });
});

describe('client and server converge', () => {
  test('two simultaneous edits against the same revision converge', () => {
    const start = 'hello world';
    const server = new CollabServer(start);
    const ana = new CollabClient(start, 0, 'ana');
    const ben = new CollabClient(start, 0, 'ben');

    const anaSend = ana.applyLocal(replaceRange(start.length, 5, 5, ' brave')).send!;
    const benSend = ben.applyLocal(replaceRange(start.length, 6, 11, 'there')).send!;
    expect(ana.document === ben.document).toBe(false);

    const anaCanonical = server.receive(anaSend);
    ana.acknowledge();
    ben.applyRemote(anaCanonical);

    const benCanonical = server.receive(benSend);
    ben.acknowledge();
    ana.applyRemote(benCanonical);

    expect(ana.document).toBe(server.document);
    expect(ben.document).toBe(server.document);
  });

  test('a client that keeps typing while waiting still converges', () => {
    const server = new CollabServer('abc');
    const ana = new CollabClient('abc', 0, 'ana');
    const ben = new CollabClient('abc', 0, 'ben');

    const anaFirst = ana.applyLocal(replaceRange(3, 0, 0, 'A')).send!;
    ana.applyLocal(replaceRange(4, 4, 4, 'Z')); // buffered while the first is in flight
    const benSend = ben.applyLocal(replaceRange(3, 3, 3, 'B')).send!;

    const anaCanonical = server.receive(anaFirst);
    const anaFlush = ana.acknowledge();
    ben.applyRemote(anaCanonical);

    const benCanonical = server.receive(benSend);
    ben.acknowledge();
    ana.applyRemote(benCanonical);

    const anaSecond = server.receive(anaFlush.send!);
    ana.acknowledge();
    ben.applyRemote(anaSecond);

    expect(ana.document).toBe(server.document);
    expect(ben.document).toBe(server.document);
    // Ana's buffered 'Z' is sent at revision 1, so the server transforms it past
    // Ben's operation with the INCOMING operation taking insert priority — 'Z'
    // lands before 'B' at the end of the document, and all three agree.
    expect(server.document).toBe('AabcZB');
  });

  /**
   * The convergence guarantee, exercised with generated edits: whichever order
   * the server happens to receive two clients' operations in, every participant
   * ends up with the server's document.
   */
  test('randomised two-client sessions always converge (200 rounds)', () => {
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let round = 0; round < 200; round += 1) {
      const start = 'abcdef';
      const server = new CollabServer(start);
      const ana = new CollabClient(start, 0, 'ana');
      const ben = new CollabClient(start, 0, 'ben');

      const anaAt = Math.floor(random() * (start.length + 1));
      const benAt = Math.floor(random() * (start.length + 1));
      const anaOps =
        random() < 0.5 ? replaceRange(start.length, anaAt, anaAt, 'X') : replaceRange(start.length, Math.min(anaAt, 5), Math.min(anaAt + 1, 6), '');
      const benOps =
        random() < 0.5 ? replaceRange(start.length, benAt, benAt, 'Y') : replaceRange(start.length, Math.min(benAt, 5), Math.min(benAt + 1, 6), '');

      const anaSend = ana.applyLocal(anaOps).send!;
      const benSend = ben.applyLocal(benOps).send!;

      // Coin-flip the order the server sees them in.
      if (random() < 0.5) {
        const a = server.receive(anaSend);
        ana.acknowledge();
        ben.applyRemote(a);
        const b = server.receive(benSend);
        ben.acknowledge();
        ana.applyRemote(b);
      } else {
        const b = server.receive(benSend);
        ben.acknowledge();
        ana.applyRemote(b);
        const a = server.receive(anaSend);
        ana.acknowledge();
        ben.applyRemote(a);
      }

      if (ana.document !== server.document || ben.document !== server.document) {
        throw new Error(`round ${round} diverged: server="${server.document}" ana="${ana.document}" ben="${ben.document}"`);
      }
    }
    expect(true).toBe(true);
  });
});

describe('opsToEdits', () => {
  test('a pure insert becomes one edit at its offset', () => {
    expect(opsToEdits([{ retain: 3 }, { insert: 'X' }, { retain: 2 }])).toEqual([{ startOffset: 3, endOffset: 3, text: 'X' }]);
  });

  test('a pure delete becomes one empty-text edit over its range', () => {
    expect(opsToEdits([{ retain: 1 }, { delete: 2 }, { retain: 1 }])).toEqual([{ startOffset: 1, endOffset: 3, text: '' }]);
  });

  test('an insert next to a delete becomes a single replace, as a user sees it', () => {
    expect(opsToEdits([{ retain: 2 }, { insert: 'hi' }, { delete: 3 }])).toEqual([{ startOffset: 2, endOffset: 5, text: 'hi' }]);
  });

  test('offsets refer to the document before the operation, so a batch applies atomically', () => {
    expect(opsToEdits([{ delete: 1 }, { retain: 2 }, { delete: 1 }])).toEqual([
      { startOffset: 0, endOffset: 1, text: '' },
      { startOffset: 3, endOffset: 4, text: '' },
    ]);
  });

  test('an operation that changes nothing produces no edits', () => {
    expect(opsToEdits([{ retain: 5 }])).toHaveLength(0);
  });
});
