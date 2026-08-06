import { ServiceKeys, type DeploymentService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { showArtifactPreview } from './artifactPreview';
import { generateManifests, k8sName, parseKubectlGet } from './kubernetes';

/**
 * Kubernetes generator (Phase 13C). Contributes "Generate K8s Manifests" to the
 * Deployment hub — previews the pure-generated Deployment + Service YAML and
 * saves it to `k8s/manifests.yaml`. The `kubectl` CLI (optional) reports cluster
 * state; generation needs nothing installed.
 */
export class KubernetesModule implements IModule {
  readonly id = 'znxstudio.deploy.kubernetes';
  readonly displayName = 'Kubernetes';

  private context!: ModuleContext;
  private deployment!: DeploymentService;

  activate(context: ModuleContext): void {
    this.context = context;
    this.deployment = context.services.get<DeploymentService>(ServiceKeys.Deployment);

    context.commands.register(CommandIds.K8sManifestGen, () => this.generate(), 'Deploy: Generate Kubernetes Manifests');
    this.deployment.registerAction({ id: 'k8s-manifests', label: 'Generate K8s Manifests', group: 'Kubernetes', command: CommandIds.K8sManifestGen });

    void selfTestCoordinator.run('kubernetes', () => this.maybeSelfTest());
  }

  private generate(): void {
    const content = generateManifests(this.deployment.context());
    showArtifactPreview({
      title: 'Kubernetes manifests',
      filename: 'k8s/manifests.yaml',
      content,
      onSave: () => void this.deployment.saveArtifact('k8s/manifests.yaml', content),
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

    const ctx = { projectName: 'Demo App', root: 'C:/p', entry: 'main.zx', environment: 'production', registry: 'ghcr.io/acme', port: 8080, envVars: { LEVEL: 'high' } };
    const yaml = generateManifests(ctx);
    const pods = parseKubectlGet('NAME        READY   STATUS    RESTARTS   AGE\ndemo-app-1  1/1     Running   0          5m\ndemo-app-2  0/1     Pending   0          3s');
    log(`k8s gen: name=${k8sName(ctx)} hasDeployment=${yaml.includes('kind: Deployment')} hasService=${yaml.includes('kind: Service')} replicas2=${yaml.includes('replicas: 2')} port=${yaml.includes('containerPort: 8080')} env=${yaml.includes('name: LEVEL')}`);
    log(`k8s parse: pods=${pods.length} first=${pods[0]?.name}/${pods[0]?.status} pendingSecond=${pods[1]?.status}`);

    try {
      const version = await window.znxstudio.tool.exec({ tool: 'kubectl', args: ['version', '--client', '-o', 'json'], cwd: 'C:/' });
      log(`k8s kubectl probe: available=${version.code === 0} ${version.code === 0 ? '' : '(not installed — generation still works)'}`);
    } catch (error) {
      log(`k8s kubectl probe failed: ${(error as Error).message}`);
    }
  }
}
