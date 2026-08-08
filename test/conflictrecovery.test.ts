import { describe, expect, test } from './harness';
import { diskConflictPreview, resolveSaveAsTarget } from '../src/renderer/editor/conflictRecovery';
import { IpcChannels } from '../src/shared/ipc';

describe('external file conflict recovery', () => {
  test('distinguishes cancel, overwrite, and a new Save As destination', () => {
    expect(resolveSaveAsTarget('/work/App.zx', null)).toEqual({ kind: 'cancel' });
    expect(resolveSaveAsTarget('/work/App.zx', '/work/App.zx')).toEqual({ kind: 'overwrite' });
    expect(resolveSaveAsTarget('C:\\Work\\App.zx', 'c:\\work\\app.zx')).toEqual({ kind: 'overwrite' });
    expect(resolveSaveAsTarget('/work/App.zx', '/tmp/Copy.zx')).toEqual({ kind: 'new', path: '/tmp/Copy.zx' });
  });

  test('shows an explicit missing-file comparison state', () => {
    expect(diskConflictPreview(null)).toContain('no longer exists');
    expect(diskConflictPreview('external')).toBe('external');
  });

  test('Save As has a dedicated IPC contract', () => {
    expect(IpcChannels.DialogSaveFile).toBe('dialog:saveFile');
  });
});
