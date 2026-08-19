/**
 * Agent execution policy — pure logic for deciding what the AI agent can and
 * cannot do. Imported by renderer (approval UI), main (enforcement), and tests.
 * No I/O, no Node/Electron dependencies.
 */

/** Request the renderer sends to main via the AgentExec IPC channel. */
export interface AgentExecRequest {
  command: string;
  args: string[];
  cwd: string;
  /** Renderer-assigned id so the caller can match cancellation. */
  execId: string;
  /** Maximum wall-clock milliseconds before the process is killed. */
  timeoutMs?: number;
  /** Maximum bytes of combined stdout+stderr captured. */
  maxOutputBytes?: number;
  /** Set to true after the user has explicitly approved a needs_approval command. */
  approved?: boolean;
}

/** Response from the main process after execution completes. */
export interface AgentExecResult {
  execId: string;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** True when the process was killed due to timeout. */
  timedOut: boolean;
  /** True when the process was killed via cancellation. */
  cancelled: boolean;
  /** True when output was truncated at maxOutputBytes. */
  truncated: boolean;
  durationMs: number;
  error?: string;
}

export const AGENT_EXEC_DEFAULTS = {
  timeoutMs: 30_000,
  maxOutputBytes: 256 * 1024,
} as const;

// ---------------------------------------------------------------------------
// Command safety policy
// ---------------------------------------------------------------------------

const ALLOWED_COMMANDS = new Set([
  'zornux', 'node', 'npm', 'npx', 'git', 'cat', 'ls', 'dir', 'echo',
  'find', 'grep', 'head', 'tail', 'wc', 'sort', 'diff', 'pwd', 'which',
  'tsc', 'eslint', 'prettier', 'cargo', 'rustc', 'python', 'python3',
]);

const BLOCKED_EXECUTABLES = new Set([
  'rm', 'rmdir', 'del', 'mkfs', 'dd', 'fdisk', 'format',
  'shutdown', 'reboot', 'halt', 'poweroff', 'init',
  'curl', 'wget', 'ssh', 'scp', 'rsync', 'ftp', 'telnet', 'nc', 'ncat',
  'sudo', 'su', 'doas', 'pkexec', 'runas',
  'chmod', 'chown', 'chgrp', 'chattr',
  'mount', 'umount', 'losetup',
  'iptables', 'ip6tables', 'nft', 'ufw', 'firewall-cmd',
  'systemctl', 'service', 'launchctl',
  'docker', 'podman', 'kubectl',
  'env', 'export', 'unset', 'set',
  'sh', 'bash', 'zsh', 'csh', 'ksh', 'fish', 'dash',
  'cmd', 'powershell', 'pwsh',
]);

const DANGEROUS_ARGUMENT_PATTERNS = [
  /--force\b/i,
  /--hard\b/i,
  /--no-verify\b/i,
  /\brm\s+-r/i,
  /\bgit\s+push\s+.*--force/i,
  /\bgit\s+push\s+-f\b/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+clean\b/i,
  /\bgit\s+checkout\s+\./i,
  /\bdrop\s+(table|database)\b/i,
  /\btruncate\b/i,
  /\bkill\s+-9\b/i,
  /\bkillall\b/i,
  />\s*\/dev\/sd/i,
  /\|\s*sh\b/i,
  /\|\s*bash\b/i,
  /\bnpm\s+publish\b/i,
  /\bcargo\s+publish\b/i,
  /\bgit\s+push\b/i,
];

export type CommandVerdict = 'allowed' | 'needs_approval' | 'blocked';

export interface CommandPolicy {
  verdict: CommandVerdict;
  reason: string;
}

const SHELL_METACHARACTERS = /[;`|&$]|\$\(|\)\s*[|&]/;

/** Determine whether an agent command is allowed, needs approval, or blocked. */
export function classifyCommand(command: string, args: string[]): CommandPolicy {
  const exe = extractExecutable(command);

  if (BLOCKED_EXECUTABLES.has(exe)) {
    return { verdict: 'blocked', reason: `Executable '${exe}' is not permitted for agent use.` };
  }

  const fullCmd = [command, ...args].join(' ');

  if (SHELL_METACHARACTERS.test(fullCmd)) {
    return { verdict: 'blocked', reason: 'Shell metacharacters (;, |, &, $, `) are not allowed.' };
  }

  for (const pattern of DANGEROUS_ARGUMENT_PATTERNS) {
    if (pattern.test(fullCmd)) {
      return { verdict: 'blocked', reason: `Command matches dangerous pattern: ${pattern.source}` };
    }
  }

  if (ALLOWED_COMMANDS.has(exe)) {
    if (isReadOnlyCommand(exe, args)) {
      return { verdict: 'allowed', reason: `'${exe}' with read-only arguments is auto-approved.` };
    }
    return { verdict: 'needs_approval', reason: `'${exe}' requires user approval for this operation.` };
  }

  return { verdict: 'needs_approval', reason: `Unknown command '${exe}' requires user approval.` };
}

function extractExecutable(command: string): string {
  const parts = command.trim().split(/[\s/\\]+/);
  const last = parts[parts.length - 1];
  return last.replace(/\.(exe|bat|cmd|com|ps1|sh)$/i, '').toLowerCase();
}

function isReadOnlyCommand(exe: string, args: string[]): boolean {
  const readOnlyExes = new Set(['cat', 'ls', 'dir', 'echo', 'head', 'tail', 'wc', 'sort', 'pwd', 'which', 'find', 'grep', 'diff']);
  if (readOnlyExes.has(exe)) return true;

  if (exe === 'git') {
    const sub = args[0]?.toLowerCase();
    const readOnlyGit = new Set(['status', 'log', 'diff', 'show', 'branch', 'remote', 'rev-parse', 'ls-files', 'blame']);
    return sub !== undefined && readOnlyGit.has(sub);
  }
  if (exe === 'zornux') {
    const sub = args[0]?.toLowerCase();
    return sub === 'check' || sub === 'info' || sub === 'version';
  }
  return false;
}

// ---------------------------------------------------------------------------
// Workspace confinement (pure path checks — no I/O)
// ---------------------------------------------------------------------------

function normalizePath(p: string): string {
  let out = p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (typeof process !== 'undefined' && process.platform === 'win32') out = out.toLowerCase();
  return out;
}

/** Check if a target path is inside one of the allowed roots. */
export function isPathConfined(target: string, roots: readonly string[]): boolean {
  if (roots.length === 0) return true;
  const norm = normalizePath(target);
  return roots.some((root) => {
    const r = normalizePath(root);
    return norm === r || norm.startsWith(r + '/');
  });
}

/** Reject path traversal attempts in agent-proposed paths. */
export function hasPathTraversal(path: string): boolean {
  const segments = path.replace(/\\/g, '/').split('/');
  return segments.some((s) => s === '..' || s === '~');
}

/** Files that must never be read into AI context or command output. */
const SENSITIVE_FILE_PATTERNS = [
  /\.env$/i,
  /\.env\.\w+$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.jks$/i,
  /\.keystore$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.ssh\//i,
  /credentials\.json$/i,
  /credentials$/i,
  /service[_-]?account.*\.json$/i,
  /\.npmrc$/i,
  /\.pypirc$/i,
  /\.netrc$/i,
  /\.git\/config$/i,
  /\.htpasswd$/i,
  /\.docker\/config\.json$/i,
  /kubeconfig/i,
  /\.kube\/config$/i,
  /\.aws\/credentials$/i,
  /\.pgpass$/i,
  /\.bash_history$/i,
  /\.zsh_history$/i,
  /terraform\.tfstate/i,
  /\.gnupg\//i,
  /token\.json$/i,
];

export function isSensitiveFile(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return SENSITIVE_FILE_PATTERNS.some((p) => p.test(normalized));
}

// ---------------------------------------------------------------------------
// Secret filtering (extends the basic filterSecrets from context.ts)
// ---------------------------------------------------------------------------

const ENV_SECRET_KEYS = [
  'api_key', 'apikey', 'api_secret', 'secret_key', 'access_key',
  'private_key', 'client_secret', 'password', 'passwd', 'token',
  'auth_token', 'bearer', 'credential', 'signing_key', 'encryption_key',
  'database_url', 'connection_string', 'jwt_secret',
];

const ENV_SECRET_PATTERN = new RegExp(
  `(${ENV_SECRET_KEYS.join('|')})\\s*[:=]\\s*['"]?[^\\s'"]{4,}['"]?`,
  'gi',
);

/** Filter secrets from command output before feeding it back to the AI. */
export function filterCommandOutput(output: string): string {
  return output
    .replace(/(['"])[A-Za-z0-9+/=_-]{32,}(['"])/g, '$1[REDACTED]$2')
    .replace(ENV_SECRET_PATTERN, (_match, key: string) => `${key}=[REDACTED]`)
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '[REDACTED CERTIFICATE]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{20,}/gi, '$1[REDACTED]')
    .replace(/(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}/g, '[REDACTED]')
    .replace(/(sk-|pk_live_|pk_test_|sk_live_|sk_test_)[A-Za-z0-9]{20,}/g, '[REDACTED]')
    .replace(/AKIA[A-Z0-9]{16}/g, '[REDACTED]');
}

/** Filter environment variables, removing sensitive entries before passing to a child process. */
export function sanitizeEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  const sensitiveKeys = new Set(ENV_SECRET_KEYS.map((k) => k.toUpperCase()));
  for (const [key, value] of Object.entries(env)) {
    const upper = key.toUpperCase();
    if (sensitiveKeys.has(upper) || upper.includes('SECRET') || upper.includes('TOKEN') ||
        upper.includes('PASSWORD') || upper.includes('CREDENTIAL') || upper.includes('PRIVATE_KEY') ||
        upper.includes('API_KEY') || upper.includes('APIKEY')) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Output truncation
// ---------------------------------------------------------------------------

export function truncateOutput(output: string, maxBytes: number): { text: string; truncated: boolean } {
  if (maxBytes <= 0) return { text: '', truncated: output.length > 0 };
  if (output.length <= maxBytes) return { text: output, truncated: false };
  const head = output.slice(0, maxBytes * 0.6);
  const tail = output.slice(-maxBytes * 0.3);
  const skipped = output.length - head.length - tail.length;
  return {
    text: `${head}\n\n… (${skipped} characters omitted) …\n\n${tail}`,
    truncated: true,
  };
}

// ---------------------------------------------------------------------------
// Parse a single command string into executable + args
// ---------------------------------------------------------------------------

export function parseCommandString(raw: string): { command: string; args: string[] } {
  const trimmed = raw.trim();
  const parts: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if ((ch === ' ' || ch === '\t') && !inSingle && !inDouble) {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) parts.push(current);

  return { command: parts[0] ?? '', args: parts.slice(1) };
}
