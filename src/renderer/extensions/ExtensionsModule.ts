import {
  ServiceKeys,
  type ExtensionInfo,
  type ExtensionService,
  type MarketplaceService,
  type RemoteInstalled,
} from '../core/Contracts';
import { tp } from '../i18n';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { Disposable, IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { parseExtensionManifest, type ExtensionManifest } from '../../shared/extensions/manifest';
import type { MarketplaceEntry } from '../../shared/extensions/marketplace';
import { assetCardToEntry, type ValidatedExtension } from '../../shared/extensions/registry';
import type { ZnxStudioExtension } from './sdk';
import { createExtensionApi } from './ExtensionApi';
import { ExtensionRuntime } from './ExtensionRuntime';
import { DEFAULT_LIMITS, createSandboxedApi } from './sandbox';
import { ExtensionDiagnostics } from './diagnostics';
import { BUNDLED_PACKAGES } from './bundled';
import { applyContributions } from './DeclarativeContributions';

/** A remote extension the user has installed, with its applied contributions (if enabled). */
interface RemoteRecord {
  summary: RemoteInstalled;
  extension?: ValidatedExtension;
  disposable?: Disposable;
}

/**
 * Extension System foundation (Phase 11A). Wires the SDK runtime into the
 * workbench: registers the built-in sample extension(s), activates `onStartup`
 * ones through the public facade, and publishes an ExtensionService so later
 * phases (Manager UI 11E, disk loading 11B, sandbox 11C) build on the same seam.
 */
export class ExtensionsModule implements IModule {
  readonly id = 'znxstudio.extensions.system';
  readonly displayName = 'Extension System';

  private context!: ModuleContext;
  private runtime!: ExtensionRuntime;
  private readonly diagnostics = new ExtensionDiagnostics();
  private readonly changeEmitter = new Emitter<ExtensionInfo[]>();
  private readonly marketplaceEmitter = new Emitter<void>();
  /** Ids the user has installed this session (beyond the pre-installed ones). */
  private readonly installed = new Set<string>();
  /** Remote (live-marketplace) extensions installed on this machine, keyed by extension id. */
  private readonly remote = new Map<string, RemoteRecord>();

  async activate(context: ModuleContext): Promise<void> {
    this.context = context;
    // Each extension gets a sandboxed facade: rate-limited + error-isolated
    // handlers, resource caps, frozen API. Activation is time-bounded.
    const runtime = new ExtensionRuntime(
      (manifest) =>
        createSandboxedApi(
          createExtensionApi(manifest, context, {
            log: (level, message) => this.diagnostics.log(manifest.id, level, message),
          }),
          {
            onError: (where, error) => {
              this.diagnostics.recordError(manifest.id, `${where}: ${error.message}`);
              runtime.reportError(manifest.id, `${where}: ${error.message}`);
            },
          },
          DEFAULT_LIMITS,
        ),
      { activationTimeoutMs: DEFAULT_LIMITS.activationTimeoutMs, diagnostics: this.diagnostics },
    );
    this.runtime = runtime;

    const service: ExtensionService = {
      list: () => this.runtime.list(),
      isActive: (id) => this.runtime.isActive(id),
      activate: async (id) => {
        const ok = await this.runtime.activate(id);
        this.fireChange();
        return ok;
      },
      deactivate: async (id) => {
        await this.runtime.deactivate(id);
        this.fireChange();
      },
      reload: async (id) => {
        await this.runtime.deactivate(id);
        this.diagnostics.reset(id);
        const ok = await this.runtime.activate(id);
        this.fireChange();
        return ok;
      },
      onDidChange: this.changeEmitter.event,
    };
    context.services.register(ServiceKeys.Extensions, service);

    const marketplace: MarketplaceService = {
      catalog: () => BUNDLED_PACKAGES.map((p) => p.entry),
      isInstalled: (id) => this.runtime.has(id) || this.remote.has(id),
      install: (entry) => this.installEntry(entry),
      uninstall: (id) => this.uninstallEntry(id),
      onDidChange: this.marketplaceEmitter.event,
      search: (query) => this.searchRemote(query),
      installedRemote: () => [...this.remote.values()].map((r) => r.summary),
      setRemoteEnabled: (id, enabled) => this.setRemoteEnabled(id, enabled),
    };
    context.services.register(ServiceKeys.Marketplace, marketplace);

    context.commands.register(CommandIds.ExtensionsList, () => this.showList(), 'Extensions: List Installed');

    this.registerBuiltIns();
    await this.runtime.activateForTrigger('onStartup');
    this.fireChange();
    await this.loadRemote();

    void selfTestCoordinator.run('extensions', () => this.maybeSelfTest());
  }

  private registerBuiltIns(): void {
    // Pre-installed packages are registered at startup.
    for (const pkg of BUNDLED_PACKAGES) {
      if (pkg.preinstalled) this.runtime.register(pkg.manifest, pkg.instance);
    }
  }

  /** Dispatch install to the bundled or the remote (live-marketplace) path. */
  private installEntry(entry: MarketplaceEntry): Promise<boolean> {
    return entry.remote ? this.installRemote(entry) : this.installBundled(entry.id);
  }
  /** Dispatch uninstall: remote extensions dispose their contributions; bundled use the runtime. */
  private uninstallEntry(id: string): Promise<void> {
    return this.remote.has(id) ? this.uninstallRemote(id) : this.uninstallBundled(id);
  }

  /** Install a bundled marketplace package: register + activate its extension. */
  private async installBundled(id: string): Promise<boolean> {
    if (this.runtime.has(id)) return true;
    const pkg = BUNDLED_PACKAGES.find((p) => p.manifest.id === id);
    if (!pkg) return false;
    this.runtime.register(pkg.manifest, pkg.instance);
    this.installed.add(id);
    await this.runtime.activate(id); // installing enables + activates it
    this.fireChange();
    this.marketplaceEmitter.fire();
    return true;
  }

  private async uninstallBundled(id: string): Promise<void> {
    const pkg = BUNDLED_PACKAGES.find((p) => p.manifest.id === id);
    if (pkg?.preinstalled) return; // pre-installed packages can't be removed
    await this.runtime.remove(id);
    this.installed.delete(id);
    this.fireChange();
    this.marketplaceEmitter.fire();
  }

  /* ----- live marketplace (remote) ----- */

  /** Search the live marketplace; maps catalog cards to entries. Throws on transport error. */
  private async searchRemote(query: string): Promise<MarketplaceEntry[]> {
    const { items } = await window.znxstudio.marketplace.search({ query });
    const entries: MarketplaceEntry[] = [];
    for (const card of items) {
      const entry = assetCardToEntry(card);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  /** Install a remote extension: main verifies + validates, we apply the returned model. */
  private async installRemote(entry: MarketplaceEntry): Promise<boolean> {
    if (!entry.publisherHandle || !entry.slug) throw new Error('Extension is missing its marketplace identity.');
    const ext = await window.znxstudio.marketplace.install(entry.publisherHandle, entry.slug, entry.version);
    const disposable = applyContributions(this.context, ext);
    this.remote.set(ext.id, {
      summary: {
        id: ext.id,
        name: ext.name,
        publisher: entry.publisher || entry.publisherHandle,
        publisherHandle: entry.publisherHandle,
        slug: entry.slug,
        version: ext.version,
        enabled: true,
      },
      extension: ext,
      disposable,
    });
    this.fireChange();
    this.marketplaceEmitter.fire();
    return true;
  }

  private async uninstallRemote(id: string): Promise<void> {
    const record = this.remote.get(id);
    if (!record) return;
    record.disposable?.dispose();
    await window.znxstudio.marketplace.uninstall(record.summary.publisherHandle, record.summary.slug, record.summary.version);
    this.remote.delete(id);
    this.fireChange();
    this.marketplaceEmitter.fire();
  }

  /** Enable/disable an installed remote extension: apply or dispose its contributions. */
  private async setRemoteEnabled(id: string, enabled: boolean): Promise<void> {
    const record = this.remote.get(id);
    if (!record || record.summary.enabled === enabled) return;
    if (enabled) {
      if (record.extension) record.disposable = applyContributions(this.context, record.extension);
    } else {
      record.disposable?.dispose();
      record.disposable = undefined;
    }
    record.summary.enabled = enabled;
    await window.znxstudio.marketplace.setEnabled(record.summary.publisherHandle, record.summary.slug, record.summary.version, enabled);
    this.marketplaceEmitter.fire();
  }

  /** At startup, list installed remote extensions and apply the enabled (revalidated) ones. */
  private async loadRemote(): Promise<void> {
    try {
      const [installed, loaded] = await Promise.all([
        window.znxstudio.marketplace.listInstalled(),
        window.znxstudio.marketplace.loadEnabled(),
      ]);
      const enabledById = new Map(loaded.apply.map((e) => [e.id, e]));
      for (const summary of installed) {
        const ext = enabledById.get(summary.id);
        const record: RemoteRecord = {
          summary: {
            id: summary.id,
            name: summary.name,
            publisher: summary.publisher,
            publisherHandle: summary.publisher,
            slug: summary.slug,
            version: summary.version,
            enabled: summary.enabled && !!ext,
          },
          extension: ext,
        };
        if (summary.enabled && ext) record.disposable = applyContributions(this.context, ext);
        this.remote.set(summary.id, record);
      }
      this.marketplaceEmitter.fire();
    } catch {
      /* marketplace unavailable at startup — leave remote empty, never block boot */
    }
  }

  private fireChange(): void {
    this.changeEmitter.fire(this.runtime.list());
  }

  private showList(): void {
    const all = this.runtime.list();
    const active = all.filter((e) => e.state === 'active').length;
    this.context.layout.showToast(`${tp('extensions.count', all.length)} installed · ${active} active.`, 'info');
    for (const ext of all) console.info(`[ZnxStudio] extension ${ext.id}@${ext.version} — ${ext.state}`);
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

    // The built-in sample activated on startup through the real facade.
    const helloActive = this.runtime.isActive('acme.hello-world');
    const helloCmd = this.context.commands.has('acme.hello-world.say');
    log(`extensions builtin: hello active=${helloActive} commandRegistered=${helloCmd}`);

    // Real activate → execute → deactivate cycle on the live registries.
    let ran = false;
    const manifest = parseExtensionManifest({
      name: 'Self Test',
      publisher: 'znxstudio',
      version: '0.0.1',
      engines: { znxstudio: '^1.0.0' },
      activationEvents: ['onCommand:znxstudio.self-test.ping'],
      permissions: ['commands'],
      contributes: { commands: [{ command: 'znxstudio.self-test.ping', title: 'Ping' }] },
    }).manifest!;
    const ext: ZnxStudioExtension = {
      activate: (ctx) => {
        ctx.subscriptions.push(ctx.commands.register('znxstudio.self-test.ping', () => (ran = true), 'Ping'));
      },
    };
    this.runtime.register(manifest, ext);
    const activated = await this.runtime.activate('znxstudio.self-test');
    await this.context.commands.execute('znxstudio.self-test.ping');
    log(`extensions cycle: activated=${activated} commandRan=${ran} listed=${this.runtime.list().some((e) => e.id === 'znxstudio.self-test')}`);
    await this.runtime.deactivate('znxstudio.self-test');
    log(`extensions deactivate: commandRemoved=${!this.context.commands.has('znxstudio.self-test.ping')} nowActive=${this.runtime.isActive('znxstudio.self-test')}`);

    // Incompatible engine is recorded, not activated.
    const badManifest = parseExtensionManifest({
      name: 'Future Ext',
      publisher: 'znxstudio',
      version: '1.0.0',
      engines: { znxstudio: '^99.0.0' },
      permissions: [],
      contributes: {},
    }).manifest!;
    const badState = this.runtime.register(badManifest, { activate: () => undefined });
    const badActivated = await this.runtime.activate('znxstudio.future-ext');
    log(`extensions compat: state=${badState} activate=${badActivated} (expect incompatible/false)`);

    // Diagnostics + reload on the live runtime (11F).
    const helloInfo = this.runtime.info('acme.hello-world');
    log(`extensions diag(hello): timedActivation=${helloInfo?.activationMs !== undefined} errors=${helloInfo?.errorCount ?? 0} logs=${helloInfo?.logs?.length ?? 0}`);
    await this.runtime.deactivate('acme.hello-world');
    const reactivated = await this.runtime.activate('acme.hello-world');
    log(`extensions reload(hello): reactivated=${reactivated} active=${this.runtime.isActive('acme.hello-world')} cmd=${this.context.commands.has('acme.hello-world.say')}`);

    // Marketplace install → activate → uninstall on the live runtime (11D).
    const installedOk = await this.installBundled('acme.line-counter');
    log(`extensions install(line-counter): ok=${installedOk} active=${this.runtime.isActive('acme.line-counter')} cmd=${this.context.commands.has('acme.line-counter.count')}`);
    await this.uninstallBundled('acme.line-counter');
    log(`extensions uninstall(line-counter): stillHas=${this.runtime.has('acme.line-counter')} cmd=${this.context.commands.has('acme.line-counter.count')}`);
  }
}
