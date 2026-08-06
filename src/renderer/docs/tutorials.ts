/**
 * Tutorial progression (Phase 18C).
 *
 * A tutorial is an ordered walk: prose, a starting program, and — on the steps
 * that have one — a `verify` block the REAL compiler rules on. The rule that
 * makes it a tutorial rather than a slideshow: **a step that can be verified must
 * be verified before you move past it.** Otherwise a learner reaches the end
 * having run nothing.
 *
 * Steps without a `verify` block are prose. They advance freely; pretending to
 * grade them would be theatre.
 */

import type { Tutorial } from './learning';

/** Indices of the steps the compiler can rule on. */
export function verifiableSteps(tutorial: Tutorial): number[] {
  return tutorial.steps.map((step, index) => (step.verify ? index : -1)).filter((index) => index >= 0);
}

export function isVerifiable(tutorial: Tutorial, index: number): boolean {
  return Boolean(tutorial.steps[index]?.verify);
}

/**
 * May the learner move from `index` to the next step? A prose step always yields;
 * a verifiable step yields only once it has actually passed.
 */
export function canAdvance(tutorial: Tutorial, index: number, passed: ReadonlySet<number>): boolean {
  if (index < 0 || index >= tutorial.steps.length - 1) return false;
  return !isVerifiable(tutorial, index) || passed.has(index);
}

/** Moving backwards is always allowed — re-reading is not cheating. */
export function canGoBack(index: number): boolean {
  return index > 0;
}

/**
 * A tutorial is finished when every verifiable step has passed AND the learner
 * has reached the last step. A tutorial with no verifiable steps finishes on
 * arrival at the last one.
 */
export function tutorialComplete(tutorial: Tutorial, index: number, passed: ReadonlySet<number>): boolean {
  const atEnd = index >= tutorial.steps.length - 1;
  return atEnd && verifiableSteps(tutorial).every((step) => passed.has(step));
}

export interface TutorialStatus {
  step: number;
  steps: number;
  verified: number;
  verifiable: number;
  percent: number;
}

export function tutorialStatus(tutorial: Tutorial, index: number, passed: ReadonlySet<number>): TutorialStatus {
  const verifiable = verifiableSteps(tutorial);
  return {
    step: index + 1,
    steps: tutorial.steps.length,
    verified: verifiable.filter((step) => passed.has(step)).length,
    verifiable: verifiable.length,
    percent: tutorial.steps.length ? Math.round(((index + 1) / tutorial.steps.length) * 100) : 0,
  };
}

/**
 * The step a learner should resume at: the first verifiable step that has not
 * passed, or the last step when they all have.
 */
export function resumeStep(tutorial: Tutorial, passed: ReadonlySet<number>): number {
  const pending = verifiableSteps(tutorial).find((step) => !passed.has(step));
  return pending ?? tutorial.steps.length - 1;
}

/** Scratch-file slot for a step, stable across attempts so it overwrites. */
export function stepSlot(tutorialId: string, index: number): string {
  return `tutorial-${tutorialId}-step-${index + 1}`;
}
