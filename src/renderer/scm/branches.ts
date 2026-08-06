/**
 * Branch model (Phase 12E). Pure parsing of `git branch --all` and validation of
 * new branch names (a simplified `git check-ref-format`). The module issues the
 * checkout / create / delete / merge operations; this layer decodes + validates.
 */

export interface Branch {
  name: string;
  current: boolean;
  remote: boolean;
}

/** Parse `git branch -a` (or plain `git branch`) output. */
export function parseBranches(output: string): Branch[] {
  const branches: Branch[] = [];
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const current = line.startsWith('*');
    let name = line.replace(/^\*?\s+/, '').trim();
    if (name.startsWith('(HEAD detached')) continue;
    if (name.includes(' -> ')) continue; // e.g. remotes/origin/HEAD -> origin/main
    const remote = name.startsWith('remotes/');
    if (remote) name = name.slice('remotes/'.length);
    branches.push({ name, current, remote });
  }
  return branches;
}

export function localBranches(branches: Branch[]): Branch[] {
  return branches.filter((b) => !b.remote);
}

export function currentBranch(branches: Branch[]): Branch | null {
  return branches.find((b) => b.current) ?? null;
}

/** Validate a proposed branch name; returns a reason it's invalid, or null. */
export function validateBranchName(name: string): string | null {
  const value = name.trim();
  if (!value) return 'Branch name is required.';
  if (/\s/.test(value)) return 'Branch name cannot contain spaces.';
  if (value.startsWith('-')) return 'Branch name cannot start with "-".';
  if (value.startsWith('/') || value.endsWith('/')) return 'Branch name cannot start or end with "/".';
  if (value.includes('..')) return 'Branch name cannot contain "..".';
  if (value.includes('@{')) return 'Branch name cannot contain "@{".';
  if (/[~^:?*[\\ ]/.test(value)) return 'Branch name contains an invalid character.';
  if (value.endsWith('.lock') || value.endsWith('.')) return 'Branch name has an invalid ending.';
  return null;
}
