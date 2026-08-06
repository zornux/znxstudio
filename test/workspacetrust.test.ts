import { describe, expect, test } from './harness';
import {
  addTrustedFolder,
  isFolderTrusted,
  isPathWithin,
  isWorkspaceTrusted,
  normalizeTrustPath,
  parentFolder,
  parseTrustStore,
  removeTrustCovering,
  EMPTY_TRUST_STORE,
} from '../src/shared/workspaceTrust';
import { WorkspaceTrustService } from '../src/main/services/WorkspaceTrustService';

describe('workspaceTrust — path model', () => {
  test('normalizes separators, trailing slash, and case where insensitive', () => {
    expect(normalizeTrustPath('C:\\Projects\\App\\', true)).toBe('c:/projects/app');
    expect(normalizeTrustPath('/home/me/app/', false)).toBe('/home/me/app');
    expect(normalizeTrustPath('/Home/Me', false)).toBe('/Home/Me'); // case preserved on linux
  });

  test('isPathWithin: equal, descendant, and non-prefix sibling', () => {
    expect(isPathWithin('/a/b/c', '/a/b', false)).toBe(true);
    expect(isPathWithin('/a/b', '/a/b', false)).toBe(true);
    expect(isPathWithin('/a/bc', '/a/b', false)).toBe(false); // sibling, not descendant
    expect(isPathWithin('C:/A/B', 'c:/a', true)).toBe(true);
  });

  test('parentFolder walks up one level', () => {
    expect(parentFolder('/home/me/app', false)).toBe('/home/me');
    expect(parentFolder('C:\\p\\app', true)).toBe('c:/p');
  });
});

describe('workspaceTrust — trust decisions', () => {
  test('a folder is trusted via itself or an ancestor', () => {
    const trusted = ['/home/me/work'];
    expect(isFolderTrusted('/home/me/work', trusted, false)).toBe(true);
    expect(isFolderTrusted('/home/me/work/app', trusted, false)).toBe(true); // parent-folder trust
    expect(isFolderTrusted('/home/me/other', trusted, false)).toBe(false);
  });

  test('empty window is trusted; multi-root needs ALL roots trusted', () => {
    expect(isWorkspaceTrusted([], ['/x'], false)).toBe(true);
    expect(isWorkspaceTrusted(['/a', '/b'], ['/a', '/b'], false)).toBe(true);
    expect(isWorkspaceTrusted(['/a', '/b'], ['/a'], false)).toBe(false); // one untrusted root restricts all
  });
});

describe('workspaceTrust — store reducers', () => {
  test('addTrustedFolder dedupes and collapses descendants under a broader parent', () => {
    let store = addTrustedFolder(EMPTY_TRUST_STORE, '/home/me/work/app', false);
    expect(store.trustedFolders).toEqual(['/home/me/work/app']);
    // Adding the parent should subsume the child entry.
    store = addTrustedFolder(store, '/home/me/work', false);
    expect(store.trustedFolders).toEqual(['/home/me/work']);
    // Adding a covered child again is a no-op.
    store = addTrustedFolder(store, '/home/me/work/app', false);
    expect(store.trustedFolders).toEqual(['/home/me/work']);
  });

  test('removeTrustCovering makes a path untrusted even when trusted via an ancestor', () => {
    const store = { trustedFolders: ['/home/me/work'] };
    const after = removeTrustCovering(store, '/home/me/work/app', false);
    expect(isFolderTrusted('/home/me/work/app', after.trustedFolders, false)).toBe(false);
    expect(after.trustedFolders).toEqual([]);
  });

  test('parseTrustStore tolerates garbage and normalizes', () => {
    expect(parseTrustStore(null, false)).toEqual({ trustedFolders: [] });
    expect(parseTrustStore({ trustedFolders: 'nope' }, false)).toEqual({ trustedFolders: [] });
    expect(parseTrustStore({ trustedFolders: ['/A', '', 42, '/A'] }, true)).toEqual({ trustedFolders: ['/a'] });
  });
});

describe('WorkspaceTrustService — enforcement gate', () => {
  // These exercise the in-memory gate only; no trustWorkspace() call is made, so
  // nothing is persisted to the user's home directory.
  test('an empty window is trusted; assertTrusted does not throw', () => {
    const svc = new WorkspaceTrustService();
    svc.setWorkspace([]);
    expect(svc.isTrusted()).toBe(true);
    let threw = false;
    try { svc.assertTrusted('running tasks'); } catch { threw = true; }
    expect(threw).toBe(false);
  });

  test('an unknown workspace is untrusted and blocks execution', () => {
    const svc = new WorkspaceTrustService();
    const state = svc.setWorkspace(['/some/untrusted/project']);
    expect(state.trusted).toBe(false);
    expect(state.decided).toBe(false); // the UI should prompt
    expect(svc.isTrusted()).toBe(false);
    let message = '';
    try { svc.assertTrusted('running tasks'); } catch (e) { message = (e as Error).message; }
    expect(message.includes('not trusted')).toBe(true);
  });

  test('continuing in Restricted Mode marks the workspace decided but still untrusted', () => {
    const svc = new WorkspaceTrustService();
    svc.setWorkspace(['/some/untrusted/project']);
    const state = svc.acknowledgeRestricted();
    expect(state.decided).toBe(true);
    expect(state.trusted).toBe(false); // execution stays blocked
    expect(svc.isTrusted()).toBe(false);
  });
});
