import type { ExtensionContext } from './sdk';

/**
 * Extension sandbox (Phase 11C). Extensions run in-process, so true VM isolation
 * isn't available — instead the sandbox contains the blast radius: it freezes the
 * SDK facade (no tampering to escalate), catches errors in command handlers so a
 * misbehaving extension can't crash the host, rate-limits handler calls, and caps
 * how many commands / status items one extension may register. Activation is also
 * bounded by a timeout (enforced in the runtime). The pure pieces are unit-tested.
 */

export interface SandboxLimits {
  activationTimeoutMs: number;
  maxCommands: number;
  maxStatusItems: number;
  maxHandlerCallsPerMinute: number;
}

export const DEFAULT_LIMITS: SandboxLimits = {
  activationTimeoutMs: 5000,
  maxCommands: 50,
  maxStatusItems: 20,
  maxHandlerCallsPerMinute: 600,
};

/** Reject if `promise` doesn't settle within `ms`. */
export function withTimeout<T>(promise: Promise<T> | T, ms: number, label = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        reject(new Error(`${label} timed out after ${ms}ms`));
      }
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      (error) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          reject(error);
        }
      },
    );
  });
}

/** A simple acquire/release cap. */
export class ResourceCounter {
  private n = 0;
  constructor(private readonly max: number) {}
  tryAcquire(): boolean {
    if (this.n >= this.max) return false;
    this.n++;
    return true;
  }
  release(): void {
    if (this.n > 0) this.n--;
  }
  count(): number {
    return this.n;
  }
}

/** Sliding-window rate limiter (now injected for deterministic tests). */
export class RateLimiter {
  private hits: number[] = [];
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}
  allow(): boolean {
    const t = this.now();
    this.hits = this.hits.filter((h) => t - h < this.windowMs);
    if (this.hits.length >= this.max) return false;
    this.hits.push(t);
    return true;
  }
}

export interface SandboxHooks {
  /** Reports a contained fault (handler throw, rate-limit trip, cap hit). */
  onError(where: string, error: Error): void;
}

/**
 * Wrap a raw SDK context in the sandbox: rate-limited + error-isolated command
 * handlers, capped command / status-item registration, and a frozen facade.
 */
export function createSandboxedApi(
  inner: ExtensionContext,
  hooks: SandboxHooks,
  limits: SandboxLimits = DEFAULT_LIMITS,
  now: () => number = () => Date.now(),
): ExtensionContext {
  const commandCounter = new ResourceCounter(limits.maxCommands);
  const statusCounter = new ResourceCounter(limits.maxStatusItems);
  const limiter = new RateLimiter(limits.maxHandlerCallsPerMinute, 60_000, now);

  const wrapHandler =
    (handler: (...args: unknown[]) => unknown) =>
    (...args: unknown[]): unknown => {
      if (!limiter.allow()) {
        hooks.onError('command', new Error('rate limit exceeded'));
        return undefined;
      }
      try {
        return handler(...args);
      } catch (error) {
        hooks.onError('command', error as Error);
        return undefined;
      }
    };

  const guarded: ExtensionContext = {
    ...inner,
    commands: {
      register: (command, handler, title) => {
        if (!commandCounter.tryAcquire()) {
          const error = new Error(`command limit (${limits.maxCommands}) reached`);
          hooks.onError('commands.register', error);
          throw error;
        }
        const disposable = inner.commands.register(command, wrapHandler(handler as (...args: unknown[]) => unknown), title);
        return {
          dispose: () => {
            commandCounter.release();
            disposable.dispose();
          },
        };
      },
      execute: (command, ...args) => inner.commands.execute(command, ...args),
    },
    window: {
      ...inner.window,
      setStatusBarItem: (id, item) => {
        if (!statusCounter.tryAcquire()) {
          const error = new Error(`status item limit (${limits.maxStatusItems}) reached`);
          hooks.onError('window.setStatusBarItem', error);
          throw error;
        }
        const disposable = inner.window.setStatusBarItem(id, item);
        return {
          dispose: () => {
            statusCounter.release();
            disposable.dispose();
          },
        };
      },
    },
  };

  // Freeze the facade so an extension can't monkey-patch it to escalate.
  Object.freeze(guarded.commands);
  Object.freeze(guarded.window);
  Object.freeze(guarded.workspace);
  Object.freeze(guarded.editor);
  Object.freeze(guarded.storage);
  return Object.freeze(guarded);
}
