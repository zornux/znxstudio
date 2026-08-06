/**
 * Capability & protocol NEGOTIATION (Integration Layer, IL-B).
 *
 * Two ways to learn what a toolchain can do:
 *   1. `zornux info --json` — authoritative. Zornux reports its product version,
 *      protocol versions, and capability flags directly.
 *   2. Derive from `zornux --version` — the fallback for a binary that predates
 *      `info` (every release before this contract shipped). ZnxStudio maps the
 *      product version to the capability set that version is known to support.
 *
 * Feature code NEVER checks the product version (`if version >= "2.4"`). It asks
 * `supports(info, capability)`. A capability present ⇒ enable; absent or unknown
 * ⇒ hide/disable gracefully. That is what lets Zornux evolve without ZnxStudio
 * pinning to a release.
 */

import { envelopeResultObject, parseEnvelope } from '../cli/envelope';
import { asRecord } from '../cli/tolerant';
import {
  CAPABILITY,
  type CapabilityKey,
  type InfoSource,
  type ProtocolName,
  PROTOCOL_NAMES,
  type ProtocolSupport,
  type ProtocolVerdict,
  protocolVerdict,
  type ZornuxCapabilities,
  type ZornuxInfo,
  type ZornuxProtocols,
  versionAtLeast,
} from './contracts';

/** The protocol baseline every field defaults to when a toolchain omits one. */
const BASELINE_PROTOCOL = '1.0';

const DEFAULT_PROTOCOLS: ZornuxProtocols = {
  cli: BASELINE_PROTOCOL,
  lsp: BASELINE_PROTOCOL,
  dap: BASELINE_PROTOCOL,
  projectManifest: BASELINE_PROTOCOL,
};

/**
 * Capabilities present in every 1.0 toolchain ZnxStudio supports. The derive table
 * turns the version-gated ones on for newer builds; `info --json`, when
 * available, overrides all of this with the truth.
 */
const BASE_CAPABILITIES: Record<CapabilityKey, boolean> = {
  semanticTokens: true,
  securityDiagnostics: true,
  cpuProfiling: true,
  heapSnapshots: true,
  allocationTracking: true,
  timeline: true,
  remoteDebug: true,
  exceptionBreakpoints: true,
  docGeneration: true,
  packageManagement: true,
  testing: true,
  database: true,
  deployment: true,
  formatting: true,
  disassemble: true,
  // Version-gated — off in the base, switched on by the derive table below.
  advisoryAudit: false,
  allocationStacks: false,
  profileTimestamps: false,
  gcStats: false,
  jsonEnvelope: false,
};

/**
 * When each version-gated capability first appeared, mirroring the real history
 * (rc.4 opt-in profiling detail + advisory audit; rc.8 the unified envelope).
 * Used ONLY for the derive-fallback; the authoritative source is `info --json`.
 */
const CAPABILITY_SINCE: { key: CapabilityKey; since: string }[] = [
  { key: CAPABILITY.advisoryAudit, since: '1.0.0-rc.4' },
  { key: CAPABILITY.allocationStacks, since: '1.0.0-rc.4' },
  { key: CAPABILITY.profileTimestamps, since: '1.0.0-rc.4' },
  { key: CAPABILITY.gcStats, since: '1.0.0-rc.4' },
  { key: CAPABILITY.jsonEnvelope, since: '1.0.0-rc.8' },
];

/** Read the protocols object tolerantly, defaulting any missing field to baseline. */
function normalizeProtocols(raw: unknown): ZornuxProtocols {
  const record = asRecord(raw);
  const out: ZornuxProtocols = { ...DEFAULT_PROTOCOLS };
  for (const name of PROTOCOL_NAMES) {
    const value = record[name];
    if (typeof value === 'string' && value.trim()) out[name] = value.trim();
  }
  return out;
}

/**
 * Read the capabilities map tolerantly: keep every BOOLEAN entry verbatim
 * (including keys ZnxStudio has never heard of — preserved, not dropped), and
 * ignore any non-boolean value rather than throwing.
 */
function normalizeCapabilities(raw: unknown): ZornuxCapabilities {
  const out: ZornuxCapabilities = {};
  for (const [key, value] of Object.entries(asRecord(raw))) {
    if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/**
 * Parse `zornux info --json`. Returns the authoritative `ZornuxInfo`, or null
 * when the output is not an `ok:true` info envelope (so the caller derives).
 */
export function parseInfoEnvelope(stdout: string): ZornuxInfo | null {
  const envelope = parseEnvelope(stdout);
  if (!envelope || !envelope.ok) return null;
  const result = envelopeResultObject(envelope);
  if (!result) return null;
  const productVersion = typeof result.productVersion === 'string' ? result.productVersion : null;
  return {
    productVersion,
    protocols: normalizeProtocols(result.protocols),
    capabilities: normalizeCapabilities(result.capabilities),
    source: 'info',
  };
}

/**
 * Derive a `ZornuxInfo` from a product version string, for a binary without
 * `info`. Best-effort: an unparseable/absent version yields only the base
 * capabilities (the safe floor), never the version-gated ones.
 */
export function deriveInfo(productVersion: string | null): ZornuxInfo {
  const capabilities: ZornuxCapabilities = { ...BASE_CAPABILITIES };
  if (productVersion) {
    for (const { key, since } of CAPABILITY_SINCE) {
      if (versionAtLeast(productVersion, since)) capabilities[key] = true;
    }
  }
  return {
    productVersion: productVersion ?? null,
    protocols: { ...DEFAULT_PROTOCOLS },
    capabilities,
    source: 'derived',
  };
}

/** The `ZornuxInfo` for a toolchain that could not be reached at all. */
export function unavailableInfo(): ZornuxInfo {
  return { productVersion: null, protocols: { ...DEFAULT_PROTOCOLS }, capabilities: {}, source: 'unavailable' };
}

/**
 * Prefer the authoritative `info --json`; fall back to deriving from the version.
 * `infoStdout` is whatever `zornux info --json` printed (may be an error/empty),
 * `version` is what `zornux --version` reported.
 */
export function resolveInfo(infoStdout: string | null, version: string | null): ZornuxInfo {
  if (infoStdout) {
    const parsed = parseInfoEnvelope(infoStdout);
    if (parsed) return parsed;
  }
  if (version === null && !infoStdout) return unavailableInfo();
  return deriveInfo(version);
}

/* --------------------------------------------------------------- gating */

/**
 * The single question feature code asks. Present-and-true ⇒ enabled; absent or
 * explicitly false ⇒ off. Unknown capability keys are simply not present, so
 * they read as off — safe by construction.
 */
export function supports(info: ZornuxInfo, capability: string): boolean {
  return info.capabilities[capability] === true;
}

/** Capability keys that ARE present and true, sorted — for display/debugging. */
export function enabledCapabilities(info: ZornuxInfo): string[] {
  return Object.keys(info.capabilities)
    .filter((key) => info.capabilities[key] === true)
    .sort();
}

/* --------------------------------------------------- protocol compat */

export interface ProtocolCompatibility {
  name: ProtocolName;
  remote: string;
  verdict: ProtocolVerdict;
}

/**
 * Check every protocol the toolchain reports against what ZnxStudio supports.
 * `support` maps each protocol to ZnxStudio's supported major (+ optional minMinor).
 */
export function checkProtocols(
  info: ZornuxInfo,
  support: Record<ProtocolName, ProtocolSupport>,
): ProtocolCompatibility[] {
  return PROTOCOL_NAMES.map((name) => ({
    name,
    remote: info.protocols[name],
    verdict: protocolVerdict(support[name], info.protocols[name]),
  }));
}

/** True when no protocol is on a different major — the toolchain is usable. */
export function toolchainCompatible(compatibilities: ProtocolCompatibility[]): boolean {
  return compatibilities.every((entry) => entry.verdict === 'ok' || entry.verdict === 'newer');
}

/**
 * The protocol majors THIS ZnxStudio speaks, per surface. Bump a major here only
 * when ZnxStudio adopts a breaking protocol change; a toolchain on a different
 * major for any surface is flagged unsupported. Currently all surfaces are 1.x.
 */
export const ZNXSTUDIO_PROTOCOL_SUPPORT: Record<ProtocolName, ProtocolSupport> = {
  cli: { major: 1 },
  lsp: { major: 1 },
  dap: { major: 1 },
  projectManifest: { major: 1 },
};
