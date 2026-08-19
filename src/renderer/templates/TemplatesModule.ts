import { ServiceKeys, type EditorService, type InputBoxService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import { tempPath } from '../core/selftestFixtures';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { PROJECT_TEMPLATES, findTemplate, renderTemplate, type ProjectTemplate } from '../../shared/templates';
import { validateProjectName } from '../wizards/newProjectWizard';
import { joinPath } from '../explorer/paths';

/**
 * Project Templates (Phase 5G). A gallery of starter templates shown as an
 * editor overlay. Picking one prompts for a name + location and scaffolds the
 * project — Zornux templates via the REAL `zornux init` (authoritative
 * zornux.project) plus the template's files — then opens it as the workspace.
 * Registered as the `TemplateNew` command and reachable from Welcome + palette.
 */
export class TemplatesModule implements IModule {
  readonly id = 'znxstudio.templates';
  readonly displayName = 'Project Templates';

  private context!: ModuleContext;
  private scaffolding = false;

  activate(context: ModuleContext): void {
    this.context = context;
    context.commands.register(CommandIds.TemplateNew, () => this.showGallery(), 'Project: New from Template…');
    void selfTestCoordinator.run('templates', () => this.maybeSelfTest());
  }

  private showGallery(): void {
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    editor?.showView(this.buildGallery());
  }

  private buildGallery(): HTMLElement {
    const view = document.createElement('div');
    view.className = 'znxstudio-templates';

    const inner = document.createElement('div');
    inner.className = 'znxstudio-templates-inner';

    const title = document.createElement('h1');
    title.className = 'znxstudio-templates-title';
    title.textContent = 'New Project';
    const tag = document.createElement('p');
    tag.className = 'znxstudio-templates-tag';
    tag.textContent = 'Choose a template to scaffold a new Zornux or Zoijs project.';
    inner.append(title, tag);

    const grid = document.createElement('div');
    grid.className = 'znxstudio-templates-grid';
    for (const template of PROJECT_TEMPLATES) grid.appendChild(this.buildCard(template));
    inner.appendChild(grid);

    view.appendChild(inner);
    return view;
  }

  private buildCard(template: ProjectTemplate): HTMLElement {
    const card = document.createElement('button');
    card.className = 'znxstudio-template-card';
    card.type = 'button';
    card.disabled = this.scaffolding;

    const icon = document.createElement('div');
    icon.className = 'znxstudio-template-icon';
    icon.textContent = template.icon;

    const name = document.createElement('div');
    name.className = 'znxstudio-template-name';
    name.textContent = template.label;

    const desc = document.createElement('div');
    desc.className = 'znxstudio-template-desc';
    desc.textContent = template.description;

    const badge = document.createElement('span');
    badge.className = 'znxstudio-template-badge';
    badge.textContent = template.runZornuxInit ? 'zornux init' : 'files only';

    card.append(icon, name, desc, badge);
    card.addEventListener('click', () => void this.scaffold(template));
    return card;
  }

  private async scaffold(template: ProjectTemplate): Promise<void> {
    if (this.scaffolding) return;
    this.setScaffolding(true);
    try {
      const input = this.context.services.get<InputBoxService>(ServiceKeys.InputBox);
      const value = await input.prompt({
        title: `Create ${template.label}`,
        label: 'Project name',
        value: 'my-zornux-app',
        placeholder: 'Letters, numbers, hyphens, underscores, and dots',
        submitLabel: 'Choose Location',
        validate: validateProjectName,
      });
      if (value === null) return;
      const name = value.trim();

      const location = await window.znxstudio.dialog.openFolder();
      if (!location) return;

      const rendered = renderTemplate(template, name);
      let compilerPath: string | null = null;
      if (rendered.runZornuxInit) {
        const info = await window.znxstudio.compiler.info();
        if (!info.available) {
          this.context.layout.showToast('Zornux compiler not available — cannot scaffold a Zornux project.', 'error');
          return;
        }
        compilerPath = info.path;
      }

      const result = await window.znxstudio.project.scaffold({
        name,
        location,
        runZornuxInit: rendered.runZornuxInit,
        vendorZoijsDir: rendered.vendorZoijsDir,
        files: rendered.files,
        compilerPath,
      });

      if (!result.ok) {
        this.context.layout.showToast(result.error ?? 'Scaffolding failed.', 'error');
        return;
      }
      this.context.layout.showToast(`Created “${result.name}” from ${template.label}.`, 'success');
      await this.context.commands.execute(CommandIds.WorkspaceOpenFolder, result.path);
    } catch (error) {
      this.context.layout.showToast(`Could not create project: ${(error as Error).message}`, 'error');
    } finally {
      this.setScaffolding(false);
    }
  }

  private setScaffolding(value: boolean): void {
    this.scaffolding = value;
    for (const card of document.querySelectorAll<HTMLButtonElement>('.znxstudio-template-card')) {
      card.disabled = value;
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

    // Pure rendering is covered exhaustively by the unit suite. Here we prove the
    // real scaffold path end-to-end into a disposable TEMP dir, incl. the actual
    // `zornux init`, then verify the authoritative zornux.project landed.
    try {
      const info = await window.znxstudio.compiler.info();
      if (!info.available) {
        log('templates: compiler unavailable, skipping scaffold');
        return;
      }
      // Unique name per run so `zornux init` never hits an existing project.
      const name = `tmpl-selftest-${Date.now()}`;
      const location = await tempPath('znxstudio-5g');
      if (!location) {
        log('templates: scaffold skipped (no temp dir)');
        return;
      }

      const cli = findTemplate('zornux-cli')!;
      const rendered = renderTemplate(cli, name);
      const result = await window.znxstudio.project.scaffold({
        name,
        location,
        runZornuxInit: rendered.runZornuxInit,
        files: rendered.files,
        compilerPath: info.path,
      });
      log(`templates scaffold(zornux-cli): ok=${result.ok} path=${result.path} error=${result.error ?? '-'}`);

      if (result.ok) {
        // Verify init's authoritative manifest + the template's overrides exist.
        const dir = await window.znxstudio.fs.readDirectory(result.path);
        const names = dir.map((n) => n.name);
        const manifest = await window.znxstudio.fs.readFile(joinPath(result.path, 'zornux.project')).catch(() => '');
        log(`templates scaffold entries=[${names.join(', ')}] manifestHasName=${manifest.includes(name)}`);
        const main = await window.znxstudio.fs.readFile(joinPath(joinPath(result.path, 'src'), 'main.zx')).catch(() => '');
        log(`templates main.zx overridden=${main.includes(name)} (template greeting present)`);
      }

      // The Zoijs template needs no compiler (files only).
      const zoijs = findTemplate('zoijs-frontend')!;
      const zoijsRendered = renderTemplate(zoijs, `${name}-web`);
      const zoijsResult = await window.znxstudio.project.scaffold({
        name: `${name}-web`,
        location,
        runZornuxInit: zoijsRendered.runZornuxInit,
        files: zoijsRendered.files,
        compilerPath: null,
      });
      log(`templates scaffold(zoijs-frontend, files-only): ok=${zoijsResult.ok} runInit=${zoijsRendered.runZornuxInit}`);
    } catch (error) {
      log(`templates self-test failed: ${(error as Error).message}`);
    }
  }
}
