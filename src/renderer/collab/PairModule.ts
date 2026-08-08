import { ServiceKeys, type CollabService, type EditorService, type QuickPickService, type StatusService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import type { CollabFrame } from './CollabModule';
import type { Op } from './ot';
import {
  NOT_FOLLOWING,
  PresenceTracker,
  breakFollowOnEdit,
  follow,
  followTarget,
  isCaret,
  selectionBounds,
  unfollow,
  type FollowState,
} from './presence';

const DECORATION_OWNER = 'collab.presence';

/**
 * Pair programming (Phase 16C). Shows where everyone else's caret is, carries
 * those carets through every operation so they never drift, and lets one person
 * follow another's view.
 *
 * Following breaks the moment the follower edits — a view that fights the person
 * driving it is worse than no follow at all.
 */
export class PairModule implements IModule {
  readonly id = 'znxstudio.collab.pair';
  readonly displayName = 'Pair Programming';

  private moduleContext!: ModuleContext;
  private collab: CollabService | undefined;
  private editor: EditorService | undefined;
  private statusBar: StatusService | undefined;
  private readonly tracker = new PresenceTracker();
  private followState: FollowState = NOT_FOLLOWING;
  private choosingParticipant = false;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.collab = context.services.tryGet<CollabService>(ServiceKeys.Collab);
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    this.statusBar = context.services.tryGet<StatusService>(ServiceKeys.Status);

    context.commands.register(CommandIds.CollabFollow, () => this.followSomeone(), 'Collaboration: Follow Participant');
    context.commands.register(CommandIds.CollabUnfollow, () => this.stopFollowing(), 'Collaboration: Stop Following');
    context.commands.addEnablementRule((id) => {
      if (id === CommandIds.CollabFollow) {
        const session = this.collab?.session();
        return !this.choosingParticipant && Boolean(session?.participants.some((participant) => participant.id !== this.collab?.participantId()));
      }
      if (id === CommandIds.CollabUnfollow) return this.followState.following !== null;
      return undefined;
    });

    if (this.collab) {
      context.subscriptions.push(this.collab.onDidReceiveFrame(({ frame }) => this.receive(frame)));
      context.subscriptions.push(this.collab.onDidChange(() => {
        if (this.collab?.state() === 'idle') this.reset();
        this.updateStatusBar();
        this.moduleContext.commands.notifyEnablementChanged();
      }));
    }

    // Broadcast our own caret, and surrender a follow the moment we type.
    const selectionSubscription = this.editor?.onDidChangeSelections(() => {
      const wasFollowing = this.followState.following;
      this.followState = breakFollowOnEdit(this.followState);
      if (wasFollowing !== this.followState.following) this.moduleContext.commands.notifyEnablementChanged();
      this.publishPresence();
      this.updateStatusBar();
    });
    if (selectionSubscription) context.subscriptions.push(selectionSubscription);
    const fileSubscription = this.editor?.onDidChangeActiveFile(() => {
      this.publishPresence();
      this.redraw();
    });
    if (fileSubscription) context.subscriptions.push(fileSubscription);

    void selfTestCoordinator.run('collab-pair', () => this.maybeSelfTest());
  }

  private reset(): void {
    this.tracker.clear();
    this.followState = NOT_FOLLOWING;
    this.editor?.clearDecorations(DECORATION_OWNER);
  }

  /** Tell the session where our caret is. Offsets, not line/column, so ops transform them. */
  private publishPresence(): void {
    if (!this.collab || this.collab.state() === 'idle' || !this.editor) return;
    const file = this.editor.currentFile();
    const selection = this.editor.getSelections()[0];
    const text = this.editor.activeText();
    if (!file || !selection || text === null) return;

    const anchor = offsetOf(text, selection.startLine, selection.startCharacter);
    const head = offsetOf(text, selection.endLine, selection.endCharacter);
    void this.collab.send({ type: 'presence', author: this.collab.participantId(), file, anchor, head });
  }

  private receive(frame: CollabFrame): void {
    if (frame.type === 'presence') {
      this.tracker.update({ author: frame.author, file: frame.file, anchor: frame.anchor, head: frame.head });
      this.followIfNeeded();
      this.redraw();
      return;
    }
    if (frame.type === 'operation') {
      // Every remote caret in this file must be carried through the operation.
      this.tracker.applyOperation(frame.file, frame.ops as Op[], frame.author);
      this.redraw();
      return;
    }
    if (frame.type === 'follow' && frame.author === this.collab?.participantId()) {
      void this.editor?.openFile(frame.file);
    }
  }

  private async followSomeone(): Promise<void> {
    if (this.choosingParticipant) return;
    const session = this.collab?.session();
    if (!session) {
      this.moduleContext.layout.showToast('Join a session to follow someone.', 'info');
      return;
    }
    const others = session.participants.filter((p) => p.id !== this.collab?.participantId());
    if (!others.length) {
      this.moduleContext.layout.showToast('Nobody else is here yet.', 'info');
      return;
    }
    this.choosingParticipant = true;
    this.moduleContext.commands.notifyEnablementChanged();
    try {
      const picker = this.moduleContext.services.get<QuickPickService>(ServiceKeys.QuickPick);
      const selectedId = await picker.pick(
        others.map((participant) => {
          const presence = this.tracker.of(participant.id);
          return {
            label: participant.name,
            description: presence?.file ? `Active in ${basename(presence.file)}` : 'No cursor shared yet',
            value: participant.id,
          };
        }),
        { placeholder: 'Choose a participant to follow' },
      );
      if (selectedId === undefined) return;

      const target = this.collab?.session()?.participants.find((participant) => participant.id === selectedId);
      if (!target || target.id === this.collab?.participantId()) {
        this.moduleContext.layout.showToast('That participant has left the session.', 'info');
        return;
      }
      this.followState = follow(this.followState, target.id, this.collab?.participantId() ?? 'me');
      this.followIfNeeded();
      this.updateStatusBar();
      this.moduleContext.layout.showToast(`Following ${target.name}. Type to take back control.`, 'info');
    } catch (error) {
      this.moduleContext.layout.showToast(`Could not start following: ${(error as Error).message}`, 'error');
    } finally {
      this.choosingParticipant = false;
      this.moduleContext.commands.notifyEnablementChanged();
    }
  }

  private stopFollowing(): void {
    this.followState = unfollow();
    this.updateStatusBar();
    this.moduleContext.commands.notifyEnablementChanged();
  }

  /** Jump to wherever the followed participant currently is. */
  private followIfNeeded(): void {
    const target = followTarget(this.followState, this.tracker);
    if (!target || !this.editor) return;
    if (this.editor.currentFile() !== target.file) {
      void this.editor.openFile(target.file);
      return;
    }
    const text = this.editor.activeText();
    if (text === null) return;
    const { line, character } = positionOf(text, target.head);
    this.editor.revealPosition(line, character);
  }

  /** Draw every remote caret and selection in the active file. */
  private redraw(): void {
    if (!this.editor) return;
    const file = this.editor.currentFile();
    const text = this.editor.activeText();
    if (!file || text === null) {
      this.editor.clearDecorations(DECORATION_OWNER);
      return;
    }
    const session = this.collab?.session();
    const self = this.collab?.participantId();

    this.editor.setDecorations(
      DECORATION_OWNER,
      this.tracker.inFile(file, self).map((presence) => {
        const { start, end } = selectionBounds(presence);
        const from = positionOf(text, start);
        const to = positionOf(text, end);
        const participant = session?.participants.find((p) => p.id === presence.author);
        return {
          startLine: from.line,
          startCharacter: from.character,
          endLine: to.line,
          endCharacter: to.character,
          severity: 'info' as const,
          inlineMessage: isCaret(presence) ? `▏${participant?.name ?? presence.author}` : undefined,
        };
      }),
    );
  }

  private updateStatusBar(): void {
    if (!this.statusBar) return;
    if (!this.collab || this.collab.state() === 'idle') {
      this.statusBar.removeItem('editor.pair');
      return;
    }
    const session = this.collab.session();
    const followed = this.followState.following
      ? session?.participants.find((p) => p.id === this.followState.following)?.name
      : null;
    this.statusBar.setItem('editor.pair', {
      text: followed ? `Following ${followed}` : `Pair ${this.tracker.all().length} cursor(s)`,
      tooltip: followed ? 'Type to take back control.' : 'Remote cursors, carried through every edit.',
      command: followed ? CommandIds.CollabUnfollow : CommandIds.CollabFollow,
      side: 'right',
      priority: 28,
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

    const tracker = new PresenceTracker();
    tracker.update({ author: 'ben', file: 'a.zx', anchor: 6, head: 6 });
    tracker.update({ author: 'cai', file: 'a.zx', anchor: 0, head: 3 });

    // Ana inserts 3 characters at offset 0; both remote cursors must shift right.
    tracker.applyOperation('a.zx', [{ insert: 'XYZ' }, { retain: 11 }], 'ana');
    log(
      `pair presence after remote insert of 3 at 0: ben.head=${tracker.of('ben')?.head} (was 6) ` +
        `cai=[${tracker.of('cai')?.anchor},${tracker.of('cai')?.head}] (was [0,3])`,
    );

    // A delete that spans a cursor collapses it onto the start of the range.
    tracker.applyOperation('a.zx', [{ retain: 7 }, { delete: 4 }, { retain: 3 }], 'ana');
    log(`pair presence after remote delete spanning ben: ben.head=${tracker.of('ben')?.head} (collapsed onto the deleted range's start)`);

    // A cursor in another file is not touched.
    tracker.update({ author: 'dee', file: 'b.zx', anchor: 5, head: 5 });
    tracker.applyOperation('a.zx', [{ insert: 'Q' }, { retain: 10 }], 'ana');
    log(`pair presence other file untouched: dee.head=${tracker.of('dee')?.head} (expect 5)`);

    let state = follow(NOT_FOLLOWING, 'ben', 'ana');
    log(`pair follow: following=${state.following} target.file=${followTarget(state, tracker)?.file}`);
    state = follow(state, 'ana', 'ana');
    log(`pair follow yourself is refused: still following=${state.following}`);
    state = breakFollowOnEdit(state);
    log(`pair follow breaks on a local edit: following=${state.following} (expect null)`);
  }
}

/** Character offset of a 0-based line/character position. */
function offsetOf(text: string, line: number, character: number): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i += 1) offset += lines[i].length + 1;
  return offset + character;
}

/** The 0-based line/character position of a character offset. */
function positionOf(text: string, offset: number): { line: number; character: number } {
  const before = text.slice(0, Math.max(0, offset));
  const lines = before.split('\n');
  return { line: lines.length - 1, character: lines[lines.length - 1].length };
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
