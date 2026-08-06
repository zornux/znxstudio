/**
 * GitHub integration helpers (Phase 12B). Pure parsing of `git remote -v`,
 * detection of a GitHub owner/repo from a remote URL (https / ssh / git@), and
 * construction of the canonical GitHub URLs the IDE opens (repo, blob-at-line,
 * commit, compare, new-PR). No network — just string work, fully unit-tested.
 */

export interface GitRemote {
  name: string;
  url: string;
}

export interface GitHubRepo {
  owner: string;
  repo: string;
}

/** Parse `git remote -v` into unique remotes (fetch URL per name). */
export function parseRemotes(output: string): GitRemote[] {
  const seen = new Map<string, string>();
  for (const line of output.split('\n')) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((?:fetch|push)\)/);
    if (!match) continue;
    if (!seen.has(match[1])) seen.set(match[1], match[2]);
  }
  return [...seen.entries()].map(([name, url]) => ({ name, url }));
}

/** Detect a GitHub owner/repo from a remote URL, or null if it isn't GitHub. */
export function parseGitHubRepo(url: string): GitHubRepo | null {
  const trimmed = url.trim().replace(/\.git$/, '');
  const match = trimmed.match(/github\.com[/:]([^/]+)\/([^/]+?)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/** The first GitHub repo among a list of remotes (origin preferred). */
export function detectGitHub(remotes: GitRemote[]): GitHubRepo | null {
  const ordered = [...remotes].sort((a, b) => (a.name === 'origin' ? -1 : b.name === 'origin' ? 1 : 0));
  for (const remote of ordered) {
    const repo = parseGitHubRepo(remote.url);
    if (repo) return repo;
  }
  return null;
}

function baseUrl(repo: GitHubRepo): string {
  return `https://github.com/${repo.owner}/${repo.repo}`;
}

export function repoUrl(repo: GitHubRepo): string {
  return baseUrl(repo);
}

/** URL to a file at a ref, optionally anchored to a 1-based line. */
export function blobUrl(repo: GitHubRepo, ref: string, path: string, line?: number): string {
  const clean = path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  const anchor = line && line > 0 ? `#L${line}` : '';
  return `${baseUrl(repo)}/blob/${encodeURIComponent(ref)}/${clean}${anchor}`;
}

export function commitUrl(repo: GitHubRepo, sha: string): string {
  return `${baseUrl(repo)}/commit/${sha}`;
}

export function compareUrl(repo: GitHubRepo, base: string, head: string): string {
  return `${baseUrl(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
}

/** URL that opens GitHub's "open a pull request" form for base...head. */
export function newPullRequestUrl(repo: GitHubRepo, base: string, head: string): string {
  return `${compareUrl(repo, base, head)}?expand=1`;
}
