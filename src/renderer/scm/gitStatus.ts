/**
 * Pure parsing of `git status --porcelain` (Phase 12A). The main process runs
 * git; this turns its output into a structured change list the Source Control
 * view groups and renders. Kept pure so the (fiddly) XY status decoding is
 * unit-tested and the same logic is reused across later SCM phases.
 */

export type GitChangeType =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'unknown';

export interface GitFileStatus {
  path: string;
  /** For renames/copies, the original path. */
  origPath?: string;
  /** Index (staged) status char. */
  index: string;
  /** Worktree (unstaged) status char. */
  worktree: string;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
  type: GitChangeType;
}

function charType(char: string): GitChangeType {
  switch (char) {
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      return 'unknown';
  }
}

function isConflict(x: string, y: string): boolean {
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
}

/** Parse `git status --porcelain=v1` output into per-file change entries. */
export function parseStatus(porcelain: string): GitFileStatus[] {
  const entries: GitFileStatus[] = [];
  for (const raw of porcelain.split('\n')) {
    if (raw.length < 4) continue;
    const index = raw[0];
    const worktree = raw[1];
    const rest = raw.slice(3);
    const untracked = index === '?' && worktree === '?';
    const conflicted = isConflict(index, worktree);

    let path = rest;
    let origPath: string | undefined;
    const arrow = rest.indexOf(' -> ');
    if (arrow >= 0) {
      origPath = unquote(rest.slice(0, arrow));
      path = unquote(rest.slice(arrow + 4));
    } else {
      path = unquote(rest);
    }

    const staged = !conflicted && index !== ' ' && index !== '?';
    const unstaged = untracked || (worktree !== ' ' && worktree !== '?');

    let type: GitChangeType;
    if (conflicted) type = 'conflicted';
    else if (untracked) type = 'untracked';
    else type = charType(index !== ' ' ? index : worktree);

    entries.push({ path, origPath, index, worktree, staged, unstaged, conflicted, type });
  }
  return entries;
}

/** Git quotes paths with special chars in double quotes; strip them. */
function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
}

export interface StatusGroups {
  conflicts: GitFileStatus[];
  staged: GitFileStatus[];
  changes: GitFileStatus[];
}

/** Split entries into the view's three groups (a file may be staged AND changed). */
export function groupStatus(entries: GitFileStatus[]): StatusGroups {
  return {
    conflicts: entries.filter((e) => e.conflicted),
    staged: entries.filter((e) => e.staged),
    changes: entries.filter((e) => e.unstaged && !e.conflicted),
  };
}

export function isClean(entries: GitFileStatus[]): boolean {
  return entries.length === 0;
}

/** A single-letter badge for a change type (VS Code-style). */
export function statusLetter(entry: GitFileStatus): string {
  switch (entry.type) {
    case 'modified':
      return 'M';
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    case 'untracked':
      return 'U';
    case 'conflicted':
      return '!';
    default:
      return '?';
  }
}
