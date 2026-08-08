import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import { isPackaged } from '../util/selftest';
import { SettingsStore } from '../services/SettingsStore';
import { MarketplaceRegistryService } from '../services/MarketplaceRegistryService';
import { InstalledExtensionsStore } from '../services/InstalledExtensionsStore';
import { ExtensionInstaller } from '../services/ExtensionInstaller';
import type { MarketplaceSearchParams } from '../services/MarketplaceRegistryService';

/**
 * Marketplace + extension endpoints. The main process owns integrity (checksum), manifest
 * validation, and filesystem persistence; the renderer only ever receives an already
 * validated, data-only contribution model — never raw artifact text. The base URL is
 * resolved by the anti-SSRF policy (production is pinned; a configured URL is honoured only
 * in an unpackaged/dev build).
 */
export function registerMarketplaceIpc(): void {
  const store = new InstalledExtensionsStore();

  // Build an installer using the current settings each call (base URL may change in dev).
  async function installer(): Promise<ExtensionInstaller> {
    const settings = await new SettingsStore().read();
    const configured = settings['marketplace.baseUrl'];
    const registry = new MarketplaceRegistryService({
      configuredBaseUrl: typeof configured === 'string' ? configured : undefined,
      allowLocalhost: !isPackaged(),
    });
    return new ExtensionInstaller(registry, store, registry.source());
  }

  ipcMain.handle(IpcChannels.MarketplaceSearch, (_e, params: MarketplaceSearchParams) =>
    installer().then((i) => i.search(params ?? {})),
  );
  ipcMain.handle(IpcChannels.MarketplaceDetail, (_e, p: { publisher: string; slug: string }) =>
    installer().then((i) => i.detail(p.publisher, p.slug)),
  );
  ipcMain.handle(IpcChannels.ExtensionsInstall, (_e, p: { publisher: string; slug: string; version: string }) =>
    installer().then((i) => i.install(p.publisher, p.slug, p.version)),
  );
  ipcMain.handle(IpcChannels.ExtensionsUninstall, (_e, p: { publisher: string; slug: string; version: string }) =>
    installer().then((i) => i.uninstall(p.publisher, p.slug, p.version)),
  );
  ipcMain.handle(
    IpcChannels.ExtensionsSetEnabled,
    (_e, p: { publisher: string; slug: string; version: string; enabled: boolean }) =>
      installer().then((i) => i.setEnabled(p.publisher, p.slug, p.version, p.enabled)),
  );
  ipcMain.handle(IpcChannels.ExtensionsList, () => installer().then((i) => i.listInstalled()));
  ipcMain.handle(IpcChannels.ExtensionsLoadEnabled, () => installer().then((i) => i.loadEnabled()));
}
