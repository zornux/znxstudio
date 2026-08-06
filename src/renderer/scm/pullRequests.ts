/**
 * Pull-request model (Phase 12C). Pure parsing of `gh pr list --json …`. The
 * `gh` CLI is optional — when it is absent or unauthenticated the IDE falls back
 * to opening GitHub's compare/new-PR page (URL built in github.ts). This layer
 * only decodes gh's JSON, so it is fully unit-tested without the CLI.
 */

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  state: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft: boolean;
}

/** The JSON fields we request from `gh pr list`. */
export const GH_PR_FIELDS = 'number,title,author,state,headRefName,baseRefName,url,isDraft';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Parse `gh pr list --json …` output into pull requests. Never throws. */
export function parseGhPrList(json: string): PullRequest[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const prs: PullRequest[] = [];
  for (const raw of parsed) {
    const pr = asRecord(raw);
    const number = Number(pr.number);
    if (!Number.isFinite(number) || number <= 0) continue;
    const author = typeof pr.author === 'object' ? String(asRecord(pr.author).login ?? '') : String(pr.author ?? '');
    prs.push({
      number,
      title: String(pr.title ?? ''),
      author,
      state: String(pr.state ?? ''),
      headRefName: String(pr.headRefName ?? ''),
      baseRefName: String(pr.baseRefName ?? ''),
      url: String(pr.url ?? ''),
      isDraft: pr.isDraft === true,
    });
  }
  return prs;
}

/** Whether `gh --version` output indicates the CLI is installed. */
export function isGhInstalled(versionOutput: string): boolean {
  return /gh version/i.test(versionOutput);
}
