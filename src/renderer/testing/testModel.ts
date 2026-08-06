/**
 * Pure Zornux test parsing + result decoding (Phase 9A). Tests are
 * `test "<name>" … expect … end` blocks (xojin/examples/tests); the real runner
 * `zornux test <file> --json` emits `{total,passed,failed,tests:[{name,status,
 * durationMs,code?,message?}]}` (exit 1 on any failure). No DOM / no Monaco.
 */
import { envelopeResultObject, parseEnvelope } from '../../shared/cli/envelope';

export interface TestBlock {
  name: string;
  /** 0-based line of the `test` declaration. */
  line: number;
}

const TEST_RE = /^test\s+"([^"]*)"/;

/** Every top-level `test "<name>"` block in the source, in order. */
export function parseTestBlocks(text: string): TestBlock[] {
  const blocks: TestBlock[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = TEST_RE.exec(lines[i]);
    if (match) blocks.push({ name: match[1], line: i });
  }
  return blocks;
}

export type TestStatus = 'passed' | 'failed' | 'skipped' | string;

export interface TestCaseResult {
  name: string;
  status: TestStatus;
  durationMs: number;
  code?: string;
  message?: string;
}

export interface TestRunResult {
  total: number;
  passed: number;
  failed: number;
  tests: TestCaseResult[];
}

/* ----- Unit runner (Phase 9B) ----- */

export interface TestRunOptions {
  engine: 'interpreter' | 'vm';
  failFast: boolean;
  /** Substring filter on test names (`--filter`). */
  filter?: string;
  /** Integration context (Phase 9C): security identity + role for guarded code. */
  identity?: string;
  role?: string;
}

/** Build the `zornux test` argument string for the given options (always --json). */
export function buildTestArgs(options: TestRunOptions): string {
  const parts = ['--json'];
  if (options.engine === 'vm') parts.push('--engine vm');
  if (options.failFast) parts.push('--fail-fast');
  const filter = options.filter?.trim();
  if (filter) parts.push(`--filter "${filter}"`);
  const identity = options.identity?.trim();
  if (identity) parts.push(`--identity "${identity}"`);
  const role = options.role?.trim();
  if (role) parts.push(`--role "${role}"`);
  return parts.join(' ');
}

/* ----- Integration classification (Phase 9C) ----- */

export type TestKind = 'unit' | 'integration';

const INTEGRATION_MARKERS: [RegExp, string][] = [
  [/^\s*service\s+\w/m, 'service'],
  [/^\s*database\s+\w/m, 'database'],
  [/^\s*policy\s+\w/m, 'policy'],
  [/\brestrict\s+to\b/, 'restrict'],
  [/^\s*on\s+(GET|POST|PUT|DELETE)\b/m, 'route'],
];

/**
 * Classify a test file as unit or integration. Integration files exercise
 * services / databases / auth policies (restrict) — the things a security
 * context (--identity/--role) or a running store affect.
 */
export function classifyTestFile(text: string): { kind: TestKind; markers: string[] } {
  const markers = INTEGRATION_MARKERS.filter(([re]) => re.test(text)).map(([, name]) => name);
  return { kind: markers.length > 0 ? 'integration' : 'unit', markers };
}

export interface FileSummary {
  file: string;
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
}

/** Aggregate per-file summaries into a run total. */
export function summarizeRun(files: FileSummary[]): {
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
} {
  return files.reduce(
    (accumulator, file) => ({
      total: accumulator.total + file.total,
      passed: accumulator.passed + file.passed,
      failed: accumulator.failed + file.failed,
      durationMs: accumulator.durationMs + file.durationMs,
    }),
    { total: 0, passed: 0, failed: 0, durationMs: 0 },
  );
}

/** Sum test durations from a run result (the runner reports per-test ms). */
export function totalDuration(result: TestRunResult): number {
  return result.tests.reduce((sum, test) => sum + test.durationMs, 0);
}

/**
 * Parse `zornux test --json` output (tolerant of surrounding log lines).
 *
 * The summary lives in the envelope's `result`; an `ok:false` envelope (the
 * program did not compile) has no result and yields null.
 */
export function parseTestResult(output: string): TestRunResult | null {
  const envelope = parseEnvelope(output);
  if (!envelope) return null;
  const record = envelopeResultObject(envelope);
  if (!record || !Array.isArray(record.tests)) return null;

  const tests: TestCaseResult[] = [];
  for (const item of record.tests) {
    if (!item || typeof item !== 'object') continue;
    const test = item as Record<string, unknown>;
    if (typeof test.name !== 'string') continue;
    tests.push({
      name: test.name,
      status: typeof test.status === 'string' ? test.status : 'unknown',
      durationMs: typeof test.durationMs === 'number' ? test.durationMs : 0,
      code: typeof test.code === 'string' ? test.code : undefined,
      message: typeof test.message === 'string' ? test.message : undefined,
    });
  }

  const passed = typeof record.passed === 'number' ? record.passed : tests.filter((t) => t.status === 'passed').length;
  const failed = typeof record.failed === 'number' ? record.failed : tests.filter((t) => t.status === 'failed').length;
  const total = typeof record.total === 'number' ? record.total : tests.length;
  return { total, passed, failed, tests };
}
