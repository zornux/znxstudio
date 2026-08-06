/**
 * A tiny, generic multi-step wizard engine (Phase 5H). Pure and DOM-free so the
 * navigation + per-step validation logic is unit-testable; the WizardsModule
 * renders it and executes the resulting plan against the real services.
 *
 * A step may `validate(state)` — returning an error string blocks advancing (and
 * finishing) until the state is fixed. State is updated immutably via `update`.
 */
export interface WizardStep<T> {
  id: string;
  title: string;
  /** Non-null error text blocks leaving this step (and finishing on the last step). */
  validate?: (state: T) => string | null;
}

export class Wizard<T> {
  private index = 0;

  constructor(
    private readonly steps: WizardStep<T>[],
    private currentState: T,
  ) {
    if (steps.length === 0) throw new Error('A wizard needs at least one step.');
  }

  get state(): T {
    return this.currentState;
  }

  current(): WizardStep<T> {
    return this.steps[this.index];
  }

  stepNumber(): number {
    return this.index + 1;
  }

  total(): number {
    return this.steps.length;
  }

  isFirst(): boolean {
    return this.index === 0;
  }

  isLast(): boolean {
    return this.index === this.steps.length - 1;
  }

  /** The current step's validation error, or null when it is satisfied. */
  error(): string | null {
    return this.current().validate?.(this.currentState) ?? null;
  }

  canAdvance(): boolean {
    return this.error() === null;
  }

  /** Advance to the next step; no-op (returns false) if invalid or already last. */
  next(): boolean {
    if (this.isLast() || !this.canAdvance()) return false;
    this.index += 1;
    return true;
  }

  back(): boolean {
    if (this.isFirst()) return false;
    this.index -= 1;
    return true;
  }

  /** True only when the last step is reached and valid. */
  canFinish(): boolean {
    return this.isLast() && this.canAdvance();
  }

  update(patch: Partial<T>): void {
    this.currentState = { ...this.currentState, ...patch };
  }
}
