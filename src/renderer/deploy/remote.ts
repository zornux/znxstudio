import type { DeploymentContext } from '../core/Contracts';

/**
 * Remote environments (Phase 13F). Pure: generate a `.devcontainer/devcontainer.json`
 * (Codespaces / VS Code Remote / local dev containers) that installs the Zornux
 * toolchain, and parse `~/.ssh/config` into hosts the IDE can offer to connect to.
 * All string work, unit-tested.
 */

/** Generate a devcontainer.json for the project. */
export function generateDevContainer(context: DeploymentContext): { filename: string; content: string } {
  const config = {
    name: context.projectName,
    image: 'mcr.microsoft.com/devcontainers/base:bookworm',
    features: {
      'ghcr.io/devcontainers/features/common-utils:2': {},
    },
    forwardPorts: [context.port],
    postCreateCommand: 'curl -fsSL https://zornux.dev/install.sh | sh',
    remoteEnv: {
      PATH: '${containerEnv:PATH}:/root/.zornux/bin',
      ZORNUX_ENV: context.environment,
    },
    customizations: {
      vscode: { extensions: [] as string[] },
    },
  };
  return { filename: '.devcontainer/devcontainer.json', content: `${JSON.stringify(config, null, 2)}\n` };
}

export interface SshHost {
  host: string;
  hostName?: string;
  user?: string;
  port?: string;
}

/** Parse an OpenSSH `~/.ssh/config` into concrete hosts (skips wildcard `Host *`). */
export function parseSshConfig(text: string): SshHost[] {
  const hosts: SshHost[] = [];
  let current: SshHost | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(\S+)\s+(.+)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === 'host') {
      if (current) hosts.push(current);
      current = value.includes('*') || value.includes('?') ? null : { host: value.split(/\s+/)[0] };
    } else if (current) {
      if (key === 'hostname') current.hostName = value;
      else if (key === 'user') current.user = value;
      else if (key === 'port') current.port = value;
    }
  }
  if (current) hosts.push(current);
  return hosts;
}

/** A copy-pasteable `ssh` command for a host. */
export function sshCommand(host: SshHost): string {
  const target = host.user && host.hostName ? `${host.user}@${host.hostName}` : host.host;
  const port = host.port && host.port !== '22' ? ` -p ${host.port}` : '';
  return `ssh${port} ${target}`;
}
