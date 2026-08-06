/**
 * IDE self-diagnostics (Phase 19A).
 *
 * The report a user pastes into a bug tracker. Two properties matter more than
 * completeness:
 *
 *  1. **It is redacted.** The home directory becomes `~` and secrets are removed
 *     (see `logging.ts`). A report is a document the user hands to a stranger.
 *  2. **It distinguishes "unknown" from "fine".** A check ZnxStudio could not run —
 *     no compiler, no workspace open — is reported as UNKNOWN, never as a pass.
 *     A green dashboard that is green because nothing was checked is worse than
 *     no dashboard.
 */

import { redact } from './logging';
import { formatBytesKb, formatDuration, formatUptime, type MetricSummary, type ProcessSnapshot, type StartupReport } from './perf';
import type { CrashRecord, SessionState } from './crash';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  /** What was observed. Shown verbatim. */
  detail: string;
  /** What to do about it, when there is something to do. */
  remedy?: string;
}

export interface EnvironmentInfo {
  znxstudio: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  compilerPath: string | null;
  compilerVersion: string | null;
}

export interface DiagnosticsReport {
  /** Milliseconds since the epoch. Injected. */
  generatedAt: number;
  environment: EnvironmentInfo;
  startup: StartupReport;
  checks: HealthCheck[];
  metrics: MetricSummary[];
  process: ProcessSnapshot | null;
  session: SessionState | null;
  crashes: CrashRecord[];
  /** The last few log lines, already redacted. */
  logTail: string[];
}

/* ----------------------------------------------------------------- checks */

const ORDER: Record<CheckStatus, number> = { fail: 0, warn: 1, unknown: 2, pass: 3 };

/** Worst first: a report is read from the top. */
export function sortChecks(checks: HealthCheck[]): HealthCheck[] {
  return [...checks].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.label.localeCompare(b.label));
}

/**
 * The overall verdict. `unknown` never upgrades to `pass`: if any check could
 * not run, the honest summary is that the IDE's health is partly unknown.
 */
export function overallStatus(checks: HealthCheck[]): CheckStatus {
  if (!checks.length) return 'unknown';
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  if (checks.some((check) => check.status === 'unknown')) return 'unknown';
  return 'pass';
}

export function countByStatus(checks: HealthCheck[]): Record<CheckStatus, number> {
  const counts: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, unknown: 0 };
  for (const check of checks) counts[check.status] += 1;
  return counts;
}

export const STATUS_ICONS: Record<CheckStatus, string> = { pass: '✓', warn: '!', fail: '✗', unknown: '?' };

export function statusLine(checks: HealthCheck[]): string {
  const counts = countByStatus(checks);
  return `${counts.pass} pass · ${counts.warn} warn · ${counts.fail} fail · ${counts.unknown} unknown`;
}

/* ------------------------------------------------------- report rendering */

function section(title: string, lines: string[]): string[] {
  return lines.length ? [`## ${title}`, '', ...lines, ''] : [];
}

/**
 * Render the report as Markdown. `homeDir` is applied one final time across the
 * whole document: individual fields (a compiler path, a log line) are redacted
 * where they are produced, but a report assembled from many sources should not
 * depend on every one of them having remembered.
 */
export function renderDiagnosticsReport(report: DiagnosticsReport, homeDir = ''): string {
  const environment = report.environment;
  const lines: string[] = [
    '# ZnxStudio diagnostics',
    '',
    `Generated ${new Date(report.generatedAt).toISOString()}.`,
    '',
    'Performance data in this report is collected locally and never transmitted.',
    '',
    ...section('Environment', [
      `- ZnxStudio ${environment.znxstudio} · Electron ${environment.electron} · Chrome ${environment.chrome} · Node ${environment.node}`,
      `- Platform ${environment.platform}`,
      `- Zornux compiler: ${environment.compilerVersion ?? 'not found'}${environment.compilerPath ? ` (${environment.compilerPath})` : ''}`,
    ]),
    ...section(
      'Checks',
      sortChecks(report.checks).map(
        (check) =>
          `- ${STATUS_ICONS[check.status]} **${check.label}** — ${check.detail}${check.remedy ? ` _${check.remedy}_` : ''}`,
      ),
    ),
    ...section('Startup', [
      `- ${report.startup.modules} modules in ${formatDuration(report.startup.totalMilliseconds)}`,
      ...(report.startup.failed.length
        ? report.startup.failed.map((entry) => `- FAILED ${entry.moduleId}: ${entry.error}`)
        : ['- No module failed to activate.']),
      ...report.startup.slowest.map((entry) => `- ${entry.moduleId}: ${formatDuration(entry.milliseconds)}`),
    ]),
    ...section(
      'Metrics',
      report.metrics.map(
        (metric) =>
          `- ${metric.name}: n=${metric.count} p50=${formatDuration(metric.p50)} p95=${formatDuration(metric.p95)} max=${formatDuration(metric.max)}`,
      ),
    ),
    ...section(
      'Processes',
      report.process
        ? [
            `- Uptime ${formatUptime(report.process.uptimeSeconds)}`,
            ...report.process.metrics.map(
              (metric) => `- ${metric.type} (pid ${metric.pid}): ${formatBytesKb(metric.privateBytesKb)}, ${metric.cpuPercent.toFixed(1)}% CPU`,
            ),
          ]
        : ['- Process metrics unavailable.'],
    ),
    ...section(
      'Session',
      report.session
        ? [
            `- Previous exit was ${report.session.previousExitClean ? 'clean' : 'NOT clean'}.`,
            ...(report.crashes.length
              ? report.crashes.map((crash) => `- ${crash.origin}: ${crash.reason}: ${crash.message}`)
              : ['- No crash recorded.']),
          ]
        : ['- Session state unavailable.'],
    ),
    ...section('Recent log', report.logTail.length ? ['```', ...report.logTail, '```'] : []),
  ];

  return redact(lines.join('\n'), homeDir);
}

/** A single-line verdict for the status bar. */
export function healthSummary(report: DiagnosticsReport): string {
  const status = overallStatus(report.checks);
  return `${STATUS_ICONS[status]} ${statusLine(report.checks)}`;
}
