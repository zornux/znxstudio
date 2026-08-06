import { describe, expect, test } from './harness';
import { candidateShells } from '../src/shared/terminal/shells';

describe('shell discovery (pure candidates)', () => {
  test('windows offers powershell, pwsh, cmd, git-bash and wsl', () => {
    const env = {
      SystemRoot: 'C:\\Windows',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    };
    const ids = candidateShells('win32', env).map((c) => c.id);
    expect(ids).toEqual(['powershell', 'pwsh', 'cmd', 'git-bash', 'wsl']);
  });

  test('windows powershell is the default (first) and resolves under System32', () => {
    const cands = candidateShells('win32', { SystemRoot: 'C:\\Windows' });
    expect(cands[0].id).toBe('powershell');
    expect(cands[0].paths[0]).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    const cmd = cands.find((c) => c.id === 'cmd');
    expect(cmd?.paths[0]).toBe('C:\\Windows\\System32\\cmd.exe');
  });

  test('windows falls back to default program-files locations when env is bare', () => {
    const cands = candidateShells('win32', {});
    const pwsh = cands.find((c) => c.id === 'pwsh');
    expect(pwsh?.paths).toContain('C:\\Program Files\\PowerShell\\7\\pwsh.exe');
    const git = cands.find((c) => c.id === 'git-bash');
    expect(git?.paths[0]).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
  });

  test('unix puts $SHELL first as the default and still offers common shells', () => {
    const cands = candidateShells('linux', { SHELL: '/usr/bin/zsh' });
    expect(cands[0].id).toBe('zsh');
    expect(cands[0].paths).toEqual(['/usr/bin/zsh']);
    const ids = cands.map((c) => c.id);
    expect(ids).toContain('bash');
    expect(ids).toContain('fish');
    expect(ids).toContain('sh');
  });

  test('unix without $SHELL leads with zsh then bash and probes homebrew paths', () => {
    const cands = candidateShells('darwin', {});
    expect(cands[0].id).toBe('zsh');
    const bash = cands.find((c) => c.id === 'bash');
    expect(bash?.paths).toContain('/opt/homebrew/bin/bash');
  });

  test('every candidate carries an id, label, args array and at least one path', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
      for (const c of candidateShells(platform, { SHELL: '/bin/bash' })) {
        expect(Boolean(c.id)).toBe(true);
        expect(Boolean(c.label)).toBe(true);
        expect(Array.isArray(c.args)).toBe(true);
        expect(c.paths.length > 0).toBe(true);
      }
    }
  });
});
