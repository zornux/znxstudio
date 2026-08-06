import { describe, expect, test } from './harness';
import { diffStat, LOG_FORMAT, parseLog, parseNumstat } from '../src/renderer/scm/history';

const FIELD = '\x1f';

describe('parseLog', () => {
  test('parses field-separated commit records', () => {
    const output = [
      ['abc123def', 'abc123d', 'Kim', '2026-07-09', 'Add feature'].join(FIELD),
      ['def456abc', 'def456a', 'Sam', '2026-07-08', 'Fix: handle edge case'].join(FIELD),
    ].join('\n');
    const commits = parseLog(output);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({ hash: 'abc123def', shortHash: 'abc123d', author: 'Kim', date: '2026-07-09', subject: 'Add feature' });
    expect(commits[1].subject).toBe('Fix: handle edge case');
  });
  test('the format string requests hash, short, author, date, subject', () => {
    expect(LOG_FORMAT).toContain('%H');
    expect(LOG_FORMAT).toContain('%h');
    expect(LOG_FORMAT).toContain('%an');
    expect(LOG_FORMAT).toContain('%s');
  });
  test('ignores blank and malformed lines', () => {
    expect(parseLog('\n\nnot a record\n')).toHaveLength(0);
  });
});

describe('parseNumstat', () => {
  test('parses additions/deletions and binary files', () => {
    const files = parseNumstat('3\t1\tsrc/a.zx\n0\t5\tsrc/b.zx\n-\t-\timage.png');
    expect(files).toHaveLength(3);
    expect(files[0]).toEqual({ additions: 3, deletions: 1, binary: false, path: 'src/a.zx' });
    expect(files[2].binary).toBe(true);
    expect(files[2].additions).toBe(0);
  });
  test('ignores non-numstat lines (log headers)', () => {
    expect(parseNumstat('commit abc\n\nAuthor: x\n2\t0\tfile.zx')).toHaveLength(1);
  });
});

describe('diffStat', () => {
  test('totals additions, deletions, and files', () => {
    const stat = diffStat(parseNumstat('3\t1\ta\n0\t5\tb'));
    expect(stat).toEqual({ additions: 3, deletions: 6, files: 2 });
  });
});
