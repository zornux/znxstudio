import { describe, expect, test } from './harness';
import {
  UpdateService,
  type AutoUpdaterLike,
  type UpdateCheckResultLike,
} from '../src/main/services/UpdateService';

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

    const previewUpdater = fakeUpdater({ version: '1.0.0' });
    const preview = new UpdateService({ currentVersion: '1.0.0', channel: 'preview', loadUpdater: () => previewUpdater });
    await preview.check();
    expect(previewUpdater.allowPrerelease).toBe(true);
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
    const status = await svc.download();
    expect(status.canInstall).toBe(true);
    expect(seen).toContain('downloading:42');
    expect(svc.current().phase).toBe('downloaded');
    svc.install();
    expect(updater.installed).toBe(true);
  });
});
