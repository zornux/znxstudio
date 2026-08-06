import { describe, expect, test } from './harness';
import {
  LOG_LEVELS,
  REDACTED,
  RingBuffer,
  countByLevel,
  filterRecords,
  formatRecord,
  logSources,
  makeRecord,
  parseLogLevel,
  parseRecord,
  redact,
  shouldLog,
  type LogRecord,
} from '../src/renderer/health/logging';
import {
  DEFAULT_BUDGETS,
  MAX_SAMPLES_PER_METRIC,
  PerfRegistry,
  checkBudgets,
  formatBytesKb,
  formatDuration,
  formatUptime,
  percentile,
  slowestByP95,
  slowestByTotal,
  startupReport,
  summarize,
  totalMemoryKb,
} from '../src/renderer/health/perf';
import {
  buildSnapshot,
  isRoutineCancellation,
  parseCrashRecord,
  parseSnapshot,
  recoverableBuffers,
  serializeError,
  shouldOfferRestore,
  type SessionState,
} from '../src/renderer/health/crash';
import {
  countByStatus,
  overallStatus,
  renderDiagnosticsReport,
  sortChecks,
  statusLine,
  type DiagnosticsReport,
  type HealthCheck,
} from '../src/renderer/health/diagnostics';

/* --------------------------------------------------------------- redaction */

describe('logging — redaction (Phase 19D)', () => {
  test('a bearer token is removed, the fact of it is kept', () => {
    expect(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc')).toBe(`Authorization: Bearer ${REDACTED}`);
  });

  test('a --token flag value is removed', () => {
    expect(redact('zornux login --token abcd1234efgh')).toBe(`zornux login --token ${REDACTED}`);
    expect(redact('zornux login --token=abcd1234efgh')).toBe(`zornux login --token=${REDACTED}`);
  });

  test('labelled credentials are removed, the label stays', () => {
    expect(redact('apiKey="sk-abcdefghijklmnop"')).toContain(REDACTED);
    expect(redact('password=hunter2xyz')).toBe(`password=${REDACTED}`);
    expect(redact('client_secret: shhhhhhhh')).toBe(`client_secret: ${REDACTED}`);
  });

  test('credential env vars are removed', () => {
    expect(redact('ZORNUX_REGISTRY_TOKEN=abc123def456')).toBe(`ZORNUX_REGISTRY_TOKEN=${REDACTED}`);
    expect(redact('ANTHROPIC_API_KEY=sk-ant-1234567890abcdef')).toContain(REDACTED);
  });

  test('an unlabelled key shape is still recognised', () => {
    expect(redact('using sk-abcdefghijklmnopqrst now')).toBe(`using ${REDACTED} now`);
    expect(redact('ghp_abcdefghijklmnopqrstuvwxyz01')).toBe(REDACTED);
    expect(redact('github_pat_11ABCDEFG0abcdefghijklm')).toBe(REDACTED);
  });

  test('ordinary text is untouched', () => {
    expect(redact('compiled 12 modules in 340 ms')).toBe('compiled 12 modules in 340 ms');
  });

  test('the home directory becomes ~, in both separator styles and any case', () => {
    expect(redact('C:\\Users\\jane\\app.zx', 'C:\\Users\\jane')).toBe('~\\app.zx');
    expect(redact('C:/Users/jane/app.zx', 'C:\\Users\\jane')).toBe('~/app.zx');
    expect(redact('c:\\users\\JANE\\app.zx', 'C:\\Users\\jane')).toBe('~\\app.zx');
  });

  test('an empty home directory redacts nothing extra', () => {
    expect(redact('C:\\Users\\jane\\app.zx', '')).toBe('C:\\Users\\jane\\app.zx');
  });

  test('redaction happens at RECORD time, before any sink sees it', () => {
    const record = makeRecord('error', 'auth', 'token: supersecretvalue', 1_000, '');
    expect(record.message).toBe(`token: ${REDACTED}`);
  });
});

/* ------------------------------------------------------------ log records */

describe('logging — records', () => {
  test('levels order correctly', () => {
    expect(shouldLog('error', 'info')).toBe(true);
    expect(shouldLog('debug', 'info')).toBe(false);
    expect(shouldLog('info', 'info')).toBe(true);
    expect(LOG_LEVELS).toHaveLength(5);
  });

  test('an unknown level falls back rather than being trusted', () => {
    expect(parseLogLevel('shout')).toBe('info');
    expect(parseLogLevel(undefined, 'trace')).toBe('trace');
    expect(parseLogLevel('WARN')).toBe('warn');
  });

  test('a record round-trips through the formatted line', () => {
    const record = makeRecord('warn', 'compiler', 'slow build', 1_700_000_000_000);
    const parsed = parseRecord(formatRecord(record));
    expect(parsed).toEqual(record);
  });

  test('a newline in a message cannot split the record', () => {
    const record = makeRecord('info', 'x', 'line one\nline two', 1_700_000_000_000);
    const line = formatRecord(record);
    expect(line.includes('\n')).toBe(false);
    expect(parseRecord(line)?.message).toBe('line one\nline two');
  });

  test('a bracket in the source cannot break the format', () => {
    const record = makeRecord('info', '[weird]', 'hi', 1_700_000_000_000);
    expect(record.source).toBe('weird');
    expect(parseRecord(formatRecord(record))?.source).toBe('weird');
  });

  test('a line this did not write parses to null', () => {
    expect(parseRecord('random text')).toBeNull();
    expect(parseRecord('not-a-date [info] [x] hi')).toBeNull();
    expect(parseRecord('2026-07-10T00:00:00.000Z [shout] [x] hi')).toBeNull();
  });

  test('the ring buffer drops the OLDEST record at capacity', () => {
    const buffer = new RingBuffer<number>(3);
    for (const value of [1, 2, 3, 4, 5]) buffer.push(value);
    expect(buffer.all()).toEqual([3, 4, 5]);
    expect(buffer.size).toBe(3);
  });

  test('a zero-capacity buffer is refused', () => {
    let threw = false;
    try {
      new RingBuffer(0);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  const records: LogRecord[] = [
    { time: 1, level: 'debug', source: 'a', message: 'alpha' },
    { time: 2, level: 'error', source: 'b', message: 'beta' },
    { time: 3, level: 'warn', source: 'a', message: 'gamma' },
  ];

  test('filtering by level keeps that level and above', () => {
    expect(filterRecords(records, { level: 'warn' })).toHaveLength(2);
    expect(filterRecords(records, { level: 'trace' })).toHaveLength(3);
  });

  test('filtering by source and text', () => {
    expect(filterRecords(records, { source: 'a' })).toHaveLength(2);
    expect(filterRecords(records, { text: 'BET' })).toHaveLength(1);
    expect(filterRecords(records, { text: '  ' })).toHaveLength(3);
  });

  test('counts and sources', () => {
    expect(countByLevel(records).error).toBe(1);
    expect(logSources(records)).toEqual(['a', 'b']);
  });
});

/* --------------------------------------------------------------- perf */

describe('perf — summaries (Phase 19C)', () => {
  test('percentiles land on real observations, never between them', () => {
    const sorted = [10, 20, 30, 40];
    expect(percentile(sorted, 0.5)).toBe(20);
    expect(percentile(sorted, 0.95)).toBe(40);
    expect(percentile(sorted, 0)).toBe(10);
    expect(percentile([], 0.5)).toBe(0);
  });

  test('summarize computes over the whole sample', () => {
    const summary = summarize('m', [10, 20, 30]);
    expect(summary.count).toBe(3);
    expect(summary.total).toBe(60);
    expect(summary.min).toBe(10);
    expect(summary.max).toBe(30);
    expect(summary.mean).toBe(20);
  });

  test('an empty metric summarises to zeroes, not NaN', () => {
    expect(summarize('m', [])).toEqual({ name: 'm', count: 0, total: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0 });
  });

  test('the registry drops the oldest sample past its cap', () => {
    const registry = new PerfRegistry();
    for (let index = 0; index < MAX_SAMPLES_PER_METRIC + 10; index += 1) registry.record('m', index);
    const summary = registry.summary('m');
    expect(summary.count).toBe(MAX_SAMPLES_PER_METRIC);
    // The first ten samples (0..9) are gone, so the minimum has moved up.
    expect(summary.min).toBe(10);
  });

  test('nonsense durations are ignored', () => {
    const registry = new PerfRegistry();
    registry.record('m', Number.NaN);
    registry.record('m', -5);
    registry.record('m', Infinity);
    expect(registry.summary('m').count).toBe(0);
  });

  test('slowest by total and by p95 answer different questions', () => {
    const chatty = summarize('chatty', Array(100).fill(5));
    const spiky = summarize('spiky', [1, 1, 400]);
    expect(slowestByTotal([chatty, spiky], 1)[0].name).toBe('chatty');
    expect(slowestByP95([chatty, spiky], 1)[0].name).toBe('spiky');
  });
});

describe('perf — startup and budgets', () => {
  test('startup separates failures from timings', () => {
    const report = startupReport([
      { moduleId: 'a', milliseconds: 10 },
      { moduleId: 'b', milliseconds: 50, error: 'boom' },
      { moduleId: 'c', milliseconds: 5 },
    ]);
    expect(report.modules).toBe(3);
    expect(report.failed).toHaveLength(1);
    expect(report.totalMilliseconds).toBe(65);
    expect(report.slowest[0].moduleId).toBe('b');
  });

  test('an UNMEASURED budget is never within budget', () => {
    const verdicts = checkBudgets([], DEFAULT_BUDGETS);
    expect(verdicts[0].measured).toBe(false);
    expect(verdicts[0].withinBudget).toBe(false);
  });

  test('a measured budget passes at the limit and fails past it', () => {
    expect(checkBudgets([summarize('command', [250])])[1].withinBudget).toBe(true);
    expect(checkBudgets([summarize('command', [251])])[1].withinBudget).toBe(false);
  });

  test('formatting', () => {
    expect(formatDuration(0.5)).toBe('500 µs');
    expect(formatDuration(12.34)).toBe('12.3 ms');
    expect(formatDuration(1500)).toBe('1.50 s');
    expect(formatBytesKb(512)).toBe('512 KB');
    expect(formatBytesKb(2048)).toBe('2.0 MB');
    expect(formatUptime(3725)).toBe('1h 2m');
    expect(formatUptime(65)).toBe('1m 5s');
    expect(formatUptime(9)).toBe('9s');
    expect(totalMemoryKb([{ type: 'Browser', pid: 1, privateBytesKb: 100, cpuPercent: 0 }])).toBe(100);
  });
});

/* -------------------------------------------------------------- crash */

describe('crash — serialization (Phase 19B)', () => {
  test('an Error keeps its name, message and a truncated stack', () => {
    const record = serializeError(new RangeError('bad'), 'renderer', 5);
    expect(record.reason).toBe('RangeError');
    expect(record.message).toBe('bad');
    expect(record.origin).toBe('renderer');
    expect(typeof record.stack).toBe('string');
  });

  test('anything else can be thrown, and is handled', () => {
    expect(serializeError('plain string', 'main', 1).message).toBe('plain string');
    expect(serializeError(undefined, 'main', 1).message).toBe('undefined');
    expect(serializeError({ message: 'objecty' }, 'gpu', 1).message).toBe('objecty');
  });

  test('a routine cancellation is not a crash', () => {
    // Monaco rejects pending requests with `Canceled` on every keystroke. The
    // first version of this module wrote three of them to the crash log before
    // anyone touched the keyboard.
    const canceled = new Error('Canceled');
    canceled.name = 'Canceled';
    expect(isRoutineCancellation(canceled)).toBe(true);
    expect(isRoutineCancellation({ name: 'AbortError' })).toBe(true);
    expect(isRoutineCancellation({ message: 'Canceled' })).toBe(true);
    expect(isRoutineCancellation('Canceled')).toBe(true);
  });

  test('a real error is never mistaken for a cancellation', () => {
    expect(isRoutineCancellation(new RangeError('boom'))).toBe(false);
    expect(isRoutineCancellation(new Error('Canceled the deploy'))).toBe(false);
    expect(isRoutineCancellation(null)).toBe(false);
    expect(isRoutineCancellation(undefined)).toBe(false);
  });

  test('an untrusted crash record is validated, and an unknown origin is unknown', () => {
    expect(parseCrashRecord({ time: 1, origin: 'martian', reason: 'x', message: 'y' })?.origin).toBe('unknown');
    expect(parseCrashRecord({ origin: 'main' })).toBeNull();
    expect(parseCrashRecord(null)).toBeNull();
  });
});

describe('crash — snapshots', () => {
  test('only dirty buffers carry text', () => {
    const snapshot = buildSnapshot(
      [
        { path: 'a.zx', text: 'unsaved', line: 0, character: 0 },
        { path: 'b.zx', line: 0, character: 0 },
      ],
      'a.zx',
      100,
    );
    expect(recoverableBuffers(snapshot)).toHaveLength(1);
    expect(snapshot.buffers).toHaveLength(2);
  });

  test('a snapshot round-trips', () => {
    const snapshot = buildSnapshot([{ path: 'a.zx', text: 'x', line: 2, character: 3 }], 'a.zx', 100);
    expect(parseSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  test('an unparseable or wrong-version snapshot yields null, never a throw', () => {
    expect(parseSnapshot('{ not json')).toBeNull();
    expect(parseSnapshot('')).toBeNull();
    expect(parseSnapshot(JSON.stringify({ formatVersion: 99, buffers: [] }))).toBeNull();
  });

  test('a malformed buffer entry is dropped, the rest survive', () => {
    const parsed = parseSnapshot(
      JSON.stringify({ formatVersion: 1, savedAt: 1, activeFile: null, buffers: [{ path: '' }, 7, { path: 'ok.zx' }] }),
    );
    expect(parsed?.buffers).toHaveLength(1);
    expect(parsed?.buffers[0]).toEqual({ path: 'ok.zx', line: 0, character: 0 });
  });

  const crashed: SessionState = { previousExitClean: false, previousCrash: null, logDirectory: '' };
  const clean: SessionState = { previousExitClean: true, previousCrash: null, logDirectory: '' };
  const withWork = buildSnapshot([{ path: 'a.zx', text: 'x', line: 0, character: 0 }], 'a.zx', 1);
  const noWork = buildSnapshot([{ path: 'a.zx', line: 0, character: 0 }], 'a.zx', 1);

  test('a CLEAN exit never offers a restore, even with unsaved work', () => {
    expect(shouldOfferRestore(clean, withWork)).toBe(false);
  });

  test('a crash with unsaved work offers a restore', () => {
    expect(shouldOfferRestore(crashed, withWork)).toBe(true);
  });

  test('a crash with nothing unsaved has nothing to offer', () => {
    expect(shouldOfferRestore(crashed, noWork)).toBe(false);
    expect(shouldOfferRestore(crashed, null)).toBe(false);
  });
});

/* -------------------------------------------------------- diagnostics */

describe('diagnostics — checks (Phase 19A)', () => {
  const checks: HealthCheck[] = [
    { id: 'a', label: 'A', status: 'pass', detail: 'ok' },
    { id: 'b', label: 'B', status: 'unknown', detail: 'not run' },
    { id: 'c', label: 'C', status: 'warn', detail: 'slow' },
    { id: 'd', label: 'D', status: 'fail', detail: 'broken' },
  ];

  test('the worst check sorts first', () => {
    expect(sortChecks(checks).map((check) => check.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  test('a failure dominates the overall status', () => {
    expect(overallStatus(checks)).toBe('fail');
  });

  test('UNKNOWN never upgrades to pass', () => {
    expect(overallStatus([checks[0], checks[1]])).toBe('unknown');
    expect(overallStatus([checks[0]])).toBe('pass');
    expect(overallStatus([])).toBe('unknown');
  });

  test('a warning beats an unknown', () => {
    expect(overallStatus([checks[1], checks[2]])).toBe('warn');
  });

  test('counts and the summary line', () => {
    expect(countByStatus(checks)).toEqual({ pass: 1, warn: 1, fail: 1, unknown: 1 });
    expect(statusLine(checks)).toBe('1 pass · 1 warn · 1 fail · 1 unknown');
  });
});

describe('diagnostics — the report', () => {
  const report: DiagnosticsReport = {
    generatedAt: 1_700_000_000_000,
    environment: {
      znxstudio: '0.1.0',
      electron: '30',
      chrome: '124',
      node: '20',
      platform: 'win32',
      compilerPath: 'C:\\Users\\jane\\zornux.exe',
      compilerVersion: '1.0.0-rc.4',
    },
    startup: { modules: 2, failed: [], totalMilliseconds: 120, slowest: [{ moduleId: 'a', milliseconds: 100 }] },
    checks: [{ id: 'a', label: 'A', status: 'pass', detail: 'fine' }],
    metrics: [summarize('command', [10, 20])],
    process: { uptimeSeconds: 65, metrics: [{ type: 'Browser', pid: 1, privateBytesKb: 2048, cpuPercent: 1.5 }] },
    session: { previousExitClean: false, previousCrash: null, logDirectory: 'C:\\Users\\jane\\logs' },
    crashes: [],
    logTail: ['2026-07-10T00:00:00.000Z [info] [x] token: abcd1234secret'],
  };

  test('the report redacts the home directory everywhere it appears', () => {
    const markdown = renderDiagnosticsReport(report, 'C:\\Users\\jane');
    expect(markdown.includes('C:\\Users\\jane')).toBe(false);
    expect(markdown).toContain('~\\zornux.exe');
  });

  test('the report redacts a secret that reached the log tail', () => {
    const markdown = renderDiagnosticsReport(report, '');
    expect(markdown.includes('abcd1234secret')).toBe(false);
    expect(markdown).toContain(REDACTED);
  });

  test('the report states that telemetry is local', () => {
    expect(renderDiagnosticsReport(report, '')).toContain('never transmitted');
  });

  test('a non-clean previous exit is reported as such', () => {
    expect(renderDiagnosticsReport(report, '')).toContain('NOT clean');
  });

  test('empty sections are omitted rather than left blank', () => {
    const markdown = renderDiagnosticsReport({ ...report, logTail: [] }, '');
    expect(markdown.includes('## Recent log')).toBe(false);
  });
});
