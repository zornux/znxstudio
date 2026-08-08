import {
  ServiceKeys,
  type ExtensionInfo,
  type ExtensionService,
  type InputBoxService,
  type MarketplaceService,
  type RemoteInstalled,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { isInstallable, searchMarketplace, type MarketplaceEntry } from '../../shared/extensions/marketplace';

function cap(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

const STATE_LABEL: Record<ExtensionInfo['state'], string> = {
  active: 'Enabled',
  registered: 'Disabled',
  failed: 'Error',
  incompatible: 'Incompatible',
};

/**
 * Extensions Manager (Phase 11E). The sidebar UI over the ExtensionService +
 * MarketplaceService: an "Installed" section (enable / disable / uninstall, with
 * state badges and error text) and a "Marketplace" section (install, with
 * install counts, ratings, and compatibility gating). Search filters both.
 */
export class ExtensionsManagerModule implements IModule {
  readonly id = 'znxstudio.extensions.manager';
  readonly displayName = 'Extensions Manager';

  private context!: ModuleContext;
  private extensions!: ExtensionService;
  private marketplace!: MarketplaceService;
  private root!: HTMLElement;
  private query = '';
  /** Cached live-marketplace results for the current query (async; render reads this). */
  private remoteResults: MarketplaceEntry[] = [];
  private remoteLoading = false;
  private remoteError = '';
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  /** Monotonic id so an out-of-order search response can't overwrite newer results. */
  private searchSeq = 0;
  /** Persistent shell elements — kept stable so typing never rebuilds the search box. */
  private searchInput?: HTMLInputElement;
  private clearSearch?: HTMLButtonElement;
  private listEl?: HTMLElement;
  /** Action keys currently in flight, used to prevent duplicate lifecycle requests. */
  private readonly pending = new Set<string>();

  activate(context: ModuleContext): void {
    this.context = context;
    this.extensions = context.services.get<ExtensionService>(ServiceKeys.Extensions);
    this.marketplace = context.services.get<MarketplaceService>(ServiceKeys.Marketplace);

    this.root = document.createElement('div');
    this.root.className = 'znxstudio-extmgr';

    context.layout.addActivityItem({ id: 'extensions', label: 'Extensions', icon: '▦', onSelect: () => this.reveal() });
    context.commands.register(CommandIds.ExtensionsShow, () => this.reveal(), 'Extensions: Show Manager');

    this.extensions.onDidChange(() => this.render());
    this.marketplace.onDidChange(() => this.render());

    this.render();
    void selfTestCoordinator.run('extensions-manager', () => this.maybeSelfTest());
  }

  private reveal(): void {
    this.render();
    this.context.layout.setSideBar('Extensions', this.root);
    this.context.layout.focusSideBar();
  }

  private matches(text: string): boolean {
    return !this.query || text.toLowerCase().includes(this.query.toLowerCase());
  }

  /**
   * Build the persistent shell ONCE: the search box and a results container. Keeping the
   * input element stable across renders is what makes typing smooth — re-creating it on
   * each keystroke (the old behaviour) dropped focus and jumped the caret.
   */
  private ensureShell(): void {
    if (this.searchInput && this.listEl) return;
    this.root.replaceChildren();

    const searchWrap = document.createElement('div');
    searchWrap.className = 'znxstudio-extmgr-search-wrap';
    const searchIcon = document.createElement('span');
    searchIcon.className = 'znxstudio-extmgr-search-icon';
    searchIcon.textContent = '⌕';
    searchIcon.setAttribute('aria-hidden', 'true');
    const search = document.createElement('input');
    search.className = 'znxstudio-extmgr-search';
    search.placeholder = 'Search the marketplace…';
    search.setAttribute('aria-label', 'Search installed and marketplace extensions');
    search.value = this.query;
    search.addEventListener('input', () => {
      this.query = search.value;
      this.renderList(); // only the results re-render — the input keeps focus + caret
      this.updateClearSearch();
      this.scheduleRemoteSearch();
    });
    this.searchInput = search;
    const clear = document.createElement('button');
    clear.className = 'znxstudio-extmgr-search-clear';
    clear.type = 'button';
    clear.textContent = '×';
    clear.title = 'Clear extension search';
    clear.setAttribute('aria-label', 'Clear extension search');
    clear.addEventListener('click', () => {
      this.query = '';
      search.value = '';
      this.updateClearSearch();
      this.renderList();
      this.scheduleRemoteSearch();
      search.focus();
    });
    this.clearSearch = clear;
    searchWrap.append(searchIcon, search, clear);
    this.updateClearSearch();

    const list = document.createElement('div');
    list.className = 'znxstudio-extmgr-list';
    this.listEl = list;

    this.root.append(searchWrap, list);
  }

  private render(): void {
    this.ensureShell();
    // Keep the input's value in sync when the query changes programmatically (not on typing).
    if (this.searchInput && this.searchInput.value !== this.query) this.searchInput.value = this.query;
    this.renderList();
  }

  private renderList(): void {
    const list = this.listEl;
    if (!list) return;
    list.replaceChildren();

    // Installed — bundled extensions + remote (live-marketplace) extensions.
    const installed = this.extensions.list().filter((e) => this.matches(`${e.name} ${e.id} ${e.publisher}`));
    const remoteInstalled = this.marketplace
      .installedRemote()
      .filter((e) => this.matches(`${e.name} ${e.id} ${e.publisher}`));
    list.appendChild(this.sectionHeader(`Installed — ${installed.length + remoteInstalled.length}`));
    if (installed.length + remoteInstalled.length === 0) list.appendChild(this.empty('Nothing installed matches.'));
    for (const info of installed) list.appendChild(this.installedRow(info));
    for (const info of remoteInstalled) list.appendChild(this.remoteInstalledRow(info));

    // Marketplace — live results + any bundled samples not yet installed.
    const bundled = searchMarketplace(this.marketplace.catalog(), this.query).filter((e) => !this.marketplace.isInstalled(e.id));
    const remote = this.remoteResults.filter((e) => !this.marketplace.isInstalled(e.id));
    list.appendChild(this.sectionHeader(`Marketplace — ${remote.length + bundled.length}`));
    if (this.remoteLoading) list.appendChild(this.empty('Searching the marketplace…'));
    if (this.remoteError) list.appendChild(this.errorLine(`Marketplace unavailable: ${this.remoteError}`));
    if (!this.remoteLoading && !this.remoteError && remote.length + bundled.length === 0) {
      list.appendChild(this.empty('No matching extensions available.'));
    }
    for (const entry of remote) list.appendChild(this.marketplaceRow(entry));
    for (const entry of bundled) list.appendChild(this.marketplaceRow(entry));
  }

  private updateClearSearch(): void {
    if (this.clearSearch) this.clearSearch.hidden = this.query.length === 0;
  }

  private extensionMark(name: string): HTMLElement {
    const mark = document.createElement('span');
    mark.className = 'znxstudio-extmgr-mark';
    mark.textContent = name.trim().charAt(0).toUpperCase() || 'E';
    mark.setAttribute('aria-hidden', 'true');
    return mark;
  }

  /** Debounce live-marketplace search so we don't fire a request per keystroke. */
  private scheduleRemoteSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.runRemoteSearch(), 300);
  }

  private async runRemoteSearch(): Promise<void> {
    // Guard against out-of-order responses: only the latest search may update the results.
    const seq = ++this.searchSeq;
    const forQuery = this.query;
    this.remoteLoading = true;
    this.remoteError = '';
    this.render();
    try {
      const results = await this.marketplace.search(forQuery);
      if (seq !== this.searchSeq) return; // a newer search superseded this one
      this.remoteResults = results;
    } catch (error) {
      if (seq !== this.searchSeq) return;
      this.remoteResults = [];
      this.remoteError = (error as Error).message;
    } finally {
      if (seq === this.searchSeq) {
        this.remoteLoading = false;
        this.render();
      }
    }
  }

  private errorLine(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-extmgr-error';
    el.textContent = text;
    return el;
  }

  /** An installed remote extension: enable/disable + uninstall, with trust facts. */
  private remoteInstalledRow(info: RemoteInstalled): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-extmgr-row';
    row.appendChild(this.extensionMark(info.name));

    const head = document.createElement('div');
    head.className = 'znxstudio-extmgr-head';
    const name = document.createElement('span');
    name.className = 'znxstudio-extmgr-name';
    name.textContent = info.name;
    const version = document.createElement('span');
    version.className = 'znxstudio-extmgr-version';
    version.textContent = `v${info.version}`;
    const badge = document.createElement('span');
    badge.className = `znxstudio-extmgr-badge is-${info.enabled ? 'active' : 'registered'}`;
    badge.textContent = info.enabled ? 'Enabled' : 'Disabled';
    head.append(name, version, badge);
    row.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'znxstudio-extmgr-meta';
    meta.textContent = `${info.publisher} · Integrity verified ✓ · Signature: not available`;
    row.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'znxstudio-extmgr-actions';
    const toggle = document.createElement('button');
    toggle.className = 'znxstudio-btn-small';
    const toggleKey = `extension:${info.id}`;
    toggle.disabled = this.pending.has(toggleKey);
    toggle.textContent = toggle.disabled ? 'Updating…' : info.enabled ? 'Disable' : 'Enable';
    toggle.addEventListener('click', () => {
      void this.runAction(toggleKey, () => this.marketplace.setRemoteEnabled(info.id, !info.enabled), 'Extension setting updated.');
    });
    const uninstall = document.createElement('button');
    uninstall.className = 'znxstudio-btn-small';
    uninstall.classList.add('is-danger');
    const uninstallKey = `extension:${info.id}`;
    uninstall.disabled = this.pending.has(uninstallKey);
    uninstall.textContent = uninstall.disabled ? 'Uninstalling…' : 'Uninstall';
    uninstall.addEventListener('click', () => {
      void this.confirmUninstall(info.id, info.name);
    });
    actions.append(toggle, uninstall);
    row.appendChild(actions);
    return row;
  }

  private sectionHeader(text: string): HTMLElement {
    const header = document.createElement('div');
    header.className = 'znxstudio-extmgr-section';
    header.textContent = text;
    return header;
  }

  private empty(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-extmgr-empty';
    el.textContent = text;
    return el;
  }

  private installedRow(info: ExtensionInfo): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-extmgr-row';
    row.appendChild(this.extensionMark(info.name));

    const head = document.createElement('div');
    head.className = 'znxstudio-extmgr-head';
    const name = document.createElement('span');
    name.className = 'znxstudio-extmgr-name';
    name.textContent = `${info.name}`;
    const version = document.createElement('span');
    version.className = 'znxstudio-extmgr-version';
    version.textContent = `v${info.version}`;
    const badge = document.createElement('span');
    badge.className = `znxstudio-extmgr-badge is-${info.state}`;
    badge.textContent = STATE_LABEL[info.state];
    head.append(name, version, badge);
    row.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'znxstudio-extmgr-meta';
    const bits = [`${info.publisher}`, `${info.commands.length} command${info.commands.length === 1 ? '' : 's'}`];
    if (info.activationMs !== undefined) bits.push(`activated in ${info.activationMs}ms`);
    if (info.errorCount) bits.push(`${info.errorCount} error${info.errorCount === 1 ? '' : 's'}`);
    meta.textContent = bits.join(' · ');
    row.appendChild(meta);
    if (info.error) {
      const error = document.createElement('div');
      error.className = 'znxstudio-extmgr-error';
      error.textContent = info.error;
      row.appendChild(error);
    }
    if (info.logs && info.logs.length) {
      const details = document.createElement('details');
      details.className = 'znxstudio-extmgr-logs';
      const summary = document.createElement('summary');
      summary.textContent = `Logs (${info.logs.length})`;
      const pre = document.createElement('pre');
      pre.textContent = info.logs.join('\n');
      details.append(summary, pre);
      row.appendChild(details);
    }

    const actions = document.createElement('div');
    actions.className = 'znxstudio-extmgr-actions';
    if (info.state !== 'incompatible') {
      const toggle = document.createElement('button');
      toggle.className = 'znxstudio-btn-small';
      const toggleKey = `extension:${info.id}`;
      toggle.disabled = this.pending.has(toggleKey);
      if (info.state === 'active') {
        toggle.textContent = toggle.disabled ? 'Disabling…' : 'Disable';
        toggle.addEventListener('click', () => void this.runAction(toggleKey, () => this.extensions.deactivate(info.id), 'Extension disabled.'));
      } else {
        toggle.textContent = toggle.disabled ? 'Enabling…' : 'Enable';
        toggle.addEventListener('click', () => void this.runAction(toggleKey, async () => {
          if (!await this.extensions.activate(info.id)) throw new Error('The extension could not be activated.');
        }, 'Extension enabled.'));
      }
      actions.appendChild(toggle);
    }
    if (info.state === 'active' || info.state === 'failed') {
      const reload = document.createElement('button');
      reload.className = 'znxstudio-btn-small';
      const reloadKey = `extension:${info.id}`;
      reload.disabled = this.pending.has(reloadKey);
      reload.textContent = reload.disabled ? 'Reloading…' : 'Reload';
      reload.addEventListener('click', () => void this.runAction(reloadKey, async () => {
        if (!await this.extensions.reload(info.id)) throw new Error('The extension could not be reloaded.');
      }, 'Extension reloaded.'));
      actions.appendChild(reload);
    }
    const catalogEntry = this.marketplace.catalog().find((e) => e.id === info.id);
    if (catalogEntry && !catalogEntry.preinstalled) {
      const uninstall = document.createElement('button');
      uninstall.className = 'znxstudio-btn-small';
      uninstall.classList.add('is-danger');
      const uninstallKey = `extension:${info.id}`;
      uninstall.disabled = this.pending.has(uninstallKey);
      uninstall.textContent = uninstall.disabled ? 'Uninstalling…' : 'Uninstall';
      uninstall.addEventListener('click', () => void this.confirmUninstall(info.id, info.name));
      actions.appendChild(uninstall);
    }
    row.appendChild(actions);
    return row;
  }

  private marketplaceRow(entry: ReturnType<MarketplaceService['catalog']>[number]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-extmgr-row';
    row.appendChild(this.extensionMark(entry.name));

    const head = document.createElement('div');
    head.className = 'znxstudio-extmgr-head';
    const name = document.createElement('span');
    name.className = 'znxstudio-extmgr-name';
    name.textContent = entry.name;
    const version = document.createElement('span');
    version.className = 'znxstudio-extmgr-version';
    version.textContent = `v${entry.version}`;
    head.append(name, version);
    row.appendChild(head);

    const desc = document.createElement('div');
    desc.className = 'znxstudio-extmgr-desc';
    desc.textContent = entry.description;
    row.appendChild(desc);

    const meta = document.createElement('div');
    meta.className = 'znxstudio-extmgr-meta';
    // Only fields the marketplace actually returns — no ratings (the API has none). Publisher
    // status and integrity/signature are shown as SEPARATE facts, never conflated.
    const downloads = entry.downloads ?? entry.installs;
    const bits = [entry.publisher];
    if (entry.trustTier) bits.push(cap(entry.trustTier));
    if (entry.verified) bits.push('Verified publisher');
    if (downloads) bits.push(`${downloads.toLocaleString()} downloads`);
    if (entry.updatedAt) bits.push(`updated ${entry.updatedAt.slice(0, 10)}`);
    meta.textContent = bits.join(' · ');
    row.appendChild(meta);

    if (entry.remote) {
      const trust = document.createElement('div');
      trust.className = 'znxstudio-extmgr-meta';
      trust.textContent = 'Integrity verified on install · Artifact signature: not available';
      row.appendChild(trust);
    }

    const actions = document.createElement('div');
    actions.className = 'znxstudio-extmgr-actions';
    const install = document.createElement('button');
    install.className = 'znxstudio-btn-small';
    install.classList.add('is-primary');
    // Remote entries carry no engine range in the card; compatibility is validated at install.
    const compatible = entry.remote ? true : isInstallable(entry);
    if (compatible) {
      const installKey = `extension:${entry.id}`;
      install.disabled = this.pending.has(installKey);
      install.textContent = install.disabled ? 'Installing…' : 'Install';
      install.addEventListener('click', () => {
        void this.runAction(installKey, async () => {
          if (!await this.marketplace.install(entry)) throw new Error('The extension could not be installed.');
        }, `${entry.name} installed.`);
      });
    } else {
      install.textContent = 'Incompatible';
      install.disabled = true;
    }
    actions.appendChild(install);
    row.appendChild(actions);
    return row;
  }

  private async confirmUninstall(id: string, name: string): Promise<void> {
    const key = `extension:${id}`;
    if (this.pending.has(key)) return;
    const input = this.context.services.get<InputBoxService>(ServiceKeys.InputBox);
    const confirmed = await input.confirm({
      title: `Uninstall ${name}?`,
      message: 'This removes the extension and disables all of its contributions.',
      confirmLabel: 'Uninstall',
      danger: true,
    });
    if (!confirmed) return;
    await this.runAction(key, () => this.marketplace.uninstall(id), `${name} uninstalled.`);
  }

  private async runAction(key: string, action: () => Promise<unknown>, successMessage: string): Promise<void> {
    if (this.pending.has(key)) return;
    this.pending.add(key);
    this.renderList();
    try {
      await action();
      this.context.layout.showToast(successMessage, 'success');
    } catch (error) {
      this.context.layout.showToast(`Extension operation failed: ${(error as Error).message}`, 'error');
    } finally {
      this.pending.delete(key);
      this.renderList();
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

    const installed = this.extensions.list();
    const catalog = this.marketplace.catalog();
    const notInstalled = catalog.filter((e) => !this.marketplace.isInstalled(e.id));
    this.render();
    const rows = this.root.querySelectorAll('.znxstudio-extmgr-row').length;
    log(`extmgr: installed=${installed.length} catalog=${catalog.length} available=${notInstalled.length} renderedRows=${rows}`);
  }
}
