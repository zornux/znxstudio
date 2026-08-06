import {
  ServiceKeys,
  type DeploymentService,
  type SettingsService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { showArtifactPreview } from './artifactPreview';
import { CI_PROVIDERS, describeCiProvider, generateCiWorkflow, type CiProviderId } from './cicd';

const CI_KEY = 'deploy.ci.provider';

/**
 * CI/CD generator (Phase 13E). Contributes CI workflow generation to the
 * Deployment hub. The provider (GitHub Actions / GitLab CI) is a settings choice;
 * the workflow is pure-generated, previewed, and saved to the right path.
 */
export class CicdModule implements IModule {
  readonly id = 'znxstudio.deploy.cicd';
  readonly displayName = 'CI/CD';

  private context!: ModuleContext;
  private deployment!: DeploymentService;
  private settings!: SettingsService;

  activate(context: ModuleContext): void {
    this.context = context;
    this.deployment = context.services.get<DeploymentService>(ServiceKeys.Deployment);
    this.settings = context.services.get<SettingsService>(ServiceKeys.Settings);

    context.commands.register(CommandIds.CiSelect, () => this.selectProvider(), 'Deploy: Select CI Provider');
    context.commands.register(CommandIds.CiGen, () => this.generate(), 'Deploy: Generate CI Workflow');

    this.deployment.registerAction({ id: 'ci-select', label: 'Select CI Provider', group: 'CI/CD', command: CommandIds.CiSelect });
    this.deployment.registerAction({ id: 'ci-gen', label: 'Generate CI Workflow', group: 'CI/CD', command: CommandIds.CiGen });

    void selfTestCoordinator.run('cicd', () => this.maybeSelfTest());
  }

  private provider(): CiProviderId {
    return (this.settings.get<string>(CI_KEY, 'github') || 'github') as CiProviderId;
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
    title.textContent = 'CI provider';
    box.appendChild(title);
    const current = this.provider();
    for (const p of CI_PROVIDERS) {
      const item = document.createElement('button');
      item.className = `znxstudio-scm-picker-item${p.id === current ? ' is-current' : ''}`;
      item.textContent = `${p.id === current ? '● ' : '   '}${p.label} (${p.filename})`;
      item.addEventListener('click', () => {
        this.settings.set(CI_KEY, p.id);
        overlay.remove();
        this.context.layout.showToast(`CI provider: ${p.label}.`, 'success');
      });
      box.appendChild(item);
    }
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  private generate(): void {
    const id = this.provider();
    const workflow = generateCiWorkflow(id, this.deployment.context());
    showArtifactPreview({
      title: `${describeCiProvider(id).label} workflow`,
      filename: workflow.filename,
      content: workflow.content,
      onSave: () => void this.deployment.saveArtifact(workflow.filename, workflow.content),
    });
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

    const ctx = { projectName: 'demo', root: 'C:/p', entry: 'main.zx', environment: 'production', registry: 'ghcr.io/acme', port: 8080, envVars: {} };
    const gh = generateCiWorkflow('github', ctx);
    const gl = generateCiWorkflow('gitlab', ctx);
    log(`cicd github: file=${gh.filename} hasBuild=${gh.content.includes('zornux build')} hasTest=${gh.content.includes('zornux test')} dockerJob=${gh.content.includes('docker build')}`);
    log(`cicd gitlab: file=${gl.filename} stages=${gl.content.includes('stages:')} installsZornux=${gl.content.includes('install.sh')}`);
  }
}
