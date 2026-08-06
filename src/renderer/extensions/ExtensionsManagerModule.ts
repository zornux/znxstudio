import {
  ServiceKeys,
  type ExtensionInfo,
  type ExtensionService,
  type MarketplaceService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { isInstallable, searchMarketplace } from '../../shared/extensions/marketplace';

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

  activate(context: ModuleContext): void {
    this.context = context;
    this.extensions = context.services.get<ExtensionService>(ServiceKeys.Extensions);
    this.marketplace = context.services.get<MarketplaceService>(ServiceKeys.Marketplace);

    this.root = document.createElement('div');
    this.root.className = 'znxstudio-extmgr';

    context.layout.addActivityItem({ id: 'extensions', label: 'Extensions', icon: '🧩', onSelect: () => this.reveal() });
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

  private render(): void {
    this.root.replaceChildren();

    const search = document.createElement('input');
    search.className = 'znxstudio-extmgr-search';
    search.placeholder = 'Search extensions…';
    search.value = this.query;
    search.addEventListener('input', () => {
      this.query = search.value;
      this.render();
    });
    this.root.appendChild(search);

    // Installed.
    const installed = this.extensions.list().filter((e) => this.matches(`${e.name} ${e.id} ${e.publisher}`));
    this.root.appendChild(this.sectionHeader(`Installed — ${installed.length}`));
    if (installed.length === 0) this.root.appendChild(this.empty('Nothing installed matches.'));
    for (const info of installed) this.root.appendChild(this.installedRow(info));

    // Marketplace (entries not yet installed).
    const catalog = searchMarketplace(this.marketplace.catalog(), this.query).filter((e) => !this.marketplace.isInstalled(e.id));
    this.root.appendChild(this.sectionHeader(`Marketplace — ${catalog.length}`));
    if (catalog.length === 0) this.root.appendChild(this.empty('No matching extensions available.'));
    for (const entry of catalog) this.root.appendChild(this.marketplaceRow(entry));
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
      if (info.state === 'active') {
        toggle.textContent = 'Disable';
        toggle.addEventListener('click', () => void this.extensions.deactivate(info.id));
      } else {
        toggle.textContent = 'Enable';
        toggle.addEventListener('click', () => void this.extensions.activate(info.id));
      }
      actions.appendChild(toggle);
    }
    if (info.state === 'active' || info.state === 'failed') {
      const reload = document.createElement('button');
      reload.className = 'znxstudio-btn-small';
      reload.textContent = 'Reload';
      reload.addEventListener('click', () => void this.extensions.reload(info.id));
      actions.appendChild(reload);
    }
    const catalogEntry = this.marketplace.catalog().find((e) => e.id === info.id);
    if (catalogEntry && !catalogEntry.preinstalled) {
      const uninstall = document.createElement('button');
      uninstall.className = 'znxstudio-btn-small';
      uninstall.textContent = 'Uninstall';
      uninstall.addEventListener('click', () => void this.marketplace.uninstall(info.id));
      actions.appendChild(uninstall);
    }
    row.appendChild(actions);
    return row;
  }

  private marketplaceRow(entry: ReturnType<MarketplaceService['catalog']>[number]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-extmgr-row';

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
    const rating = entry.rating ? `★ ${entry.rating.toFixed(1)}` : '';
    const installs = entry.installs ? `${entry.installs.toLocaleString()} installs` : '';
    meta.textContent = [entry.publisher, installs, rating].filter(Boolean).join(' · ');
    row.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'znxstudio-extmgr-actions';
    const install = document.createElement('button');
    install.className = 'znxstudio-btn-small';
    const compatible = isInstallable(entry);
    if (compatible) {
      install.textContent = 'Install';
      install.addEventListener('click', () => void this.marketplace.install(entry.id));
    } else {
      install.textContent = 'Incompatible';
      install.disabled = true;
    }
    actions.appendChild(install);
    row.appendChild(actions);
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

    const installed = this.extensions.list();
    const catalog = this.marketplace.catalog();
    const notInstalled = catalog.filter((e) => !this.marketplace.isInstalled(e.id));
    this.render();
    const rows = this.root.querySelectorAll('.znxstudio-extmgr-row').length;
    log(`extmgr: installed=${installed.length} catalog=${catalog.length} available=${notInstalled.length} renderedRows=${rows}`);
  }
}
