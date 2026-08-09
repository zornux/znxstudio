import { ServiceKeys, type InputBoxService, type TrustService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import type { WorkspaceType } from '../../shared/types';
import { buildSolution, type Solution, type SolutionProject } from './solutionModel';
import type { ProjectReferenceGraph, ProjectReferencesService, ResolvedReference } from './projectReferences';
import { examplePath, examplesParent } from '../core/selftestFixtures';
import { joinPath } from '../explorer/paths';

const TYPE_LABEL: Record<WorkspaceType, string> = {
  'zornux-api': 'Zornux API',
  'zoijs-frontend': 'Zoijs Frontend',
  'zornux-zoijs-fullstack': 'Zornux + Zoijs',
  generic: 'Generic',
};

const TYPE_ICON: Record<WorkspaceType, string> = {
  'zornux-api': 'Z',
  'zoijs-frontend': 'UI',
  'zornux-zoijs-fullstack': '◇',
  generic: '▧',
};

/**
 * The Solution Explorer — a project-centric logical view of the (multi-root)
 * workspace: Solution → Projects, each showing its type, version, targets,
 * scripts and problem count. Complements the file-oriented Project Explorer;
 * both are sidebar views swapped via the activity bar. Consumes WorkspaceService
 * (multi-root `folders()` + `onDidChangeFolders`) only.
 */
export class SolutionExplorerModule implements IModule {
  readonly id = 'znxstudio.solution';
  readonly displayName = 'Solution Explorer';

  private context!: ModuleContext;
  private workspace!: WorkspaceService;
  private references: ProjectReferencesService | undefined;
  private container!: HTMLElement;
  private readonly scriptRows: HTMLElement[] = [];
  private readonly packageActionRows: HTMLElement[] = [];
  private renderSequence = 0;
  private packageBusy = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    this.references = context.services.tryGet<ProjectReferencesService>(ServiceKeys.ProjectReferences);

    this.container = document.createElement('div');
    this.container.className = 'znxstudio-solution';

    context.layout.addActivityItem({
      id: 'solution',
      label: 'Solution',
      icon: '◇',
      onSelect: () => {
        context.layout.setSideBar('Solution', this.shell());
        context.layout.focusSideBar();
      },
    });

    this.workspace.onDidChangeFolders(() => void this.render());
    context.subscriptions.push(
      context.commands.onDidChangeEnablement(() => this.refreshScriptRows()),
    );
    const trust = context.services.tryGet<TrustService>(ServiceKeys.Trust);
    if (trust) {
      context.subscriptions.push(trust.onDidChange(() => this.refreshPackageActions()));
    }
    void this.render();
    void selfTestCoordinator.run('solution-explorer', () => this.maybeSelfTest());
  }

  /** Sidebar body: a toolbar (add folder) + the solution tree container. */
  private shell(): HTMLElement {
    const shell = document.createElement('div');
    shell.className = 'znxstudio-solution-shell';

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-explorer-toolbar';
    const add = document.createElement('button');
    add.className = 'znxstudio-icon-btn';
    add.title = 'Add Folder to Workspace';
    add.setAttribute('aria-label', 'Add Folder to Workspace');
    add.textContent = '➕';
    add.addEventListener('click', () => this.executeIfEnabled(CommandIds.WorkspaceAddFolder));
    toolbar.appendChild(add);

    shell.append(toolbar, this.container);
    return shell;
  }

  private async render(): Promise<void> {
    const sequence = ++this.renderSequence;
    this.scriptRows.length = 0;
    this.packageActionRows.length = 0;
    const folders = this.workspace.folders();
    if (folders.length === 0) {
      this.renderEmpty();
      return;
    }
    const solution = buildSolution(folders);
    // Resolve the reference graph between the open projects (5C).
    let graph: ProjectReferenceGraph | undefined;
    let referenceError = '';
    try {
      graph = await this.references?.graphFor(folders);
    } catch (error) {
      referenceError = (error as Error).message;
    }
    if (
      sequence !== this.renderSequence ||
      !sameRoots(folders.map((folder) => folder.root), this.workspace.folders().map((folder) => folder.root))
    ) return;
    const fragment = document.createDocumentFragment();
    fragment.appendChild(this.renderSolutionHeader(solution));
    if (referenceError) {
      const warning = document.createElement('div');
      warning.className = 'znxstudio-solution-detail';
      warning.textContent = `Could not resolve project references: ${referenceError}`;
      fragment.appendChild(warning);
      this.context.layout.showToast('Project references could not be refreshed.', 'error');
    }
    for (const project of solution.projects) {
      fragment.appendChild(this.renderProject(project, graph));
    }
    this.container.replaceChildren(fragment);
    this.refreshPackageActions();
  }

  private renderEmpty(): void {
    const wrap = document.createElement('div');
    wrap.className = 'znxstudio-explorer-empty';
    const message = document.createElement('p');
    message.textContent = 'No solution open';
    const button = document.createElement('button');
    button.className = 'znxstudio-btn';
    button.textContent = 'Open Folder';
    button.addEventListener('click', () => this.executeIfEnabled(CommandIds.WorkspaceOpenFolder));
    wrap.append(message, button);
    this.container.replaceChildren(wrap);
  }

  private renderSolutionHeader(solution: Solution): HTMLElement {
    const header = document.createElement('div');
    header.className = 'znxstudio-solution-header';
    const projectWord = solution.projectCount === 1 ? 'project' : 'projects';
    const count = solution.projects.length;
    const folderWord = count === 1 ? 'folder' : 'folders';
    header.textContent = `Solution '${solution.name}' — ${solution.projectCount} ${projectWord}, ${count} ${folderWord}`;
    return header;
  }

  private renderProject(project: SolutionProject, graph?: ProjectReferenceGraph): HTMLElement {
    const item = document.createElement('div');
    item.className = 'znxstudio-solution-project';

    const row = document.createElement('div');
    row.className = 'znxstudio-tree-row';
    row.title = project.root;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-expanded', 'false');
    row.setAttribute('aria-label', `${project.name}, ${project.isProject ? TYPE_LABEL[project.type] : 'folder'}`);

    const twisty = document.createElement('span');
    twisty.className = 'znxstudio-icon';
    twisty.textContent = '▸';
    const icon = document.createElement('span');
    icon.className = 'znxstudio-icon';
    icon.textContent = TYPE_ICON[project.type];
    const name = document.createElement('span');
    name.className = 'znxstudio-solution-project-name';
    name.textContent = project.name;

    const badge = document.createElement('span');
    badge.className = 'znxstudio-solution-badge';
    badge.textContent = project.isProject
      ? `${TYPE_LABEL[project.type]}${project.version ? ` v${project.version}` : ''}`
      : 'folder';

    row.append(twisty, icon, name, badge);
    if (project.problemCount > 0) {
      const problems = document.createElement('span');
      problems.className = 'znxstudio-solution-problems';
      problems.title = `${project.problemCount} project problem(s)`;
      problems.textContent = `⚠ ${project.problemCount}`;
      row.appendChild(problems);
    }

    const details = this.renderProjectDetails(project, graph);
    details.style.display = 'none';
    const setExpanded = (expanded: boolean): void => {
      details.style.display = expanded ? '' : 'none';
      twisty.textContent = expanded ? '▾' : '▸';
      row.setAttribute('aria-expanded', String(expanded));
    };
    row.addEventListener('click', () => setExpanded(row.getAttribute('aria-expanded') !== 'true'));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setExpanded(row.getAttribute('aria-expanded') !== 'true');
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setExpanded(true);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setExpanded(false);
      }
    });

    item.append(row, details);
    return item;
  }

  private renderProjectDetails(project: SolutionProject, graph?: ProjectReferenceGraph): HTMLElement {
    const details = document.createElement('div');
    details.className = 'znxstudio-solution-details';

    if (project.targets.length) {
      const targets = document.createElement('div');
      targets.className = 'znxstudio-solution-detail';
      targets.textContent = `Targets: ${project.targets.join(', ')}`;
      details.appendChild(targets);
    }

    // Dependencies (5C references + 5D manage: add / remove / restore).
    const references = graph?.references.get(project.root) ?? [];
    const header = document.createElement('div');
    header.className = 'znxstudio-explorer-section-header';
    header.textContent = 'Dependencies';
    details.appendChild(header);
    for (const reference of references) details.appendChild(this.renderReference(reference, project.root));
    details.appendChild(this.renderAddDependency(project.root));

    const restore = document.createElement('div');
    restore.className = 'znxstudio-solution-detail znxstudio-solution-action';
    restore.textContent = '⟳ Restore dependencies';
    this.makePackageAction(restore, () => void this.runPackage('restore', project.root, []));
    details.appendChild(restore);

    if (project.scripts.length) {
      const scriptsHeader = document.createElement('div');
      scriptsHeader.className = 'znxstudio-explorer-section-header';
      scriptsHeader.textContent = 'Scripts';
      details.appendChild(scriptsHeader);
      for (const script of project.scripts) {
        const scriptRow = document.createElement('div');
        scriptRow.className = 'znxstudio-tree-row';
        scriptRow.innerHTML = `<span class="znxstudio-icon">▶</span>`;
        scriptRow.append(script);
        scriptRow.tabIndex = 0;
        scriptRow.setAttribute('role', 'button');
        const run = (event: Event): void => {
          event.stopPropagation();
          if (this.context.commands.isEnabled(CommandIds.RunScript)) {
            this.context.commands.executeFromUi(CommandIds.RunScript, undefined, script, project.root);
          }
        };
        scriptRow.addEventListener('click', run);
        scriptRow.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            run(event);
          }
        });
        this.scriptRows.push(scriptRow);
        details.appendChild(scriptRow);
      }
      this.refreshScriptRows();
    }

    const remove = document.createElement('div');
    remove.className = 'znxstudio-solution-detail znxstudio-solution-action';
    remove.textContent = 'Remove from workspace';
    remove.tabIndex = 0;
    remove.setAttribute('role', 'button');
    const removeProject = (event: Event): void => {
      event.stopPropagation();
      this.executeIfEnabled(CommandIds.WorkspaceRemoveFolder, project.root);
    };
    remove.addEventListener('click', removeProject);
    remove.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        removeProject(event);
      }
    });
    details.appendChild(remove);

    return details;
  }

  private refreshScriptRows(): void {
    const enabled = this.context.commands.has(CommandIds.RunScript) &&
      this.context.commands.isEnabled(CommandIds.RunScript);
    for (const row of this.scriptRows) {
      row.classList.toggle('is-disabled', !enabled);
      row.setAttribute('aria-disabled', String(!enabled));
      row.tabIndex = enabled ? 0 : -1;
    }
  }

  private executeIfEnabled(id: string, ...args: unknown[]): void {
    if (this.context.commands.has(id) && this.context.commands.isEnabled(id)) {
      this.context.commands.executeFromUi(id, undefined, ...args);
    }
  }

  /** One reference row: internal (→ another open project) or an external package, with a remove action. */
  private renderReference(reference: ResolvedReference, projectRoot: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-solution-detail znxstudio-solution-ref';
    const { dependency } = reference;
    const scope = dependency.registry ? ` from ${dependency.registry}` : '';
    const label = document.createElement('span');
    label.className = 'znxstudio-solution-ref-label';
    if (reference.internal) {
      row.classList.add('is-internal');
      label.textContent = `→ ${dependency.name} ${dependency.constraint}`;
      row.title = `Internal reference — resolves to the open project (v${reference.targetVersion ?? '?'})`;
    } else if (reference.ambiguous) {
      label.textContent = `${dependency.name} ${dependency.constraint} · ⚠ multiple matching projects`;
      row.title = 'Ambiguous internal dependency — more than one open project declares this package name';
    } else {
      label.textContent = `${dependency.name} ${dependency.constraint}${scope}`;
      row.title = 'External dependency (registry / package)';
    }

    const remove = document.createElement('button');
    remove.className = 'znxstudio-icon-btn';
    remove.title = `Remove dependency ${dependency.name}`;
    remove.setAttribute('aria-label', `Remove dependency ${dependency.name}`);
    remove.textContent = '✕';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.confirmRemoveDependency(projectRoot, dependency.name);
    });
    this.packageActionRows.push(remove);

    row.append(label, remove);
    return row;
  }

  /** "+ Add dependency" that expands into a small name/version form. */
  private renderAddDependency(root: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'znxstudio-solution-detail';

    const link = document.createElement('span');
    link.className = 'znxstudio-solution-action';
    link.textContent = '+ Add dependency';
    this.makePackageAction(link, () => {
      const form = document.createElement('div');
      form.className = 'znxstudio-solution-addform';
      const name = document.createElement('input');
      name.className = 'znxstudio-input';
      name.placeholder = 'name';
      const version = document.createElement('input');
      version.className = 'znxstudio-input';
      version.placeholder = 'version (optional)';
      const submit = document.createElement('button');
      submit.className = 'znxstudio-btn';
      submit.textContent = 'Add';
      const run = () => {
        const packageName = name.value.trim();
        if (!packageName) return;
        const spec = version.value.trim() ? `${packageName}@${version.value.trim()}` : packageName;
        void this.runPackage('add', root, [spec]);
      };
      this.makePackageAction(submit, run);
      this.refreshPackageActions();
      name.addEventListener('keydown', (keyEvent) => {
        if (keyEvent.key === 'Enter') run();
      });
      form.append(name, version, submit);
      wrap.replaceChildren(form);
      name.focus();
    });

    wrap.append(link);
    return wrap;
  }

  /** Run a `zornux` package op, report the outcome, and refresh the view. */
  private async runPackage(command: 'add' | 'remove' | 'restore', root: string, args: string[]): Promise<void> {
    if (this.packageBusy) return;
    const trust = this.context.services.tryGet<TrustService>(ServiceKeys.Trust);
    if (trust && !trust.requireTrust('Manage project dependencies')) return;
    if (!this.workspace.folders().some((folder) => folder.root === root)) {
      this.context.layout.showToast('That project is no longer in the workspace.', 'info');
      return;
    }
    this.packageBusy = true;
    this.refreshPackageActions();
    try {
      const info = await window.znxstudio.compiler.info();
      if (!info.available) {
        this.context.layout.showToast('Zornux compiler not available — cannot manage packages.', 'error');
        return;
      }
      const result = await window.znxstudio.packages.run({ command, cwd: root, args, compilerPath: info.path });
      if (result.success) {
        this.context.layout.showToast(result.message || `zornux ${command} succeeded.`, 'success');
      } else {
        const detail = result.diagnostics[0]?.message ?? result.message ?? `zornux ${command} failed.`;
        this.context.layout.showToast(detail, 'error');
      }
    } catch (error) {
      this.context.layout.showToast(`Package operation failed: ${(error as Error).message}`, 'error');
    } finally {
      this.packageBusy = false;
      this.refreshPackageActions();
      void this.render();
    }
  }

  private async confirmRemoveDependency(root: string, name: string): Promise<void> {
    if (this.packageBusy) return;
    const input = this.context.services.get<InputBoxService>(ServiceKeys.InputBox);
    const confirmed = await input.confirm({
      title: `Remove Dependency ${name}?`,
      message: 'This updates the project manifest and may change the lockfile.',
      confirmLabel: 'Remove Dependency',
      danger: true,
    });
    if (confirmed) await this.runPackage('remove', root, [name]);
  }

  private makePackageAction(element: HTMLElement, action: () => void): void {
    element.tabIndex = 0;
    element.setAttribute('role', 'button');
    const activate = (event: Event): void => {
      event.stopPropagation();
      if (element.getAttribute('aria-disabled') !== 'true') action();
    };
    element.addEventListener('click', activate);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate(event);
      }
    });
    this.packageActionRows.push(element);
  }

  private refreshPackageActions(): void {
    const enabled = (this.context.services.tryGet<TrustService>(ServiceKeys.Trust)?.isTrusted() ?? true) && !this.packageBusy;
    for (const action of this.packageActionRows) {
      action.classList.toggle('is-disabled', !enabled);
      action.setAttribute('aria-disabled', String(!enabled));
      action.tabIndex = enabled ? 0 : -1;
      if (action instanceof HTMLButtonElement) action.disabled = !enabled;
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

    try {
      // Build a solution from two real folders (non-invasive; the live workspace
      // is untouched — see WorkspaceModule's self-test for the same approach).
      const rootDir = await examplesParent();
      const webDir = await examplePath('web');
      if (!rootDir || !webDir) {
        log('solution: skipped (no examples root)');
        return;
      }
      const [infoA, infoB] = await Promise.all([
        window.znxstudio.workspace.load(rootDir),
        window.znxstudio.workspace.load(webDir),
      ]);
      const solution = buildSolution([infoA, infoB]);
      log(
        `solution: name='${solution.name}' projects=${solution.projectCount}/${solution.projects.length}`,
      );
      for (const project of solution.projects) {
        log(
          `solution project: name=${project.name} type=${project.type} isProject=${project.isProject} v=${project.version ?? '-'} scripts=${project.scripts.length} targets=${project.targets.length} problems=${project.problemCount}`,
        );
      }
      log(`solution live view: folders=${this.workspace.folders().length} (empty in headless)`);

      // 5D: exercise the real `zornux` package commands. Success path runs in a
      // TEMP dir (any lockfile lands in disposable temp, never the repo); the
      // failure path uses `app`, whose dependency can't resolve its unconfigured
      // registry — and which, verified, writes no lockfile on failure.
      const info = await window.znxstudio.compiler.info();
      if (info.available) {
        const tempDir = (await window.znxstudio.app.getInfo()).tempDir;
        if (!tempDir) {
          log('solution: skipped (no temp dir)');
          return;
        }
        await window.znxstudio.fs.writeFile(joinPath(tempDir, 'zornux.project'), 'name = znxstudio-pkg-selftest\nversion = 0.1.0\n');
        const ok = await window.znxstudio.packages.run({ command: 'restore', cwd: tempDir, args: [], compilerPath: info.path });
        log(`packages restore(temp, no deps): success=${ok.success} msg="${ok.message.slice(0, 40)}"`);
        const bad = await window.znxstudio.packages.run({
          command: 'restore',
          cwd: await examplePath('registry', 'app'),
          args: [],
          compilerPath: info.path,
        });
        log(
          `packages restore(app, unresolvable): success=${bad.success} diagnostics=${bad.diagnostics.length} first=${bad.diagnostics[0]?.code ?? bad.message.slice(0, 40) ?? '-'}`,
        );
      }
    } catch (error) {
      log(`solution self-test failed: ${(error as Error).message}`);
    }
  }
}

function sameRoots(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((root, index) => root === b[index]);
}
