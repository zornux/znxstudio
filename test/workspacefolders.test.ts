import { describe, expect, test } from './harness';
import { WorkspaceFolderSet, normalizeRoot } from '../src/renderer/workspace/workspaceFolders';
import type { WorkspaceInfo } from '../src/shared/types';

function ws(root: string, name?: string): WorkspaceInfo {
  return {
    root,
    isZnxStudioProject: false,
    project: name ? ({ name } as WorkspaceInfo['project']) : null,
    detectedType: 'generic',
    diagnostics: [],
  };
}

describe('workspace folder set: basics', () => {
  test('primary is the first folder; empty when none', () => {
    const set = new WorkspaceFolderSet();
    expect(set.isEmpty()).toBeTruthy();
    expect(set.primary()).toBeNull();
    set.set([ws('C:/a'), ws('C:/b')]);
    expect(set.primary()!.root).toBe('C:/a');
    expect(set.list()).toHaveLength(2);
  });

  test('set() replaces and de-dupes', () => {
    const set = new WorkspaceFolderSet();
    set.set([ws('C:/a'), ws('C:/a'), ws('C:/b')]);
    expect(set.list()).toHaveLength(2);
  });

  test('add returns true for new, false for an already-open root (case/slash-insensitive)', () => {
    const set = new WorkspaceFolderSet();
    expect(set.add(ws('C:/a'))).toBeTruthy();
    expect(set.add(ws('C:/b'))).toBeTruthy();
    expect(set.add(ws('c:\\A\\'))).toBeFalsy(); // same as C:/a
    expect(set.list()).toHaveLength(2);
  });

  test('add on an existing root refreshes its info in place (keeps position)', () => {
    const set = new WorkspaceFolderSet();
    set.set([ws('C:/a', 'old'), ws('C:/b')]);
    set.add(ws('C:/a', 'new'));
    expect(set.list()[0].project!.name).toBe('new');
    expect(set.list()).toHaveLength(2);
  });

  test('remove deletes by root and reports whether anything changed', () => {
    const set = new WorkspaceFolderSet();
    set.set([ws('C:/a'), ws('C:/b')]);
    expect(set.remove('c:\\b')).toBeTruthy();
    expect(set.remove('C:/nope')).toBeFalsy();
    expect(set.list()).toHaveLength(1);
    expect(set.primary()!.root).toBe('C:/a');
  });
});

describe('workspace folder set: containing', () => {
  test('finds the owning folder by path prefix', () => {
    const set = new WorkspaceFolderSet();
    set.set([ws('C:/proj'), ws('D:/other')]);
    expect(set.containing('C:/proj/src/app.zx')!.root).toBe('C:/proj');
    expect(set.containing('D:\\other\\x.zx')!.root).toBe('D:/other');
  });

  test('longest matching root wins for nested folders', () => {
    const set = new WorkspaceFolderSet();
    set.set([ws('C:/proj'), ws('C:/proj/sub')]);
    expect(set.containing('C:/proj/sub/deep/x.zx')!.root).toBe('C:/proj/sub');
    expect(set.containing('C:/proj/other/x.zx')!.root).toBe('C:/proj');
  });

  test('an exact root path matches; a non-descendant does not', () => {
    const set = new WorkspaceFolderSet();
    set.set([ws('C:/proj')]);
    expect(set.containing('C:/proj')!.root).toBe('C:/proj');
    expect(set.containing('C:/project-2/x.zx')).toBeNull(); // not a path-segment prefix
    expect(set.containing('C:/elsewhere/x.zx')).toBeNull();
  });
});

describe('normalizeRoot', () => {
  test('collapses slashes, trims trailing, lower-cases', () => {
    expect(normalizeRoot('C:\\Studio\\Apps\\')).toBe('c:/studio/apps');
    expect(normalizeRoot('C:/a//b/')).toBe('c:/a/b');
  });
});
