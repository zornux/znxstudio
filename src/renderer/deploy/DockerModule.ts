import { ServiceKeys, type DeploymentService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { showArtifactPreview } from './artifactPreview';
import {
  generateDockerfile,
  generateDockerignore,
  imageTag,
  parseDockerImages,
  parseDockerPs,
} from './docker';

/**
 * Docker generator (Phase 13B). Contributes "Generate Dockerfile" / ".dockerignore"
 * to the Deployment hub — previews the pure-generated artifact and saves it into
 * the project. The `docker` CLI (optional, via tool:exec) is used only to report
 * running state; generation itself needs nothing installed.
 */
export class DockerModule implements IModule {
  readonly id = 'znxstudio.deploy.docker';
  readonly displayName = 'Docker';

  private context!: ModuleContext;
  private deployment!: DeploymentService;

  activate(context: ModuleContext): void {
    this.context = context;
    this.deployment = context.services.get<DeploymentService>(ServiceKeys.Deployment);

    context.commands.register(CommandIds.DockerfileGen, () => this.generateDockerfile(), 'Deploy: Generate Dockerfile');
    context.commands.register(CommandIds.DockerignoreGen, () => this.generateDockerignore(), 'Deploy: Generate .dockerignore');

    this.deployment.registerAction({ id: 'dockerfile', label: 'Generate Dockerfile', group: 'Docker', command: CommandIds.DockerfileGen });
    this.deployment.registerAction({ id: 'dockerignore', label: 'Generate .dockerignore', group: 'Docker', command: CommandIds.DockerignoreGen });

    void selfTestCoordinator.run('docker', () => this.maybeSelfTest());
  }

  private generateDockerfile(): void {
    const content = generateDockerfile(this.deployment.context());
    showArtifactPreview({
      title: 'Dockerfile',
      filename: 'Dockerfile',
      content,
      onSave: () => void this.deployment.saveArtifact('Dockerfile', content),
    });
  }

  private generateDockerignore(): void {
    const content = generateDockerignore();
    showArtifactPreview({
      title: '.dockerignore',
      filename: '.dockerignore',
      content,
      onSave: () => void this.deployment.saveArtifact('.dockerignore', content),
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

    const ctx = { projectName: 'demo', root: 'C:/p', entry: 'main.zx', environment: 'production', registry: 'ghcr.io/acme', port: 8080, envVars: { API_KEY: 'x' } };
    const dockerfile = generateDockerfile(ctx);
    const ps = parseDockerPs('abc123\tdemo:latest\tUp 2 minutes\tdemo-web');
    const images = parseDockerImages('ghcr.io/acme/demo\tlatest\tsha123\t120MB');
    log(`docker gen: hasBuild=${dockerfile.includes('zornux build')} exposesPort=${dockerfile.includes('EXPOSE 8080')} hasEnv=${dockerfile.includes('ENV API_KEY')} cmd=${dockerfile.includes('"zornux", "run", "main.zx"')} tag=${imageTag(ctx)}`);
    log(`docker parse: ps=${ps.length}/${ps[0]?.name} images=${images.length}/${images[0]?.repository}`);

    // Optional real docker probe (via allowlisted tool:exec).
    try {
      const version = await window.znxstudio.tool.exec({ tool: 'docker', args: ['--version'], cwd: 'C:/' });
      log(`docker probe: available=${version.code === 0} ${version.code === 0 ? version.stdout.trim() : '(not installed — generation still works)'}`);
    } catch (error) {
      log(`docker probe failed: ${(error as Error).message}`);
    }
  }
}
