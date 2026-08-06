/**
 * The collaborative document (Phase 16B): the client sync engine and the server
 * that orders operations.
 *
 * The server is the single source of truth for ORDER. A client may only ever
 * have one operation in flight; anything typed while waiting is buffered into a
 * single pending operation. That gives the classic three states:
 *
 *   synchronized          — nothing in flight, nothing buffered
 *   awaiting confirmation — one operation in flight
 *   awaiting with buffer  — one in flight, more typed since
 *
 * Every state transition preserves the invariant that the client's document
 * equals the server's document once the in-flight and buffered operations have
 * been acknowledged. `transform` (ot.ts) is what makes that true.
 */

import { apply, compose, identity, transform, type Op } from './ot';

/** One operation as it travels over the wire. */
export interface OperationMessage {
  /** The server revision this operation was written against. */
  revision: number;
  ops: Op[];
  /** Who wrote it. The server never transforms an author's own operation back to them. */
  author: string;
}

/**
 * The server's view: an authoritative document and the ordered history of
 * operations applied to it.
 */
export class CollabServer {
  private readonly history: OperationMessage[] = [];

  constructor(private text: string) {}

  get document(): string {
    return this.text;
  }

  get revision(): number {
    return this.history.length;
  }

  /**
   * Accept an operation written against `message.revision`, transform it past
   * everything that landed since, apply it, and return the canonical form every
   * client will receive.
   */
  receive(message: OperationMessage): OperationMessage {
    if (message.revision < 0 || message.revision > this.revision) {
      throw new Error(`revision ${message.revision} is not in [0, ${this.revision}]`);
    }
    let ops = message.ops;
    for (const concurrent of this.history.slice(message.revision)) {
      // The INCOMING operation takes insert priority over the history it did not
      // see. This must match `CollabClient.applyRemote`, which gives the same
      // operation priority while it is still in flight — the two sides are
      // transforming the same operation, and they have to agree on which side of
      // a tie it lands. Reverse either one and concurrent inserts diverge.
      [ops] = transform(ops, concurrent.ops);
    }
    const canonical: OperationMessage = { revision: this.revision, ops, author: message.author };
    this.text = apply(this.text, ops);
    this.history.push(canonical);
    return canonical;
  }

  /** Everything a client at `revision` has not seen yet. */
  since(revision: number): OperationMessage[] {
    return this.history.slice(revision);
  }
}

export type ClientState = 'synchronized' | 'awaiting-confirmation' | 'awaiting-with-buffer';

/** What the client wants the transport to do after a call. */
export interface ClientEffect {
  /** Send this operation to the server, or nothing when none may go now. */
  send?: OperationMessage;
  /** Apply this operation to the local editor (a remote edit, transformed). */
  applyLocally?: Op[];
}

/**
 * One participant's document. It never talks to a socket itself: every method
 * returns the effect the caller should carry out, which keeps the whole engine
 * pure and testable without a network.
 */
export class CollabClient {
  private outstanding: Op[] | null = null;
  private buffer: Op[] | null = null;

  constructor(
    private text: string,
    private rev: number,
    private readonly author: string,
  ) {}

  get document(): string {
    return this.text;
  }
  get revision(): number {
    return this.rev;
  }

  get state(): ClientState {
    if (!this.outstanding) return 'synchronized';
    return this.buffer ? 'awaiting-with-buffer' : 'awaiting-confirmation';
  }

  /** The user typed. Apply locally, and send now only if nothing is in flight. */
  applyLocal(ops: Op[]): ClientEffect {
    this.text = apply(this.text, ops);
    if (!this.outstanding) {
      this.outstanding = ops;
      return { send: { revision: this.rev, ops, author: this.author } };
    }
    // Already waiting: fold this edit into the single buffered operation.
    this.buffer = this.buffer ? compose(this.buffer, ops) : ops;
    return {};
  }

  /** The server acknowledged our in-flight operation. Send the buffer, if any. */
  acknowledge(): ClientEffect {
    if (!this.outstanding) throw new Error('acknowledged an operation that was never sent');
    this.rev += 1;
    this.outstanding = this.buffer;
    this.buffer = null;
    if (!this.outstanding) return {};
    return { send: { revision: this.rev, ops: this.outstanding, author: this.author } };
  }

  /**
   * A remote operation arrived. Transform it past whatever we have in flight and
   * buffered, apply the result locally, and rewrite our pending operations so
   * they still make sense against the new document.
   */
  applyRemote(message: OperationMessage): ClientEffect {
    let incoming = message.ops;

    if (this.outstanding) {
      // Our operation went to the server first, so it keeps insert priority.
      const [outstandingPrime, incomingPrime] = transform(this.outstanding, incoming);
      this.outstanding = outstandingPrime;
      incoming = incomingPrime;

      if (this.buffer) {
        const [bufferPrime, incomingPrime2] = transform(this.buffer, incoming);
        this.buffer = bufferPrime;
        incoming = incomingPrime2;
      }
    }

    this.text = apply(this.text, incoming);
    this.rev += 1;
    return { applyLocally: incoming };
  }

  /** An operation that leaves the document unchanged — useful as a starting point. */
  noop(): Op[] {
    return identity(this.text.length);
  }
}
