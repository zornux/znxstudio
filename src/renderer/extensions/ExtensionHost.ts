import type { IModule, ModuleContext } from '../core/Module';
import type { ActivationRecord } from '../health/perf';

/**
 * Hosts and activates trusted, bundled modules. Marketplace extensions use the
 * separate declarative contribution pipeline: downloaded JavaScript is never
 * executed in this privileged renderer.
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
      try {
        await module.deactivate?.();
      } catch (error) {
        console.error(`[ZnxStudio] failed to deactivate module ${module.id}:`, error);
      }
    }
  }

  getModules(): readonly IModule[] {
    return this.modules;
  }

}
