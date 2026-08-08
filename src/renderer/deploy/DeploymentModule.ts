import {
  ServiceKeys,
  type ArtifactSaveResult,
  type DeployAction,
  type DeploymentContext,
  type DeploymentService,
  type InputBoxService,
  type QuickPickService,
  type SettingsService,
  type WorkspaceService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import {
  defaultProfile,
  parseDeploymentProfiles,
  validateProfile,
  type DeployTarget,
  type DeploymentProfile,
} from './profiles';

const PROFILES_KEY = 'deploy.profiles';
const ACTIVE_KEY = 'deploy.activeProfile';

/**
 * Deployment hub (Phase 13A). Owns deployment profiles + project context and
 * saves generated artifacts into the workspace. Publishes DeploymentService —
 * the seam the 13B–13F generators plug their actions into.
 */
export class DeploymentModule implements IModule, DeploymentService {
  readonly id = 'znxstudio.deployment';
  readonly displayName = 'Deployment';

  private moduleContext!: ModuleContext;
  private settings!: SettingsService;
  private workspace!: WorkspaceService;
  private view!: HTMLElement;
  private profileList: DeploymentProfile[] = [];
  private activeId = '';
  private creatingProfile = false;
  private readonly registeredActions: DeployAction[] = [];
  private readonly actionButtons = new Map<string, HTMLButtonElement>();
  private readonly changeEmitter = new Emitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.settings = context.services.get<SettingsService>(ServiceKeys.Settings);
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);

    this.load();
    context.services.register(ServiceKeys.Deployment, this);
    context.subscriptions.push(
      context.commands.onDidChangeEnablement(() => this.refreshActionButtons()),
    );

    this.view = document.createElement('div');
    this.view.className = 'znxstudio-deploy';
    context.layout.addActivityItem({ id: 'deploy', label: 'Deployment', icon: '🚀', onSelect: () => this.reveal() });
    context.commands.register(CommandIds.DeployShow, () => this.reveal(), 'Deployment: Show');
    context.commands.register(CommandIds.DeployNewProfile, () => this.newProfilePrompt(), 'Deployment: New Profile');
    context.commands.addEnablementRule((id) => id === CommandIds.DeployNewProfile ? !this.creatingProfile : undefined);

    this.settings.onDidChange((event) => {
      if (event.key === PROFILES_KEY || event.key === ACTIVE_KEY) {
        this.load();
        this.render();
        this.changeEmitter.fire();
      }
    });
    this.workspace.onDidChangeWorkspace(() => this.render());

    this.render();
    void selfTestCoordinator.run('deployment', () => this.maybeSelfTest());
  }

  private load(): void {
    this.profileList = parseDeploymentProfiles(this.settings.get<unknown[]>(PROFILES_KEY, []));
    this.activeId = this.settings.get<string>(ACTIVE_KEY, '');
    if (this.profileList.length && !this.profileList.some((p) => p.id === this.activeId)) {
      this.activeId = this.profileList[0].id;
    }
  }

  private persist(): void {
    this.settings.set(PROFILES_KEY, this.profileList);
    this.settings.set(ACTIVE_KEY, this.activeId);
    this.changeEmitter.fire();
  }

  /* ----- DeploymentService ----- */
  profiles(): DeploymentProfile[] {
    return this.profileList;
  }
  active(): DeploymentProfile | null {
    return this.profileList.find((p) => p.id === this.activeId) ?? this.profileList[0] ?? null;
  }
  setActive(id: string): void {
    this.activeId = id;
    this.persist();
    this.render();
  }
  addProfile(profile: DeploymentProfile): void {
    this.profileList = [...this.profileList.filter((p) => p.id !== profile.id), profile];
    this.activeId = profile.id;
    this.persist();
    this.render();
  }
  removeProfile(id: string): void {
    this.profileList = this.profileList.filter((p) => p.id !== id);
    if (this.activeId === id) this.activeId = this.profileList[0]?.id ?? '';
    this.persist();
    this.render();
  }

  context(): DeploymentContext {
    const root = this.workspace.currentFolder();
    const project = this.workspace.currentWorkspace()?.project;
    const projectName = project?.name?.trim() || (root ? root.replace(/[\\/]+$/, '').split(/[\\/]/).pop()! : 'app');
    const active = this.active();
    return {
      projectName,
      root,
      entry: 'main.zx',
      environment: active?.environment ?? 'production',
      registry: active?.registry ?? '',
      port: Number(this.settings.get('deploy.port', 8080)) || 8080,
      envVars: active?.envVars ?? {},
    };
  }

  async saveArtifact(relPath: string, content: string): Promise<ArtifactSaveResult> {
    const root = this.workspace.currentFolder();
    if (!root) return { ok: false, error: 'Open a folder to save deployment artifacts.' };
    const abs = `${root.replace(/[\\/]+$/, '')}/${relPath}`;
    try {
      await window.znxstudio.fs.writeFile(abs, content);
      this.moduleContext.layout.showToast(`Saved ${relPath}.`, 'success');
      return { ok: true, path: abs };
    } catch (error) {
      this.moduleContext.layout.showToast(`Save failed: ${(error as Error).message}`, 'error');
      return { ok: false, error: (error as Error).message };
    }
  }

  registerAction(action: DeployAction): void {
    this.registeredActions.push(action);
    if (this.view) this.render();
  }
  actions(): DeployAction[] {
    return this.registeredActions;
  }

  /* ----- UI ----- */
  private reveal(): void {
    this.render();
    this.moduleContext.layout.setSideBar('Deployment', this.view);
    this.moduleContext.layout.focusSideBar();
  }

  private async newProfilePrompt(): Promise<void> {
    if (this.creatingProfile) return;
    this.creatingProfile = true;
    this.moduleContext.commands.notifyEnablementChanged();
    this.render();
    try {
      const input = this.moduleContext.services.get<InputBoxService>(ServiceKeys.InputBox);
      const picker = this.moduleContext.services.get<QuickPickService>(ServiceKeys.QuickPick);
      const value = await input.prompt({
        title: 'New Deployment Profile',
        label: 'Profile name',
        value: 'production',
        placeholder: 'For example: production or staging',
        submitLabel: 'Choose Target',
        validate: (candidate) => {
          const profile = defaultProfile(candidate.trim());
          const invalid = validateProfile(profile);
          if (invalid) return invalid;
          return this.profileList.some((entry) => entry.id === profile.id)
            ? 'A profile with this name already exists.'
            : null;
        },
      });
      if (value === null) return;
      const name = value.trim();

      const target = await picker.pick<DeployTarget>([
        { label: 'Docker', description: 'Generate a container image configuration', value: 'docker' },
        { label: 'Kubernetes', description: 'Generate Kubernetes deployment resources', value: 'kubernetes' },
        { label: 'Cloud', description: 'Configure a managed cloud deployment', value: 'cloud' },
        { label: 'Static', description: 'Publish prebuilt static files', value: 'static' },
      ], { placeholder: 'Select a deployment target' });
      if (target === undefined) return;

      const profile = defaultProfile(name, target);
      const invalid = validateProfile(profile);
      if (invalid) {
        this.moduleContext.layout.showToast(invalid, 'error');
        return;
      }
      this.addProfile(profile);
      this.moduleContext.layout.showToast(`Created deployment profile “${profile.name}”.`, 'success');
    } catch (error) {
      this.moduleContext.layout.showToast(`Could not create deployment profile: ${(error as Error).message}`, 'error');
    } finally {
      this.creatingProfile = false;
      this.moduleContext.commands.notifyEnablementChanged();
      this.render();
    }
  }

  private render(): void {
    if (!this.view) return;
    this.actionButtons.clear();
    this.view.replaceChildren();

    const context = this.context();
    const header = document.createElement('div');
    header.className = 'znxstudio-deploy-header';
    header.textContent = `🚀 ${context.projectName}`;
    this.view.appendChild(header);

    // Active profile selector.
    if (this.profileList.length) {
      const row = document.createElement('div');
      row.className = 'znxstudio-deploy-active';
      const label = document.createElement('span');
      label.textContent = 'Profile';
      const select = document.createElement('select');
      select.className = 'znxstudio-select';
      select.setAttribute('aria-label', 'Active deployment profile');
      for (const profile of this.profileList) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = `${profile.name} (${profile.target})`;
        option.selected = profile.id === this.active()?.id;
        select.appendChild(option);
      }
      select.addEventListener('change', () => this.setActive(select.value));
      row.append(label, select);
      this.view.appendChild(row);
    }

    // Profile cards.
    for (const profile of this.profileList) {
      const card = document.createElement('div');
      card.className = `znxstudio-deploy-card${profile.id === this.active()?.id ? ' is-active' : ''}`;
      const title = document.createElement('div');
      title.className = 'znxstudio-deploy-card-title';
      title.textContent = profile.name;
      const meta = document.createElement('div');
      meta.className = 'znxstudio-deploy-card-meta';
      meta.textContent = `${profile.target} · ${profile.environment}${profile.registry ? ` · ${profile.registry}` : ''}`;
      const remove = document.createElement('button');
      remove.className = 'znxstudio-btn-small';
      remove.textContent = '✕';
      remove.title = 'Remove profile';
      remove.addEventListener('click', () => this.removeProfile(profile.id));
      title.appendChild(remove);
      card.append(title, meta);
      this.view.appendChild(card);
    }

    const newBtn = document.createElement('button');
    newBtn.className = 'znxstudio-btn-small';
    newBtn.textContent = this.creatingProfile ? 'Creating…' : '＋ New Profile';
    newBtn.disabled = this.creatingProfile;
    newBtn.addEventListener('click', () => void this.newProfilePrompt());
    this.view.appendChild(newBtn);

    // Generator actions (contributed by 13B–13F), grouped.
    const groups = new Map<string, DeployAction[]>();
    for (const action of this.registeredActions) {
      const list = groups.get(action.group) ?? [];
      list.push(action);
      groups.set(action.group, list);
    }
    for (const [group, actions] of groups) {
      const gh = document.createElement('div');
      gh.className = 'znxstudio-deploy-group';
      gh.textContent = group;
      this.view.appendChild(gh);
      for (const action of actions) {
        const button = document.createElement('button');
        button.className = 'znxstudio-btn-small znxstudio-deploy-action';
        button.textContent = action.label;
        button.addEventListener('click', () => {
          if (
            this.moduleContext.commands.has(action.command) &&
            this.moduleContext.commands.isEnabled(action.command)
          ) {
            void this.moduleContext.commands.execute(action.command);
          }
        });
        this.actionButtons.set(action.id, button);
        this.view.appendChild(button);
      }
    }
    this.refreshActionButtons();
  }

  private refreshActionButtons(): void {
    for (const action of this.registeredActions) {
      const button = this.actionButtons.get(action.id);
      if (!button) continue;
      button.disabled =
        !this.moduleContext.commands.has(action.command) ||
        !this.moduleContext.commands.isEnabled(action.command);
    }
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
    const parsed = parseDeploymentProfiles([
      { name: 'Prod', target: 'docker', environment: 'production', registry: 'ghcr.io/acme' },
      { name: 'bad', target: 'nonsense' },
      { name: 'K8s', target: 'kubernetes' },
    ]);
    const ctx = this.context();
    log(`deploy profiles: parsed=${parsed.length} (dropped invalid target) first=${parsed[0]?.id}/${parsed[0]?.target} valid=${validateProfile(defaultProfile('x')) === null}`);
    log(`deploy context: project=${ctx.projectName} env=${ctx.environment} port=${ctx.port} actions=${this.registeredActions.length}`);
  }
}
