import { ServiceKeys, type InputBoxService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import {
  parsePackageInfo,
  parseRegistryList,
  parseSearchResults,
  type PackageInfo,
  type PackageSearchResult,
  type RegistryEntry,
} from '../../shared/packageQuery';

/**
 * The Package Manager — a browsing/registry surface over the real `zornux`
 * package commands (search / info / registry list-add-remove / add). It
 * operates in the PRIMARY workspace folder (registries and search are scoped to
 * a project's zornux.project). A separate sidebar view (activity 📦) from the
 * file/solution explorers; installs reuse the 5D `packages.run('add')` path so
 * the Solution Explorer's dependency view stays the source of truth for what's
 * installed. All results are text parsed by the pure `packageQuery` helpers.
 */
export class PackageManagerModule implements IModule {
  readonly id = 'znxstudio.packages';
  readonly displayName = 'Package Manager';

  private context!: ModuleContext;
  private workspace!: WorkspaceService;
  private container!: HTMLElement;
  private searchInput?: HTMLInputElement;
  private searchButton?: HTMLButtonElement;
  private registryFilter?: HTMLSelectElement;
  private results: PackageSearchResult[] = [];
  private registries: RegistryEntry[] = [];
  private searchStatus = '';
  private searchSequence = 0;
  private registrySequence = 0;
  private searching = false;
  private readonly pendingPackages = new Set<string>();

  activate(context: ModuleContext): void {
    this.context = context;
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);

    this.container = document.createElement('div');
    this.container.className = 'znxstudio-packages';

    context.layout.addActivityItem({
      id: 'packages',
      label: 'Packages',
      icon: '📦',
      onSelect: () => {
        context.layout.setSideBar('Packages', this.shell());
        context.layout.focusSideBar();
        void this.refreshRegistries();
      },
    });

    this.workspace.onDidChangeWorkspace(() => {
      this.searchSequence += 1;
      this.registrySequence += 1;
      this.searching = false;
      this.updateSearchButton();
      this.results = [];
      this.searchStatus = '';
      void this.refreshRegistries();
    });

    void selfTestCoordinator.run('package-manager', () => this.maybeSelfTest());
  }

  /** Sidebar body: search box + registry filter, results, and a registries section. */
  private shell(): HTMLElement {
    const shell = document.createElement('div');
    shell.className = 'znxstudio-packages-shell';

    const bar = document.createElement('div');
    bar.className = 'znxstudio-packages-searchbar';

    const input = document.createElement('input');
    input.className = 'znxstudio-input';
    input.placeholder = 'Search packages…';
    input.setAttribute('aria-label', 'Search packages');
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void this.runSearch();
    });
    this.searchInput = input;

    const filter = document.createElement('select');
    filter.className = 'znxstudio-select';
    filter.setAttribute('aria-label', 'Registry filter');
    this.registryFilter = filter;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'znxstudio-btn';
    button.textContent = 'Search';
    button.addEventListener('click', () => void this.runSearch());
    this.searchButton = button;

    bar.append(input, filter, button);
    shell.append(bar, this.container);
    this.renderRegistryFilter();
    this.render();
    return shell;
  }

  private hasWorkspace(): boolean {
    return this.workspace.currentFolder() !== null;
  }

  /* -------------------------------------------------------------- searching */

  private async runSearch(): Promise<void> {
    const term = this.searchInput?.value.trim() ?? '';
    const cwd = this.workspace.currentFolder();
    if (!cwd) {
      this.context.layout.showToast('Open a folder to search packages.', 'error');
      return;
    }
    if (!term) {
      this.searchSequence += 1;
      this.searching = false;
      this.results = [];
      this.searchStatus = '';
      this.updateSearchButton();
      this.render();
      return;
    }
    if (this.searching) return;

    const sequence = ++this.searchSequence;
    this.searching = true;
    this.updateSearchButton();
    this.searchStatus = 'Searching…';
    this.results = [];
    this.render();
    try {
      const compilerPath = await this.compilerPath();
      if (compilerPath === null || !this.isCurrentWorkspace(cwd, sequence, 'search')) return;
      const registry = this.registryFilter?.value || undefined;
      const raw = await window.znxstudio.packages.query({ command: 'search', cwd, args: [term], registry, compilerPath });
      if (!this.isCurrentWorkspace(cwd, sequence, 'search')) return;
      const outcome = parseSearchResults(raw.exitCode, raw.stdout, raw.stderr);
      if (outcome.diagnostics.length > 0) {
        this.context.layout.showToast(outcome.diagnostics[0].message, 'error');
        this.searchStatus = outcome.diagnostics[0].message;
        this.results = [];
      } else {
        this.results = outcome.results;
        this.searchStatus = outcome.results.length === 0 ? `No packages match “${term}”.` : '';
      }
    } catch (error) {
      if (!this.isCurrentWorkspace(cwd, sequence, 'search')) return;
      this.searchStatus = `Search failed: ${(error as Error).message}`;
      this.context.layout.showToast('Package search failed.', 'error');
    } finally {
      if (sequence === this.searchSequence) {
        this.searching = false;
        this.updateSearchButton();
        this.render();
      }
    }
  }

  private async showInfo(pkg: PackageSearchResult, host: HTMLElement): Promise<void> {
    const cwd = this.workspace.currentFolder();
    if (!cwd) return;
    host.textContent = 'Loading versions…';
    try {
      const compilerPath = await this.compilerPath();
      if (compilerPath === null || this.workspace.currentFolder() !== cwd) return;
      const raw = await window.znxstudio.packages.query({ command: 'info', cwd, args: [pkg.name], compilerPath });
      if (!host.isConnected || this.workspace.currentFolder() !== cwd) return;
      const outcome = parsePackageInfo(raw.exitCode, raw.stdout, raw.stderr);
      if (outcome.info) {
        host.replaceChildren(this.renderInfo(outcome.info));
      } else {
        host.textContent = outcome.diagnostics[0]?.message ?? 'No version information.';
      }
    } catch (error) {
      if (host.isConnected) host.textContent = `Could not load versions: ${(error as Error).message}`;
    }
  }

  private async install(pkg: PackageSearchResult): Promise<void> {
    const cwd = this.workspace.currentFolder();
    if (!cwd) return;
    const spec = `${pkg.name}@${pkg.version}`;
    if (this.pendingPackages.has(spec)) return;
    this.pendingPackages.add(spec);
    this.render();
    try {
      const compilerPath = await this.compilerPath();
      if (compilerPath === null || this.workspace.currentFolder() !== cwd) return;
      const result = await window.znxstudio.packages.run({ command: 'add', cwd, args: [spec], compilerPath });
      if (result.success) {
        this.context.layout.showToast(result.message || `Added ${spec}.`, 'success');
      } else {
        this.context.layout.showToast(result.diagnostics[0]?.message ?? result.message ?? `Adding ${spec} failed.`, 'error');
      }
    } catch (error) {
      this.context.layout.showToast(`Adding ${spec} failed: ${(error as Error).message}`, 'error');
    } finally {
      this.pendingPackages.delete(spec);
      this.render();
    }
  }

  /* ------------------------------------------------------------ registries */

  private async refreshRegistries(): Promise<void> {
    const cwd = this.workspace.currentFolder();
    const sequence = ++this.registrySequence;
    if (!cwd) {
      this.registries = [];
      this.renderRegistryFilter();
      this.render();
      return;
    }
    try {
      const compilerPath = await this.compilerPath(false);
      if (compilerPath === null || !this.isCurrentWorkspace(cwd, sequence, 'registry')) return;
      const raw = await window.znxstudio.packages.query({ command: 'registry', cwd, args: ['list'], compilerPath });
      if (!this.isCurrentWorkspace(cwd, sequence, 'registry')) return;
      this.registries = raw.exitCode === 0 ? parseRegistryList(raw.stdout) : [];
    } catch (error) {
      if (!this.isCurrentWorkspace(cwd, sequence, 'registry')) return;
      this.registries = [];
      this.context.layout.showToast(`Could not load registries: ${(error as Error).message}`, 'error');
    } finally {
      this.render();
      if (sequence === this.registrySequence) this.renderRegistryFilter();
    }
  }

  private async addRegistry(name: string, location: string): Promise<void> {
    const cwd = this.workspace.currentFolder();
    if (!cwd) return;
    try {
      const compilerPath = await this.compilerPath();
      if (compilerPath === null || this.workspace.currentFolder() !== cwd) return;
      const result = await window.znxstudio.packages.run({ command: 'registry', cwd, args: ['add', name, location], compilerPath });
      if (result.success) this.context.layout.showToast(result.message || `Added registry ${name}.`, 'success');
      else this.context.layout.showToast(result.diagnostics[0]?.message ?? result.message ?? 'Adding registry failed.', 'error');
      await this.refreshRegistries();
    } catch (error) {
      this.context.layout.showToast(`Adding registry failed: ${(error as Error).message}`, 'error');
    }
  }

  private async removeRegistry(name: string): Promise<void> {
    const cwd = this.workspace.currentFolder();
    if (!cwd) return;
    const input = this.context.services.get<InputBoxService>(ServiceKeys.InputBox);
    const confirmed = await input.confirm({
      title: `Remove Registry ${name}?`,
      message: 'Packages available only through this registry will no longer be discoverable.',
      confirmLabel: 'Remove Registry',
      danger: true,
    });
    if (!confirmed || this.workspace.currentFolder() !== cwd) return;
    try {
      const compilerPath = await this.compilerPath();
      if (compilerPath === null || this.workspace.currentFolder() !== cwd) return;
      const result = await window.znxstudio.packages.run({ command: 'registry', cwd, args: ['remove', name], compilerPath });
      if (result.success) this.context.layout.showToast(result.message || `Removed registry ${name}.`, 'success');
      else this.context.layout.showToast(result.diagnostics[0]?.message ?? result.message ?? 'Removing registry failed.', 'error');
      await this.refreshRegistries();
    } catch (error) {
      this.context.layout.showToast(`Removing registry failed: ${(error as Error).message}`, 'error');
    }
  }

  /** Resolves the compiler path, toasting when unavailable. Pass false to stay quiet. */
  private async compilerPath(notify = true): Promise<string | null> {
    let info;
    try {
      info = await window.znxstudio.compiler.info();
    } catch (error) {
      if (notify) this.context.layout.showToast(`Could not inspect the compiler: ${(error as Error).message}`, 'error');
      return null;
    }
    if (!info.available) {
      if (notify) this.context.layout.showToast('Zornux compiler not available — cannot manage packages.', 'error');
      return null;
    }
    return info.path;
  }

  /* ---------------------------------------------------------------- render */

  private renderRegistryFilter(): void {
    const filter = this.registryFilter;
    if (!filter) return;
    const previous = filter.value;
    filter.replaceChildren();
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'All registries';
    filter.appendChild(all);
    for (const registry of this.registries) {
      const option = document.createElement('option');
      option.value = registry.name;
      option.textContent = registry.name;
      filter.appendChild(option);
    }
    if ([...filter.options].some((o) => o.value === previous)) filter.value = previous;
  }

  private render(): void {
    if (!this.hasWorkspace()) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-explorer-empty';
      const message = document.createElement('p');
      message.textContent = 'Open a folder to manage packages';
      const button = document.createElement('button');
      button.className = 'znxstudio-btn';
      button.textContent = 'Open Folder';
      button.addEventListener('click', () => void this.context.commands.execute(CommandIds.WorkspaceOpenFolder));
      empty.append(message, button);
      this.container.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    // Search results.
    if (this.searchStatus) {
      const status = document.createElement('div');
      status.className = 'znxstudio-packages-status';
      status.textContent = this.searchStatus;
      fragment.appendChild(status);
    }
    for (const result of this.results) fragment.appendChild(this.renderResult(result));

    // Registries.
    fragment.appendChild(this.renderRegistriesSection());
    this.container.replaceChildren(fragment);
  }

  private renderResult(result: PackageSearchResult): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-packages-result';

    const header = document.createElement('div');
    header.className = 'znxstudio-tree-row';

    const name = document.createElement('span');
    name.className = 'znxstudio-packages-name';
    name.textContent = result.name;
    const version = document.createElement('span');
    version.className = 'znxstudio-packages-version';
    version.textContent = result.version;
    const registry = document.createElement('span');
    registry.className = 'znxstudio-packages-registry';
    registry.textContent = result.registry;

    const info = document.createElement('div');
    info.className = 'znxstudio-packages-info';
    info.style.display = 'none';

    const infoBtn = document.createElement('button');
    infoBtn.className = 'znxstudio-icon-btn';
    infoBtn.title = 'Show available versions';
    infoBtn.textContent = 'ⓘ';
    infoBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const collapsed = info.style.display === 'none';
      info.style.display = collapsed ? '' : 'none';
      if (collapsed) void this.showInfo(result, info);
    });

    const add = document.createElement('button');
    add.className = 'znxstudio-btn znxstudio-btn-small';
    const spec = `${result.name}@${result.version}`;
    add.disabled = this.pendingPackages.has(spec);
    add.textContent = add.disabled ? 'Adding…' : 'Add';
    add.title = `Add ${result.name}@${result.version} to the project`;
    add.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.install(result);
    });

    header.append(name, version, registry, infoBtn, add);
    row.append(header, info);
    return row;
  }

  private renderInfo(info: PackageInfo): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'znxstudio-packages-info-body';
    if (info.sources.length === 0) {
      wrap.textContent = 'No versions in the configured registries.';
      return wrap;
    }
    for (const source of info.sources) {
      const line = document.createElement('div');
      line.className = 'znxstudio-packages-info-line';
      line.textContent = `${source.registry}: ${source.versions.join(', ')}`;
      wrap.appendChild(line);
    }
    return wrap;
  }

  private renderRegistriesSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'znxstudio-packages-registries';

    const header = document.createElement('div');
    header.className = 'znxstudio-explorer-section-header';
    header.textContent = 'Registries';
    section.appendChild(header);

    if (this.registries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-packages-status';
      empty.textContent = 'No registries configured.';
      section.appendChild(empty);
    }
    for (const registry of this.registries) section.appendChild(this.renderRegistry(registry));
    section.appendChild(this.renderAddRegistry());
    return section;
  }

  private renderRegistry(registry: RegistryEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-tree-row znxstudio-packages-registry-row';
    row.title = registry.location;

    const name = document.createElement('span');
    name.className = 'znxstudio-packages-name';
    name.textContent = registry.name;
    const location = document.createElement('span');
    location.className = 'znxstudio-packages-registry-loc';
    location.textContent = registry.location;

    row.append(name, location);
    if (registry.isDefault) {
      const badge = document.createElement('span');
      badge.className = 'znxstudio-solution-badge';
      badge.textContent = 'default';
      row.appendChild(badge);
    }

    const remove = document.createElement('button');
    remove.className = 'znxstudio-icon-btn';
    remove.title = `Remove registry ${registry.name}`;
    remove.textContent = '✕';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.removeRegistry(registry.name);
    });
    row.appendChild(remove);
    return row;
  }

  private renderAddRegistry(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'znxstudio-packages-status';

    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'znxstudio-solution-action';
    link.textContent = '+ Add registry';
    link.addEventListener('click', () => {
      const form = document.createElement('div');
      form.className = 'znxstudio-solution-addform';
      const name = document.createElement('input');
      name.className = 'znxstudio-input';
      name.placeholder = 'name';
      const location = document.createElement('input');
      location.className = 'znxstudio-input';
      location.placeholder = 'folder path or https:// URL';
      const submit = document.createElement('button');
      submit.className = 'znxstudio-btn';
      submit.textContent = 'Add';
      const run = () => {
        const registryName = name.value.trim();
        const loc = location.value.trim();
        if (!registryName || !loc) return;
        void this.addRegistry(registryName, loc);
      };
      submit.addEventListener('click', run);
      location.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') run();
      });
      form.append(name, location, submit);
      wrap.replaceChildren(form);
      name.focus();
    });

    wrap.append(link);
    return wrap;
  }

  private isCurrentWorkspace(cwd: string, sequence: number, kind: 'search' | 'registry'): boolean {
    const currentSequence = kind === 'search' ? this.searchSequence : this.registrySequence;
    return currentSequence === sequence && this.workspace.currentFolder() === cwd;
  }

  private updateSearchButton(): void {
    if (!this.searchButton) return;
    this.searchButton.disabled = this.searching;
    this.searchButton.textContent = this.searching ? 'Searching…' : 'Search';
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) -----
   * Stands up a REAL local folder registry in TEMP: publish the repo's
   * Greetings example into it, register it, then search/info/registry-list
   * against the live CLI — proving the pure parsers against real output. All
   * writes land in TEMP; the repo is never touched. */
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
      const info = await window.znxstudio.compiler.info();
      if (!info.available) {
        log('package-manager: compiler unavailable, skipping');
        return;
      }
      const compilerPath = info.path;
      const temp = 'C:\\Users\\jerem\\AppData\\Local\\Temp\\znxstudio-pkg-5e';
      const proj = `${temp}\\proj`;
      // A fresh store per run so publish always writes cleanly (a folder registry
      // rejects a duplicate version with ZX1411). PublishLocal creates the folder.
      const store = `${temp}\\store-${Date.now()}`;
      const greetings = 'C:\\Studio Apps\\xojin\\examples\\registry\\greetings';

      await window.znxstudio.fs.writeFile(`${proj}\\zornux.project`, 'name = pkg5e-selftest\nversion = 0.1.0\n');

      // Publish the real Greetings 1.0.0 into a local folder registry.
      const published = await window.znxstudio.packages.query({ command: 'publish', cwd: proj, args: [greetings, '--local', store], compilerPath });
      log(`packages publish(greetings→store): exit=${published.exitCode}`);

      // Register the store, then list — the parser should surface it.
      await window.znxstudio.packages.run({ command: 'registry', cwd: proj, args: ['add', 'store', store], compilerPath });
      const listRaw = await window.znxstudio.packages.query({ command: 'registry', cwd: proj, args: ['list'], compilerPath });
      const registries = parseRegistryList(listRaw.stdout);
      log(`packages registry list: count=${registries.length} names=[${registries.map((r) => r.name).join(', ')}]`);

      // Search the store for Greetings.
      const searchRaw = await window.znxstudio.packages.query({ command: 'search', cwd: proj, args: ['Greet'], compilerPath });
      const search = parseSearchResults(searchRaw.exitCode, searchRaw.stdout, searchRaw.stderr);
      const first = search.results[0];
      log(`packages search('Greet'): results=${search.results.length} first=${first ? `${first.name} ${first.version} (${first.registry})` : '-'}`);

      // Info: versions across registries.
      const infoRaw = await window.znxstudio.packages.query({ command: 'info', cwd: proj, args: ['Greetings'], compilerPath });
      const parsedInfo = parsePackageInfo(infoRaw.exitCode, infoRaw.stdout, infoRaw.stderr);
      log(`packages info('Greetings'): name=${parsedInfo.info?.name ?? '-'} sources=${parsedInfo.info?.sources.length ?? 0} versions=[${parsedInfo.info?.sources[0]?.versions.join(', ') ?? '-'}]`);

      // Failure path: info for a package no registry has → parsed diagnostic.
      const missingRaw = await window.znxstudio.packages.query({ command: 'info', cwd: proj, args: ['NoSuchPkg'], compilerPath });
      const missing = parsePackageInfo(missingRaw.exitCode, missingRaw.stdout, missingRaw.stderr);
      log(`packages info('NoSuchPkg'): info=${missing.info ? 'present' : 'null'} diagnostics=${missing.diagnostics.length} first=${missing.diagnostics[0]?.code ?? '-'}`);
    } catch (error) {
      log(`package-manager self-test failed: ${(error as Error).message}`);
    }
  }
}
