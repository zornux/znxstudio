import type { LanguageActivationContext, LanguageCapabilities, LanguageService } from './api';
import { requiredLanguagesFor } from './activation';
import type { WorkspaceInfo } from '../../shared/types';

export interface LanguageDescriptor {
  id: string;
  displayName: string;
  native: boolean;
  active: boolean;
  capabilities: LanguageCapabilities;
}

export interface ActivationReport {
  /** Languages we own that were activated. */
  activated: string[];
  /** Required languages provided by Monaco built-ins (future services can register). */
  builtin: string[];
}

/**
 * The Language Registry. Owns language registration (native + extension),
 * capability queries, extension→language resolution, and per-workspace
 * activation. New languages (Java, Python, C#, SQL, JS…) register here without
 * any change to the registry itself.
 */
export class LanguageRegistry {
  private readonly services = new Map<string, LanguageService>();
  private readonly active = new Set<string>();
  private readonly byExtension = new Map<string, string>();

  register(service: LanguageService): void {
    const { id, extensions } = service.metadata;
    if (this.services.has(id)) throw new Error(`Language already registered: ${id}`);
    this.services.set(id, service);
    for (const extension of extensions) this.byExtension.set(normalizeExtension(extension), id);
  }

  get(id: string): LanguageService | undefined {
    return this.services.get(id);
  }

  all(): LanguageService[] {
    return [...this.services.values()];
  }

  list(): LanguageDescriptor[] {
    return this.all().map((service) => ({
      id: service.metadata.id,
      displayName: service.metadata.displayName,
      native: service.metadata.native,
      active: this.active.has(service.metadata.id),
      capabilities: service.capabilities,
    }));
  }

  languageIdForExtension(extension: string): string | undefined {
    return this.byExtension.get(normalizeExtension(extension));
  }

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  activeIds(): string[] {
    return [...this.active];
  }

  async activate(id: string, context: LanguageActivationContext): Promise<boolean> {
    const service = this.services.get(id);
    if (!service) return false;
    if (!this.active.has(id)) {
      await service.activate(context);
      this.active.add(id);
    }
    return true;
  }

  async deactivate(id: string): Promise<void> {
    const service = this.services.get(id);
    if (service && this.active.has(id)) {
      await service.deactivate();
      this.active.delete(id);
    }
  }

  /** Activate every language the workspace requires that we have a service for. */
  async activateForWorkspace(
    info: WorkspaceInfo | null,
    makeContext: (workspace: WorkspaceInfo | null) => LanguageActivationContext,
  ): Promise<ActivationReport> {
    const report: ActivationReport = { activated: [], builtin: [] };
    const context = makeContext(info);
    for (const id of requiredLanguagesFor(info)) {
      if (this.services.has(id)) {
        await this.activate(id, context);
        report.activated.push(id);
      } else {
        report.builtin.push(id);
      }
    }
    return report;
  }
}

function normalizeExtension(extension: string): string {
  return extension.replace(/^\./, '').toLowerCase();
}
