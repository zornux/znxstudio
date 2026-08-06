/**
 * Exercise verification (shared by tutorials, 18C, and lessons, 18E).
 *
 * There is no simulated grader here. An exercise is verified by writing the
 * learner's program to a scratch file and running the REAL Zornux CLI on it —
 * `zornux run` for programs that must produce output, `zornux check` for ones
 * that only have to compile. What this module owns is the pure part: what
 * "matches" means, and how to explain a mismatch.
 */

/** How an exercise is judged against the real compiler. */
export type Verification =
  | { kind: 'run'; expectedOutput: string[]; engine?: 'interpreter' | 'vm' }
  | { kind: 'check' };

export interface VerificationResult {
  passed: boolean;
  /** What the program actually printed, as lines. */
  actual: string[];
  /** What it was supposed to print. Empty for a `check` exercise. */
  expected: string[];
  exitCode: number | null;
  /** A one-line explanation of the verdict, safe to show the learner. */
  explanation: string;
}

/**
 * Split captured output into comparable lines. Trailing blank lines are dropped
 * because a program's final newline is not something a learner should have to
 * think about; interior blank lines are significant and kept.
 */
export function outputLines(output: string): string[] {
  const lines = output.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trimEnd());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

/** Line-for-line equality after trailing-whitespace normalisation. */
export function outputMatches(expected: string[], actual: string[]): boolean {
  if (expected.length !== actual.length) return false;
  return expected.every((line, index) => line.trimEnd() === actual[index]);
}

/** The 0-based index of the first differing line, or -1 when they match. */
export function firstDifference(expected: string[], actual: string[]): number {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    if ((expected[index] ?? null) !== (actual[index] ?? null)) return index;
  }
  return -1;
}

/**
 * Judge a completed run. A `check` exercise passes on exit 0 alone; a `run`
 * exercise must ALSO print exactly what was asked for — a program that compiles
 * and prints the wrong thing has not solved the exercise.
 */
export function judge(verification: Verification, exitCode: number | null, output: string): VerificationResult {
  const actual = outputLines(output);

  if (verification.kind === 'check') {
    const passed = exitCode === 0;
    return {
      passed,
      actual,
      expected: [],
      exitCode,
      explanation: passed ? 'Your program compiles.' : 'Your program does not compile yet — see the compiler output below.',
    };
  }

  const expected = verification.expectedOutput.map((line) => line.trimEnd());
  if (exitCode !== 0) {
    return {
      passed: false,
      actual,
      expected,
      exitCode,
      explanation: `Your program stopped with exit code ${exitCode} before it could print an answer.`,
    };
  }

  if (outputMatches(expected, actual)) {
    return { passed: true, actual, expected, exitCode, explanation: 'Exactly right.' };
  }

  const index = firstDifference(expected, actual);
  const wanted = expected[index];
  const got = actual[index];
  const explanation =
    wanted === undefined
      ? `Line ${index + 1}: your program printed an extra line, ${JSON.stringify(got)}.`
      : got === undefined
        ? `Line ${index + 1}: your program stopped early — it still needs to print ${JSON.stringify(wanted)}.`
        : `Line ${index + 1}: expected ${JSON.stringify(wanted)} but got ${JSON.stringify(got)}.`;
  return { passed: false, actual, expected, exitCode, explanation };
}

/** The CLI argv for a verification against a scratch file. */
export function verificationArgs(verification: Verification, file: string): string[] {
  if (verification.kind === 'check') return ['check', file];
  return [verification.engine === 'vm' ? 'vm-run' : 'run', file];
}

/** Parse an untrusted `verify` block from a pack. Returns null when malformed. */
export function parseVerification(value: unknown): Verification | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind === 'check') return { kind: 'check' };
  if (raw.kind !== 'run') return null;
  if (!Array.isArray(raw.expectedOutput)) return null;
  const expectedOutput = raw.expectedOutput.filter((line): line is string => typeof line === 'string');
  if (expectedOutput.length !== raw.expectedOutput.length) return null;
  const engine = raw.engine === 'vm' ? 'vm' : raw.engine === 'interpreter' ? 'interpreter' : undefined;
  return { kind: 'run', expectedOutput, ...(engine ? { engine } : {}) };
}
