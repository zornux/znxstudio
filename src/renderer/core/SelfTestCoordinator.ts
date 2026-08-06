/**
 * Shared gate for the modules' optional headless self-tests. Each module routes
 * its self-test through `run(name, testFunc)` instead of firing it unawaited, so
 * a bounded number run at once (default 1). This stops the per-module self-tests
 * from stampeding the machine — several of them each spawn a cold `zornux.exe`
 * (compiler check, project check, DAP adapter), and running them all at once
 * starves those subprocesses and makes the debugger handshake time out.
 *
 * Guarantees:
 *  - at most `concurrency` self-tests execute concurrently (default 1);
 *  - a failing self-test is isolated — it never rejects `run` or affects others;
 *  - per-module outcomes are preserved in completion order via `results()`.
 *
 * The class is transport/DOM-free and deterministic (an injectable clock), so it
 * is unit-tested directly.
 */
export type SelfTestStatus = 'passed' | 'failed';

export interface SelfTestOutcome {
  name: string;
  status: SelfTestStatus;
  durationMs: number;
  /** Present only when status === 'failed'. */
  error?: string;
}

export class SelfTestCoordinator {
  private concurrency = 1;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly outcomes: SelfTestOutcome[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Sets the max number of self-tests allowed to run at once (min 1). */
  configure(concurrency: number): void {
    this.concurrency = Number.isFinite(concurrency) && concurrency >= 1 ? Math.floor(concurrency) : 1;
    // A larger budget may let queued waiters start immediately.
    this.pump();
  }

  /** Current concurrency budget (mainly for tests/diagnostics). */
  get maxConcurrency(): number {
    return this.concurrency;
  }

  /** A snapshot of the outcomes recorded so far, in completion order. */
  results(): SelfTestOutcome[] {
    return this.outcomes.slice();
  }

  /**
   * Runs `testFunc` under the concurrency gate. Resolves with the outcome once
   * it finishes; never rejects (failures are captured, not thrown).
   */
  async run(name: string, testFunc: () => Promise<void> | void): Promise<SelfTestOutcome> {
    await this.acquire();
    const start = this.now();
    try {
      await testFunc();
      const outcome: SelfTestOutcome = { name, status: 'passed', durationMs: this.now() - start };
      this.outcomes.push(outcome);
      return outcome;
    } catch (error) {
      const outcome: SelfTestOutcome = {
        name,
        status: 'failed',
        durationMs: this.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
      this.outcomes.push(outcome);
      return outcome;
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      this.pump();
    });
  }

  private release(): void {
    this.active--;
    this.pump();
  }

  /** Starts as many queued waiters as the budget allows. */
  private pump(): void {
    while (this.active < this.concurrency && this.waiters.length > 0) {
      const next = this.waiters.shift()!;
      this.active++;
      next();
    }
  }
}

/** The single coordinator shared by every module's self-test. */
export const selfTestCoordinator = new SelfTestCoordinator();
