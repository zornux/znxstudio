import { describe, expect, test } from './harness';
import {
  PARTICIPANT_COLORS,
  addParticipant,
  canEdit,
  colorForIndex,
  decodeInvite,
  encodeInvite,
  exposureSummary,
  generateToken,
  host,
  isLoopback,
  removeParticipant,
  tokenMatches,
  updateParticipant,
  type SessionInfo,
} from '../src/renderer/collab/session';
import {
  buildManifest,
  diffManifest,
  diffSummary,
  hashContent,
  isInSync,
  relativePath,
} from '../src/renderer/collab/manifest';

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: 'abc123',
    host: '127.0.0.1',
    port: 4823,
    root: 'C:\\ws',
    token: 'deadbeef',
    participants: [],
    loopbackOnly: true,
    ...overrides,
  };
}

describe('isLoopback', () => {
  test('recognises every loopback spelling', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('localhost')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
  });
  test('anything routable is not loopback', () => {
    expect(isLoopback('0.0.0.0')).toBe(false);
    expect(isLoopback('192.168.1.10')).toBe(false);
  });
});

describe('invites', () => {
  test('round-trip through encode and decode', () => {
    const invite = { host: '192.168.1.7', port: 4823, token: 'abc123' };
    expect(decodeInvite(encodeInvite(invite))).toEqual(invite);
  });

  test('the link is a znxstudio:// url a person can paste', () => {
    expect(encodeInvite({ host: '127.0.0.1', port: 1, token: 't' })).toBe('znxstudio://join?host=127.0.0.1&port=1&token=t');
  });

  test('anything that is not an invite decodes to null', () => {
    expect(decodeInvite('https://example.com')).toBeNull();
    expect(decodeInvite('')).toBeNull();
    expect(decodeInvite('znxstudio://join?host=x')).toBeNull();
  });

  test('a missing or out-of-range port is rejected, never defaulted', () => {
    expect(decodeInvite('znxstudio://join?host=h&token=t')).toBeNull();
    expect(decodeInvite('znxstudio://join?host=h&port=0&token=t')).toBeNull();
    expect(decodeInvite('znxstudio://join?host=h&port=70000&token=t')).toBeNull();
    expect(decodeInvite('znxstudio://join?host=h&port=abc&token=t')).toBeNull();
  });

  test('the scheme is matched case-insensitively', () => {
    expect(decodeInvite('ZNXSTUDIO://join?host=h&port=1&token=t')?.host).toBe('h');
  });
});

describe('generateToken', () => {
  test('produces a hex token of the requested byte length', () => {
    expect(generateToken(16)).toHaveLength(32);
    expect(/^[0-9a-f]+$/.test(generateToken(8))).toBe(true);
  });
  test('two tokens differ — it is drawn from the platform CSPRNG', () => {
    expect(generateToken() === generateToken()).toBe(false);
  });
});

describe('tokenMatches', () => {
  test('an exact match passes', () => {
    expect(tokenMatches('abc123', 'abc123')).toBe(true);
  });
  test('a different token, or a different length, fails', () => {
    expect(tokenMatches('abc123', 'abc124')).toBe(false);
    expect(tokenMatches('abc123', 'abc12')).toBe(false);
    expect(tokenMatches('abc123', '')).toBe(false);
  });
});

describe('participants', () => {
  test('joining assigns the next colour from the palette', () => {
    let current = session();
    current = addParticipant(current, { id: 'host', name: 'Ana', role: 'host', readOnly: false });
    current = addParticipant(current, { id: 'p1', name: 'Ben', role: 'guest', readOnly: false });
    expect(current.participants[0].color).toBe(PARTICIPANT_COLORS[0]);
    expect(current.participants[1].color).toBe(PARTICIPANT_COLORS[1]);
  });

  test('the palette wraps rather than running out', () => {
    expect(colorForIndex(PARTICIPANT_COLORS.length)).toBe(PARTICIPANT_COLORS[0]);
  });

  test('joining twice with the same id changes nothing', () => {
    let current = addParticipant(session(), { id: 'p1', name: 'Ben', role: 'guest', readOnly: false });
    current = addParticipant(current, { id: 'p1', name: 'Impostor', role: 'guest', readOnly: false });
    expect(current.participants).toHaveLength(1);
    expect(current.participants[0].name).toBe('Ben');
  });

  test('leaving removes exactly one participant', () => {
    let current = addParticipant(session(), { id: 'p1', name: 'Ben', role: 'guest', readOnly: false });
    current = addParticipant(current, { id: 'p2', name: 'Cai', role: 'guest', readOnly: false });
    expect(removeParticipant(current, 'p1').participants.map((p) => p.id)).toEqual(['p2']);
  });

  test('updating a participant never lets its id be rewritten', () => {
    const current = addParticipant(session(), { id: 'p1', name: 'Ben', role: 'guest', readOnly: false });
    const updated = updateParticipant(current, 'p1', { name: 'Ben B.', id: 'hacked' } as never);
    expect(updated.participants[0].id).toBe('p1');
    expect(updated.participants[0].name).toBe('Ben B.');
  });

  test('host() finds the participant serving the session', () => {
    let current = addParticipant(session(), { id: 'p1', name: 'Ben', role: 'guest', readOnly: false });
    current = addParticipant(current, { id: 'h', name: 'Ana', role: 'host', readOnly: false });
    expect(host(current)?.name).toBe('Ana');
  });
});

describe('canEdit', () => {
  test('a normal participant may write', () => {
    const current = addParticipant(session(), { id: 'p1', name: 'Ben', role: 'guest', readOnly: false });
    expect(canEdit(current, 'p1')).toBe(true);
  });
  test('a read-only guest may not', () => {
    const current = addParticipant(session(), { id: 'p1', name: 'Ben', role: 'guest', readOnly: true });
    expect(canEdit(current, 'p1')).toBe(false);
  });
  test('someone who is not in the session may not', () => {
    expect(canEdit(session(), 'ghost')).toBe(false);
  });
});

describe('exposureSummary', () => {
  test('a loopback session says nothing is reachable from the network', () => {
    expect(exposureSummary(session())).toContain('reachable from this machine only');
  });
  test('a bound session says plainly who can reach it', () => {
    expect(exposureSummary(session({ loopbackOnly: false, host: '0.0.0.0' }))).toContain('anyone who can route to this machine');
  });
});

describe('hashContent', () => {
  test('is deterministic and differs on any change', () => {
    expect(hashContent('show 1')).toBe(hashContent('show 1'));
    expect(hashContent('show 1') === hashContent('show 2')).toBe(false);
  });
  test('is a stable 8-character hex digest', () => {
    expect(hashContent('anything')).toHaveLength(8);
  });
  test('the empty document hashes to the FNV offset basis', () => {
    expect(hashContent('')).toBe('811c9dc5');
  });
});

describe('relativePath', () => {
  test('strips the root and forward-slashes the rest', () => {
    expect(relativePath('C:\\ws', 'C:\\ws\\src\\main.zx')).toBe('src/main.zx');
  });
  test('matches the root case-insensitively, because Windows does', () => {
    expect(relativePath('C:/WS', 'c:/ws/a.zx')).toBe('a.zx');
  });
  test('a path outside the root is left alone', () => {
    expect(relativePath('C:/ws', 'D:/other/a.zx')).toBe('D:/other/a.zx');
  });
});

describe('manifests', () => {
  const mine = buildManifest('C:/ws', [
    { path: 'C:/ws/a.zx', content: 'show 1' },
    { path: 'C:/ws/sub/b.zx', content: 'show 2' },
    { path: 'C:/ws/gone.zx', content: 'old' },
  ]);
  const theirs = buildManifest('D:/other', [
    { path: 'D:/other/a.zx', content: 'show 1' },
    { path: 'D:/other/sub/b.zx', content: 'show CHANGED' },
    { path: 'D:/other/new.zx', content: 'fresh' },
  ]);

  test('entries are workspace-relative and sorted, so two machines agree', () => {
    expect(mine.entries.map((e) => e.path)).toEqual(['a.zx', 'gone.zx', 'sub/b.zx']);
  });

  test('the diff names exactly what must be fetched, what differs, and what is not shared', () => {
    const diff = diffManifest(mine, theirs);
    expect(diff.added).toEqual(['new.zx']);
    expect(diff.changed).toEqual(['sub/b.zx']);
    expect(diff.removed).toEqual(['gone.zx']);
  });

  test('identical copies are in sync', () => {
    const diff = diffManifest(mine, mine);
    expect(isInSync(diff)).toBe(true);
    expect(diffSummary(diff)).toBe('In sync with the host.');
  });

  test('the summary counts each kind of divergence', () => {
    expect(diffSummary(diffManifest(mine, theirs))).toBe('1 to fetch · 1 differ · 1 not shared');
  });

  test('a file identical in content but on a different drive still matches', () => {
    const diff = diffManifest(mine, theirs);
    expect(diff.changed.includes('a.zx')).toBe(false);
  });
});
