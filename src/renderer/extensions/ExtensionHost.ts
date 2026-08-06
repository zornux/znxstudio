import type { IModule, ModuleContext } from '../core/Module';
import type { ActivationRecord } from '../health/perf';

/**
 * Hosts and activates modules. In Phase 1 the "extensions" are the built-in
 * core modules, registered in-process. The same host is the seam where:
 *   - Zornux & Zoijs land as first-class language/framework modules, and
 *   - third-party plugins are loaded dynamically (see `loadPlugin`, TODO).
 *
 * Activation is fault-isolated: one failing module never blocks the rest.
 */
export class ExtensionHost {
  private readonly modules: IModule[] = [];
  private readonly activated: IModule[] = [];
  /** Per-module activation timings and failures (Phase 19A/19C). */
  private readonly activations: ActivationRecord[] = [];
  private startupMilliseconds = 0;

  register(module: IModule): void {
    this.modules.push(module);
  }

  registerAll(modules: IModule[]): void {
    for (const module of modules) this.register(module);
  }

  async activateAll(context: ModuleContext): Promise<void> {
    const startedAt = performance.now();
    for (const module of this.modules) {
      const moduleStartedAt = performance.now();
      try {
        await module.activate(context);
        this.activated.push(module);
        this.activations.push({ moduleId: module.id, milliseconds: performance.now() - moduleStartedAt });
        console.info(`[ZnxStudio] activated module: ${module.id}`);
      } catch (error) {
        // Activation stays fault-isolated: the failure is RECORDED, not thrown,
        // so the diagnostics report can name the module that did not come up.
        this.activations.push({
          moduleId: module.id,
          milliseconds: performance.now() - moduleStartedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`[ZnxStudio] failed to activate module ${module.id}:`, error);
      }
    }
    this.startupMilliseconds = performance.now() - startedAt;
  }

  /** What activated, how long it took, and what failed. */
  activationRecords(): ActivationRecord[] {
    return [...this.activations];
  }

  /** Wall-clock for the whole activation pass — not the sum of the parts. */
  startupDuration(): number {
    return this.startupMilliseconds;
  }

  async deactivateAll(): Promise<void> {
    for (const module of [...this.activated].reverse()) {
      await module.deactivate?.();
    }
  }

  getModules(): readonly IModule[] {
    return this.modules;
  }

  /**
   * Placeholder for dynamic plugin loading (Extension System phase). A real
   * implementation will read a plugin manifest, sandbox it, and register the
   * module it exports.
   */
  async loadPlugin(_manifestPath: string): Promise<void> {
    throw new Error('Dynamic plugin loading is not implemented in Phase 1.');
  }
}
