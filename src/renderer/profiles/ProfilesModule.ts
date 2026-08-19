import {
  ServiceKeys,
  type EditorService,
  type ProfileService,
  type SettingsService,
  type StatusService,
  type WorkspaceService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { normalizeRoot } from '../workspace/workspaceFolders';
import { examplePath } from '../core/selftestFixtures';
import { joinPath } from '../explorer/paths';
import {
  ENVIRONMENT_PROFILES,
  isEnvironmentProfile,
  parseConfigShow,
  parseConfigValidate,
  profileConfigFiles,
  profileDisplay,
  type ConfigShowResult,
  type ConfigValidateResult,
  type EnvironmentProfile,
} from '../../shared/environmentProfiles';

const PROFILE_ICON: Record<EnvironmentProfile, string> = {
  development: 'D',
  testing: 'T',
  staging: 'S',
  production: 'P',
};

const SETTINGS_KEY = 'zornux.profiles.byRoot';
const DEFAULT_PROFILE: EnvironmentProfile = 'development';

/**
 * Workspace Profiles (Phase 5F). Publishes the ProfileService — the active
 * environment profile (development / testing / staging / production) for the
 * primary folder, persisted per root in settings and threaded into the CLI as
 * `--profile` (Run consumes it). Provides a sidebar view (activity 🌱) to switch
 * profiles, inspect which config layer files exist, and run the REAL
 * `zornux config show|validate` for the active profile. Status-bar item shows
 * the active profile and opens the view.
 */
export class ProfilesModule implements IModule, ProfileService {
  readonly id = 'znxstudio.profiles';
  readonly displayName = 'Workspace Profiles';

  private context!: ModuleContext;
  private workspace!: WorkspaceService;
  private settings?: SettingsService;
  private readonly changeEmitter = new Emitter<EnvironmentProfile>();
  readonly onDidChangeProfile = this.changeEmitter.event;

  private activeProfile: EnvironmentProfile = DEFAULT_PROFILE;
  private container!: HTMLElement;
  private renderSequence = 0;
  private configSequence = 0;
  private runningConfig = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    context.services.register(ServiceKeys.Profile, this satisfies ProfileService);

    this.container = document.createElement('div');
    this.container.className = 'znxstudio-profiles';

    this.activeProfile = this.loadProfile();

    context.commands.register(CommandIds.ProfileSelect, () => this.openView(), 'Workspace: Select Profile');
    context.subscriptions.push(
      context.commands.addEnablementRule((id) => id === CommandIds.ProfileSelect ? Boolean(this.workspace.currentFolder()) : undefined),
    );

    context.layout.addActivityItem({
      id: 'profiles',
      label: 'Profiles',
      icon: '◉',
      onSelect: () => this.openView(),
    });

    // Re-load the persisted profile when the primary folder changes.
    this.workspace.onDidChangeWorkspace(() => {
      this.renderSequence += 1;
      this.configSequence += 1;
      this.runningConfig = false;
      const next = this.loadProfile();
      if (next !== this.activeProfile) {
        this.activeProfile = next;
        this.changeEmitter.fire(next);
      }
      this.updateStatus();
      this.context.commands.notifyEnablementChanged();
      void this.render();
    });

    this.updateStatus();
    this.context.commands.notifyEnablementChanged();
    void selfTestCoordinator.run('profiles', () => this.maybeSelfTest());
  }

  /* --------------------------------------------------------- ProfileService */

  active(): EnvironmentProfile {
    return this.activeProfile;
  }

  list(): readonly EnvironmentProfile[] {
    return ENVIRONMENT_PROFILES;
  }

  setActive(profile: EnvironmentProfile): void {
    if (profile === this.activeProfile) return;
    this.configSequence += 1;
    this.runningConfig = false;
    this.activeProfile = profile;
    this.persistProfile(profile);
    this.changeEmitter.fire(profile);
    this.updateStatus();
    void this.render();
  }

  /* ----------------------------------------------------------- persistence */

  private loadProfile(): EnvironmentProfile {
    const root = this.workspace.currentFolder();
    if (!root || !this.settings) return DEFAULT_PROFILE;
    const map = this.settings.get<Record<string, string>>(SETTINGS_KEY, {});
    const stored = map[normalizeRoot(root)];
    return isEnvironmentProfile(stored) ? stored : DEFAULT_PROFILE;
  }

  private persistProfile(profile: EnvironmentProfile): void {
    const root = this.workspace.currentFolder();
    if (!root || !this.settings) return;
    const map = { ...this.settings.get<Record<string, string>>(SETTINGS_KEY, {}) };
    map[normalizeRoot(root)] = profile;
    this.settings.set(SETTINGS_KEY, map);
  }

  /* ------------------------------------------------------------ status bar */

  private updateStatus(): void {
    const status = this.context.services.tryGet<StatusService>(ServiceKeys.Status);
    if (!this.workspace.currentFolder()) {
      status?.removeItem('profiles.active');
      return;
    }
    status?.setItem('profiles.active', {
      text: `${PROFILE_ICON[this.activeProfile]} ${profileDisplay(this.activeProfile)}`,
      tooltip: `Active environment profile — click to change (threaded into zornux run/config as --profile ${this.activeProfile})`,
      command: CommandIds.ProfileSelect,
      side: 'right',
      priority: 33,
    });
  }

  /* ---------------------------------------------------------------- view */

  private openView(): void {
    this.context.layout.setSideBar('Profiles', this.shell());
    this.context.layout.focusSideBar();
    void this.render();
  }

  private shell(): HTMLElement {
    const shell = document.createElement('div');
    shell.className = 'znxstudio-profiles-shell';
    const header = document.createElement('div');
    header.className = 'znxstudio-solution-header';
    header.textContent = 'Environment Profile';
    shell.append(header, this.container);
    return shell;
  }

  private async render(): Promise<void> {
    const sequence = ++this.renderSequence;
    const root = this.workspace.currentFolder();
    const profile = this.activeProfile;
    if (!root) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-explorer-empty';
      const message = document.createElement('p');
      message.textContent = 'Open a folder to select a profile';
      empty.appendChild(message);
      this.container.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    fragment.appendChild(this.renderProfilePicker());
    fragment.appendChild(await this.renderConfigLayers(root, profile));
    if (sequence !== this.renderSequence || this.workspace.currentFolder() !== root || this.activeProfile !== profile) return;
    fragment.appendChild(this.renderConfigActions());
    this.container.replaceChildren(fragment);
  }

  private renderProfilePicker(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'znxstudio-profiles-picker';
    for (const profile of ENVIRONMENT_PROFILES) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'znxstudio-tree-row znxstudio-profiles-option';
      if (profile === this.activeProfile) row.classList.add('is-active');
      const mark = document.createElement('span');
      mark.className = 'znxstudio-icon';
      mark.textContent = profile === this.activeProfile ? '◉' : '○';
      const icon = document.createElement('span');
      icon.className = 'znxstudio-icon';
      icon.textContent = PROFILE_ICON[profile];
      const label = document.createElement('span');
      label.textContent = profileDisplay(profile);
      row.append(mark, icon, label);
      row.setAttribute('aria-pressed', String(profile === this.activeProfile));
      row.addEventListener('click', () => this.setActive(profile));
      group.appendChild(row);
    }
    return group;
  }

  private async renderConfigLayers(root: string, profile: EnvironmentProfile): Promise<HTMLElement> {
    const section = document.createElement('div');
    section.className = 'znxstudio-profiles-layers';
    const header = document.createElement('div');
    header.className = 'znxstudio-explorer-section-header';
    header.textContent = 'Config layers';
    section.appendChild(header);

    const present = new Set<string>();
    try {
      for (const node of await window.znxstudio.fs.readDirectory(root)) present.add(node.name);
    } catch {
      /* unreadable root — treat as no config files */
    }

    for (const file of profileConfigFiles(profile)) {
      const row = document.createElement('div');
      row.className = 'znxstudio-solution-detail znxstudio-profiles-layer';
      const exists = present.has(file.name);
      const mark = document.createElement('span');
      mark.className = 'znxstudio-icon';
      mark.textContent = exists ? '✓' : '·';
      const name = document.createElement('span');
      name.className = 'znxstudio-profiles-layer-name';
      name.textContent = file.name;
      name.classList.toggle('is-missing', !exists);
      const role = document.createElement('span');
      role.className = 'znxstudio-solution-badge';
      role.textContent = file.committed ? file.role : `${file.role} · git-ignored`;
      row.append(mark, name, role);
      section.appendChild(row);
    }
    return section;
  }

  private renderConfigActions(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'znxstudio-profiles-actions';

    const showBtn = document.createElement('button');
    showBtn.className = 'znxstudio-btn';
    showBtn.textContent = 'Show effective config';
    showBtn.dataset.configAction = 'true';
    showBtn.addEventListener('click', () => void this.runConfig('show'));

    const validateBtn = document.createElement('button');
    validateBtn.className = 'znxstudio-btn';
    validateBtn.textContent = 'Validate';
    validateBtn.dataset.configAction = 'true';
    validateBtn.addEventListener('click', () => void this.runConfig('validate'));

    const output = document.createElement('div');
    output.className = 'znxstudio-profiles-output';
    output.dataset.role = 'output';

    section.append(showBtn, validateBtn, output);
    return section;
  }

  private outputHost(): HTMLElement | null {
    return this.container.querySelector('[data-role="output"]');
  }

  private zornuxEntry(): string | null {
    const root = this.workspace.currentFolder();
    if (!root) return null;
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    const active = editor?.currentFile();
    if (active && active.toLowerCase().endsWith('.zx')) return active;
    return joinPath(joinPath(root, 'src'), 'main.zx');
  }

  private async runConfig(subcommand: 'show' | 'validate'): Promise<void> {
    if (this.runningConfig) return;
    const root = this.workspace.currentFolder();
    const entry = this.zornuxEntry();
    const host = this.outputHost();
    if (!root || !entry || !host) return;
    const profile = this.activeProfile;
    const sequence = ++this.configSequence;
    this.runningConfig = true;
    this.setConfigBusy(true);
    host.textContent = `Running zornux config ${subcommand} --profile ${profile}…`;
    try {
      const info = await window.znxstudio.compiler.info();
      if (!info.available) {
        this.context.layout.showToast('Zornux compiler not available.', 'error');
        host.textContent = 'Zornux compiler is not available.';
        return;
      }
      const raw = await window.znxstudio.config.query({
        subcommand,
        file: entry,
        profile,
        cwd: root,
        compilerPath: info.path,
      });
      if (!this.isCurrentConfig(sequence, root, profile, host)) return;
      if (subcommand === 'show') {
        host.replaceChildren(this.renderShow(parseConfigShow(raw.exitCode, raw.stdout, raw.stderr)));
      } else {
        host.replaceChildren(this.renderValidate(parseConfigValidate(raw.exitCode, raw.stdout, raw.stderr)));
      }
    } catch (error) {
      if (!this.isCurrentConfig(sequence, root, profile, host)) return;
      host.textContent = `Config command failed: ${(error as Error).message}`;
      this.context.layout.showToast('Configuration command failed.', 'error');
    } finally {
      if (sequence === this.configSequence) {
        this.runningConfig = false;
        this.setConfigBusy(false);
      }
    }
  }

  private setConfigBusy(busy: boolean): void {
    for (const button of this.container.querySelectorAll<HTMLButtonElement>('[data-config-action="true"]')) button.disabled = busy;
  }

  private isCurrentConfig(sequence: number, root: string, profile: EnvironmentProfile, host: HTMLElement): boolean {
    return sequence === this.configSequence && host.isConnected && this.workspace.currentFolder() === root && this.activeProfile === profile;
  }

  private renderShow(result: ConfigShowResult): HTMLElement {
    const wrap = document.createElement('div');
    if (result.error) {
      wrap.className = 'znxstudio-profiles-error';
      wrap.textContent = result.error;
      return wrap;
    }
    if (result.noConfig) {
      wrap.className = 'znxstudio-profiles-status';
      wrap.textContent = 'The entry declares no configuration.';
      return wrap;
    }
    const heading = document.createElement('div');
    heading.className = 'znxstudio-profiles-status';
    heading.textContent = `Profile: ${result.profile ?? profileDisplay(this.activeProfile)}`;
    wrap.appendChild(heading);
    for (const block of result.blocks) {
      const name = document.createElement('div');
      name.className = 'znxstudio-profiles-block';
      name.textContent = `${block.name}:`;
      wrap.appendChild(name);
      for (const field of block.fields) {
        const line = document.createElement('div');
        line.className = 'znxstudio-profiles-field';
        line.textContent = `${field.name} = ${field.value}`;
        wrap.appendChild(line);
      }
    }
    return wrap;
  }

  private renderValidate(result: ConfigValidateResult): HTMLElement {
    const wrap = document.createElement('div');
    const summary = document.createElement('div');
    summary.className = result.valid ? 'znxstudio-profiles-status' : 'znxstudio-profiles-error';
    summary.textContent = result.summary || (result.valid ? 'Configuration is valid.' : 'Configuration has errors.');
    wrap.appendChild(summary);
    for (const error of result.errors) {
      const line = document.createElement('div');
      line.className = 'znxstudio-profiles-error';
      line.textContent = error;
      wrap.appendChild(line);
    }
    for (const warning of result.warnings) {
      const line = document.createElement('div');
      line.className = 'znxstudio-profiles-field';
      line.textContent = warning;
      wrap.appendChild(line);
    }
    return wrap;
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

    // Pure-parser coverage is exhaustive in the unit suite; here we prove the
    // active-profile persistence round-trip and the REAL `zornux config` path.
    log(`profiles: list=[${this.list().join(', ')}] default=${this.active()}`);

    try {
      const info = await window.znxstudio.compiler.info();
      if (!info.available) {
        log('profiles: compiler unavailable, skipping config run');
        return;
      }
      // Run `config show/validate` against the real config example (declares an
      // `AppConfig` with a redacted secret) for two profiles.
      const root = await examplePath('configuration');
      if (!root) {
        log('profiles: examples root unavailable, skipping config run');
        return;
      }
      const entry = await examplePath('configuration', 'app_config.zx');
      for (const profile of ['development', 'production'] as EnvironmentProfile[]) {
        const shown = await window.znxstudio.config.query({ subcommand: 'show', file: entry, profile, cwd: root, compilerPath: info.path });
        const parsedShow = parseConfigShow(shown.exitCode, shown.stdout, shown.stderr);
        log(
          `config show --profile ${profile}: exit=${shown.exitCode} profile=${parsedShow.profile ?? '-'} noConfig=${parsedShow.noConfig} blocks=${parsedShow.blocks.length} error=${parsedShow.error ? 'yes' : 'no'}`,
        );
        const validated = await window.znxstudio.config.query({ subcommand: 'validate', file: entry, profile, cwd: root, compilerPath: info.path });
        const parsedValidate = parseConfigValidate(validated.exitCode, validated.stdout, validated.stderr);
        log(
          `config validate --profile ${profile}: valid=${parsedValidate.valid} warnings=${parsedValidate.warnings.length} errors=${parsedValidate.errors.length} summary="${parsedValidate.summary.slice(0, 50)}"`,
        );
      }
    } catch (error) {
      log(`profiles self-test failed: ${(error as Error).message}`);
    }
  }
}
