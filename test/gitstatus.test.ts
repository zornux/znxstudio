import { describe, expect, test } from './harness';
import { groupStatus, isClean, parseStatus, statusLetter } from '../src/renderer/scm/gitStatus';

describe('parseStatus', () => {
  test('classifies staged, unstaged, untracked, and conflicts', () => {
    const out = parseStatus([
      'M  staged.zx', //   staged modified (index M)
      ' M worktree.zx', //  unstaged modified (worktree M)
      'A  added.zx', //     staged add
      'MM both.zx', //      staged + unstaged
      '?? new.txt', //      untracked
      'UU merge.zx', //     conflict
      'D  gone.zx', //      staged delete
    ].join('\n'));
    expect(out).toHaveLength(7);
    const byPath = Object.fromEntries(out.map((e) => [e.path, e]));
    expect(byPath['staged.zx'].staged).toBe(true);
    expect(byPath['staged.zx'].unstaged).toBe(false);
    expect(byPath['worktree.zx'].staged).toBe(false);
    expect(byPath['worktree.zx'].unstaged).toBe(true);
    expect(byPath['both.zx'].staged).toBe(true);
    expect(byPath['both.zx'].unstaged).toBe(true);
    expect(byPath['new.txt'].type).toBe('untracked');
    expect(byPath['merge.zx'].conflicted).toBe(true);
    expect(byPath['merge.zx'].type).toBe('conflicted');
    expect(byPath['gone.zx'].type).toBe('deleted');
  });

  test('parses a rename into path + origPath', () => {
    const [entry] = parseStatus('R  old.zx -> new.zx');
    expect(entry.type).toBe('renamed');
    expect(entry.origPath).toBe('old.zx');
    expect(entry.path).toBe('new.zx');
  });

  test('unquotes paths with special characters', () => {
    const [entry] = parseStatus('?? "with space.zx"');
    expect(entry.path).toBe('with space.zx');
  });

  test('ignores blank lines and empty output', () => {
    expect(parseStatus('')).toHaveLength(0);
    expect(isClean(parseStatus('\n\n'))).toBe(true);
  });
});

describe('groupStatus', () => {
  test('splits into conflicts / staged / changes (a file can be in two)', () => {
    const groups = groupStatus(parseStatus(['MM both.zx', '?? new.txt', 'UU c.zx'].join('\n')));
    expect(groups.staged.map((e) => e.path)).toEqual(['both.zx']);
    expect(groups.changes.map((e) => e.path)).toEqual(['both.zx', 'new.txt']);
    expect(groups.conflicts.map((e) => e.path)).toEqual(['c.zx']);
  });
});

describe('statusLetter', () => {
  test('maps types to badges', () => {
    const [m, u, c] = parseStatus(['M  a.zx', '?? b.txt', 'UU c.zx'].join('\n'));
    expect(statusLetter(m)).toBe('M');
    expect(statusLetter(u)).toBe('U');
    expect(statusLetter(c)).toBe('!');
  });
});
