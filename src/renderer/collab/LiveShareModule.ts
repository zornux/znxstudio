import { ServiceKeys, type CollabService, type EditorService, type StatusService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CollabClient, CollabServer, type OperationMessage } from './document';
import { opsToEdits, replaceRange, type Op } from './ot';
import type { CollabFrame } from './CollabModule';

/**
 * Live collaboration (Phase 16B). Wires the OT engine to a session.
 *
 * The HOST owns a `CollabServer` per shared file: it decides the order of
 * operations. Every participant, host included, drives a `CollabClient` that
 * keeps at most one operation in flight and folds anything typed meanwhile into
 * a single buffered operation. `transform` reconciles the rest.
 *
 * Local echo is suppressed while a remote operation is applied, so an incoming
 * edit never bounces back out as a new local one.
 */
export class LiveShareModule implements IModule {
  readonly id = 'znxstudio.collab.liveshare';
  readonly displayName = 'Live Share';

  private moduleContext!: ModuleContext;
  private collab: CollabService | undefined;
  private editor: EditorService | undefined;
  private statusBar: StatusService | undefined;

  /** Host only: the authority for each shared file. */
  private readonly servers = new Map<string, CollabServer>();
  /** Every participant: the local view of each shared file. */
  private readonly clients = new Map<string, CollabClient>();
  /** True while a remote operation is being written into the editor. */
  private applyingRemote = false;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.collab = context.services.tryGet<CollabService>(ServiceKeys.Collab);
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    this.statusBar = context.services.tryGet<StatusService>(ServiceKeys.Status);

    this.collab?.onDidReceiveFrame(({ peerId, frame }) => this.receive(peerId, frame));
    this.collab?.onDidChange(() => {
      if (this.collab?.state() === 'idle') this.reset();
      this.updateStatusBar();
    });

    void selfTestCoordinator.run('collab-liveshare', () => this.maybeSelfTest());
  }

  private reset(): void {
    this.servers.clear();
    this.clients.clear();
  }

  /** Begin sharing a file: the host becomes its authority, everyone gets a client. */
  share(file: string, text: string): void {
    if (this.collab?.state() === 'hosting') this.servers.set(file, new CollabServer(text));
    this.clients.set(file, new CollabClient(text, 0, this.collab?.participantId() ?? 'me'));
  }

  /** The local user edited `file`: replace [start, end) with `text`. */
  localEdit(file: string, documentLength: number, start: number, end: number, text: string): void {
    if (this.applyingRemote) return;
    if (this.collab && !this.collab.canWrite()) {
      this.moduleContext.layout.showToast('You joined this session read-only.', 'info');
      return;
    }
    const client = this.clients.get(file);
    if (!client) return;

    const ops = replaceRange(documentLength, start, end, text);
    const effect = client.applyLocal(ops);
    if (effect.send) this.dispatch(file, effect.send);
  }

  /** Send an operation onward: through the host's server when hosting, else to the host. */
  private dispatch(file: string, message: OperationMessage): void {
    const server = this.servers.get(file);
    if (server) {
      // The host is its own server: commit, acknowledge ourselves, broadcast.
      const canonical = server.receive(message);
      this.clients.get(file)?.acknowledge();
      void this.collab?.send({ type: 'operation', file, revision: canonical.revision, ops: canonical.ops, author: canonical.author });
      return;
    }
    void this.collab?.send({ type: 'operation', file, revision: message.revision, ops: message.ops, author: message.author });
  }

  private receive(peerId: string, frame: CollabFrame): void {
    if (frame.type === 'ack') {
      const effect = this.clients.get(frame.file)?.acknowledge();
      if (effect?.send) this.dispatch(frame.file, effect.send);
      return;
    }
    if (frame.type !== 'operation') return;

    const message: OperationMessage = {
      revision: frame.revision,
      ops: frame.ops as Op[],
      author: frame.author,
    };

    const server = this.servers.get(frame.file);
    if (server) {
      // Host: order the guest's operation, tell it we took it, tell everyone else.
      const canonical = server.receive(message);
      this.applyRemote(frame.file, canonical);
      void this.collab?.send({ type: 'ack', file: frame.file });
      void this.collab?.send({
        type: 'operation',
        file: frame.file,
        revision: canonical.revision,
        ops: canonical.ops,
        author: canonical.author,
      });
      return;
    }

    // Guest: an operation of our own comes back as the acknowledgement.
    if (message.author === this.collab?.participantId()) {
      const effect = this.clients.get(frame.file)?.acknowledge();
      if (effect?.send) this.dispatch(frame.file, effect.send);
      return;
    }
    this.applyRemote(frame.file, message);
    void peerId;
  }

  /** Write a remote operation into the local document without echoing it back out. */
  private applyRemote(file: string, message: OperationMessage): void {
    const client = this.clients.get(file);
    if (!client) return;
    this.applyingRemote = true;
    try {
      const effect = client.applyRemote(message);
      // The operation's offsets refer to the document as the editor still holds
      // it, so the edits apply as one atomic, undoable batch.
      if (effect.applyLocally && this.editor?.currentFile() === file) {
        this.editor.applyOffsetEdits(opsToEdits(effect.applyLocally));
      }
    } finally {
      this.applyingRemote = false;
    }
    this.updateStatusBar();
  }

  /** The local text of a shared file, as the engine believes it to be. */
  documentOf(file: string): string | null {
    return this.clients.get(file)?.document ?? null;
  }

  private updateStatusBar(): void {
    if (!this.statusBar) return;
    if (!this.collab || this.collab.state() === 'idle' || !this.clients.size) {
      this.statusBar.removeItem('editor.liveshare');
      return;
    }
    const states = [...this.clients.values()].map((client) => client.state);
    const syncing = states.filter((state) => state !== 'synchronized').length;
    this.statusBar.setItem('editor.liveshare', {
      text: syncing ? `⟳ ${syncing} syncing` : `✓ ${this.clients.size} in sync`,
      tooltip: 'Live share: operations in flight are transformed against everything that landed since.',
      side: 'right',
      priority: 27,
    });
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    // Two participants edit the same document simultaneously, against the same
    // revision. Whatever order the server sees them in, both must converge.
    const start = 'hello world';
    const server = new CollabServer(start);
    const ana = new CollabClient(start, 0, 'ana');
    const ben = new CollabClient(start, 0, 'ben');

    // Ana inserts " brave" at 5; Ben, at the same instant, deletes "world".
    const anaEffect = ana.applyLocal(replaceRange(start.length, 5, 5, ' brave'));
    const benEffect = ben.applyLocal(replaceRange(start.length, 6, 11, 'there'));
    log(`liveshare local: ana="${ana.document}" ben="${ben.document}" (they have diverged)`);

    const anaCanonical = server.receive(anaEffect.send!);
    ana.acknowledge();
    ben.applyRemote(anaCanonical);

    const benCanonical = server.receive(benEffect.send!);
    ben.acknowledge();
    ana.applyRemote(benCanonical);

    log(`liveshare converged: server="${server.document}" ana="${ana.document}" ben="${ben.document}"`);
    log(`liveshare all equal: ${server.document === ana.document && ana.document === ben.document}`);

    // The three-state client: typing while an operation is in flight buffers.
    const solo = new CollabClient('abc', 0, 'solo');
    solo.applyLocal(replaceRange(3, 3, 3, 'd'));
    log(`liveshare state after first edit: ${solo.state} (expect awaiting-confirmation)`);
    solo.applyLocal(replaceRange(4, 4, 4, 'e'));
    log(`liveshare state while waiting: ${solo.state} (expect awaiting-with-buffer)`);
    const flushed = solo.acknowledge();
    log(`liveshare acknowledge flushes the buffer: sends=${Boolean(flushed.send)} state=${solo.state}`);
    solo.acknowledge();
    log(`liveshare finally: state=${solo.state} document="${solo.document}"`);
  }
}
