import { describe, expect, test } from './harness';
import {
  currentBranch,
  localBranches,
  parseBranches,
  validateBranchName,
} from '../src/renderer/scm/branches';

describe('parseBranches', () => {
  test('parses local, current, and remote branches', () => {
    const branches = parseBranches(
      ['* main', '  feature/x', '  remotes/origin/main', '  remotes/origin/HEAD -> origin/main'].join('\n'),
    );
    expect(branches).toHaveLength(3); // the HEAD -> alias is skipped
    expect(currentBranch(branches)!.name).toBe('main');
    expect(localBranches(branches).map((b) => b.name)).toEqual(['main', 'feature/x']);
    expect(branches.find((b) => b.name === 'origin/main')!.remote).toBe(true);
  });

  test('skips a detached HEAD line and blanks', () => {
    const branches = parseBranches('* (HEAD detached at abc123)\n  main\n\n');
    expect(branches.map((b) => b.name)).toEqual(['main']);
  });
});

describe('validateBranchName', () => {
  test('accepts normal names including slashes', () => {
    expect(validateBranchName('feature/login')).toBeNull();
    expect(validateBranchName('fix-42')).toBeNull();
  });
  test('rejects invalid names', () => {
    expect(validateBranchName('')).toContain('required');
    expect(validateBranchName('has space')).toContain('spaces');
    expect(validateBranchName('-dashes')).toContain('"-"');
    expect(validateBranchName('a..b')).toContain('".."');
    expect(validateBranchName('ends/')).toContain('"/"');
    expect(validateBranchName('bad~ref')).toContain('invalid character');
    expect(validateBranchName('x.lock')).toContain('ending');
  });
});
