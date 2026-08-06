import { describe, expect, test } from './harness';
import {
  bestRelease,
  buildReleaseManifest,
  channelForVersion,
  checkForUpdate,
  compareSemVer,
  eligibleChannels,
  parseSemVer,
  parseUpdateFeed,
  verifyChecksum,
} from '../src/shared/update';

const FEED = {
  channels: {
    stable: { version: '1.0.0', url: 'https://dl/z-1.0.0.exe', sha512: 'AAA', size: 100, notes: 'ga' },
    preview: { version: '1.1.0-rc.2', url: 'https://dl/z-1.1.0-rc.2.exe', sha512: 'BBB' },
    nightly: { version: '1.2.0-nightly.5', url: 'https://dl/z-nightly.exe', sha512: 'CCC' },
  },
};

describe('update — semver (20F)', () => {
  test('parses and rejects', () => {
    expect(parseSemVer('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null });
    expect(parseSemVer('v1.0.0-rc.2')?.prerelease).toBe('rc.2');
    expect(parseSemVer('nope')).toBeNull();
  });

  test('compares, with a final release outranking its prerelease', () => {
    expect(compareSemVer('1.0.0', '0.9.9')).toBe(1);
    expect(compareSemVer('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemVer('1.0.0-rc.1', '1.0.0-rc.2')).toBe(-1);
    expect(compareSemVer('1.0.0', '1.0.0-rc.9')).toBe(1); // release > prerelease
    expect(compareSemVer('1.2.0-nightly.5', '1.1.0-rc.2')).toBe(1);
  });
});

describe('update — channels (20F)', () => {
  test('eligibility widens with risk tolerance', () => {
    expect(eligibleChannels('stable')).toEqual(['stable']);
    expect(eligibleChannels('preview')).toEqual(['stable', 'preview']);
    expect(eligibleChannels('nightly')).toEqual(['stable', 'preview', 'nightly']);
  });

  test('bestRelease picks the newest across eligible channels', () => {
    const feed = parseUpdateFeed(FEED);
    expect(bestRelease(feed, 'stable')?.version).toBe('1.0.0');
    expect(bestRelease(feed, 'preview')?.version).toBe('1.1.0-rc.2');
    expect(bestRelease(feed, 'nightly')?.version).toBe('1.2.0-nightly.5');
  });
});

describe('update — feed parsing is tolerant (20F)', () => {
  test('drops incomplete releases and never throws on junk', () => {
    expect(parseUpdateFeed(null)).toEqual({});
    expect(parseUpdateFeed('garbage')).toEqual({});
    expect(parseUpdateFeed({ channels: { stable: { version: '1.0.0' } } })).toEqual({}); // no url/sha512
    expect(parseUpdateFeed({ channels: { stable: { version: 'bad', url: 'u', sha512: 's' } } })).toEqual({});
    const ok = parseUpdateFeed({ channels: { stable: { version: '2.0.0', url: 'u', sha512: 's' } } });
    expect(ok.stable?.version).toBe('2.0.0');
  });
});

describe('update — check + checksum (20F)', () => {
  const feed = parseUpdateFeed(FEED);

  test('detects an available update, up-to-date, and an empty feed', () => {
    expect(checkForUpdate('0.9.0', feed, 'stable')).toEqual({ available: true, release: feed.stable!, reason: 'update-available' });
    expect(checkForUpdate('1.0.0', feed, 'stable').reason).toBe('up-to-date');
    expect(checkForUpdate('1.0.0', {}, 'stable')).toEqual({ available: false, release: null, reason: 'no-feed' });
  });

  test('a preview user on 1.0.0 sees the rc; a stable user does not', () => {
    expect(checkForUpdate('1.0.0', feed, 'preview').available).toBe(true);
    expect(checkForUpdate('1.0.0', feed, 'stable').available).toBe(false);
  });

  test('checksum verification is case-insensitive and rejects empty/mismatch', () => {
    expect(verifyChecksum('ABCDEF', 'abcdef')).toBe(true);
    expect(verifyChecksum('abc', 'abd')).toBe(false);
    expect(verifyChecksum('', '')).toBe(false);
  });
});

describe('update — channel derivation + release manifest (20F)', () => {
  test('version → channel', () => {
    expect(channelForVersion('1.0.0')).toBe('stable');
    expect(channelForVersion('1.1.0-rc.2')).toBe('preview');
    expect(channelForVersion('1.0.0-beta.1')).toBe('preview');
    expect(channelForVersion('1.2.0-nightly.20260110')).toBe('nightly');
  });

  test('manifest sorts files, derives the channel, and keeps the injected date', () => {
    const manifest = buildReleaseManifest({
      product: 'ZnxStudio',
      version: '1.1.0-rc.2',
      releaseDate: '2026-07-10T00:00:00Z',
      artifacts: [
        { name: 'ZnxStudio-1.1.0-rc.2.exe', sha512: 'X', size: 90 },
        { name: 'ZnxStudio-1.1.0-rc.2-portable.exe', sha512: 'Y', size: 80 },
      ],
    });
    expect(manifest.channel).toBe('preview');
    expect(manifest.releaseDate).toBe('2026-07-10T00:00:00Z');
    expect(manifest.files.map((f) => f.name)).toEqual([
      'ZnxStudio-1.1.0-rc.2-portable.exe',
      'ZnxStudio-1.1.0-rc.2.exe',
    ]);
  });
});
