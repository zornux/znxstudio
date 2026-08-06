import {
  ServiceKeys,
  type CollabService,
  type CollabState,
  type EditorService,
  type StatusService,
  type WorkspaceService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import {
  addParticipant,
  canEdit,
  decodeInvite,
  encodeInvite,
  exposureSummary,
  generateToken,
  isLoopback,
  removeParticipant,
  updateParticipant,
  type Participant,
  type SessionInfo,
} from './session';
import { buildManifest, diffManifest, diffSummary, hashContent, isInSync, type WorkspaceManifest } from './manifest';

/** Frames the two ends of a session exchange. */
export type CollabFrame =
  | { type: 'welcome'; peerId: string }
  | { type: 'denied'; reason: string }
  | { type: 'manifest'; manifest: WorkspaceManifest }
  | { type: 'roster'; participants: Participant[] }
  | { type: 'operation'; file: string; revision: number; ops: unknown; author: string }
  | { type: 'ack'; file: string }
  | { type: 'presence'; author: string; file: string; anchor: number; head: number }
  | { type: 'follow'; author: string; file: string };

/**
 * Collaboration hub (Phase 16A).
 *
 * HONEST SCOPE, stated once and repeated in the UI: there is no ZnxStudio cloud.
 * The host's own IDE binds a TCP port; guests connect straight to it. Traffic is
 * newline-delimited JSON and is NOT encrypted, so the default binding is
 * loopback and exposing a session on the LAN is an explicit, labelled choice.
 */
export class CollabModule implements IModule, CollabService {
  readonly id = 'znxstudio.collab';
  readonly displayName = 'Collaboration';

  private moduleContext!: ModuleContext;
  private workspace: WorkspaceService | undefined;
  private editor: EditorService | undefined;
  private statusBar: StatusService | undefined;
  private view!: HTMLElement;
  private collabSession: SessionInfo | null = null;
  private role: 'host' | 'guest' | null = null;
  private selfId = 'me';
  private manifest: WorkspaceManifest | null = null;
  private syncNote = '';
  private readonly changeEmitter = new Emitter<void>();
  private readonly frameEmitter = new Emitter<{ peerId: string; frame: CollabFrame }>();
  readonly onDidChange = this.changeEmitter.event;
  readonly onDidReceiveFrame = this.frameEmitter.event;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    this.statusBar = context.services.tryGet<StatusService>(ServiceKeys.Status);
    context.services.register(ServiceKeys.Collab, this);

    this.view = document.createElement('div');
    this.view.className = 'znxstudio-collab';
    context.layout.addActivityItem({ id: 'collab', label: 'Collaboration', icon: '👥', onSelect: () => this.reveal() });
    context.commands.register(CommandIds.CollabHost, () => void this.hostSession(), 'Collaboration: Host Session');
    context.commands.register(CommandIds.CollabJoin, () => void this.joinSession(), 'Collaboration: Join Session');
    context.commands.register(CommandIds.CollabLeave, () => void this.leave(), 'Collaboration: Leave Session');
    context.commands.register(CommandIds.CollabShow, () => this.reveal(), 'Collaboration: Show');

    window.znxstudio.collab.onMessage((message) => this.receive(message.peerId, message.payload as CollabFrame));
    window.znxstudio.collab.onPeerJoined((event) => this.peerJoined(event.peerId, event.name));
    window.znxstudio.collab.onPeerLeft((event) => this.peerLeft(event.peerId));
    window.znxstudio.collab.onClosed((event) => this.closed(event.reason));

    this.render();
    void selfTestCoordinator.run('collab', () => this.maybeSelfTest());
  }

  /* ----- CollabService ----- */
  session(): SessionInfo | null {
    return this.collabSession;
  }
  state(): CollabState {
    if (!this.collabSession) return 'idle';
    return this.role === 'host' ? 'hosting' : 'joined';
  }
  participantId(): string {
    return this.selfId;
  }
  canWrite(): boolean {
    return this.collabSession ? canEdit(this.collabSession, this.selfId) : true;
  }
  async send(frame: CollabFrame): Promise<void> {
    if (!this.collabSession) return;
    await window.znxstudio.collab.send(frame);
  }

  /* ----- session lifecycle ----- */
  private async hostSession(): Promise<void> {
    const root = this.workspace?.currentFolder();
    if (!root) {
      this.moduleContext.layout.showToast('Open a folder to share.', 'info');
      return;
    }
    if (this.collabSession) {
      this.moduleContext.layout.showToast('A session is already running.', 'info');
      return;
    }

    const lan = window.confirm(
      'Expose this session on the local network?\n\n' +
        'OK — bind 0.0.0.0, reachable by anyone who can route to this machine and holds the token. Traffic is NOT encrypted.\n' +
        'Cancel — bind loopback only (recommended).',
    );
    const token = generateToken();
    const result = await window.znxstudio.collab.host({ token, host: lan ? '0.0.0.0' : '127.0.0.1', port: 0 });
    if (!result.ok || result.port === undefined) {
      this.moduleContext.layout.showToast(`Could not host: ${result.error ?? 'unknown error'}`, 'error');
      return;
    }

    this.role = 'host';
    this.selfId = 'host';
    this.collabSession = {
      sessionId: token.slice(0, 8),
      host: result.host ?? '127.0.0.1',
      port: result.port,
      root,
      token,
      participants: [],
      loopbackOnly: result.loopbackOnly ?? true,
    };
    this.collabSession = addParticipant(this.collabSession, { id: 'host', name: 'You (host)', role: 'host', readOnly: false });
    this.manifest = await this.readManifest(root);
    this.update();
    this.moduleContext.layout.showToast(`Hosting on ${result.host}:${result.port}.`, 'info');
  }

  private async joinSession(): Promise<void> {
    if (this.collabSession) {
      this.moduleContext.layout.showToast('Already in a session.', 'info');
      return;
    }
    const text = window.prompt('Paste the invite link:', 'znxstudio://join?host=127.0.0.1&port=0&token=');
    if (!text) return;
    const invite = decodeInvite(text);
    if (!invite) {
      this.moduleContext.layout.showToast('That is not a valid ZnxStudio invite.', 'error');
      return;
    }
    if (!isLoopback(invite.host)) {
      const proceed = window.confirm(
        `This invite points at ${invite.host}, not this machine.\n\nThe connection is NOT encrypted. Continue only on a network you trust.`,
      );
      if (!proceed) return;
    }

    const name = window.prompt('Your name in the session:', 'Guest') ?? 'Guest';
    const result = await window.znxstudio.collab.join({ ...invite, name });
    if (!result.ok) {
      this.moduleContext.layout.showToast(`Could not join: ${result.error ?? 'unknown error'}`, 'error');
      return;
    }

    this.role = 'guest';
    this.selfId = 'guest';
    this.collabSession = {
      sessionId: invite.token.slice(0, 8),
      host: invite.host,
      port: invite.port,
      root: this.workspace?.currentFolder() ?? '',
      token: invite.token,
      participants: [],
      loopbackOnly: isLoopback(invite.host),
    };
    this.collabSession = addParticipant(this.collabSession, { id: 'guest', name, role: 'guest', readOnly: false });
    this.update();
  }

  private async leave(): Promise<void> {
    if (!this.collabSession) return;
    await window.znxstudio.collab.leave();
    this.collabSession = null;
    this.role = null;
    this.manifest = null;
    this.syncNote = '';
    this.update();
    this.moduleContext.layout.showToast('Left the session.', 'info');
  }

  /* ----- wire ----- */
  private peerJoined(peerId: string, name: string): void {
    if (!this.collabSession) return;
    this.collabSession = addParticipant(this.collabSession, { id: peerId, name, role: 'guest', readOnly: false });
    // A guest needs to know what is shared before it can sync anything.
    if (this.manifest) void window.znxstudio.collab.sendTo(peerId, { type: 'manifest', manifest: this.manifest });
    void window.znxstudio.collab.send({ type: 'roster', participants: this.collabSession.participants });
    this.update();
  }

  private peerLeft(peerId: string): void {
    if (!this.collabSession) return;
    this.collabSession = removeParticipant(this.collabSession, peerId);
    this.update();
  }

  private closed(reason: string): void {
    if (!this.collabSession) return;
    this.moduleContext.layout.showToast(`Session ended: ${reason}`, 'info');
    this.collabSession = null;
    this.role = null;
    this.update();
  }

  private receive(peerId: string, frame: CollabFrame): void {
    if (!frame || typeof frame !== 'object') return;
    if (frame.type === 'manifest') {
      void this.compareManifest(frame.manifest);
      return;
    }
    if (frame.type === 'roster' && this.collabSession) {
      for (const participant of frame.participants) {
        if (participant.id === this.selfId) continue;
        this.collabSession = this.collabSession.participants.some((p) => p.id === participant.id)
          ? updateParticipant(this.collabSession, participant.id, participant)
          : addParticipant(this.collabSession, participant);
      }
      this.update();
      return;
    }
    // Everything else belongs to 16B/16C; hand it on untouched.
    this.frameEmitter.fire({ peerId, frame });
  }

  /* ----- workspace manifest ----- */
  private async readManifest(root: string): Promise<WorkspaceManifest | null> {
    try {
      const paths = (await window.znxstudio.search.files(root)).slice(0, 500);
      const files: { path: string; content: string }[] = [];
      for (const path of paths) {
        try {
          files.push({ path, content: await window.znxstudio.fs.readFile(path) });
        } catch {
          // A file we cannot read is a file we cannot share; skip it rather than guess.
        }
      }
      return buildManifest(root, files);
    } catch {
      return null;
    }
  }

  /** A guest compares the host's manifest against its own copy and says how far apart they are. */
  private async compareManifest(theirs: WorkspaceManifest): Promise<void> {
    const root = this.workspace?.currentFolder();
    const mine = root ? await this.readManifest(root) : null;
    if (!mine) {
      this.syncNote = `Host shares ${theirs.entries.length} file(s). Open a folder to compare.`;
    } else {
      const diff = diffManifest(mine, theirs);
      this.syncNote = isInSync(diff) ? 'In sync with the host.' : `Out of sync — ${diffSummary(diff)}.`;
    }
    this.update();
  }

  /* ----- UI ----- */
  private update(): void {
    this.render();
    this.updateStatusBar();
    this.changeEmitter.fire();
  }

  private reveal(): void {
    this.render();
    this.moduleContext.layout.setSideBar('Collaboration', this.view);
    this.moduleContext.layout.focusSideBar();
  }

  private updateStatusBar(): void {
    if (!this.statusBar) return;
    if (!this.collabSession) {
      this.statusBar.removeItem('editor.collab');
      return;
    }
    this.statusBar.setItem('editor.collab', {
      text: `👥 ${this.collabSession.participants.length}`,
      tooltip: exposureSummary(this.collabSession),
      command: CommandIds.CollabShow,
      side: 'right',
      priority: 26,
    });
  }

  private render(): void {
    if (!this.view) return;
    this.view.replaceChildren();

    const header = document.createElement('div');
    header.className = 'znxstudio-collab-header';
    header.textContent = '👥 Collaboration';
    this.view.appendChild(header);

    if (!this.collabSession) {
      this.view.appendChild(
        note(
          'No session. ZnxStudio has no cloud service: hosting binds a TCP port on THIS machine and guests connect directly to it.',
          'znxstudio-collab-note',
        ),
      );
      this.view.appendChild(button('🟢 Host session', () => void this.hostSession()));
      this.view.appendChild(button('🔗 Join session', () => void this.joinSession()));
      return;
    }

    const session = this.collabSession;
    this.view.appendChild(note(exposureSummary(session), session.loopbackOnly ? 'znxstudio-collab-note' : 'znxstudio-collab-warn'));
    this.view.appendChild(note('Traffic is not encrypted. Share the invite only with people you trust.', 'znxstudio-collab-warn'));

    if (this.role === 'host') {
      const invite = encodeInvite({ host: session.host, port: session.port, token: session.token });
      const link = document.createElement('input');
      link.className = 'znxstudio-input znxstudio-collab-invite';
      link.readOnly = true;
      link.value = invite;
      link.addEventListener('focus', () => link.select());
      this.view.appendChild(link);
      this.view.appendChild(
        button('📋 Copy invite', () => {
          void navigator.clipboard.writeText(invite);
          this.moduleContext.layout.showToast('Invite copied. It grants write access.', 'info');
        }),
      );
      if (this.manifest) this.view.appendChild(note(`Sharing ${this.manifest.entries.length} file(s) from ${session.root}.`, 'znxstudio-collab-note'));
    }

    if (this.syncNote) this.view.appendChild(note(this.syncNote, 'znxstudio-collab-note'));

    const roster = document.createElement('div');
    roster.className = 'znxstudio-collab-roster';
    for (const participant of session.participants) {
      const row = document.createElement('div');
      row.className = 'znxstudio-collab-participant';
      const dot = document.createElement('span');
      dot.className = 'znxstudio-collab-dot';
      dot.style.background = participant.color;
      const label = document.createElement('span');
      label.textContent = `${participant.name}${participant.role === 'host' ? ' · host' : ''}${participant.readOnly ? ' · read-only' : ''}`;
      row.append(dot, label);
      if (participant.activeFile) {
        const where = document.createElement('span');
        where.className = 'znxstudio-collab-where';
        where.textContent = participant.activeFile.split(/[\\/]/).pop() ?? '';
        row.appendChild(where);
      }
      roster.appendChild(row);
    }
    this.view.appendChild(roster);
    this.view.appendChild(button('⏹ Leave session', () => void this.leave()));
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

    try {
      // A REAL loopback session: host a port, then connect to it from this same
      // process and exchange a frame over the real socket.
      const token = generateToken();
      const hosted = await window.znxstudio.collab.host({ token, host: '127.0.0.1', port: 0 });
      log(`collab REAL host: ok=${hosted.ok} ${hosted.host}:${hosted.port} loopbackOnly=${hosted.loopbackOnly}`);
      if (!hosted.ok || hosted.port === undefined) return;

      const invite = encodeInvite({ host: '127.0.0.1', port: hosted.port, token });
      const decoded = decodeInvite(invite);
      log(`collab invite round-trip: port=${decoded?.port} tokenMatches=${decoded?.token === token}`);

      const received = new Promise<string>((resolve) => {
        const off = window.znxstudio.collab.onMessage((message) => {
          const frame = message.payload as CollabFrame;
          if (frame.type === 'roster') {
            off();
            resolve(`roster with ${frame.participants.length} participant(s) from ${message.peerId}`);
          }
        });
        setTimeout(() => {
          off();
          resolve('no frame within 3s');
        }, 3000);
      });

      const joined = await window.znxstudio.collab.join({ host: '127.0.0.1', port: hosted.port, token, name: 'SelfTest' });
      log(`collab REAL join (real TCP handshake): ok=${joined.ok}${joined.error ? ` error=${joined.error}` : ''}`);

      await window.znxstudio.collab.send({ type: 'roster', participants: [] });
      log(`collab REAL frame over the wire: ${await received}`);

      const denied = await window.znxstudio.collab.join({ host: '127.0.0.1', port: hosted.port, token: 'wrong', name: 'Intruder' });
      log(`collab REAL wrong token: ok=${denied.ok} (expect ok=false — already connected or denied)`);

      await window.znxstudio.collab.leave();
      log('collab REAL: session torn down');

      const manifest = buildManifest('C:/ws', [
        { path: 'C:/ws/a.zx', content: 'show 1' },
        { path: 'C:/ws/sub/b.zx', content: 'show 2' },
      ]);
      const theirs = buildManifest('D:/other', [
        { path: 'D:/other/a.zx', content: 'show 1' },
        { path: 'D:/other/sub/b.zx', content: 'show CHANGED' },
        { path: 'D:/other/c.zx', content: 'new' },
      ]);
      const diff = diffManifest(manifest, theirs);
      log(
        `collab manifest: hash("show 1")=${hashContent('show 1')} added=[${diff.added}] changed=[${diff.changed}] removed=[${diff.removed}] → ${diffSummary(diff)}`,
      );
    } catch (error) {
      log(`collab REAL failed: ${(error as Error).message}`);
    }
  }
}

function note(text: string, className: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}

function button(label: string, onClick: () => void): HTMLElement {
  const element = document.createElement('button');
  element.className = 'znxstudio-btn-small znxstudio-collab-action';
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}
