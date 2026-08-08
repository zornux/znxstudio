import type { Disposable } from '../core/Module';
import { EXTENSION_CONTRIBUTABLE_COMMANDS } from '../../shared/extensions/registry';
import { reportUiError } from '../core/uiErrors';

export type CommandHandler = (...args: any[]) => unknown;

interface CommandEntry {
  id: string;
  title: string;
  handler: CommandHandler;
}

/**
 * Command bus. Modules register named commands; anything (UI, keybindings,
 * plugins) can execute them by id without knowing who implements them.
 */
/** How a command invocation ended, for perf telemetry (Phase 19C). */
export interface CommandCompletion {
  id: string;
  milliseconds: number;
  ok: boolean;
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandEntry>();
  private readonly observers: ((id: string) => void)[] = [];
  private readonly completionObservers: ((completion: CommandCompletion) => void)[] = [];
  private readonly enablementRules: ((id: string) => boolean | undefined)[] = [];
  private readonly enablementObservers: (() => void)[] = [];

  register(id: string, handler: CommandHandler, title: string = id): Disposable {
    if (this.commands.has(id)) {
      throw new Error(`Command already registered: ${id}`);
    }
    this.commands.set(id, { id, title, handler });
    return { dispose: () => void this.commands.delete(id) };
  }

  async execute<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    const command = this.commands.get(id);
    if (!command) {
      throw new Error(`Unknown command: ${id}`);
    }
    if (!this.isEnabled(id)) {
      throw new Error(`Command is disabled in the current context: ${id}`);
    }
    // Observers see the id BEFORE the handler runs, so the macro recorder
    // captures a command even when it later throws — the user did invoke it.
    for (const observer of this.observers) observer(id);

    const startedAt = performance.now();
    try {
      const result = (await command.handler(...args)) as T;
      this.notifyCompletion({ id, milliseconds: performance.now() - startedAt, ok: true });
      return result;
    } catch (error) {
      // A command that threw still took time, and a slow failure is exactly the
      // kind of thing the perf report should show. Then rethrow, untouched.
      this.notifyCompletion({ id, milliseconds: performance.now() - startedAt, ok: false });
      throw error;
    }
  }

  /** Fire-and-forget execution for click/keyboard handlers; never leaks a rejected promise. */
  executeFromUi(id: string, onError?: (error: unknown) => void, ...args: unknown[]): void {
    void this.execute(id, ...args).catch((error) => {
      if (onError) onError(error);
      else reportUiError(`Command failed (${id})`, error);
    });
  }

  private notifyCompletion(completion: CommandCompletion): void {
    for (const observer of this.completionObservers) {
      // A misbehaving telemetry observer must never break the command that ran.
      try {
        observer(completion);
      } catch {
        /* ignored */
      }
    }
  }

  /** Observe every command invocation (the macro recorder, Phase 17E). */
  onDidExecute(observer: (id: string) => void): () => void {
    this.observers.push(observer);
    return () => {
      const index = this.observers.indexOf(observer);
      if (index >= 0) this.observers.splice(index, 1);
    };
  }

  /** Observe how long each command took, and whether it threw (Phase 19C). */
  onDidComplete(observer: (completion: CommandCompletion) => void): () => void {
    this.completionObservers.push(observer);
    return () => {
      const index = this.completionObservers.indexOf(observer);
      if (index >= 0) this.completionObservers.splice(index, 1);
    };
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }

  /**
   * Whether a command may be targeted by a marketplace (declarative) extension — a `runs`
   * alias or a contributed keybinding. Only the curated, benign allowlist qualifies;
   * privileged/internal commands (terminal, fs, workspace mutation, git, debug, trust) are
   * never contributable, so declarative data can never reach privileged execution. This is
   * defence-in-depth: the main-process validator already enforces the same allowlist.
   */
  isExtensionContributable(id: string): boolean {
    return EXTENSION_CONTRIBUTABLE_COMMANDS.includes(id) && this.commands.has(id);
  }

  /**
   * Register a predicate that can disable commands (e.g. trust-gated execution in Restricted Mode). A
   * rule returns `false` to disable a command, or `undefined` to abstain. The UI (command palette, menus,
   * toolbars) reflects this via {@link isEnabled}; execution itself remains guarded at the IPC boundary.
   */
  addEnablementRule(rule: (id: string) => boolean | undefined): Disposable {
    this.enablementRules.push(rule);
    return {
      dispose: () => {
        const index = this.enablementRules.indexOf(rule);
        if (index >= 0) this.enablementRules.splice(index, 1);
      },
    };
  }

  /** Whether a command is currently enabled — true unless an enablement rule vetoes it. */
  isEnabled(id: string): boolean {
    for (const rule of this.enablementRules) {
      if (rule(id) === false) return false;
    }
    return true;
  }

  /**
   * Observe changes to command enablement (e.g. Workspace Trust flipping). Surfaces that render enabled
   * state and don't rebuild on demand — the editor toolbar — subscribe here to refresh live. The
   * command palette rebuilds its list on each open, so it needs no subscription.
   */
  onDidChangeEnablement(observer: () => void): Disposable {
    this.enablementObservers.push(observer);
    return {
      dispose: () => {
        const index = this.enablementObservers.indexOf(observer);
        if (index >= 0) this.enablementObservers.splice(index, 1);
      },
    };
  }

  /** Signal that enablement may have changed, so subscribed surfaces re-evaluate. */
  notifyEnablementChanged(): void {
    for (const observer of this.enablementObservers) {
      try {
        observer();
      } catch {
        /* a misbehaving observer must not break the notifier */
      }
    }
  }

  list(): { id: string; title: string; enabled: boolean }[] {
    return [...this.commands.values()].map(({ id, title }) => ({ id, title, enabled: this.isEnabled(id) }));
  }
}
