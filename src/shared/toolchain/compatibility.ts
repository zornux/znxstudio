/**
 * Toolchain compatibility (Integration Layer, IL-E). Turns the raw per-protocol
 * verdicts from `checkProtocols` into a single status + a human summary ZnxStudio
 * can show, and declares the compatibility MATRIX (which ZnxStudio supports which
 * Zornux protocol generations) as data.
 *
 * The rule: a same-major protocol is compatible (minors are additive); a
 * different major is a breaking gap. ZnxStudio warns clearly rather than failing
 * unpredictably when a toolchain is unsupported.
 */

import type { ProtocolName, ZornuxInfo } from './contracts';
import { checkProtocols, type ProtocolCompatibility, ZNXSTUDIO_PROTOCOL_SUPPORT } from './negotiation';

export type CompatibilityStatus =
  | 'ok' // every protocol surface is a compatible major/minor
  | 'degraded' // same majors, but the toolchain trails a minor ZnxStudio uses (or a version couldn't be read)
  | 'unsupported' // at least one protocol surface is on a different (breaking) major
  | 'unavailable'; // no toolchain was reached at all

export interface ToolchainCompatibility {
  status: CompatibilityStatus;
  protocols: ProtocolCompatibility[];
  /** Protocol surfaces on a different major — the breaking ones. */
  incompatible: ProtocolName[];
  /** One-line summary suitable for a status item / banner. */
  summary: string;
}

/**
 * Evaluate the negotiated toolchain against what THIS ZnxStudio speaks. Pure and
 * total — every `ZornuxInfo` maps to exactly one status.
 */
export function evaluateToolchain(info: ZornuxInfo): ToolchainCompatibility {
  const protocols = checkProtocols(info, ZNXSTUDIO_PROTOCOL_SUPPORT);
  const incompatible = protocols.filter((p) => p.verdict === 'unsupported').map((p) => p.name);

  if (info.source === 'unavailable') {
    return {
      status: 'unavailable',
      protocols,
      incompatible,
      summary: 'No Zornux toolchain was found — language intelligence runs on the built-in front end only.',
    };
  }

  const which = info.productVersion ? `Zornux ${info.productVersion}` : 'the installed Zornux';

  if (incompatible.length > 0) {
    return {
      status: 'unsupported',
      protocols,
      incompatible,
      summary: `${which} speaks an unsupported ${incompatible.join(', ')} protocol. Update ZnxStudio or pin a compatible Zornux; some features may not work.`,
    };
  }

  if (protocols.some((p) => p.verdict === 'newer' || p.verdict === 'unknown')) {
    return {
      status: 'degraded',
      protocols,
      incompatible,
      summary: `${which} is older than a protocol feature ZnxStudio uses — advanced features may be limited. Consider updating Zornux.`,
    };
  }

  return { status: 'ok', protocols, incompatible, summary: `${which} is fully compatible.` };
}

/** True when the toolchain is usable (features may still be capability-gated). */
export function isUsable(status: CompatibilityStatus): boolean {
  return status === 'ok' || status === 'degraded';
}

/* --------------------------------------------------------------- matrix */

/** One declared row of the tested compatibility matrix (`x` = any minor). */
export interface CompatibilityRow {
  /** The ZnxStudio version this row describes. */
  znxstudio: string;
  cli: string;
  lsp: string;
  dap: string;
  projectManifest: string;
}

/**
 * The compatibility matrix ZnxStudio commits to. Each new protocol MAJOR ZnxStudio
 * adopts adds a row (and a `major` to `ZNXSTUDIO_PROTOCOL_SUPPORT`). Today ZnxStudio
 * speaks generation 1 on every surface.
 */
export const COMPATIBILITY_MATRIX: CompatibilityRow[] = [
  { znxstudio: '0.1', cli: '1.x', lsp: '1.x', dap: '1.x', projectManifest: '1.x' },
];
