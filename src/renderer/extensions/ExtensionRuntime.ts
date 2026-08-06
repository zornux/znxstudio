import {
  SDK_VERSION,
  activationMatches,
  isEngineCompatible,
  type ExtensionManifest,
} from '../../shared/extensions/manifest';
import type { ExtensionInfo, ExtensionState } from '../core/Contracts';
import type { ExtensionContext, ZnxStudioExtension } from './sdk';
import { withTimeout } from './sandbox';
import type { ExtensionDiagnostics } from './diagnostics';

export interface RuntimeOptions {
  sdkVersion?: string;
  /** Bound extension activation; 0 disables the timeout. */
  activationTimeoutMs?: number;
  /** Diagnostics sink for activation timing / error surfacing (11F). */
  diagnostics?: ExtensionDiagnostics;
  /** Monotonic clock (injected for tests); defaults to Date.now. */
  clock?: () => number;
}

interface LoadedExtension {
  manifest: ExtensionManifest;
  instance: ZnxStudioExtension;
  state: ExtensionState;
  error?: string;
  context?: ExtensionContext;
}

/**
 * Owns the lifecycle of registered extensions (Phase 11A): engine-compat check
 * on register, activation on demand (startup / command triggers), and clean
 * teardown that disposes everything the SDK facade tracked. Decoupled from the
 * workbench via an injected `makeApi`, so it is unit-testable with real registries.
 */
export class ExtensionRuntime {
  private readonly items = new Map<string, LoadedExtension>();

  private readonly sdkVersion: string;
  private readonly activationTimeoutMs: number;
  private readonly diagnostics?: ExtensionDiagnostics;
  private readonly clock: () => number;

  constructor(
    private readonly makeApi: (manifest: ExtensionManifest) => ExtensionContext,
    options: RuntimeOptions = {},
  ) {
    this.sdkVersion = options.sdkVersion ?? SDK_VERSION;
    this.activationTimeoutMs = options.activationTimeoutMs ?? 0;
    this.diagnostics = options.diagnostics;
    this.clock = options.clock ?? (() => Date.now());
  }

  /** Register an extension; incompatible engines are recorded, not activated. */
  register(manifest: ExtensionManifest, instance: ZnxStudioExtension): ExtensionState {
    const compatible = isEngineCompatible(manifest.engines.znxstudio, this.sdkVersion);
    const state: ExtensionState = compatible ? 'registered' : 'incompatible';
    this.items.set(manifest.id, {
      manifest,
      instance,
      state,
      error: compatible ? undefined : `Requires ZnxStudio ${manifest.engines.znxstudio}; SDK is ${this.sdkVersion}.`,
    });
    return state;
  }

  async activate(id: string): Promise<boolean> {
    const item = this.items.get(id);
    if (!item) return false;
    if (item.state === 'active') return true;
    if (item.state === 'incompatible') return false;
    const started = this.clock();
    try {
      const api = this.makeApi(item.manifest);
      const activation = Promise.resolve(item.instance.activate(api));
      await (this.activationTimeoutMs > 0
        ? withTimeout(activation, this.activationTimeoutMs, `activation of ${item.manifest.id}`)
        : activation);
      item.context = api;
      item.state = 'active';
      item.error = undefined;
      this.diagnostics?.recordActivation(item.manifest.id, this.clock() - started);
      return true;
    } catch (error) {
      item.state = 'failed';
      item.error = (error as Error).message;
      this.diagnostics?.recordError(item.manifest.id, (error as Error).message);
      return false;
    }
  }

  /** Record a contained runtime fault (from the sandbox) against an extension. */
  reportError(id: string, message: string): void {
    const item = this.items.get(id);
    if (item) item.error = message;
  }

  async deactivate(id: string): Promise<void> {
    const item = this.items.get(id);
    if (!item || item.state !== 'active') return;
    try {
      await item.instance.deactivate?.();
    } catch (error) {
      item.error = (error as Error).message;
    }
    // Dispose everything the facade tracked (commands, status items, …).
    for (const disposable of [...(item.context?.subscriptions ?? [])].reverse()) {
      try {
        disposable.dispose();
      } catch {
        /* ignore */
      }
    }
    item.context = undefined;
    item.state = 'registered';
  }

  /** Activate every compatible extension whose events fire for `trigger`. */
  async activateForTrigger(trigger: string): Promise<string[]> {
    const activated: string[] = [];
    for (const item of this.items.values()) {
      if (item.state === 'registered' && activationMatches(item.manifest.activationEvents, trigger)) {
        if (await this.activate(item.manifest.id)) activated.push(item.manifest.id);
      }
    }
    return activated;
  }

  /** Deactivate and forget an extension entirely (marketplace uninstall). */
  async remove(id: string): Promise<void> {
    await this.deactivate(id);
    this.items.delete(id);
  }

  isActive(id: string): boolean {
    return this.items.get(id)?.state === 'active';
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  list(): ExtensionInfo[] {
    return [...this.items.values()].map((item) => this.toInfo(item));
  }

  info(id: string): ExtensionInfo | null {
    const item = this.items.get(id);
    return item ? this.toInfo(item) : null;
  }

  private toInfo(item: LoadedExtension): ExtensionInfo {
    const diag = this.diagnostics?.get(item.manifest.id);
    return {
      id: item.manifest.id,
      name: item.manifest.name,
      version: item.manifest.version,
      publisher: item.manifest.publisher,
      description: item.manifest.description,
      state: item.state,
      error: item.error,
      activationEvents: item.manifest.activationEvents,
      commands: item.manifest.contributes.commands ?? [],
      activationMs: diag?.activationMs,
      errorCount: diag?.errorCount,
      logs: this.diagnostics?.recentMessages(item.manifest.id),
    };
  }
}
