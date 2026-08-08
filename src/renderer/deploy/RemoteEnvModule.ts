import { ServiceKeys, type DeploymentService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { joinPath } from '../explorer/paths';
import { showArtifactPreview } from './artifactPreview';
import { generateDevContainer, parseSshConfig, sshCommand, type SshHost } from './remote';

/**
 * Remote environments (Phase 13F — the Phase 13 finale). Generates a
 * devcontainer.json for Codespaces / VS Code Remote / local containers, and
 * lists SSH hosts parsed from `~/.ssh/config` with copy-able connect commands.
 * Generation is pure; the host list is read-only.
 */
export class RemoteEnvModule implements IModule {
  readonly id = 'znxstudio.deploy.remote';
  readonly displayName = 'Remote Environments';

  private context!: ModuleContext;
  private deployment!: DeploymentService;
  private panel!: HTMLElement;
  private hosts: SshHost[] = [];
  private loaded = false;
  private generateButton: HTMLButtonElement | undefined;

  activate(context: ModuleContext): void {
    this.context = context;
    this.deployment = context.services.get<DeploymentService>(ServiceKeys.Deployment);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-remote';
    context.layout.addPanelView({ id: 'remote-envs', title: 'Remote', element: this.panel });

    context.commands.register(CommandIds.DevContainerGen, () => this.generateDevContainer(), 'Deploy: Generate Dev Container');
    context.commands.register(CommandIds.RemoteShow, () => this.reveal(), 'Remote: Show Environments');
    const workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    context.subscriptions.push(
      context.commands.addEnablementRule((id) =>
        id === CommandIds.DevContainerGen ? workspace.currentFolder() !== null : undefined,
      ),
      context.commands.onDidChangeEnablement(() => this.refreshCommandState()),
    );
    workspace.onDidChangeWorkspace(() => context.commands.notifyEnablementChanged());
    this.deployment.registerAction({ id: 'devcontainer', label: 'Generate Dev Container', group: 'Remote', command: CommandIds.DevContainerGen });

    this.render();
    void selfTestCoordinator.run('remote', () => this.maybeSelfTest());
  }

  private reveal(): void {
    this.context.layout.showPanelView('remote-envs');
    void this.loadHosts();
  }

  private generateDevContainer(): void {
    const artifact = generateDevContainer(this.deployment.context());
    showArtifactPreview({
      title: 'Dev Container',
      filename: artifact.filename,
      content: artifact.content,
      onSave: () => void this.deployment.saveArtifact(artifact.filename, artifact.content),
    });
  }

  private async loadHosts(): Promise<void> {
    try {
      const home = (await window.znxstudio.app.getInfo()).homeDir;
      const text = await window.znxstudio.fs.readFile(joinPath(joinPath(home, '.ssh'), 'config'));
      this.hosts = parseSshConfig(text);
    } catch {
      this.hosts = [];
    }
    this.loaded = true;
    this.render();
  }

  private render(): void {
    this.panel.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-remote-toolbar';
    const gen = document.createElement('button');
    gen.className = 'znxstudio-btn-small';
    gen.textContent = 'Generate Dev Container';
    this.generateButton = gen;
    gen.addEventListener('click', () => {
      if (this.context.commands.isEnabled(CommandIds.DevContainerGen)) {
        this.context.commands.executeFromUi(CommandIds.DevContainerGen);
      }
    });
    const refresh = document.createElement('button');
    refresh.className = 'znxstudio-btn-small';
    refresh.textContent = '⟳ SSH Hosts';
    refresh.addEventListener('click', () => void this.loadHosts());
    toolbar.append(gen, refresh);
    this.refreshCommandState();
    this.panel.appendChild(toolbar);

    const section = document.createElement('div');
    section.className = 'znxstudio-remote-section';
    section.textContent = 'SSH Hosts (~/.ssh/config)';
    this.panel.appendChild(section);

    if (!this.loaded) {
      this.panel.appendChild(this.message('Click "SSH Hosts" to load configured hosts.'));
      return;
    }
    if (this.hosts.length === 0) {
      this.panel.appendChild(this.message('No hosts found in ~/.ssh/config.'));
      return;
    }
    for (const host of this.hosts) {
      const row = document.createElement('div');
      row.className = 'znxstudio-remote-host';
      const name = document.createElement('span');
      name.className = 'znxstudio-remote-name';
      name.textContent = host.host;
      const detail = document.createElement('span');
      detail.className = 'znxstudio-remote-detail';
      detail.textContent = [host.user && host.hostName ? `${host.user}@${host.hostName}` : host.hostName, host.port && host.port !== '22' ? `:${host.port}` : ''].filter(Boolean).join('');
      const copy = document.createElement('button');
      copy.className = 'znxstudio-btn-small';
      copy.textContent = 'Copy ssh';
      copy.addEventListener('click', () => {
        void navigator.clipboard?.writeText(sshCommand(host));
        this.context.layout.showToast(`Copied: ${sshCommand(host)}`, 'success');
      });
      row.append(name, detail, copy);
      this.panel.appendChild(row);
    }
  }

  private refreshCommandState(): void {
    if (this.generateButton) {
      this.generateButton.disabled = !this.context.commands.isEnabled(CommandIds.DevContainerGen);
      this.generateButton.title = this.generateButton.disabled
        ? 'Open a folder to generate a Dev Container'
        : 'Generate a Dev Container configuration';
    }
  }

  private message(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-remote-empty';
    el.textContent = text;
    return el;
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    const ctx = { projectName: 'demo', root: 'C:/p', entry: 'main.zx', environment: 'production', registry: '', port: 8080, envVars: {} };
    const dc = generateDevContainer(ctx);
    const parsed = JSON.parse(dc.content);
    const sample = parseSshConfig('Host prod\n  HostName 10.0.0.1\n  User deploy\n  Port 2222\nHost *\n  ForwardAgent yes');
    log(`remote devcontainer: file=${dc.filename} name=${parsed.name} port=${parsed.forwardPorts[0]} installs=${dc.content.includes('install.sh')}`);
    log(`remote ssh parse: hosts=${sample.length} (wildcard skipped) first=${sample[0]?.host} cmd=${sample[0] ? sshCommand(sample[0]) : ''}`);

    // Optional: read the real ~/.ssh/config if present.
    try {
      const home = (await window.znxstudio.app.getInfo()).homeDir;
      const text = await window.znxstudio.fs.readFile(joinPath(joinPath(home, '.ssh'), 'config'));
      log(`remote real ssh: config found, hosts=${parseSshConfig(text).length}`);
    } catch {
      log('remote real ssh: no ~/.ssh/config (parse verified on sample)');
    }
  }
}
