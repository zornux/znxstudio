/**
 * Macro recording (Phase 17E) — the pure model.
 *
 * A macro is a recorded sequence of COMMAND invocations, not of keystrokes.
 * Recording keystrokes would replay whatever the keys happen to be bound to
 * later; recording commands replays what the user actually did.
 *
 * Two safety rules, both enforced here rather than left to the UI:
 *
 *   1. Some commands must never be recorded, because replaying them is either
 *      meaningless (recording the recorder) or dangerous out of context (a
 *      commit, a deploy, leaving a live session). They are dropped at record
 *      time, so a macro cannot contain one at all.
 *   2. Replay stops at the first command that throws. A macro that half-ran and
 *      reported success would be worse than one that stopped and said where.
 */

export interface MacroStep {
  command: string;
  /** Milliseconds since the previous step, for replay pacing. Clamped on parse. */
  delayMs: number;
}

export interface Macro {
  name: string;
  steps: MacroStep[];
}

export const MAX_STEP_DELAY_MS = 5_000;
export const MAX_MACRO_STEPS = 500;

/**
 * Commands never captured into a macro. Recording the recorder is nonsense; the
 * rest are outward-facing or destructive enough that replaying them from a
 * keystroke, out of the context in which they were recorded, is a bad idea.
 */
export const UNRECORDABLE_COMMANDS: readonly string[] = [
  'znxstudio.macro.startRecording',
  'znxstudio.macro.stopRecording',
  'znxstudio.macro.replay',
  'znxstudio.macro.show',
  'znxstudio.scm.commit',
  'znxstudio.scm.stageAll',
  'znxstudio.deploy.cloudDeployCmd',
  'znxstudio.collab.host',
  'znxstudio.collab.join',
  'znxstudio.collab.leave',
  'znxstudio.security.exportReport',
  // Wipes progress the learner earned against the real compiler, and writes
  // generated documentation into the user's own project.
  'znxstudio.learning.resetProgress',
  'znxstudio.docs.saveApi',
  // Throws away work recovered from a crash. Not something to replay from a key.
  'znxstudio.crash.discard',
];

export function isRecordable(command: string): boolean {
  return !UNRECORDABLE_COMMANDS.includes(command);
}

/** Records command invocations until stopped. Pure: the clock is injected. */
export class MacroRecorder {
  private steps: MacroStep[] = [];
  private lastAt: number | null = null;
  private recording = false;
  /** Commands offered while recording but refused. Surfaced so the user is not surprised. */
  private readonly refused: string[] = [];

  get isRecording(): boolean {
    return this.recording;
  }

  get stepCount(): number {
    return this.steps.length;
  }

  get refusedCommands(): string[] {
    return [...new Set(this.refused)];
  }

  start(now: number): void {
    this.steps = [];
    this.refused.length = 0;
    this.lastAt = now;
    this.recording = true;
  }

  /** Offer a command. Returns true when it was captured. */
  record(command: string, now: number): boolean {
    if (!this.recording) return false;
    if (!isRecordable(command)) {
      this.refused.push(command);
      return false;
    }
    if (this.steps.length >= MAX_MACRO_STEPS) return false;

    const delayMs = this.lastAt === null ? 0 : clampDelay(now - this.lastAt);
    this.lastAt = now;
    this.steps.push({ command, delayMs });
    return true;
  }

  /** Stop and return the macro, or null when nothing was captured. */
  stop(name: string): Macro | null {
    this.recording = false;
    this.lastAt = null;
    if (!this.steps.length) return null;
    // The first step's delay is meaningless — it measures how long the user took
    // to do anything after pressing record.
    const steps = this.steps.map((step, index) => (index === 0 ? { ...step, delayMs: 0 } : step));
    this.steps = [];
    return { name: name.trim() || 'Untitled macro', steps };
  }

  cancel(): void {
    this.recording = false;
    this.steps = [];
    this.lastAt = null;
  }
}

export function clampDelay(delayMs: number): number {
  if (!Number.isFinite(delayMs) || delayMs < 0) return 0;
  return Math.min(MAX_STEP_DELAY_MS, Math.round(delayMs));
}

/* -------------------------------------------------------------- replay */

export interface ReplayResult {
  ok: boolean;
  /** How many steps ran, including the one that failed. */
  executed: number;
  failedCommand?: string;
  error?: string;
}

/**
 * Replay a macro, awaiting each command. Stops at the first failure and reports
 * which command it was — never continues past it, and never claims success.
 * `sleep` is injected so a test can replay a macro instantly.
 */
export async function replayMacro(
  macro: Macro,
  execute: (command: string) => unknown | Promise<unknown>,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<ReplayResult> {
  let executed = 0;
  for (const step of macro.steps) {
    if (step.delayMs > 0) await sleep(step.delayMs);
    executed += 1;
    try {
      await execute(step.command);
    } catch (error) {
      return { ok: false, executed, failedCommand: step.command, error: (error as Error).message };
    }
  }
  return { ok: true, executed };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------------------------------------------------- persistence */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Read macros from untrusted settings. A step naming an unrecordable command is
 * dropped even here — a hand-edited settings file must not smuggle one in — and a
 * macro left with no steps is dropped entirely.
 */
export function parseMacros(value: unknown): Macro[] {
  if (!Array.isArray(value)) return [];
  const macros: Macro[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (typeof record.name !== 'string' || !record.name.trim()) continue;
    if (!Array.isArray(record.steps)) continue;

    const steps: MacroStep[] = [];
    for (const rawStep of record.steps.slice(0, MAX_MACRO_STEPS)) {
      const step = asRecord(rawStep);
      if (typeof step.command !== 'string' || !step.command.trim()) continue;
      if (!isRecordable(step.command)) continue;
      steps.push({ command: step.command, delayMs: clampDelay(Number(step.delayMs ?? 0)) });
    }
    if (steps.length) macros.push({ name: record.name.trim(), steps });
  }
  return macros;
}

/** Total wall-clock a replay will take, for the UI to show before running it. */
export function macroDurationMs(macro: Macro): number {
  return macro.steps.reduce((total, step) => total + step.delayMs, 0);
}

/** Add or replace a macro by name. */
export function upsertMacro(macros: Macro[], macro: Macro): Macro[] {
  const others = macros.filter((existing) => existing.name !== macro.name);
  return [...others, macro].sort((a, b) => a.name.localeCompare(b.name));
}

export function removeMacro(macros: Macro[], name: string): Macro[] {
  return macros.filter((macro) => macro.name !== name);
}
