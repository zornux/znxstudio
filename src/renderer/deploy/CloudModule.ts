import {
  ServiceKeys,
  type DeploymentService,
  type SettingsService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { showArtifactPreview } from './artifactPreview';
import {
  CLOUD_PROVIDERS,
  buildDeployCommand,
  describeCloudProvider,
  formatDeployCommand,
  generateProviderConfig,
  type CloudProviderId,
} from './cloudProviders';

const PROVIDER_KEY = 'deploy.cloud.provider';

/**
 * Cloud deploy (Phase 13D). Vendor-neutral: the provider is a runtime choice in
 * settings, and each contributes a config generator + a deploy command. No cloud
 * is required. Deploy commands are shown for the user to run (never auto-run —
 * a real cloud deploy is outward-facing).
 */
export class CloudModule implements IModule {
  readonly id = 'znxstudio.deploy.cloud';
  readonly displayName = 'Cloud Deploy';

  private context!: ModuleContext;
  private deployment!: DeploymentService;
  private settings!: SettingsService;

  activate(context: ModuleContext): void {
    this.context = context;
    this.deployment = context.services.get<DeploymentService>(ServiceKeys.Deployment);
    this.settings = context.services.get<SettingsService>(ServiceKeys.Settings);

    context.commands.register(CommandIds.CloudSelect, () => this.selectProvider(), 'Deploy: Select Cloud Provider');
    context.commands.register(CommandIds.CloudConfigGen, () => this.generateConfig(), 'Deploy: Generate Cloud Config');
    context.commands.register(CommandIds.CloudDeployCmd, () => this.showDeployCommand(), 'Deploy: Show Deploy Command');

    this.deployment.registerAction({ id: 'cloud-select', label: 'Select Cloud Provider', group: 'Cloud', command: CommandIds.CloudSelect });
    this.deployment.registerAction({ id: 'cloud-config', label: 'Generate Cloud Config', group: 'Cloud', command: CommandIds.CloudConfigGen });
    this.deployment.registerAction({ id: 'cloud-deploy', label: 'Show Deploy Command', group: 'Cloud', command: CommandIds.CloudDeployCmd });

    void selfTestCoordinator.run('cloud', () => this.maybeSelfTest());
  }

  private provider(): CloudProviderId {
    return (this.settings.get<string>(PROVIDER_KEY, 'none') || 'none') as CloudProviderId;
  }

  private selectProvider(): void {
    const overlay = document.createElement('div');
    overlay.className = 'znxstudio-scm-picker';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    const box = document.createElement('div');
    box.className = 'znxstudio-scm-picker-box';
    const title = document.createElement('div');
    title.className = 'znxstudio-scm-picker-title';
    title.textContent = 'Cloud provider';
    box.appendChild(title);
    const current = this.provider();
    for (const p of CLOUD_PROVIDERS) {
      const item = document.createElement('button');
      item.className = `znxstudio-scm-picker-item${p.id === current ? ' is-current' : ''}`;
      item.innerHTML = `${p.id === current ? '● ' : '   '}<strong>${p.label}</strong> — <span class="znxstudio-muted">${p.blurb}</span>`;
      item.addEventListener('click', () => {
        this.settings.set(PROVIDER_KEY, p.id);
        overlay.remove();
        this.context.layout.showToast(`Cloud provider: ${p.label}.`, 'success');
      });
      box.appendChild(item);
    }
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  private generateConfig(): void {
    const id = this.provider();
    if (id === 'none') {
      this.context.layout.showToast('Select a cloud provider first.', 'info');
      return;
    }
    const config = generateProviderConfig(id, this.deployment.context());
    if (!config) {
      this.context.layout.showToast(`${describeCloudProvider(id).label} deploys from an image/CLI — no config file. Use "Show Deploy Command".`, 'info');
      return;
    }
    showArtifactPreview({
      title: `${describeCloudProvider(id).label} config`,
      filename: config.filename,
      content: config.content,
      onSave: () => void this.deployment.saveArtifact(config.filename, config.content),
    });
  }

  private showDeployCommand(): void {
    const id = this.provider();
    const desc = describeCloudProvider(id);
    const command = buildDeployCommand(id, this.deployment.context());
    if (!command) {
      this.context.layout.showToast(
        id === 'render' ? 'Render deploys on git push — commit the render.yaml Blueprint.' : `${desc.label} has no CLI deploy command configured.`,
        'info',
      );
      return;
    }
    const text = `# Deploy ${this.deployment.context().projectName} to ${desc.label}\n${formatDeployCommand(command)}\n`;
    showArtifactPreview({ title: `${desc.label} deploy command`, filename: 'deploy.sh', content: text });
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

    const ctx = { projectName: 'Demo App', root: 'C:/p', entry: 'main.zx', environment: 'production', registry: 'ghcr.io/acme', port: 8080, envVars: {} };
    const fly = generateProviderConfig('fly', ctx);
    const render = generateProviderConfig('render', ctx);
    const railway = generateProviderConfig('railway', ctx);
    const gcpCmd = buildDeployCommand('gcp', ctx);
    const azureCmd = buildDeployCommand('azure', ctx);
    log(`cloud providers: count=${CLOUD_PROVIDERS.length} fly=${fly?.filename}/${fly?.content.includes('internal_port = 8080')} render=${render?.content.includes('runtime: docker')} railway=${railway?.content.includes('DOCKERFILE')}`);
    log(`cloud deploy cmd: gcp=${gcpCmd ? formatDeployCommand(gcpCmd) : 'null'}`);
    log(`cloud deploy cmd: azure=${azureCmd ? formatDeployCommand(azureCmd) : 'null'} render=${buildDeployCommand('render', ctx)} (expect null → git push)`);
  }
}
