import { describe, expect, test } from './harness';
import { BookmarkModel } from '../src/renderer/editor/bookmarks';
import { NavHistory, isSignificantJump } from '../src/renderer/editor/navHistory';

describe('BookmarkModel', () => {
  test('toggle adds then removes a line', () => {
    const model = new BookmarkModel();
    expect(model.toggle('a', 3)).toBe(true);
    expect(model.has('a', 3)).toBe(true);
    expect(model.toggle('a', 3)).toBe(false);
    expect(model.has('a', 3)).toBe(false);
  });

  test('lines are returned ascending and count is global', () => {
    const model = new BookmarkModel();
    model.toggle('a', 9);
    model.toggle('a', 2);
    model.toggle('b', 0);
    expect(model.lines('a')).toEqual([2, 9]);
    expect(model.count()).toBe(3);
    expect(model.all()).toEqual([
      { uri: 'a', line: 2 },
      { uri: 'a', line: 9 },
      { uri: 'b', line: 0 },
    ]);
  });

  test('next/prev wrap within a file', () => {
    const model = new BookmarkModel();
    model.toggle('a', 2);
    model.toggle('a', 5);
    model.toggle('a', 9);
    expect(model.nextInFile('a', 2)).toBe(5);
    expect(model.nextInFile('a', 9)).toBe(2); // wrap
    expect(model.prevInFile('a', 5)).toBe(2);
    expect(model.prevInFile('a', 2)).toBe(9); // wrap
    expect(model.nextInFile('missing', 0)).toBeNull();
  });

  test('serialize/load round-trips', () => {
    const model = new BookmarkModel();
    model.toggle('a', 1);
    model.toggle('b', 4);
    const other = new BookmarkModel();
    other.load(model.serialize());
    expect(other.count()).toBe(2);
    expect(other.lines('a')).toEqual([1]);
    expect(other.lines('b')).toEqual([4]);
  });

  test('load ignores malformed entries', () => {
    const model = new BookmarkModel();
    model.load({ a: [0, -1, 3.5, 2] });
    expect(model.lines('a')).toEqual([0, 2]);
  });
});

describe('NavHistory', () => {
  test('records jumps and steps back and forward', () => {
    const history = new NavHistory();
    history.push({ uri: 'a', line: 0, character: 0 });
    history.push({ uri: 'a', line: 40, character: 0 });
    history.push({ uri: 'b', line: 5, character: 0 });
    expect(history.size()).toBe(3);
    expect(history.canForward()).toBe(false);
    expect(history.back()?.line).toBe(40);
    expect(history.back()?.line).toBe(0);
    expect(history.canBack()).toBe(false);
    expect(history.forward()?.line).toBe(40);
  });

  test('a push after going back truncates forward history', () => {
    const history = new NavHistory();
    history.push({ uri: 'a', line: 0, character: 0 });
    history.push({ uri: 'a', line: 50, character: 0 });
    history.back();
    history.push({ uri: 'c', line: 99, character: 0 });
    expect(history.canForward()).toBe(false);
    expect(history.current()?.line).toBe(99);
  });

  test('same-line push refines the column without growing', () => {
    const history = new NavHistory();
    history.push({ uri: 'a', line: 10, character: 0 });
    history.push({ uri: 'a', line: 10, character: 6 });
    expect(history.size()).toBe(1);
    expect(history.current()?.character).toBe(6);
  });

  test('respects the size cap', () => {
    const history = new NavHistory(3);
    for (let i = 0; i < 5; i += 1) history.push({ uri: 'a', line: i * 20, character: 0 });
    expect(history.size()).toBe(3);
    expect(history.current()?.line).toBe(80);
  });

  test('discardCurrent removes an unreachable target and retains a neighbor', () => {
    const history = new NavHistory();
    history.push({ uri: 'a', line: 0, character: 0 });
    history.push({ uri: 'missing', line: 20, character: 0 });
    history.push({ uri: 'b', line: 40, character: 0 });
    history.back();
    expect(history.discardCurrent()?.uri).toBe('b');
    expect(history.size()).toBe(2);
    expect(history.back()?.uri).toBe('a');
  });
});

describe('isSignificantJump', () => {
  test('first location is always significant', () => {
    expect(isSignificantJump(null, { uri: 'a', line: 3, character: 0 })).toBe(true);
  });

  test('a different file is significant', () => {
    expect(isSignificantJump({ uri: 'a', line: 0, character: 0 }, { uri: 'b', line: 0, character: 0 })).toBe(true);
  });

  test('small same-file moves are not recorded, large ones are', () => {
    const from = { uri: 'a', line: 10, character: 0 };
    expect(isSignificantJump(from, { uri: 'a', line: 13, character: 0 })).toBe(false);
    expect(isSignificantJump(from, { uri: 'a', line: 30, character: 0 })).toBe(true);
  });
});
