import { describe, expect, test } from './harness';
import {
  UpdateService,
  type AutoUpdaterLike,
  type UpdateCheckResultLike,
} from '../src/main/services/UpdateService';
import type { RollbackController, RollbackRecord } from '../src/main/services/rollback';

/** A rollback controller that records how the service drives it. */
function fakeRollback(record: RollbackRecord | null, opts: { performOk?: boolean } = {}) {
  const calls = { prepare: [] as Array<[string, string]>, perform: 0, clear: 0 };
  const controller: RollbackController = {
    prepare: (from, to) => { calls.prepare.push([from, to]); return true; },
    available: () => record,
    perform: () => { calls.perform += 1; return opts.performOk ?? true; },
    clear: () => { calls.clear += 1; },
  };
  return { controller, calls };
}

const RECORD: RollbackRecord = {
  previousVersion: '1.0.0',
  updatedToVersion: '1.1.0',
  backupPath: '/state/rollback/1.0.0.bak',
  createdAt: '2026-01-01T00:00:00.000Z',
  platform: 'linux',
};

/** A fake electron-updater autoUpdater, recording state the service drives. */
interface FakeUpdater extends AutoUpdaterLike {
  emit(event: string, arg?: unknown): void;
  installed: boolean;
}

function fakeUpdater(opts: {
  version?: string | null;
  check?: () => Promise<UpdateCheckResultLike | null>;
  onDownload?: (u: FakeUpdater) => void;
} = {}): FakeUpdater {
  const handlers: Record<string, (arg: unknown) => void> = {};
  const updater: FakeUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    channel: null,
    allowPrerelease: false,
    installed: false,
    on: (event, cb) => {
      handlers[event] = cb as (arg: unknown) => void;
    },
    emit: (event, arg) => handlers[event]?.(arg),
    checkForUpdates:
      opts.check ??
      (async () =>
        opts.version === null
          ? { updateInfo: undefined }
          : { updateInfo: { version: opts.version ?? '1.0.0', files: [{ sha512: 'abc', size: 42 }], releaseNotes: 'Fixes' } }),
    downloadUpdate: async () => {
      (opts.onDownload ?? ((u) => {
        u.emit('download-progress', { percent: 42 });
        u.emit('update-downloaded', undefined);
      }))(updater);
    },
    quitAndInstall: () => {
      updater.installed = true;
    },
  };
  return updater;
}

describe('UpdateService — electron-updater (GitHub-native)', () => {
  test('reports an available update when the feed is newer', async () => {
    const svc = new UpdateService({ currentVersion: '1.0.0', channel: 'stable', loadUpdater: () => fakeUpdater({ version: '1.2.0' }) });
    const status = await svc.check();
    expect(status.phase).toBe('update-available');
    expect(status.release?.version).toBe('1.2.0');
    expect(status.release?.notes).toBe('Fixes');
    expect(status.release?.sha512).toBe('abc');
  });

  test('reports up-to-date when the feed is not newer', async () => {
    const svc = new UpdateService({ currentVersion: '1.0.0', channel: 'stable', loadUpdater: () => fakeUpdater({ version: '1.0.0' }) });
    expect((await svc.check()).phase).toBe('up-to-date');
  });

  test('a stable subscriber disallows prereleases; a preview subscriber allows them', async () => {
    const stableUpdater = fakeUpdater({ version: '1.0.0' });
    const stable = new UpdateService({ currentVersion: '1.0.0', channel: 'stable', loadUpdater: () => stableUpdater });
    await stable.check();
    expect(stableUpdater.allowPrerelease).toBe(false);
    expect(stableUpdater.channel).toBe('latest');

    const previewUpdater = fakeUpdater({ version: '1.0.0' });
    const preview = new UpdateService({ currentVersion: '1.0.0', channel: 'preview', loadUpdater: () => previewUpdater });
    await preview.check();
    expect(previewUpdater.allowPrerelease).toBe(true);
    expect(previewUpdater.channel).toBe('rc');
  });

  test('keeps nightly isolated on its own provider feed', async () => {
    const updater = fakeUpdater({ version: '1.2.0-nightly.1' });
    const svc = new UpdateService({ currentVersion: '1.0.0', channel: 'nightly', loadUpdater: () => updater });
    await svc.check();
    expect(updater.channel).toBe('nightly');
  });

  test('no updateInfo degrades to up-to-date', async () => {
    const svc = new UpdateService({ currentVersion: '1.0.0', channel: 'stable', loadUpdater: () => fakeUpdater({ version: null }) });
    expect((await svc.check()).phase).toBe('up-to-date');
  });

  test('a failing check (offline) degrades to no-feed (never throws)', async () => {
    const svc = new UpdateService({
      currentVersion: '1.0.0',
      channel: 'stable',
      loadUpdater: () =>
        fakeUpdater({
          check: async () => {
            throw new Error('net down');
          },
        }),
    });
    expect((await svc.check()).phase).toBe('no-feed');
  });

  test('without electron-updater, check is no-feed and download is a no-op', async () => {
    const logs: string[] = [];
    const svc = new UpdateService({
      currentVersion: '1.0.0',
      channel: 'stable',
      loadUpdater: () => null, // simulate an unpackaged build
      log: (_l, m) => logs.push(m),
    });
    expect((await svc.check()).phase).toBe('no-feed');
    const status = await svc.download();
    expect(status.canInstall).toBe(false);
    svc.install(); // guarded no-op
    expect(svc.current().phase).toBe('no-feed'); // unchanged; no real updater
  });

  test('a fake updater drives progress → downloaded → install', async () => {
    const updater = fakeUpdater({ version: '1.2.0' });
    const seen: string[] = [];
    const svc = new UpdateService({ currentVersion: '1.0.0', channel: 'stable', loadUpdater: () => updater });
    svc.onDidChangeStatus((s) => seen.push(`${s.phase}${s.percent != null ? `:${s.percent}` : ''}`));
    await svc.check();
    expect(updater.autoInstallOnAppQuit).toBe(false);
    const status = await svc.download();
    expect(status.canInstall).toBe(true);
    expect(seen).toContain('downloading:42');
    expect(svc.current().phase).toBe('downloaded');
    svc.install();
    expect(updater.installed).toBe(true);
  });

  test('coalesces concurrent checks and downloads', async () => {
    let checks = 0;
    let downloads = 0;
    const updater = fakeUpdater({
      check: async () => {
        checks += 1;
        await Promise.resolve();
        return { updateInfo: { version: '1.2.0' } };
      },
      onDownload: (u) => {
        downloads += 1;
        u.emit('update-downloaded');
      },
    });
    const svc = new UpdateService({ currentVersion: '1.0.0', channel: 'stable', loadUpdater: () => updater });
    await Promise.all([svc.check(), svc.check()]);
    await Promise.all([svc.download(), svc.download()]);
    expect(checks).toBe(1);
    expect(downloads).toBe(1);
    await svc.check();
    expect(checks).toBe(1); // downloaded state is preserved until install
  });

  test('updates the channel without registering a second updater', async () => {
    const updater = fakeUpdater({ version: '1.0.0' });
    let loads = 0;
    const svc = new UpdateService({ currentVersion: '1.0.0', channel: 'stable', loadUpdater: () => { loads += 1; return updater; } });
    await svc.check();
    svc.setChannel('preview');
    await svc.check();
    expect(loads).toBe(1);
    expect(updater.allowPrerelease).toBe(true);
  });

  test('normalizes full changelog release notes', async () => {
    const updater = fakeUpdater({
      check: async () => ({ updateInfo: { version: '1.2.0', releaseNotes: [{ version: '1.2.0', note: 'New UI' }, { version: '1.1.0', note: 'Fixes' }] } }),
    });
    const svc = new UpdateService({ currentVersion: '1.0.0', channel: 'stable', loadUpdater: () => updater });
    expect((await svc.check()).release?.notes).toBe('1.2.0\nNew UI\n\n1.1.0\nFixes');
  });

  test('provides a safe release page and reports synchronous install failures', async () => {
    const updater = fakeUpdater({ version: '1.2.0' });
    updater.quitAndInstall = () => { throw new Error('installer unavailable'); };
    const svc = new UpdateService({ currentVersion: '1.0.0', channel: 'stable', loadUpdater: () => updater });
    const available = await svc.check();
    expect(available.release?.url).toBe('https://github.com/zornux/znxstudio/releases/tag/v1.2.0');
    await svc.download();
    expect(svc.install().phase).toBe('error');
    expect(svc.current().error).toBe('installer unavailable');
  });
});

describe('UpdateService — rollback (last-known-good)', () => {
  test('snapshots the current version before installing an update', async () => {
    const updater = fakeUpdater({ version: '1.2.0' });
    const { controller, calls } = fakeRollback(null);
    const svc = new UpdateService({ currentVersion: '1.0.0', channel: 'stable', loadUpdater: () => updater, rollback: controller });
    await svc.check();
    await svc.download();
    svc.install();
    expect(updater.installed).toBe(true);
    // prepare(current, target) runs before quitAndInstall so the point survives the swap.
    expect(calls.prepare).toEqual([['1.0.0', '1.2.0']]);
  });

  test('reports canRollback/rollbackVersion from the recorded point', () => {
    const { controller } = fakeRollback(RECORD);
    const svc = new UpdateService({ currentVersion: '1.1.0', channel: 'stable', loadUpdater: () => null, rollback: controller });
    expect(svc.current().canRollback).toBe(true);
    expect(svc.current().rollbackVersion).toBe('1.0.0');
  });

  test('no rollback point → canRollback is false', () => {
    const { controller } = fakeRollback(null);
    const svc = new UpdateService({ currentVersion: '1.1.0', channel: 'stable', loadUpdater: () => null, rollback: controller });
    expect(svc.current().canRollback).toBe(false);
    expect(svc.current().rollbackVersion).toBe(null);
  });

  test('rollback() restores when a point exists', () => {
    const { controller, calls } = fakeRollback(RECORD);
    const svc = new UpdateService({ currentVersion: '1.1.0', channel: 'stable', loadUpdater: () => null, rollback: controller });
    svc.rollback();
    expect(calls.perform).toBe(1);
  });

  test('rollback() is a guarded no-op (not an error) when unavailable', () => {
    const { controller, calls } = fakeRollback(null);
    const svc = new UpdateService({ currentVersion: '1.1.0', channel: 'stable', loadUpdater: () => null, rollback: controller });
    expect(svc.rollback().phase).toBe('idle');
    expect(calls.perform).toBe(0);
  });

  test('rollback() surfaces a restore failure as an error', () => {
    const { controller } = fakeRollback(RECORD, { performOk: false });
    const svc = new UpdateService({ currentVersion: '1.1.0', channel: 'stable', loadUpdater: () => null, rollback: controller });
    expect(svc.rollback().phase).toBe('error');
  });
});
