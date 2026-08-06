import { describe, expect, test } from './harness';
import {
  NOT_FOLLOWING,
  PresenceTracker,
  breakFollowOnEdit,
  follow,
  followTarget,
  isCaret,
  selectionBounds,
  transformAll,
  transformPresence,
  unfollow,
  type Presence,
} from '../src/renderer/collab/presence';

function presence(overrides: Partial<Presence> = {}): Presence {
  return { author: 'ben', file: 'a.zx', anchor: 6, head: 6, ...overrides };
}

describe('transformPresence', () => {
  test("someone else's insert before the cursor pushes it right", () => {
    const moved = transformPresence(presence(), [{ insert: 'XYZ' }, { retain: 11 }], 'ana');
    expect(moved.head).toBe(9);
    expect(moved.anchor).toBe(9);
  });

  test("someone else's insert after the cursor leaves it alone", () => {
    expect(transformPresence(presence({ head: 2, anchor: 2 }), [{ retain: 5 }, { insert: 'X' }, { retain: 6 }], 'ana').head).toBe(2);
  });

  test("someone else's insert exactly at the cursor does NOT drag it along", () => {
    expect(transformPresence(presence(), [{ retain: 6 }, { insert: 'X' }, { retain: 5 }], 'ana').head).toBe(6);
  });

  test("the author's own insert at their cursor pushes it right, as typing should", () => {
    expect(transformPresence(presence({ author: 'ana' }), [{ retain: 6 }, { insert: 'X' }, { retain: 5 }], 'ana').head).toBe(7);
  });

  test('a delete before the cursor pulls it left', () => {
    expect(transformPresence(presence(), [{ delete: 2 }, { retain: 9 }], 'ana').head).toBe(4);
  });

  test('a delete spanning the cursor collapses it onto the start of the range', () => {
    const moved = transformPresence(presence({ anchor: 6, head: 6 }), [{ retain: 4 }, { delete: 4 }, { retain: 3 }], 'ana');
    expect(moved.head).toBe(4);
  });

  test('a selection is carried through without inverting', () => {
    const moved = transformPresence(presence({ anchor: 2, head: 8 }), [{ insert: 'AB' }, { retain: 11 }], 'ana');
    expect(moved.anchor).toBe(4);
    expect(moved.head).toBe(10);
  });

  test('a backwards selection stays backwards', () => {
    const moved = transformPresence(presence({ anchor: 8, head: 2 }), [{ insert: 'AB' }, { retain: 11 }], 'ana');
    expect(moved.anchor).toBeGreaterThan(moved.head);
  });
});

describe('transformAll', () => {
  test('only cursors in the edited file move', () => {
    const moved = transformAll(
      [presence({ author: 'ben', file: 'a.zx', anchor: 1, head: 1 }), presence({ author: 'cai', file: 'b.zx', anchor: 1, head: 1 })],
      'a.zx',
      [{ insert: 'XX' }, { retain: 11 }],
      'ana',
    );
    expect(moved[0].head).toBe(3);
    expect(moved[1].head).toBe(1);
  });
});

describe('PresenceTracker', () => {
  test('keeps one cursor per author, newest wins', () => {
    const tracker = new PresenceTracker();
    tracker.update(presence({ head: 1, anchor: 1 }));
    tracker.update(presence({ head: 9, anchor: 9 }));
    expect(tracker.all()).toHaveLength(1);
    expect(tracker.of('ben')?.head).toBe(9);
  });

  test('inFile excludes other files and yourself', () => {
    const tracker = new PresenceTracker();
    tracker.update(presence({ author: 'ben', file: 'a.zx' }));
    tracker.update(presence({ author: 'me', file: 'a.zx' }));
    tracker.update(presence({ author: 'cai', file: 'b.zx' }));
    expect(tracker.inFile('a.zx', 'me').map((p) => p.author)).toEqual(['ben']);
  });

  test('applyOperation carries every cursor in the file', () => {
    const tracker = new PresenceTracker();
    tracker.update(presence({ author: 'ben', anchor: 6, head: 6 }));
    tracker.update(presence({ author: 'cai', anchor: 0, head: 3 }));
    tracker.applyOperation('a.zx', [{ insert: 'XYZ' }, { retain: 11 }], 'ana');
    expect(tracker.of('ben')?.head).toBe(9);
    expect(tracker.of('cai')?.head).toBe(6);
  });

  test('remove and clear drop cursors', () => {
    const tracker = new PresenceTracker();
    tracker.update(presence());
    tracker.remove('ben');
    expect(tracker.all()).toHaveLength(0);
    tracker.update(presence());
    tracker.clear();
    expect(tracker.all()).toHaveLength(0);
  });
});

describe('selectionBounds', () => {
  test('normalises a backwards selection', () => {
    expect(selectionBounds(presence({ anchor: 9, head: 2 }))).toEqual({ start: 2, end: 9 });
  });
  test('a caret has zero width', () => {
    expect(isCaret(presence({ anchor: 4, head: 4 }))).toBe(true);
    expect(isCaret(presence({ anchor: 4, head: 5 }))).toBe(false);
  });
});

describe('following', () => {
  test('following someone records them', () => {
    expect(follow(NOT_FOLLOWING, 'ben', 'ana').following).toBe('ben');
  });

  test('following yourself is refused', () => {
    expect(follow(NOT_FOLLOWING, 'ana', 'ana').following).toBeNull();
  });

  test('unfollow clears it', () => {
    expect(unfollow().following).toBeNull();
  });

  test('a local edit takes control back from a follow', () => {
    expect(breakFollowOnEdit({ following: 'ben' }).following).toBeNull();
  });

  test('a local edit while not following changes nothing', () => {
    const state = NOT_FOLLOWING;
    expect(breakFollowOnEdit(state)).toBe(state);
  });

  test('followTarget resolves the followed cursor, or null', () => {
    const tracker = new PresenceTracker();
    tracker.update(presence({ author: 'ben', file: 'x.zx' }));
    expect(followTarget({ following: 'ben' }, tracker)?.file).toBe('x.zx');
    expect(followTarget({ following: 'ghost' }, tracker)).toBeNull();
    expect(followTarget(NOT_FOLLOWING, tracker)).toBeNull();
  });
});
