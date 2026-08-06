/**
 * Presence (Phase 16C) — where everyone else is, and following them.
 *
 * A remote cursor is two offsets into a document that keeps changing underneath
 * it. When an operation lands, every remote selection must be carried through it
 * with `transformPosition`, or the carets drift and point at the wrong code.
 *
 * The anchor and the head are transformed with the SAME rule, so a selection
 * never inverts, and a zero-width caret stays zero-width.
 */

import { transformPosition, type Op } from './ot';

export interface Presence {
  /** The participant this cursor belongs to. */
  author: string;
  file: string;
  /** Where the selection started (may be after the head when selecting backwards). */
  anchor: number;
  /** Where the caret is. */
  head: number;
}

export interface PresenceView extends Presence {
  color: string;
  name: string;
  /** True when the selection covers no characters — a bare caret. */
  isCaret: boolean;
}

/**
 * Carry a remote cursor through an operation. `ownAuthor` is the author of the
 * operation: their own insert pushes their caret right, while a bystander's
 * caret sitting exactly at that point stays where it is rather than being
 * dragged along by someone else's typing.
 */
export function transformPresence(presence: Presence, ops: Op[], opAuthor: string): Presence {
  const insertBefore = presence.author !== opAuthor;
  return {
    ...presence,
    anchor: transformPosition(presence.anchor, ops, insertBefore),
    head: transformPosition(presence.head, ops, insertBefore),
  };
}

/** Carry every cursor in a file through one operation. Cursors elsewhere are untouched. */
export function transformAll(presences: Presence[], file: string, ops: Op[], opAuthor: string): Presence[] {
  return presences.map((presence) => (presence.file === file ? transformPresence(presence, ops, opAuthor) : presence));
}

/** The store of everyone else's cursors. One per author, newest wins. */
export class PresenceTracker {
  private readonly byAuthor = new Map<string, Presence>();

  update(presence: Presence): void {
    this.byAuthor.set(presence.author, presence);
  }

  remove(author: string): void {
    this.byAuthor.delete(author);
  }

  clear(): void {
    this.byAuthor.clear();
  }

  all(): Presence[] {
    return [...this.byAuthor.values()];
  }

  /** Everyone whose caret is in `file`, excluding `self`. */
  inFile(file: string, self?: string): Presence[] {
    return this.all().filter((presence) => presence.file === file && presence.author !== self);
  }

  of(author: string): Presence | undefined {
    return this.byAuthor.get(author);
  }

  /** Apply an operation to every tracked cursor. */
  applyOperation(file: string, ops: Op[], opAuthor: string): void {
    for (const presence of transformAll(this.all(), file, ops, opAuthor)) this.byAuthor.set(presence.author, presence);
  }
}

/** Normalised bounds of a selection, low offset first. */
export function selectionBounds(presence: Presence): { start: number; end: number } {
  return presence.anchor <= presence.head
    ? { start: presence.anchor, end: presence.head }
    : { start: presence.head, end: presence.anchor };
}

export function isCaret(presence: Presence): boolean {
  return presence.anchor === presence.head;
}

/* ------------------------------------------------------------- following */

export interface FollowState {
  /** The participant being followed, or null. */
  following: string | null;
}

export const NOT_FOLLOWING: FollowState = { following: null };

/** Following yourself is meaningless; following nobody is the way to stop. */
export function follow(state: FollowState, author: string, self: string): FollowState {
  if (author === self) return state;
  return { following: author };
}

export function unfollow(): FollowState {
  return NOT_FOLLOWING;
}

/**
 * Where a follower should be looking. Null when not following, or when the
 * followed participant has not told us where they are yet.
 */
export function followTarget(state: FollowState, tracker: PresenceTracker): Presence | null {
  if (!state.following) return null;
  return tracker.of(state.following) ?? null;
}

/**
 * A person who edits while following has taken control back — the view would
 * fight them otherwise. This is what an editor should call on a local edit.
 */
export function breakFollowOnEdit(state: FollowState): FollowState {
  return state.following ? NOT_FOLLOWING : state;
}
