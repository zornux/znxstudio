import { ServiceKeys, type EditorService, type ProfileService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { PROJECT_TEMPLATES } from '../../shared/templates';
import { ENVIRONMENT_PROFILES, profileDisplay, type EnvironmentProfile } from '../../shared/environmentProfiles';
import { Wizard } from './wizardModel';
import {
  buildNewProjectPlan,
  initialNewProjectState,
  newProjectSteps,
  type NewProjectPlan,
  type NewProjectState,
} from './newProjectWizard';

/**
 * Guided wizards (Phase 5H) — the capstone that composes the earlier phases.
 * The New Project wizard walks Template → Name/Location → Dependencies →
 * Profile → Review as an editor overlay, then executes the plan against the
 * real services: 5G scaffold (`zornux init` + template files) → 5D `zornux add`
 * per dependency → open the folder → set the 5F profile. Registered as
 * `WizardNewProject`; Welcome's primary action opens it.
 */
export class WizardsModule implements IModule {
  readonly id = 'znxstudio.wizards';
  readonly displayName = 'Wizards';

  private context!: ModuleContext;
  private wizard?: Wizard<NewProjectState>;
  private container?: HTMLElement;

  activate(context: ModuleContext): void {
    this.context = context;
    context.commands.register(CommandIds.WizardNewProject, () => this.startNewProject(), 'Project: New from Wizard…');
    void selfTestCoordinator.run('wizards', () => this.maybeSelfTest());
  }

  private startNewProject(): void {
    this.wizard = new Wizard<NewProjectState>(newProjectSteps(), initialNewProjectState());
    this.container = document.createElement('div');
    this.container.className = 'znxstudio-wizard';
    this.context.services.tryGet<EditorService>(ServiceKeys.Editor)?.showView(this.container);
    this.render();
  }

  private render(): void {
    const wizard = this.wizard;
    const host = this.container;
    if (!wizard || !host) return;

    const inner = document.createElement('div');
    inner.className = 'znxstudio-wizard-inner';

    // Progress header.
    const steps = document.createElement('div');
    steps.className = 'znxstudio-wizard-steps';
    for (let i = 0; i < wizard.total(); i += 1) {
      const dot = document.createElement('span');
      dot.className = 'znxstudio-wizard-dot';
      if (i + 1 === wizard.stepNumber()) dot.classList.add('is-active');
      else if (i + 1 < wizard.stepNumber()) dot.classList.add('is-done');
      steps.appendChild(dot);
    }
    const heading = document.createElement('h2');
    heading.className = 'znxstudio-wizard-title';
    heading.textContent = `Step ${wizard.stepNumber()} of ${wizard.total()} — ${wizard.current().title}`;
    inner.append(steps, heading);

    // Step body.
    inner.appendChild(this.renderStep(wizard.current().id));

    // Validation hint.
    const error = wizard.error();
    if (error) {
      const hint = document.createElement('div');
      hint.className = 'znxstudio-wizard-error';
      hint.textContent = error;
      inner.appendChild(hint);
    }

    // Footer buttons.
    const footer = document.createElement('div');
    footer.className = 'znxstudio-wizard-footer';
    const cancel = this.button('Cancel', 'ghost', () => this.close());
    const back = this.button('Back', 'ghost', () => {
      wizard.back();
      this.render();
    });
    back.disabled = wizard.isFirst();
    footer.append(cancel, back);

    if (wizard.isLast()) {
      const finish = this.button('Create Project', 'primary', () => void this.finish());
      finish.disabled = !wizard.canFinish();
      footer.appendChild(finish);
    } else {
      const next = this.button('Next', 'primary', () => {
        wizard.next();
        this.render();
      });
      next.disabled = !wizard.canAdvance();
      footer.appendChild(next);
    }
    inner.appendChild(footer);

    host.replaceChildren(inner);
  }

  private renderStep(id: string): HTMLElement {
    switch (id) {
      case 'template':
        return this.renderTemplateStep();
      case 'details':
        return this.renderDetailsStep();
      case 'dependencies':
        return this.renderDependenciesStep();
      case 'profile':
        return this.renderProfileStep();
      default:
        return this.renderReviewStep();
    }
  }

  private renderTemplateStep(): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'znxstudio-wizard-templates';
    for (const template of PROJECT_TEMPLATES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'znxstudio-template-card';
      if (this.wizard?.state.templateId === template.id) card.classList.add('is-selected');
      const icon = document.createElement('div');
      icon.className = 'znxstudio-template-icon';
      icon.textContent = template.icon;
      const name = document.createElement('div');
      name.className = 'znxstudio-template-name';
      name.textContent = template.label;
      const desc = document.createElement('div');
      desc.className = 'znxstudio-template-desc';
      desc.textContent = template.description;
      card.append(icon, name, desc);
      card.addEventListener('click', () => {
        this.wizard?.update({ templateId: template.id });
        this.render();
      });
      grid.appendChild(card);
    }
    return grid;
  }

  private renderDetailsStep(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'znxstudio-wizard-body';

    const name = document.createElement('input');
    name.className = 'znxstudio-input';
    name.placeholder = 'Project name';
    name.value = this.wizard?.state.name ?? '';
    name.addEventListener('input', () => {
      this.wizard?.update({ name: name.value });
      // Live-validate without stealing focus (re-render footer state only).
      this.refreshFooter();
    });

    const locationRow = document.createElement('div');
    locationRow.className = 'znxstudio-wizard-locationrow';
    const location = document.createElement('span');
    location.className = 'znxstudio-wizard-location';
    location.textContent = this.wizard?.state.location ?? 'No folder chosen';
    const pick = this.button('Choose folder…', 'ghost', async () => {
      const chosen = await window.znxstudio.dialog.openFolder();
      if (chosen) {
        this.wizard?.update({ location: chosen });
        this.render();
      }
    });
    locationRow.append(pick, location);

    body.append(this.label('Name'), name, this.label('Location'), locationRow);
    return body;
  }

  private renderDependenciesStep(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'znxstudio-wizard-body';
    body.appendChild(this.label('Dependencies to add (optional)'));

    const list = document.createElement('div');
    list.className = 'znxstudio-wizard-deplist';
    const specs = this.wizard?.state.dependencies ?? [];
    specs.forEach((spec, index) => {
      const row = document.createElement('div');
      row.className = 'znxstudio-wizard-deprow';
      const text = document.createElement('span');
      text.textContent = spec;
      text.className = 'znxstudio-wizard-depspec';
      const remove = this.button('✕', 'icon', () => {
        const next = [...specs];
        next.splice(index, 1);
        this.wizard?.update({ dependencies: next });
        this.render();
      });
      row.append(text, remove);
      list.appendChild(row);
    });
    body.appendChild(list);

    const addRow = document.createElement('div');
    addRow.className = 'znxstudio-wizard-addrow';
    const input = document.createElement('input');
    input.className = 'znxstudio-input';
    input.placeholder = 'name or name@version';
    const add = () => {
      const value = input.value.trim();
      if (!value) return;
      this.wizard?.update({ dependencies: [...(this.wizard?.state.dependencies ?? []), value] });
      this.render();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') add();
    });
    addRow.append(input, this.button('Add', 'ghost', add));
    body.appendChild(addRow);
    return body;
  }

  private renderProfileStep(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'znxstudio-wizard-body';
    body.appendChild(this.label('Default environment profile for this workspace'));
    for (const profile of ENVIRONMENT_PROFILES) {
      const row = document.createElement('div');
      row.className = 'znxstudio-tree-row znxstudio-profiles-option';
      if (this.wizard?.state.profile === profile) row.classList.add('is-active');
      const mark = document.createElement('span');
      mark.className = 'znxstudio-icon';
      mark.textContent = this.wizard?.state.profile === profile ? '◉' : '○';
      const label = document.createElement('span');
      label.textContent = profileDisplay(profile);
      row.append(mark, label);
      row.addEventListener('click', () => {
        this.wizard?.update({ profile });
        this.render();
      });
      body.appendChild(row);
    }
    return body;
  }

  private renderReviewStep(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'znxstudio-wizard-body';
    const state = this.wizard?.state;
    if (!state) return body;
    const template = PROJECT_TEMPLATES.find((t) => t.id === state.templateId);
    const rows: [string, string][] = [
      ['Template', template?.label ?? '—'],
      ['Name', state.name],
      ['Location', state.location ?? '—'],
      ['Dependencies', state.dependencies.length ? state.dependencies.join(', ') : 'none'],
      ['Profile', profileDisplay(state.profile)],
    ];
    for (const [key, value] of rows) {
      const row = document.createElement('div');
      row.className = 'znxstudio-wizard-reviewrow';
      const k = document.createElement('span');
      k.className = 'znxstudio-wizard-reviewkey';
      k.textContent = key;
      const v = document.createElement('span');
      v.textContent = value;
      row.append(k, v);
      body.appendChild(row);
    }
    return body;
  }

  /** Re-render only the footer's enabled state after a keystroke (keeps input focus). */
  private refreshFooter(): void {
    const wizard = this.wizard;
    const host = this.container;
    if (!wizard || !host) return;
    const next = host.querySelector('.znxstudio-wizard-footer .primary') as HTMLButtonElement | null;
    if (next) next.disabled = wizard.isLast() ? !wizard.canFinish() : !wizard.canAdvance();
  }

  private async finish(): Promise<void> {
    const wizard = this.wizard;
    if (!wizard || !wizard.canFinish()) return;
    let plan: NewProjectPlan;
    try {
      plan = buildNewProjectPlan(wizard.state);
    } catch (error) {
      this.context.layout.showToast((error as Error).message, 'error');
      return;
    }

    let compilerPath: string | null = null;
    if (plan.requiresCompiler) {
      const info = await window.znxstudio.compiler.info();
      if (!info.available) {
        this.context.layout.showToast('Zornux compiler not available — cannot create this project.', 'error');
        return;
      }
      compilerPath = info.path;
    }

    const result = await window.znxstudio.project.scaffold({ ...plan.scaffold, compilerPath });
    if (!result.ok) {
      this.context.layout.showToast(result.error ?? 'Scaffolding failed.', 'error');
      return;
    }

    // Add each dependency via the real `zornux add` (5D), in the new project dir.
    const failed: string[] = [];
    for (const spec of plan.dependencies) {
      const dep = await window.znxstudio.packages.run({ command: 'add', cwd: result.path, args: [spec], compilerPath });
      if (!dep.success) failed.push(spec);
    }

    this.close();
    await this.context.commands.execute(CommandIds.WorkspaceOpenFolder, result.path);

    // Persist the chosen profile for the now-open workspace (5F).
    this.context.services.tryGet<ProfileService>(ServiceKeys.Profile)?.setActive(plan.profile);

    if (failed.length) {
      this.context.layout.showToast(`Created “${result.name}”, but these deps failed: ${failed.join(', ')}.`, 'error');
    } else {
      this.context.layout.showToast(`Created “${result.name}” from the wizard.`, 'success');
    }
  }

  private close(): void {
    this.wizard = undefined;
    this.container = undefined;
    this.context.commands.executeFromUi(CommandIds.ViewWelcome);
  }

  /* ----- small DOM helpers ----- */
  private label(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-wizard-label';
    el.textContent = text;
    return el;
  }

  private button(text: string, kind: 'primary' | 'ghost' | 'icon', onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = kind === 'icon' ? 'znxstudio-icon-btn' : `znxstudio-btn ${kind}`;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
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

    // Drive the wizard engine headlessly through a full flow, then execute the
    // plan against the real services into a disposable TEMP dir.
    try {
      const wizard = new Wizard<NewProjectState>(newProjectSteps(), initialNewProjectState());
      log(`wizard start: step=${wizard.stepNumber()}/${wizard.total()} canAdvance=${wizard.canAdvance()} (expect false — no template)`);
      wizard.update({ templateId: 'zornux-cli' });
      log(`wizard after template: canAdvance=${wizard.canAdvance()} advanced=${wizard.next()}`);

      const name = `wiz-selftest-${Date.now()}`;
      wizard.update({ name, location: 'C:\\Users\\jerem\\AppData\\Local\\Temp\\znxstudio-5h' });
      log(`wizard details: error=${wizard.error() ?? 'none'} advanced=${wizard.next()}`);
      wizard.update({ dependencies: ['MissingPkg@1.0.0'] });
      log(`wizard deps: error=${wizard.error() ?? 'none'} advanced=${wizard.next()}`);
      wizard.update({ profile: 'production' });
      wizard.next();
      log(`wizard review: isLast=${wizard.isLast()} canFinish=${wizard.canFinish()}`);

      const plan = buildNewProjectPlan(wizard.state);
      log(`wizard plan: runInit=${plan.scaffold.runZornuxInit} requiresCompiler=${plan.requiresCompiler} deps=${plan.dependencies.length} profile=${plan.profile}`);

      const info = await window.znxstudio.compiler.info();
      if (!info.available) {
        log('wizards: compiler unavailable, skipping execution');
        return;
      }
      const scaffolded = await window.znxstudio.project.scaffold({ ...plan.scaffold, compilerPath: info.path });
      log(`wizard scaffold: ok=${scaffolded.ok} path=${scaffolded.path} error=${scaffolded.error ?? '-'}`);
      if (scaffolded.ok) {
        // The dependency is intentionally unresolvable → add should fail cleanly.
        const dep = await window.znxstudio.packages.run({ command: 'add', cwd: scaffolded.path, args: plan.dependencies[0].split('@')[0] ? [plan.dependencies[0]] : [], compilerPath: info.path });
        log(`wizard dep add(${plan.dependencies[0]}): success=${dep.success} firstDiag=${dep.diagnostics[0]?.code ?? dep.message.slice(0, 30)}`);
      }
    } catch (error) {
      log(`wizards self-test failed: ${(error as Error).message}`);
    }
  }
}
