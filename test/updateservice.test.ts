import { createServer, type Server } from 'node:http';
import { describe, expect, test } from './harness';
import { UpdateService } from '../src/main/services/UpdateService';

/** Start a mock feed server returning `body` (or a 500), on an ephemeral port. */
function mockFeed(body: string | null): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server: Server = createServer((_req, res) => {
      if (body === null) {
        res.statusCode = 500;
        res.end('error');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}/feed.json`, close: () => server.close() });
    });
  });
}

function feed(version: string, channel = 'stable', notes = 'Fixes'): string {
  return JSON.stringify({
    channels: { [channel]: { version, url: `https://dl/${version}.exe`, sha512: 'abc', notes } },
  });
}

describe('UpdateService — runtime feed check (mock server)', () => {
  test('reports an available update when the feed is newer', async () => {
    const server = await mockFeed(feed('1.2.0'));
    try {
      const svc = new UpdateService({ currentVersion: '1.0.0', feedUrl: server.url, channel: 'stable' });
      const status = await svc.check();
      expect(status.phase).toBe('update-available');
      expect(status.release?.version).toBe('1.2.0');
      expect(status.release?.notes).toBe('Fixes');
    } finally {
      server.close();
    }
  });

  test('reports up-to-date when the feed is not newer', async () => {
    const server = await mockFeed(feed('1.0.0'));
    try {
      const svc = new UpdateService({ currentVersion: '1.0.0', feedUrl: server.url, channel: 'stable' });
      expect((await svc.check()).phase).toBe('up-to-date');
    } finally {
      server.close();
    }
  });

  test('a stable subscriber does not see a preview-only release', async () => {
    const server = await mockFeed(feed('2.0.0-rc.1', 'preview'));
    try {
      const stable = new UpdateService({ currentVersion: '1.0.0', feedUrl: server.url, channel: 'stable' });
      expect((await stable.check()).phase).toBe('no-feed'); // nothing on the stable channel
      const preview = new UpdateService({ currentVersion: '1.0.0', feedUrl: server.url, channel: 'preview' });
      expect((await preview.check()).phase).toBe('update-available');
    } finally {
      server.close();
    }
  });

  test('malformed JSON degrades to no-feed (never throws)', async () => {
    const server = await mockFeed('{ not json');
    try {
      const svc = new UpdateService({ currentVersion: '1.0.0', feedUrl: server.url, channel: 'stable' });
      expect((await svc.check()).phase).toBe('no-feed');
    } finally {
      server.close();
    }
  });

  test('a server error degrades to no-feed', async () => {
    const server = await mockFeed(null); // 500
    try {
      const svc = new UpdateService({ currentVersion: '1.0.0', feedUrl: server.url, channel: 'stable' });
      expect((await svc.check()).phase).toBe('no-feed');
    } finally {
      server.close();
    }
  });

  test('offline (unreachable feed) degrades to no-feed', async () => {
    // Nothing is listening on this port.
    const svc = new UpdateService({ currentVersion: '1.0.0', feedUrl: 'http://127.0.0.1:1/feed.json', channel: 'stable' });
    expect((await svc.check()).phase).toBe('no-feed');
  });

  test('without electron-updater, download is a no-op and install is guarded', async () => {
    const server = await mockFeed(feed('1.2.0'));
    try {
      const logs: string[] = [];
      const svc = new UpdateService({
        currentVersion: '1.0.0',
        feedUrl: server.url,
        channel: 'stable',
        loadUpdater: () => null, // simulate an unpackaged build
        log: (_l, m) => logs.push(m),
      });
      await svc.check();
      const status = await svc.download();
      expect(status.canInstall).toBe(false);
      expect(status.release?.version).toBe('1.2.0'); // caller can open release.url manually
      svc.install(); // guarded no-op
      expect(logs.some((m) => m.includes('manual download'))).toBe(true);
    } finally {
      server.close();
    }
  });

  test('a fake updater drives progress → downloaded → install', async () => {
    const server = await mockFeed(feed('1.2.0'));
    try {
      const handlers: Record<string, (arg: unknown) => void> = {};
      let installed = false;
      const fakeUpdater = {
        autoDownload: true,
        on: (event: string, cb: (arg: unknown) => void) => (handlers[event] = cb),
        downloadUpdate: async () => {
          handlers['download-progress']?.({ percent: 42 });
          handlers['update-downloaded']?.(undefined);
        },
        quitAndInstall: () => (installed = true),
      };
      const seen: string[] = [];
      const svc = new UpdateService({
        currentVersion: '1.0.0',
        feedUrl: server.url,
        channel: 'stable',
        loadUpdater: () => fakeUpdater,
      });
      svc.onDidChangeStatus((s) => seen.push(`${s.phase}${s.percent != null ? `:${s.percent}` : ''}`));
      await svc.check();
      const status = await svc.download();
      expect(status.canInstall).toBe(true);
      expect(seen).toContain('downloading:42');
      expect(svc.current().phase).toBe('downloaded');
      svc.install();
      expect(installed).toBe(true);
    } finally {
      server.close();
    }
  });
});
