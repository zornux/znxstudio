import { describe, expect, test } from './harness';
import { GH_PR_FIELDS, isGhInstalled, parseGhPrList } from '../src/renderer/scm/pullRequests';

describe('parseGhPrList', () => {
  test('parses gh pr list JSON (author object → login)', () => {
    const prs = parseGhPrList(
      JSON.stringify([
        { number: 7, title: 'Add feature', author: { login: 'kim' }, state: 'OPEN', headRefName: 'feat', baseRefName: 'main', url: 'https://github.com/acme/demo/pull/7', isDraft: false },
        { number: 9, title: 'WIP', author: { login: 'sam' }, state: 'OPEN', headRefName: 'wip', baseRefName: 'main', url: 'https://github.com/acme/demo/pull/9', isDraft: true },
      ]),
    );
    expect(prs).toHaveLength(2);
    expect(prs[0]).toEqual({ number: 7, title: 'Add feature', author: 'kim', state: 'OPEN', headRefName: 'feat', baseRefName: 'main', url: 'https://github.com/acme/demo/pull/7', isDraft: false });
    expect(prs[1].isDraft).toBe(true);
  });

  test('drops entries without a valid number and tolerates garbage', () => {
    expect(parseGhPrList('[{"title":"no number"}]')).toHaveLength(0);
    expect(parseGhPrList('not json')).toHaveLength(0);
    expect(parseGhPrList('{}')).toHaveLength(0);
  });

  test('accepts a plain-string author', () => {
    const [pr] = parseGhPrList('[{"number":1,"title":"x","author":"lee","url":"u"}]');
    expect(pr.author).toBe('lee');
  });
});

describe('isGhInstalled', () => {
  test('detects the gh version banner', () => {
    expect(isGhInstalled('gh version 2.40.0 (2023-12-13)')).toBe(true);
    expect(isGhInstalled("'gh' is not recognized")).toBe(false);
  });
});

describe('GH_PR_FIELDS', () => {
  test('requests the fields the parser reads', () => {
    for (const field of ['number', 'title', 'author', 'headRefName', 'baseRefName', 'url', 'isDraft']) {
      expect(GH_PR_FIELDS.includes(field)).toBe(true);
    }
  });
});
