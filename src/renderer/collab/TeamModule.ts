import { ServiceKeys, type AiService, type InputBoxService, type SettingsService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { joinPath } from '../explorer/paths';
import {
  EMPTY_TEAM_SETTINGS,
  explainSettings,
  mergeSettings,
  overriddenByTeam,
  parseTeamSettings,
  renderTeamSettings,
  type ResolvedSetting,
  type TeamSettings,
} from './teamSettings';
import {
  EMPTY_POLICY,
  blocksBuild,
  complianceSummary,
  evaluatePolicy,
  isCompliant,
  parsePolicy,
  satisfiesProfile,
  type Policy,
  type PolicyViolation,
} from './policy';

const TEAM_FILE = 'znxstudio.team.json';
const POLICY_FILE = 'znxstudio.policy.json';
const LOCK_FILE = 'zornux.lock';
const PROJECT_FILE = 'zornux.project';

/**
 * Team settings (Phase 16D) and policies (Phase 16E).
 *
 * Both are files committed to the repository, so a team's shared configuration
 * travels with the code rather than living in someone's machine. Settings shape
 * defaults; policies state requirements and are CHECKED, never enforced —
 * ZnxStudio runs on the developer's own machine and says so plainly.
 */
export class TeamModule implements IModule {
  readonly id = 'znxstudio.collab.team';
  readonly displayName = 'Team';

  private moduleContext!: ModuleContext;
  private workspace: WorkspaceService | undefined;
  private settings: SettingsService | undefined;
  private ai: AiService | undefined;

  private settingsPanel!: HTMLElement;
  private policyPanel!: HTMLElement;
  private team: TeamSettings = EMPTY_TEAM_SETTINGS;
  private policy: Policy = EMPTY_POLICY;
  private violations: PolicyViolation[] = [];
  private teamFound = false;
  private policyFound = false;
  private creatingTeamFile = false;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    this.ai = context.services.tryGet<AiService>(ServiceKeys.Ai);

    this.settingsPanel = document.createElement('div');
    this.settingsPanel.className = 'znxstudio-team';
    context.layout.addPanelView({ id: 'team-settings', title: 'Team Settings', element: this.settingsPanel });

    this.policyPanel = document.createElement('div');
    this.policyPanel.className = 'znxstudio-team';
    context.layout.addPanelView({ id: 'team-policies', title: 'Policies', element: this.policyPanel });

    context.commands.register(CommandIds.TeamSettingsShow, () => this.moduleContext.layout.showPanelView('team-settings'), 'Team: Show Settings');
    context.commands.register(CommandIds.TeamPoliciesShow, () => this.moduleContext.layout.showPanelView('team-policies'), 'Team: Show Policies');
    context.commands.register(CommandIds.TeamPolicyCheck, () => void this.reload(), 'Team: Check Policy Compliance');

    this.workspace?.onDidChangeWorkspace(() => void this.reload());
    this.renderSettings();
    this.renderPolicy();
    void this.reload();
    void selfTestCoordinator.run('collab-team', () => this.maybeSelfTest());
  }

  private async readFile(name: string): Promise<string | null> {
    const root = this.workspace?.currentFolder();
    if (!root) return null;
    try {
      return await window.znxstudio.fs.readFile(joinPath(root, name));
    } catch {
      return null;
    }
  }

  private async reload(): Promise<void> {
    const [teamText, policyText, projectText, lockText] = await Promise.all([
      this.readFile(TEAM_FILE),
      this.readFile(POLICY_FILE),
      this.readFile(PROJECT_FILE),
      this.readFile(LOCK_FILE),
    ]);

    this.teamFound = teamText !== null;
    this.policyFound = policyText !== null;
    this.team = teamText ? parseTeamSettings(teamText) : EMPTY_TEAM_SETTINGS;
    this.policy = policyText ? parsePolicy(policyText) : EMPTY_POLICY;

    this.violations = this.policyFound
      ? evaluatePolicy(this.policy, {
          projectText,
          hasLockfile: lockText !== null,
          aiProvider: this.aiProviderId(),
        })
      : [];

    this.applyTeamSettings();
    this.renderSettings();
    this.renderPolicy();
  }

  private aiProviderId(): string {
    // AI is optional and vendor-neutral; 'none' is the default and means AI is off.
    return this.settings?.get<string>('ai.provider', 'none') ?? 'none';
  }

  /**
   * Apply the team's defaults and locks to the live settings. A team DEFAULT
   * only fills a key the user never set; a LOCKED key always wins.
   */
  private applyTeamSettings(): void {
    if (!this.settings || !this.teamFound) return;
    const user = this.settings.all();
    const effective = mergeSettings(user, this.team);
    // Only write back what actually changes, so this never churns the store.
    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(effective)) {
      if (user[key] !== value) changed[key] = value;
    }
    if (Object.keys(changed).length) this.settings.applyAll({ ...user, ...changed });
  }

  /* ----- settings panel ----- */
  private renderSettings(): void {
    if (!this.settingsPanel) return;
    this.settingsPanel.replaceChildren();

    if (!this.teamFound) {
      this.settingsPanel.appendChild(
        note(`No ${TEAM_FILE} in this workspace. Commit one to share defaults across the team.`, 'znxstudio-team-note'),
      );
      const create = button(this.creatingTeamFile ? 'Creating…' : '＋ Create team settings', () => void this.createTeamFile());
      create.disabled = this.creatingTeamFile;
      this.settingsPanel.appendChild(create);
      return;
    }

    this.settingsPanel.appendChild(note(this.team.name || 'Team settings', 'znxstudio-team-title'));
    if (this.team.notice) this.settingsPanel.appendChild(note(this.team.notice, 'znxstudio-team-notice'));

    const overridden = overriddenByTeam(this.settings?.all() ?? {}, this.team);
    if (overridden.length) {
      this.settingsPanel.appendChild(
        note(
          `${overridden.length} of your settings are overridden by a team lock and will not take effect: ${overridden
            .map((setting) => setting.key)
            .join(', ')}.`,
          'znxstudio-team-warn',
        ),
      );
    }

    for (const setting of explainSettings(this.settings?.all() ?? {}, this.team)) {
      this.settingsPanel.appendChild(this.renderSettingRow(setting));
    }
  }

  private renderSettingRow(setting: ResolvedSetting): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-team-setting';

    const key = document.createElement('span');
    key.className = 'znxstudio-team-key';
    key.textContent = setting.key;

    const value = document.createElement('span');
    value.className = 'znxstudio-team-value';
    value.textContent = JSON.stringify(setting.value);

    const origin = document.createElement('span');
    origin.className = `znxstudio-team-origin origin-${setting.origin}`;
    origin.textContent = setting.origin;
    origin.title = ORIGIN_EXPLANATION[setting.origin];

    row.append(key, value, origin);

    if (setting.overriddenUserValue !== undefined) {
      const overridden = document.createElement('span');
      overridden.className = 'znxstudio-team-overridden';
      overridden.textContent = `your ${JSON.stringify(setting.overriddenUserValue)} is ignored`;
      row.appendChild(overridden);
    }
    return row;
  }

  private async createTeamFile(): Promise<void> {
    const root = this.workspace?.currentFolder();
    if (!root || this.creatingTeamFile) return;
    this.creatingTeamFile = true;
    this.renderSettings();
    try {
      const input = this.moduleContext.services.get<InputBoxService>(ServiceKeys.InputBox);
      const value = await input.prompt({
        title: 'Create Team Settings',
        label: 'Team name',
        value: 'Our team',
        placeholder: 'Shown to everyone using this workspace',
        submitLabel: 'Create Settings',
        validate: (name) => {
          const normalized = name.trim();
          if (!normalized) return 'Enter a team name.';
          if (normalized.length > 80) return 'Team name must be 80 characters or fewer.';
          return /[\u0000-\u001f]/.test(normalized) ? 'Team name cannot contain control characters.' : null;
        },
      });
      if (value === null) return;
      if (this.workspace?.currentFolder() !== root) {
        this.moduleContext.layout.showToast('Team settings creation cancelled because the workspace changed.', 'info');
        return;
      }

      const path = joinPath(root, TEAM_FILE);
      try {
        await window.znxstudio.fs.readFile(path);
        this.moduleContext.layout.showToast(`${TEAM_FILE} already exists. Reloading the team settings.`, 'info');
        await this.reload();
        return;
      } catch {
        // The file is still absent; proceed with first-time creation.
      }
      const content = renderTeamSettings({ name: value.trim(), defaults: { 'editor.tabSize': 4 }, locked: {}, notice: undefined });
      await window.znxstudio.fs.writeFile(path, content);
      this.moduleContext.layout.showToast(`Wrote ${TEAM_FILE}. Commit it to share it.`, 'info');
      await this.reload();
    } catch (error) {
      this.moduleContext.layout.showToast(`Could not write ${TEAM_FILE}: ${(error as Error).message}`, 'error');
    } finally {
      this.creatingTeamFile = false;
      this.renderSettings();
    }
  }

  /* ----- policy panel ----- */
  private renderPolicy(): void {
    if (!this.policyPanel) return;
    this.policyPanel.replaceChildren();

    if (!this.policyFound) {
      this.policyPanel.appendChild(note(`No ${POLICY_FILE} in this workspace.`, 'znxstudio-team-note'));
      return;
    }

    this.policyPanel.appendChild(note(complianceSummary(this.policy, this.violations), this.violations.length ? 'znxstudio-team-warn' : 'znxstudio-team-ok'));
    if (this.policy.notice) this.policyPanel.appendChild(note(this.policy.notice, 'znxstudio-team-notice'));

    // The honest caveat, stated where someone will actually read it.
    this.policyPanel.appendChild(
      note(
        'A policy is CHECKED here, not enforced: ZnxStudio runs on your machine. Gate on it in CI, where enforcement belongs.',
        'znxstudio-team-note',
      ),
    );

    if (blocksBuild(this.violations)) {
      this.policyPanel.appendChild(note('At least one violation is an error — a CI gate on this policy would fail.', 'znxstudio-team-warn'));
    }

    for (const violation of this.violations) {
      const row = document.createElement('div');
      row.className = 'znxstudio-team-violation';

      const head = document.createElement('div');
      head.className = 'znxstudio-team-violation-head';
      const badge = document.createElement('span');
      badge.className = `znxstudio-severity znxstudio-severity-${violation.severity === 'error' ? 'error' : 'warning'}`;
      badge.textContent = violation.severity;
      const rule = document.createElement('span');
      rule.className = 'znxstudio-team-key';
      rule.textContent = violation.rule;
      head.append(badge, rule);
      row.appendChild(head);

      row.appendChild(note(violation.message, 'znxstudio-team-note'));
      row.appendChild(note(violation.remedy, 'znxstudio-team-remedy'));
      this.policyPanel.appendChild(row);
    }

    if (isCompliant(this.violations)) {
      this.policyPanel.appendChild(note('Everything this policy asks for is in place.', 'znxstudio-team-ok'));
    }

    this.policyPanel.appendChild(button('⟳ Re-check', () => void this.reload()));
    void this.ai;
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

    const team = parseTeamSettings(
      JSON.stringify({
        name: 'Platform',
        defaults: { 'editor.tabSize': 4, 'ai.provider': 'ollama' },
        locked: { 'editor.formatOnSave': true, 'ai.provider': 'none' },
      }),
    );
    const user = { 'editor.tabSize': 2, 'ai.provider': 'openai', 'editor.fontSize': 13 };
    const effective = mergeSettings(user, team);
    log(
      `team settings precedence: tabSize=${effective['editor.tabSize']} (user beats team default) ` +
        `formatOnSave=${effective['editor.formatOnSave']} (team lock) ai.provider=${effective['ai.provider']} (lock beats user)`,
    );
    log(`team settings: a key in both defaults and locked is locked → defaults has ai.provider? ${'ai.provider' in team.defaults}`);
    log(`team settings overridden: [${overriddenByTeam(user, team).map((s) => `${s.key}(${JSON.stringify(s.overriddenUserValue)})`).join(' ')}]`);

    const policy = parsePolicy(
      JSON.stringify({
        name: 'Baseline',
        requiredSecurityProfile: 'strict',
        requiredSecurityRules: ['ZX3701'],
        requireLockfile: true,
        allowedAiProviders: [],
        severity: 'error',
      }),
    );
    const failing = evaluatePolicy(policy, {
      projectText: 'name = demo\nsecurity.profile = relaxed\nsecurity.disable = ZX3701\n',
      hasLockfile: false,
      aiProvider: 'openai',
    });
    log(`policy violations: ${failing.length} → [${failing.map((v) => v.rule).join(' ')}]`);
    log(`policy first: ${failing[0]?.message}`);
    log(`policy blocksBuild=${blocksBuild(failing)} summary="${complianceSummary(policy, failing)}"`);

    const passing = evaluatePolicy(policy, {
      projectText: 'name = demo\nsecurity.profile = strict\n',
      hasLockfile: true,
      aiProvider: 'none',
    });
    log(`policy compliant workspace: violations=${passing.length} compliant=${isCompliant(passing)}`);
    log(`policy profile ranking: strict satisfies standard=${satisfiesProfile('strict', 'standard')} relaxed satisfies strict=${satisfiesProfile('relaxed', 'strict')}`);
  }
}

const ORIGIN_EXPLANATION: Record<ResolvedSetting['origin'], string> = {
  locked: 'The team locked this key. Your own value is ignored.',
  user: 'You set this yourself; it beats the team default.',
  team: 'A team default. Set it yourself to override.',
  default: "ZnxStudio's built-in default.",
};

function note(text: string, className: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.className = 'znxstudio-btn-small';
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}
