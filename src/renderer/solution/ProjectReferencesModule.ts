import { ServiceKeys } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import type { WorkspaceInfo } from '../../shared/types';
import { parseZornuxManifest } from './zornuxManifest';
import {
  resolveProjectReferences,
  type ProjectNode,
  type ProjectReferenceGraph,
  type ProjectReferencesService,
} from './projectReferences';
import { examplePath } from '../core/selftestFixtures';

/**
 * Loads each open project's `zornux.project` manifest and resolves the reference
 * graph between them (which project depends on which, plus build order and
 * cycles). Registered as a service so the Solution Explorer (5B) and the coming
 * Dependency Manager (5D) share one source of truth. Reads the same manifest the
 * `zornux` CLI writes, so references never drift from the toolchain.
 */
export class ProjectReferencesModule implements IModule, ProjectReferencesService {
  readonly id = 'znxstudio.projectReferences';
  readonly displayName = 'Project References';

  activate(context: ModuleContext): void {
    context.services.register(ServiceKeys.ProjectReferences, this);
    void selfTestCoordinator.run('project-references', () => this.maybeSelfTest());
  }

  async graphFor(folders: WorkspaceInfo[]): Promise<ProjectReferenceGraph> {
    const nodes = await Promise.all(folders.map((folder) => this.loadNode(folder)));
    return resolveProjectReferences(nodes);
  }

  private async loadNode(folder: WorkspaceInfo): Promise<ProjectNode> {
    const path = `${folder.root.replace(/[\\/]+$/, '')}/zornux.project`;
    let text: string | null = null;
    try {
      text = await window.znxstudio.fs.readFile(path);
    } catch {
      text = null; // no manifest — a plain folder, never a reference target
    }
    if (text === null) {
      return { root: folder.root, name: baseName(folder.root), version: '0.1.0', hasManifest: false, dependencies: [] };
    }
    const manifest = parseZornuxManifest(text);
    return {
      root: folder.root,
      name: manifest.name,
      version: manifest.version,
      hasManifest: true,
      dependencies: manifest.dependencies,
    };
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

    try {
      // Real internal-reference pair: greeter-app depends on the Greetings library.
      const appDir = await examplePath('registry', 'app');
      const libDir = await examplePath('registry', 'greetings');
      if (!appDir || !libDir) {
        log('projectRefs: skipped (no examples root)');
        return;
      }
      const [app, lib] = await Promise.all([
        window.znxstudio.workspace.load(appDir),
        window.znxstudio.workspace.load(libDir),
      ]);
      const graph = await this.graphFor([app, lib]);
      const names = graph.nodes.map((node) => `${baseName(node.root)}→${node.name}`).join(', ');
      log(`projectRefs nodes: [${names}]`);
      const appRefs = graph.references.get(app.root) ?? [];
      const first = appRefs[0];
      log(
        `projectRefs app deps: count=${appRefs.length} first=${first ? `${first.dependency.name} ${first.dependency.constraint}${first.dependency.registry ? ` from ${first.dependency.registry}` : ''} internal=${first.internal} target=${first.targetVersion ?? '-'}` : 'none'}`,
      );
      log(`projectRefs order: [${graph.order.map(baseName).join(' → ')}] cycles=${graph.cycles.length}`);
    } catch (error) {
      log(`projectRefs self-test failed: ${(error as Error).message}`);
    }
  }
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
