/**
 * Commit history model (Phase 12F). Pure parsing of `git log` (records separated
 * by a unit-separator field format) and `git show --numstat` (per-file line
 * counts). The Repo Explorer renders these; keeping the decode pure means the
 * format handling is unit-tested and reused.
 */

const FIELD = '\x1f';

/** The `git log` pretty format that emits FIELD-separated columns. */
export const LOG_FORMAT = `--pretty=format:%H${FIELD}%h${FIELD}%an${FIELD}%ad${FIELD}%s`;

export interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export interface CommitFile {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

/** Parse `git log LOG_FORMAT --date=short` output into commits. */
export function parseLog(output: string): Commit[] {
  const commits: Commit[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(FIELD);
    if (parts.length < 5) continue;
    commits.push({
      hash: parts[0],
      shortHash: parts[1],
      author: parts[2],
      date: parts[3],
      subject: parts.slice(4).join(FIELD),
    });
  }
  return commits;
}

/** Parse `git show --numstat` (or `git diff --numstat`) into per-file counts. */
export function parseNumstat(output: string): CommitFile[] {
  const files: CommitFile[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!match) continue;
    const binary = match[1] === '-' && match[2] === '-';
    files.push({
      additions: match[1] === '-' ? 0 : Number(match[1]),
      deletions: match[2] === '-' ? 0 : Number(match[2]),
      binary,
      path: match[3],
    });
  }
  return files;
}

/** Sum additions/deletions across a commit's files. */
export function diffStat(files: CommitFile[]): { additions: number; deletions: number; files: number } {
  return files.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
      files: acc.files + 1,
    }),
    { additions: 0, deletions: 0, files: 0 },
  );
}
