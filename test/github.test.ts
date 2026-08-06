import { describe, expect, test } from './harness';
import {
  blobUrl,
  commitUrl,
  compareUrl,
  detectGitHub,
  newPullRequestUrl,
  parseGitHubRepo,
  parseRemotes,
  repoUrl,
} from '../src/renderer/scm/github';

describe('parseRemotes', () => {
  test('collapses fetch/push into one entry per remote', () => {
    const out = parseRemotes(
      [
        'origin\thttps://github.com/acme/demo.git (fetch)',
        'origin\thttps://github.com/acme/demo.git (push)',
        'upstream\tgit@github.com:acme/upstream.git (fetch)',
        'upstream\tgit@github.com:acme/upstream.git (push)',
      ].join('\n'),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ name: 'origin', url: 'https://github.com/acme/demo.git' });
  });
});

describe('parseGitHubRepo', () => {
  test('handles https, ssh, and git@ forms', () => {
    expect(parseGitHubRepo('https://github.com/acme/demo.git')).toEqual({ owner: 'acme', repo: 'demo' });
    expect(parseGitHubRepo('git@github.com:acme/demo.git')).toEqual({ owner: 'acme', repo: 'demo' });
    expect(parseGitHubRepo('ssh://git@github.com/acme/demo')).toEqual({ owner: 'acme', repo: 'demo' });
  });
  test('returns null for non-GitHub remotes', () => {
    expect(parseGitHubRepo('https://gitlab.com/acme/demo.git')).toBeNull();
    expect(parseGitHubRepo('/local/path')).toBeNull();
  });
});

describe('detectGitHub', () => {
  test('prefers origin', () => {
    const repo = detectGitHub([
      { name: 'upstream', url: 'https://github.com/other/x.git' },
      { name: 'origin', url: 'https://github.com/acme/demo.git' },
    ]);
    expect(repo).toEqual({ owner: 'acme', repo: 'demo' });
  });
  test('null when no remote is GitHub', () => {
    expect(detectGitHub([{ name: 'origin', url: 'https://example.com/x.git' }])).toBeNull();
  });
});

describe('URL builders', () => {
  const repo = { owner: 'acme', repo: 'demo' };
  test('repo, blob (with line), commit, compare, PR', () => {
    expect(repoUrl(repo)).toBe('https://github.com/acme/demo');
    expect(blobUrl(repo, 'main', 'src/a.zx', 12)).toBe('https://github.com/acme/demo/blob/main/src/a.zx#L12');
    expect(blobUrl(repo, 'main', '/src/a.zx')).toBe('https://github.com/acme/demo/blob/main/src/a.zx');
    expect(commitUrl(repo, 'abc123')).toBe('https://github.com/acme/demo/commit/abc123');
    expect(compareUrl(repo, 'main', 'feature')).toBe('https://github.com/acme/demo/compare/main...feature');
    expect(newPullRequestUrl(repo, 'main', 'feature')).toBe('https://github.com/acme/demo/compare/main...feature?expand=1');
  });
});
