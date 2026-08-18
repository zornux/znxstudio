import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from './harness';
// The release policy intentionally stays executable by plain Node in CI.
// @ts-expect-error JavaScript build utility has no generated declaration file.
import { releasePolicy } from '../build/release-policy.mjs';

function policy(refType: string, refName: string) {
  return spawnSync(process.execPath, ['build/release-policy.mjs', refType, refName], { encoding: 'utf8' });
}

describe('release publishing policy', () => {
  test('ships electron-updater as an application dependency', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Boolean(pkg.dependencies?.['electron-updater'])).toBe(true);
    expect(Boolean(pkg.devDependencies?.['electron-updater'])).toBe(false);
  });

  test('classifies final SemVer as a stable release', () => {
    expect(releasePolicy('1.2.0', 'tag', 'v1.2.0')).toEqual({
      publish: true,
      prerelease: false,
      releaseType: 'release',
      updateChannel: 'latest',
    });
  });

  test('classifies the current package version correctly via the CLI', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    const result = policy('tag', `v${pkg.version}`);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('publish=true');
    const isPrerelease = pkg.version.includes('-');
    expect(result.stdout).toContain(`release_type=${isPrerelease ? 'prerelease' : 'release'}`);
  });

  test('isolates nightly metadata from release-candidate metadata', () => {
    expect(releasePolicy('1.2.0-nightly.7', 'tag', 'v1.2.0-nightly.7').updateChannel).toBe('nightly');
    expect(releasePolicy('1.2.0-beta.2', 'tag', 'v1.2.0-beta.2').updateChannel).toBe('rc');
  });

  test('refuses a tag that differs from package.json', () => {
    const result = policy('tag', 'v9.9.9');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not match package version');
  });

  test('manual dispatch builds without publishing', () => {
    const result = policy('branch', 'main');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('publish=false');
  });
});
