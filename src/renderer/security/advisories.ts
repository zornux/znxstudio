/**
 * Dependency audit (Phase 15C), REBUILT on Zornux 1.0.0-rc.4.
 *
 * History, because it explains the shape of this file. Through rc.3 the compiler
 * declared a vulnerable-dependency rule (ZX3709) but never ran it: it needed an
 * `IDependencyAdvisorySource` and only `EmptyAdvisorySource` shipped. So ZnxStudio
 * implemented the matching itself — read `zornux.project` + `zornux.lock`, match
 * against a feed, synthesise the findings. That worked at the developer's desk
 * and did nothing for CI, where `zornux check --security` still exited 0.
 *
 * rc.4 closed it: `zornux check <file> --security --advisories <feed.json>`
 * loads a feed from disk, matches it against the resolved lockfile, and emits
 * real ZX3709 findings. **ZnxStudio no longer matches versions.** Doing it in two
 * places would guarantee the IDE and the build eventually disagree, and the
 * compiler is the one that decides whether a build fails.
 *
 * What remains here is what the IDE genuinely owns:
 *   • reading the feed, so the panel can say what is in it;
 *   • listing the project's declared and resolved dependencies, for display;
 *   • parsing the notes the CLI writes to STDERR about what it could not audit.
 *
 * The feed schema is the COMPILER's (`FileDependencyAdvisorySource.AdvisoryJson`),
 * not one ZnxStudio invented: `{"advisories": [{package, affected, severity, id,
 * summary, url, fixed}]}`, property names matched case-insensitively.
 */

import type { SecurityFinding } from './findings';

/** The rule id the compiler emits for a vulnerable dependency. */
export const VULNERABLE_DEPENDENCY_RULE = 'ZX3709';

/** The advisory feed ZnxStudio looks for in the workspace root. */
export const ADVISORY_FEED_FILE = 'zornux.advisories.json';

export interface PackageVersion {
  major: number;
  minor: number;
  patch: number;
}

/** One package resolved by the project, as `zornux.lock` records it. */
export interface LockEntry {
  name: string;
  version: string;
  source: string;
  hash: string;
}

/** A dependency as `zornux.project` declares it, with the line it is written on. */
export interface DeclaredDependency {
  name: string;
  constraint: string;
  registry?: string;
  /** 1-based line in `zornux.project`. */
  line: number;
}

/** A dependency joined to the version the lockfile pinned, for display. */
export interface ResolvedDependency {
  name: string;
  constraint: string;
  /** The exact version the lockfile pinned, or null when the project is not restored. */
  version: string | null;
  line: number;
}

/** One advisory, exactly as the compiler's feed reader models it. */
export interface Advisory {
  package: string;
  affected: string;
  severity: string;
  id: string;
  summary: string;
  url: string;
  fixed: string | null;
}

/* ------------------------------------------------------------- versions */

/** Strict `major.minor.patch`, as `SemanticVersion.cs` requires. */
export function parseVersion(text: string): PackageVersion | null {
  const parts = text.trim().split('.');
  if (parts.length !== 3) return null;
  const numbers = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  return { major: numbers[0], minor: numbers[1], patch: numbers[2] };
}

export function formatVersion(version: PackageVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/* ------------------------------------------------------------- lockfile */

/**
 * Parse `zornux.lock`, mirroring `PackageLockFile.Parse`: `package <name>`
 * blocks of `key = value` lines, `#` comments ignored.
 */
export function parseLockFile(text: string): LockEntry[] {
  const entries: LockEntry[] = [];
  let name: string | null = null;
  let version = '0.0.0';
  let source = 'local';
  let hash = '';

  const flush = (): void => {
    if (name && parseVersion(version)) entries.push({ name, version, source, hash });
    name = null;
    version = '0.0.0';
    source = 'local';
    hash = '';
  };

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('package ')) {
      flush();
      name = line.slice('package '.length).trim();
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === 'version') version = value;
    else if (key === 'source') source = value;
    else if (key === 'hash') hash = value;
  }
  flush();
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The dependency lines of `zornux.project`, keeping the line number so the panel
 * can reveal the declaration. Mirrors `PackageManifest`'s
 * `dependency <Name> = <constraint> [from <Registry>]`.
 */
export function parseDeclaredDependencies(projectText: string): DeclaredDependency[] {
  const dependencies: DeclaredDependency[] = [];
  const lines = projectText.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('dependency ') || line.startsWith('#')) continue;
    const rest = line.slice('dependency '.length);
    const eq = rest.indexOf('=');
    if (eq <= 0) continue;
    const name = rest.slice(0, eq).trim();
    let value = rest.slice(eq + 1).trim();
    let registry: string | undefined;
    const from = / from (\S+)$/.exec(value);
    if (from) {
      registry = from[1];
      value = value.slice(0, from.index).trim();
    }
    if (name && value) dependencies.push({ name, constraint: value, registry, line: i + 1 });
  }
  return dependencies;
}

/**
 * Join declared dependencies to the versions the lockfile pinned. Display only:
 * the compiler audits the LOCKFILE, which also covers transitive packages a
 * manifest never names.
 */
export function resolveDependencies(declared: DeclaredDependency[], lock: LockEntry[]): ResolvedDependency[] {
  const locked = new Map(lock.map((entry) => [entry.name.toLowerCase(), entry.version]));
  return declared.map((dependency) => ({
    name: dependency.name,
    constraint: dependency.constraint,
    version: locked.get(dependency.name.toLowerCase()) ?? null,
    line: dependency.line,
  }));
}

/* -------------------------------------------------------------- the feed */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Case-insensitive property read, because `System.Text.Json` matches that way. */
function field(record: Record<string, unknown>, name: string): string | null {
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === name && typeof value === 'string') return value;
  }
  return null;
}

/**
 * Read an advisory feed in the COMPILER's schema, for display only. An entry
 * missing a package or an affected range is dropped here exactly as the compiler
 * drops it — but note that the compiler REPORTS such entries on stderr, and this
 * function is not what decides whether a dependency is vulnerable.
 */
export function parseAdvisoryFeed(text: string): Advisory[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const list = asRecord(raw).advisories;
  if (!Array.isArray(list)) return [];

  const advisories: Advisory[] = [];
  for (const entry of list) {
    const a = asRecord(entry);
    const packageName = field(a, 'package');
    const affected = field(a, 'affected');
    if (!packageName || !affected) continue;
    const id = field(a, 'id') ?? '(no id)';
    advisories.push({
      package: packageName,
      affected,
      severity: field(a, 'severity') ?? 'error',
      id,
      summary: field(a, 'summary') ?? '',
      url: field(a, 'url') ?? `https://zornux.dev/security/advisories#${id}`,
      fixed: field(a, 'fixed'),
    });
  }
  return advisories;
}

/** A feed skeleton, so a workspace without one can be given a starting point. */
export function renderAdvisoryFeed(advisories: Advisory[]): string {
  return `${JSON.stringify(
    {
      advisories: advisories.map((a) => ({
        package: a.package,
        affected: a.affected,
        severity: a.severity,
        id: a.id,
        summary: a.summary,
        url: a.url,
        ...(a.fixed ? { fixed: a.fixed } : {}),
      })),
    },
    null,
    2,
  )}\n`;
}

/* -------------------------------------------------------- the CLI's notes */

/**
 * What the audit could NOT do. The CLI writes these to stderr, deliberately —
 * "tools parse stdout for the finding shape, and a note is not a finding". They
 * matter enormously: an unaudited package is not a safe one, and ZnxStudio must say
 * so rather than render a reassuring empty list.
 */
export interface AuditNotes {
  /** Declared dependencies with no `zornux.lock` entry — version unknown, not audited. */
  unaudited: string[];
  /** Advisories the compiler could not use, and why. */
  problems: string[];
}

const UNAUDITED = /^note: '([^']+)' has no 'zornux\.lock' entry/;

export function parseAuditNotes(output: string): AuditNotes {
  const notes: AuditNotes = { unaudited: [], problems: [] };
  for (const raw of output.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    const unaudited = UNAUDITED.exec(line);
    if (unaudited) {
      notes.unaudited.push(unaudited[1]);
      continue;
    }
    if (line.startsWith('warning: advisory ')) notes.problems.push(line.slice('warning: '.length));
  }
  return notes;
}

/* ------------------------------------------------------ the real findings */

/** The ZX3709 findings the compiler reported. ZnxStudio reads them; it never derives them. */
export function dependencyFindings(findings: SecurityFinding[]): SecurityFinding[] {
  return findings.filter((finding) => finding.code === VULNERABLE_DEPENDENCY_RULE);
}

/**
 * The `zornux add` command that resolves a finding, or null when the advisory
 * names no fixed version. Read out of the compiler's own suggested fix rather
 * than reconstructed, so the two can never disagree.
 */
export function upgradeCommandFor(finding: SecurityFinding): string | null {
  const match = /Upgrade '([^']+)' to (\d+\.\d+\.\d+)/.exec(finding.suggestedFix);
  return match ? `zornux add ${match[1]}@${match[2]}` : null;
}

export interface AuditSummary {
  dependencies: number;
  /** Declared dependencies the lockfile does not resolve — unaudited, not clean. */
  unaudited: number;
  /** Distinct packages with at least one advisory against them. */
  vulnerable: number;
  /** Findings that make `zornux check --security` exit non-zero. */
  blocking: number;
  fixable: number;
}

export function auditSummary(dependencies: ResolvedDependency[], findings: SecurityFinding[], notes: AuditNotes): AuditSummary {
  const vulnerabilities = dependencyFindings(findings);
  return {
    dependencies: dependencies.length,
    unaudited: notes.unaudited.length,
    vulnerable: new Set(vulnerabilities.map((f) => packageOf(f)?.toLowerCase() ?? f.message)).size,
    blocking: vulnerabilities.filter((f) => f.severity === 'Error' || f.severity === 'Critical').length,
    fixable: vulnerabilities.filter((f) => upgradeCommandFor(f) !== null).length,
  };
}

/** The package a ZX3709 finding is about, taken from the message the compiler wrote. */
export function packageOf(finding: SecurityFinding): string | null {
  return /^'([^']+)'/.exec(finding.message)?.[1] ?? null;
}
