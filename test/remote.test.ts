import { describe, expect, test } from './harness';
import type { DeploymentContext } from '../src/renderer/core/Contracts';
import { generateDevContainer, parseSshConfig, sshCommand } from '../src/renderer/deploy/remote';

const CTX: DeploymentContext = {
  projectName: 'demo',
  root: 'C:/p',
  entry: 'main.zx',
  environment: 'production',
  registry: '',
  port: 8080,
  envVars: {},
};

describe('generateDevContainer', () => {
  test('is valid JSON that forwards the port and installs zornux', () => {
    const dc = generateDevContainer(CTX);
    expect(dc.filename).toBe('.devcontainer/devcontainer.json');
    const parsed = JSON.parse(dc.content);
    expect(parsed.name).toBe('demo');
    expect(parsed.forwardPorts).toEqual([8080]);
    expect(parsed.postCreateCommand).toContain('install.sh');
    expect(parsed.remoteEnv.ZORNUX_ENV).toBe('production');
  });
});

describe('parseSshConfig', () => {
  test('parses concrete hosts and skips wildcards', () => {
    const hosts = parseSshConfig(
      ['Host prod', '  HostName 10.0.0.1', '  User deploy', '  Port 2222', '', 'Host *', '  ForwardAgent yes', 'Host staging', '  HostName staging.example.com'].join('\n'),
    );
    expect(hosts).toHaveLength(2);
    expect(hosts[0]).toEqual({ host: 'prod', hostName: '10.0.0.1', user: 'deploy', port: '2222' });
    expect(hosts[1].host).toBe('staging');
  });
  test('ignores comments and blank lines', () => {
    expect(parseSshConfig('# a comment\n\nHost only\n  HostName h')).toHaveLength(1);
  });
});

describe('sshCommand', () => {
  test('builds a user@host command with a non-default port', () => {
    expect(sshCommand({ host: 'prod', hostName: '10.0.0.1', user: 'deploy', port: '2222' })).toBe('ssh -p 2222 deploy@10.0.0.1');
  });
  test('falls back to the host alias and omits port 22', () => {
    expect(sshCommand({ host: 'prod', port: '22' })).toBe('ssh prod');
  });
});
