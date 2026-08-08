import { describe, expect, test } from './harness';
import type { OpenEditor } from '../src/renderer/core/Contracts';
import {
  addRecentWorkspace,
  dirtyPaths,
  formatRecentWorkspaces,
  hasUnsaved,
  parseSession,
  pruneRecentWorkspaces,
  resolveAutosaveMode,
  restorableSession,
  serializeSession,
} from '../src/renderer/editor/unsavedGuard';

function editor(over: Partial<OpenEditor>): OpenEditor {
  return { uri: `file://${over.path}`, path: '/a.zx', name: 'a.zx', dirty: false, pinned: false, preview: false, active: false, ...over };
}

describe('unsavedGuard — dirty detection', () => {
  test('finds dirty tabs', () => {
    const editors = [editor({ path: '/a.zx', dirty: true }), editor({ path: '/b.zx' }), editor({ path: '/c.zx', dirty: true })];
    expect(dirtyPaths(editors)).toEqual(['/a.zx', '/c.zx']);
    expect(hasUnsaved(editors)).toBe(true);
    expect(hasUnsaved([editor({ path: '/x' })])).toBe(false);
  });
});

describe('unsavedGuard — autosave mode resolution', () => {
  test('explicit mode wins', () => {
    expect(resolveAutosaveMode('onWindowChange', false)).toBe('onWindowChange');
    expect(resolveAutosaveMode('onFocusChange', true)).toBe('onFocusChange');
  });
  test('legacy boolean maps when no explicit mode', () => {
    expect(resolveAutosaveMode(undefined, true)).toBe('afterDelay');
    expect(resolveAutosaveMode(undefined, false)).toBe('off');
  });
  test('unknown string falls back to off (never save on a typo)', () => {
    expect(resolveAutosaveMode('sometimes', true)).toBe('off');
  });
});

describe('unsavedGuard — session snapshot', () => {
  test('serializes permanent tabs only, records active', () => {
    const editors = [
      editor({ path: '/a.zx', pinned: true, active: true }),
      editor({ path: '/peek.zx', preview: true }),
      editor({ path: '/b.zx' }),
    ];
    const snap = serializeSession(editors);
    expect(snap.tabs).toEqual([
      { path: '/a.zx', pinned: true },
      { path: '/b.zx', pinned: false },
    ]);
    expect(snap.activePath).toBe('/a.zx');
  });

  test('parseSession tolerates garbage', () => {
    expect(parseSession(null).tabs).toEqual([]);
    expect(parseSession({ tabs: 'nope' }).tabs).toEqual([]);
    const parsed = parseSession({ tabs: [{ path: '/x', pinned: true }, { nope: 1 }], activePath: '/x' });
    expect(parsed.tabs).toEqual([{ path: '/x', pinned: true }]);
    expect(parsed.activePath).toBe('/x');
  });

  test('parseSession removes empty and duplicate paths and rejects a missing active tab', () => {
    const parsed = parseSession({
      tabs: [
        { path: '  /x  ', pinned: true },
        { path: '/x', pinned: false },
        { path: '   ', pinned: true },
      ],
      activePath: '/missing',
    });
    expect(parsed.tabs).toEqual([{ path: '/x', pinned: true }]);
    expect(parsed.activePath).toBeNull();
  });

  test('restorableSession drops files that no longer exist', () => {
    const snap = serializeSession([editor({ path: '/gone.zx', active: true }), editor({ path: '/here.zx' })]);
    const exists = (p: string) => p === '/here.zx';
    const restored = restorableSession(snap, exists);
    expect(restored.tabs.map((t) => t.path)).toEqual(['/here.zx']);
    // The active file was deleted, so no active survives.
    expect(restored.activePath).toBe(null);
  });
});

describe('unsavedGuard — recent workspaces', () => {
  test('adds to front, dedupes, caps', () => {
    let recent = addRecentWorkspace(undefined, '/w1');
    recent = addRecentWorkspace(recent, '/w2');
    recent = addRecentWorkspace(recent, '/w1'); // re-open moves to front
    expect(recent).toEqual(['/w1', '/w2']);
    const many = Array.from({ length: 12 }, (_, i) => `/w${i}`);
    expect(addRecentWorkspace(many, '/new', 10)).toHaveLength(10);
  });

  test('formatRecentWorkspaces splits leaf name from parent dir', () => {
    const entries = formatRecentWorkspaces(['C:\\Studio Apps\\xojin', '/home/me/proj']);
    expect(entries).toEqual([
      { path: 'C:\\Studio Apps\\xojin', name: 'xojin', dir: 'C:\\Studio Apps' },
      { path: '/home/me/proj', name: 'proj', dir: '/home/me' },
    ]);
  });

  test('formatRecentWorkspaces tolerates junk and caps the list', () => {
    const raw = [123, '', null, '/a/one', '/b/two', '/c/three', '/d/four', '/e/five', '/f/six', '/g/seven'];
    const entries = formatRecentWorkspaces(raw, 6);
    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.name)).toEqual(['one', 'two', 'three', 'four', 'five', 'six']);
    expect(formatRecentWorkspaces('not-an-array')).toEqual([]);
  });

  test('pruneRecentWorkspaces drops deleted/moved projects, preserving order', () => {
    const list = ['/a/one', '/b/two', '/c/three'];
    const existing = new Set(['/a/one', '/c/three']); // /b/two was deleted or moved
    expect(pruneRecentWorkspaces(list, existing)).toEqual(['/a/one', '/c/three']);
  });

  test('pruneRecentWorkspaces returns empty when none still exist and tolerates junk', () => {
    expect(pruneRecentWorkspaces(['/gone'], new Set())).toEqual([]);
    expect(pruneRecentWorkspaces([123, null, '/keep'], new Set(['/keep']))).toEqual(['/keep']);
    expect(pruneRecentWorkspaces('nope', new Set(['/x']))).toEqual([]);
  });
});
