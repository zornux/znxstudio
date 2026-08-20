/**
 * The Zornux **integration contract** — the versioned surface ZnxStudio couples to,
 * instead of any particular Zornux release or its internals.
 *
 * The rule (Integration Layer): ZnxStudio talks to Zornux only through versioned
 * external protocols — LSP, DAP, the CLI/JSON envelope, and the project
 * manifest. A new compiler release does not require a new IDE release; ZnxStudio
 * cares whether the *protocol* stays compatible and which *capabilities* are
 * present, not what the product version number is.
 *
 * This module is pure (no Node, no Electron) so both the main-process
 * `ToolchainService` and the renderer can share it.
 */

/** The four protocol surfaces ZnxStudio speaks to a Zornux toolchain over. */
export type ProtocolName = 'cli' | 'lsp' | 'dap' | 'projectManifest';

export const PROTOCOL_NAMES: ProtocolName[] = ['cli', 'lsp', 'dap', 'projectManifest'];

/** Protocol versions a toolchain reports. Strings like `"1.0"` (major.minor[.patch]). */
export interface ZornuxProtocols {
  cli: string;
  lsp: string;
  dap: string;
  projectManifest: string;
}

/**
 * Optional features a toolchain may or may not support. Deliberately an OPEN
 * map: a capability ZnxStudio has never heard of is preserved (as a boolean),
 * never dropped, so a newer Zornux can advertise features to a newer ZnxStudio
 * without a contract change. Unknown keys read as "absent" when gating.
 */
export type ZornuxCapabilities = Record<string, boolean>;

/**
 * The capability keys ZnxStudio knows how to gate on today. The map is open, so
 * this is a convenience for callers — not an exhaustive schema. Kept in sync
 * with `zornux info --json`'s `capabilities` (and the derive-fallback table).
 */
export const CAPABILITY = {
  semanticTokens: 'semanticTokens',
  securityDiagnostics: 'securityDiagnostics',
  advisoryAudit: 'advisoryAudit',
  cpuProfiling: 'cpuProfiling',
  heapSnapshots: 'heapSnapshots',
  allocationTracking: 'allocationTracking',
  allocationStacks: 'allocationStacks',
  profileTimestamps: 'profileTimestamps',
  gcStats: 'gcStats',
  timeline: 'timeline',
  remoteDebug: 'remoteDebug',
  exceptionBreakpoints: 'exceptionBreakpoints',
  docGeneration: 'docGeneration',
  packageManagement: 'packageManagement',
  testing: 'testing',
  database: 'database',
  deployment: 'deployment',
  jsonEnvelope: 'jsonEnvelope',
  formatting: 'formatting',
  disassemble: 'disassemble',
  namedArguments: 'namedArguments',
  postgresProvider: 'postgresProvider',
  regexSupport: 'regexSupport',
  importAliases: 'importAliases',
  queryCapture: 'queryCapture',
  mobileCodegen: 'mobileCodegen',
} as const;

export type CapabilityKey = (typeof CAPABILITY)[keyof typeof CAPABILITY];

/** How a `ZornuxInfo` was obtained. */
export type InfoSource =
  | 'info' // the real `zornux info --json` (authoritative)
  | 'derived' // synthesized from `zornux --version` + the derive table (best-effort)
  | 'unavailable'; // the toolchain could not be reached at all

/** Everything ZnxStudio negotiated about the resolved toolchain. */
export interface ZornuxInfo {
  /** The release, e.g. `"1.0.0-rc.9"`. Null when unknown/unavailable. */
  productVersion: string | null;
  protocols: ZornuxProtocols;
  capabilities: ZornuxCapabilities;
  source: InfoSource;
}

/* ------------------------------------------------------------ versions */

/**
 * A parsed Zornux version. `pre` holds the release-candidate number for a
 * `-rc.N` build, or null for a final release. A release sorts AFTER any of its
 * own release candidates (`1.0.0` > `1.0.0-rc.9`).
 */
export interface ZornuxVersion {
  major: number;
  minor: number;
  patch: number;
  pre: number | null;
}

const VERSION_RE = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?/i;

/** Parse `major.minor.patch[-rc.N]`. Returns null when it is not a version. */
export function parseZornuxVersion(value: string): ZornuxVersion | null {
  const match = VERSION_RE.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] !== undefined ? Number(match[4]) : null,
  };
}

/** Order two versions: negative if a < b, 0 if equal, positive if a > b. */
export function compareZornuxVersion(a: ZornuxVersion, b: ZornuxVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // Same x.y.z: a final release (pre=null) beats any rc; two rcs compare by number.
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return a.pre - b.pre;
}

/** True when `version` is at least `target` (both parsed strings). Unparseable ⇒ false. */
export function versionAtLeast(version: string, target: string): boolean {
  const v = parseZornuxVersion(version);
  const t = parseZornuxVersion(target);
  if (!v || !t) return false;
  return compareZornuxVersion(v, t) >= 0;
}

/* ------------------------------------------------------- protocol compat */

/** A protocol version parsed as major.minor (patch ignored for compatibility). */
export interface ProtocolVersion {
  major: number;
  minor: number;
}

const PROTOCOL_RE = /^\s*(\d+)(?:\.(\d+))?/;

export function parseProtocolVersion(value: string): ProtocolVersion | null {
  const match = PROTOCOL_RE.exec(value);
  if (!match) return null;
  return { major: Number(match[1]), minor: match[2] !== undefined ? Number(match[2]) : 0 };
}

/** The protocol range ZnxStudio supports for one surface. */
export interface ProtocolSupport {
  /** The single major version ZnxStudio speaks. */
  major: number;
  /** The lowest minor ZnxStudio needs (default 0 — any minor of the major). */
  minMinor?: number;
}

export type ProtocolVerdict =
  | 'ok' // same major, high enough minor — fully compatible
  | 'newer' // same major, but the toolchain's minor is below what ZnxStudio needs
  | 'unsupported' // different major — a breaking gap
  | 'unknown'; // the version string could not be parsed

/**
 * Compare a toolchain's reported protocol version against what ZnxStudio supports.
 * Semver rule: same major ⇒ compatible (minors are additive); a different major
 * is a breaking change. A toolchain minor BELOW ZnxStudio's `minMinor` means the
 * toolchain is older than a field ZnxStudio relies on — reported as `newer` (ZnxStudio
 * is newer than the toolchain), so the caller can degrade rather than fail.
 */
export function protocolVerdict(support: ProtocolSupport, remote: string): ProtocolVerdict {
  const parsed = parseProtocolVersion(remote);
  if (!parsed) return 'unknown';
  if (parsed.major !== support.major) return 'unsupported';
  if (parsed.minor < (support.minMinor ?? 0)) return 'newer';
  return 'ok';
}
