import { ServiceKeys, type SecurityService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import type { SecuritySeverity } from './findings';
import {
  DEFAULT_SETTINGS,
  SECURITY_PROFILES,
  SECURITY_RULES,
  applyProfile,
  builtInRules,
  effectiveSeverity,
  isEnabled,
  parseSecuritySettings,
  ruleBlocksBuild,
  renderSecuritySettings,
  updateProjectText,
  type RuleInfo,
  type SecurityProfile,
  type SecuritySettings,
} from './rules';

const PROJECT_FILE = 'zornux.project';
const SEVERITIES: SecuritySeverity[] = ['Info', 'Warning', 'Error', 'Critical'];

/**
 * Static security analysis (Phase 15D). The rule catalog, and the one place a
 * team picks its posture: a project profile, per-rule disables, and per-rule
 * severity overrides. Everything written here goes into the project's real
 * `zornux.project` as `security.*` settings, which the compiler reads on the
 * next `zornux check --security` — so the IDE and the build never disagree.
 */
export class SecurityRulesModule implements IModule {
  readonly id = 'znxstudio.security.rules';
  readonly displayName = 'Security Rules';

  private moduleContext!: ModuleContext;
  private workspace: WorkspaceService | undefined;
  private security: SecurityService | undefined;
  private panel!: HTMLElement;
  private settings: SecuritySettings = { ...DEFAULT_SETTINGS };
  private projectFound = false;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    this.security = context.services.tryGet<SecurityService>(ServiceKeys.Security);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-secrules';
    context.layout.addPanelView({ id: 'security-rules', title: 'Security Rules', element: this.panel });

    context.commands.register(CommandIds.SecurityRulesShow, () => this.reveal(), 'Security: Show Rules');

    this.workspace?.onDidChangeWorkspace(() => void this.load());
    this.render();
    void this.load();
    void selfTestCoordinator.run('security-rules', () => this.maybeSelfTest());
  }

  private reveal(): void {
    this.render();
    this.moduleContext.layout.showPanelView('security-rules');
  }

  private projectPath(): string | null {
    const root = this.workspace?.currentFolder();
    return root ? `${root}\\${PROJECT_FILE}` : null;
  }

  private async load(): Promise<void> {
    const path = this.projectPath();
    this.projectFound = false;
    this.settings = { ...DEFAULT_SETTINGS };
    if (path) {
      try {
        this.settings = parseSecuritySettings(await window.znxstudio.fs.readFile(path));
        this.projectFound = true;
      } catch {
        this.projectFound = false;
      }
    }
    this.render();
  }

  /** Persist to the real `zornux.project`, preserving every non-security line. */
  private async save(next: SecuritySettings): Promise<void> {
    const path = this.projectPath();
    if (!path) return;
    try {
      const existing = await window.znxstudio.fs.readFile(path);
      await window.znxstudio.fs.writeFile(path, updateProjectText(existing, next));
      this.settings = next;
      this.moduleContext.layout.showToast(`${PROJECT_FILE} updated — rescan to apply.`, 'info');
    } catch (error) {
      this.moduleContext.layout.showToast(`Could not update ${PROJECT_FILE}: ${(error as Error).message}`, 'error');
    }
    this.render();
  }

  private render(): void {
    if (!this.panel) return;
    this.panel.replaceChildren();

    this.panel.appendChild(this.renderProfilePicker());

    if (!this.projectFound) {
      this.panel.appendChild(
        note(
          `No ${PROJECT_FILE} in this folder — the catalog below is read-only. Settings are stored in the project file the compiler reads.`,
          'znxstudio-secrules-note',
        ),
      );
    }

    const counts = this.security?.findings() ?? [];
    for (const rule of SECURITY_RULES) {
      this.panel.appendChild(this.renderRule(rule, counts.filter((f) => f.code === rule.id).length));
    }

    const preview = renderSecuritySettings(this.settings);
    this.panel.appendChild(
      note(
        preview.length ? `zornux.project:\n${preview.join('\n')}` : 'zornux.project: no security settings (every rule at its authored severity).',
        'znxstudio-secrules-preview',
      ),
    );
  }

  private renderProfilePicker(): HTMLElement {
    const box = document.createElement('div');
    box.className = 'znxstudio-secrules-profile';

    const label = document.createElement('div');
    label.className = 'znxstudio-secrules-label';
    label.textContent = 'Project profile';
    box.appendChild(label);

    for (const profile of SECURITY_PROFILES) {
      const option = document.createElement('label');
      option.className = 'znxstudio-secrules-radio';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'znxstudio-security-profile';
      radio.checked = this.settings.profile === profile;
      radio.disabled = !this.projectFound;
      radio.addEventListener('change', () => void this.save({ ...this.settings, profile }));
      const text = document.createElement('span');
      text.textContent = `${profile} — ${describeProfile(profile)}`;
      option.append(radio, text);
      box.appendChild(option);
    }

    return box;
  }

  private renderRule(rule: RuleInfo, findingCount: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-secrules-row';
    if (!rule.builtIn) row.classList.add('is-inactive');

    const head = document.createElement('div');
    head.className = 'znxstudio-secrules-head';

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.setAttribute('aria-label', `Enable rule ${rule.id}`);
    enabled.checked = isEnabled(this.settings, rule.id);
    enabled.disabled = !this.projectFound || !rule.builtIn;
    enabled.addEventListener('change', () => {
      const disabled = this.settings.disabled.filter((id) => id.toUpperCase() !== rule.id.toUpperCase());
      if (!enabled.checked) disabled.push(rule.id);
      void this.save({ ...this.settings, disabled });
    });
    head.appendChild(enabled);

    const code = document.createElement('span');
    code.className = 'znxstudio-secrules-code';
    code.textContent = rule.id;
    head.appendChild(code);

    const title = document.createElement('span');
    title.textContent = rule.title;
    head.appendChild(title);

    const category = document.createElement('span');
    category.className = 'znxstudio-secrules-category';
    category.textContent = rule.category;
    head.appendChild(category);

    const severity = effectiveSeverity(this.settings, rule);
    const badge = document.createElement('span');
    badge.className = `znxstudio-severity znxstudio-severity-${severity.toLowerCase()}`;
    badge.textContent = severity;
    badge.title =
      severity === rule.defaultSeverity
        ? `Authored severity: ${rule.defaultSeverity}`
        : `Authored ${rule.defaultSeverity}, shown as ${severity} under this configuration`;
    head.appendChild(badge);

    if (findingCount) {
      const hits = document.createElement('span');
      hits.className = 'znxstudio-secrules-hits';
      hits.textContent = `${findingCount} finding(s)`;
      head.appendChild(hits);
    }

    if (ruleBlocksBuild(this.settings, rule) && rule.builtIn) {
      const blocks = document.createElement('span');
      blocks.className = 'znxstudio-secrules-blocks';
      blocks.textContent = 'fails build';
      head.appendChild(blocks);
    }

    row.appendChild(head);

    const override = document.createElement('select');
    override.className = 'znxstudio-select znxstudio-secrules-override';
    override.setAttribute('aria-label', `Severity override for ${rule.id ?? 'rule'}`);
    override.disabled = !this.projectFound || !rule.builtIn;
    const inherit = document.createElement('option');
    inherit.value = '';
    inherit.textContent = `from profile (${applyProfile(rule.defaultSeverity, this.settings.profile)})`;
    override.appendChild(inherit);
    for (const level of SEVERITIES) {
      const option = document.createElement('option');
      option.value = level;
      option.textContent = `override → ${level.toLowerCase()}`;
      option.selected = this.settings.severityOverrides[rule.id] === level;
      override.appendChild(option);
    }
    override.addEventListener('change', () => {
      const overrides = { ...this.settings.severityOverrides };
      if (override.value) overrides[rule.id] = override.value as SecuritySeverity;
      else delete overrides[rule.id];
      void this.save({ ...this.settings, severityOverrides: overrides });
    });
    row.appendChild(override);

    if (rule.note) row.appendChild(note(rule.note, 'znxstudio-secrules-inactive'));

    const docs = document.createElement('a');
    docs.className = 'znxstudio-secrules-docs';
    docs.textContent = 'docs';
    docs.href = `https://zornux.dev/security/rules#${rule.id.toLowerCase()}`;
    docs.target = '_blank';
    docs.rel = 'noreferrer';
    row.appendChild(docs);

    return row;
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

    log(`security rules: ${SECURITY_RULES.length} declared, ${builtInRules().length} run by \`zornux check --security\``);

    const strict = parseSecuritySettings('name = demo\nsecurity.profile = strict\n');
    const unsafeApi = SECURITY_RULES[1];
    log(`security rules strict: ${unsafeApi.id} authored ${unsafeApi.defaultSeverity} → ${effectiveSeverity(strict, unsafeApi)}`);

    const relaxed = parseSecuritySettings('security.profile = relaxed\n');
    const injection = SECURITY_RULES[3];
    log(`security rules relaxed: ${injection.id} authored ${injection.defaultSeverity} → ${effectiveSeverity(relaxed, injection)}`);

    const overridden = parseSecuritySettings('security.profile = strict\nsecurity.severity.ZX3702 = info\n');
    log(`security rules override beats profile: ${unsafeApi.id} → ${effectiveSeverity(overridden, unsafeApi)} (expect Info)`);

    const secret = SECURITY_RULES[0];
    log(
      `security rules extremes never move: ${secret.id} Critical under relaxed → ${effectiveSeverity(relaxed, secret)}`,
    );

    const written = updateProjectText('name = demo\nversion = 1.0.0\nsecurity.profile = relaxed\n', {
      profile: 'strict',
      disabled: ['ZX3703'],
      severityOverrides: { ZX3702: 'Info' },
    });
    log(`security rules write-back: ${JSON.stringify(written)}`);

    await this.realProfileSelfTest(log);
  }

  /**
   * Prove the whole configuration surface against the REAL compiler: write a
   * `zornux.project` beside a program and confirm `zornux check --security`
   * actually shifts and silences severities the way this module predicts.
   * Writes only into the OS temp directory.
   */
  private async realProfileSelfTest(log: (message: string) => void): Promise<void> {
    if (!this.security) return;
    try {
      const info = await window.znxstudio.app.getInfo();
      const dir = `${info.tempDir}\\znxstudio-secrules`;
      const program = `${dir}\\flow.zx`;
      const project = `${dir}\\${PROJECT_FILE}`;

      // Trips ZX3704 (injection, Error) and ZX3706 (web, Warning) — one rule at
      // each end of the profile shift.
      await window.znxstudio.fs.writeFile(
        program,
        [
          'import db',
          'import files',
          'import web',
          'create origin = files.open_to_read("q.txt")',
          'create name = files.next_line(origin)',
          'create conn = "memory"',
          'create store = db.open("sqlite", conn)',
          'show db.query(store, name, [])',
          'show web.cookie("session", "abc", {"http_only": false})',
          'db.close(store)',
          'files.close(origin)',
          '',
        ].join('\n'),
      );

      const scan = async (projectText: string): Promise<string> => {
        await window.znxstudio.fs.writeFile(project, projectText);
        const result = await this.security!.scanFile(program);
        return (result?.findings ?? []).map((f) => `${f.code}=${f.severity}`).join(' ');
      };

      const predict = (settings: SecuritySettings, ruleId: string): string => {
        const rule = SECURITY_RULES.find((r) => r.id === ruleId)!;
        return isEnabled(settings, ruleId) ? effectiveSeverity(settings, rule) : 'disabled';
      };

      const standardText = 'name = demo\nversion = 1.0.0\n';
      log(`security rules REAL standard: ${await scan(standardText)} (predicted ZX3706=${predict(parseSecuritySettings(standardText), 'ZX3706')})`);

      const strictText = `${standardText}security.profile = strict\n`;
      log(`security rules REAL strict: ${await scan(strictText)} (predicted ZX3706=${predict(parseSecuritySettings(strictText), 'ZX3706')})`);

      const relaxedText = `${standardText}security.profile = relaxed\nsecurity.disable = ZX3706\n`;
      const settings = parseSecuritySettings(relaxedText);
      log(
        `security rules REAL relaxed+disable: ${await scan(relaxedText)} ` +
          `(predicted ZX3704=${predict(settings, 'ZX3704')} ZX3706=${predict(settings, 'ZX3706')})`,
      );
    } catch (error) {
      log(`security rules REAL failed: ${(error as Error).message}`);
    }
  }
}

function describeProfile(profile: SecurityProfile): string {
  switch (profile) {
    case 'relaxed':
      return 'an error is relaxed to a warning';
    case 'strict':
      return 'a warning is raised to an error';
    default:
      return 'severities as each rule authored them';
  }
}

function note(text: string, className: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}
