import { describe, expect, test } from './harness';
import {
  defaultShell,
  executableCandidates,
  exeName,
  isCaseSensitiveFs,
  lineEnding,
  parsePathEnv,
  pathListSeparator,
  pathsEqual,
  SUPPORTED_TARGETS,
  toPosixPath,
} from '../src/shared/platform';

describe('platform — filesystem + line endings (20G)', () => {
  test('case sensitivity and line endings per platform', () => {
    expect(isCaseSensitiveFs('linux')).toBe(true);
    expect(isCaseSensitiveFs('win32')).toBe(false);
    expect(isCaseSensitiveFs('darwin')).toBe(false);
    expect(lineEnding('win32')).toBe('\r\n');
    expect(lineEnding('linux')).toBe('\n');
  });

  test('path equality honors the platform case rule', () => {
    expect(pathsEqual('C:\\App\\Main', 'c:/app/main', 'win32')).toBe(true);
    expect(pathsEqual('/App/Main', '/app/main', 'linux')).toBe(false);
    expect(toPosixPath('a\\b\\c')).toBe('a/b/c');
  });
});

describe('platform — executables + PATH (20G)', () => {
  test('exe naming + shell selection', () => {
    expect(exeName('zornux', 'win32')).toBe('zornux.exe');
    expect(exeName('zornux', 'linux')).toBe('zornux');
    expect(defaultShell('win32')).toBe('powershell.exe');
    expect(defaultShell('win32', { COMSPEC: 'C:/cmd.exe' })).toBe('C:/cmd.exe');
    expect(defaultShell('darwin')).toBe('/bin/zsh');
    expect(defaultShell('linux', { SHELL: '/usr/bin/fish' })).toBe('/usr/bin/fish');
  });

  test('PATH parsing + executable candidates per platform', () => {
    expect(pathListSeparator('win32')).toBe(';');
    expect(pathListSeparator('linux')).toBe(':');
    expect(parsePathEnv('C:/a;C:/b;', 'win32')).toEqual(['C:/a', 'C:/b']);
    expect(parsePathEnv('/usr/bin:/bin', 'linux')).toEqual(['/usr/bin', '/bin']);

    expect(executableCandidates('zornux', ['/usr/bin', '/bin/'], 'linux')).toEqual(['/usr/bin/zornux', '/bin/zornux']);
    expect(executableCandidates('zornux', ['C:\\tools'], 'win32')).toEqual(['C:\\tools/zornux.exe']);
  });
});

describe('platform — supported target matrix (20F/20G)', () => {
  test('covers win/mac/linux on x64 + arm64', () => {
    expect(SUPPORTED_TARGETS).toHaveLength(6);
    const key = (p: string, a: string) => SUPPORTED_TARGETS.some((t) => t.platform === p && t.arch === a);
    for (const platform of ['win32', 'darwin', 'linux']) {
      expect(key(platform, 'x64')).toBe(true);
      expect(key(platform, 'arm64')).toBe(true);
    }
  });
});
