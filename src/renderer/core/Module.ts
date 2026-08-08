import type { CommandRegistry } from '../commands/CommandRegistry';
import type { LayoutManager } from './LayoutManager';
import type { ServiceRegistry } from './ServiceRegistry';

export interface Disposable {
  dispose(): void;
}

/**
 * Everything a module receives at activation time. This is the stable contract
 * used by trusted built-in Zornux/Zoijs modules. Marketplace packages use the
 * narrower declarative contribution contract instead.
 */
export interface ModuleContext {
  readonly services: ServiceRegistry;
  readonly commands: CommandRegistry;
  readonly layout: LayoutManager;
  /** Disposables collected here are torn down when the workbench shuts down. */
  readonly subscriptions: Disposable[];
}

/**
 * A first-class unit of IDE functionality. Core features (editor, explorer,
 * terminal, …) are modules, and so are future language packs and plugins.
 */
export interface IModule {
  readonly id: string;
  readonly displayName: string;
  activate(context: ModuleContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
