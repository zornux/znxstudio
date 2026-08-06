/**
 * Cross-platform shell discovery. This module is pure — it computes the *set of
 * shells worth probing* for a platform and environment, but does not touch the
 * filesystem itself, so it can be unit-tested off Electron. The main process
 * (`TerminalService`) probes each candidate's `paths` with `existsSync` and
 * keeps the ones that are actually installed.
 */

/** A shell the user can launch, resolved to a concrete executable. */
export interface ShellProfile {
  /** Stable id the renderer sends back to request this shell (e.g. `powershell`). */
  id: string;
  /** Human label shown in the UI (e.g. `Windows PowerShell`, `Git Bash`). */
  label: string;
  /** Absolute path to the resolved executable. */
  file: string;
  /** Arguments passed at spawn time. */
  args: string[];
}

/** A shell worth probing, with an ordered list of paths to look for. */
export interface ShellCandidate {
  id: string;
  label: string;
  args: string[];
  /**
   * Ordered absolute paths to probe; the first that exists on disk becomes the
   * profile's `file`. Placeholders (%SystemRoot%, $SHELL, …) are already
   * expanded here.
   */
  paths: string[];
}

type Env = Record<string, string | undefined>;

/** Drop falsy/duplicate paths while preserving order. */
function paths(...entries: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** Join a Windows base dir with a sub-path using backslashes. */
function win(base: string | undefined, sub: string): string | undefined {
  if (!base) return undefined;
  return `${base.replace(/[\\/]+$/, '')}\\${sub}`;
}

function windowsCandidates(env: Env): ShellCandidate[] {
  const sysRoot = env.SystemRoot || env.windir || 'C:\\Windows';
  const sys32 = win(sysRoot, 'System32') as string;
  const pf = env.ProgramFiles || 'C:\\Program Files';
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localApp = env.LOCALAPPDATA;

  return [
    {
      id: 'powershell',
      label: 'Windows PowerShell',
      args: [],
      paths: paths(win(sys32, 'WindowsPowerShell\\v1.0\\powershell.exe')),
    },
    {
      id: 'pwsh',
      label: 'PowerShell',
      args: [],
      paths: paths(
        win(pf, 'PowerShell\\7\\pwsh.exe'),
        win(pf86, 'PowerShell\\7\\pwsh.exe'),
        win(localApp, 'Microsoft\\WindowsApps\\pwsh.exe'),
      ),
    },
    {
      id: 'cmd',
      label: 'Command Prompt',
      args: [],
      paths: paths(win(sys32, 'cmd.exe')),
    },
    {
      id: 'git-bash',
      label: 'Git Bash',
      args: [],
      paths: paths(
        win(pf, 'Git\\bin\\bash.exe'),
        win(pf86, 'Git\\bin\\bash.exe'),
        win(localApp, 'Programs\\Git\\bin\\bash.exe'),
      ),
    },
    {
      id: 'wsl',
      label: 'WSL',
      args: [],
      paths: paths(win(sys32, 'wsl.exe')),
    },
  ];
}

function unixCandidates(env: Env): ShellCandidate[] {
  const shellPath = env.SHELL;
  const shellId = shellPath ? basename(shellPath) : undefined;

  const list: ShellCandidate[] = [];
  // The user's login shell ($SHELL) comes first so it is the default.
  if (shellPath && shellId) {
    list.push({ id: shellId, label: labelFor(shellId), args: [], paths: paths(shellPath) });
  }
  list.push(
    { id: 'zsh', label: 'zsh', args: [], paths: paths('/bin/zsh', '/usr/bin/zsh', '/usr/local/bin/zsh', '/opt/homebrew/bin/zsh') },
    { id: 'bash', label: 'bash', args: [], paths: paths('/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash', '/opt/homebrew/bin/bash') },
    { id: 'fish', label: 'fish', args: [], paths: paths('/usr/bin/fish', '/usr/local/bin/fish', '/opt/homebrew/bin/fish') },
    { id: 'sh', label: 'sh', args: [], paths: paths('/bin/sh', '/usr/bin/sh') },
    { id: 'pwsh', label: 'PowerShell', args: [], paths: paths('/usr/bin/pwsh', '/usr/local/bin/pwsh', '/opt/homebrew/bin/pwsh') },
  );
  return list;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function labelFor(id: string): string {
  switch (id) {
    case 'pwsh':
      return 'PowerShell';
    case 'powershell':
      return 'Windows PowerShell';
    case 'cmd':
      return 'Command Prompt';
    case 'git-bash':
      return 'Git Bash';
    case 'wsl':
      return 'WSL';
    default:
      return id;
  }
}

/**
 * The shells worth probing for a platform/env, in priority order. The first
 * entry is the platform default. Callers probe each candidate's `paths` and
 * keep those that exist.
 */
export function candidateShells(platformName: NodeJS.Platform, env: Env): ShellCandidate[] {
  if (platformName === 'win32') return windowsCandidates(env);
  return unixCandidates(env);
}
