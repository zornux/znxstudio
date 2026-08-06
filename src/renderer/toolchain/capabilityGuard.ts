/**
 * Capability gating (Integration Layer, IL-C). Feature code asks the negotiated
 * toolchain whether a capability is present and, when it is not, gets a clear,
 * actionable reason to show the user instead of firing a CLI flag the installed
 * Zornux does not understand.
 *
 * The rule: gate on the capability, never on a version number. A present
 * capability enables the feature; an absent one disables it gracefully with an
 * explanation that names the toolchain.
 */

import type { ZornuxInfo } from '../../shared/toolchain/contracts';
import { supports } from '../../shared/toolchain/negotiation';

export interface CapabilityStatus {
  enabled: boolean;
  /** A user-facing explanation when disabled; null when enabled. */
  reason: string | null;
}

/**
 * Whether `capability` is usable on this toolchain, with a message to show when
 * it is not. `label` is the human name of the feature (e.g. "Heap snapshots").
 */
export function capabilityStatus(info: ZornuxInfo, capability: string, label: string): CapabilityStatus {
  if (supports(info, capability)) return { enabled: true, reason: null };
  if (info.source === 'unavailable') {
    return { enabled: false, reason: `${label} is unavailable — no Zornux toolchain was found.` };
  }
  const which = info.productVersion ? `Zornux ${info.productVersion}` : 'the installed Zornux';
  return {
    enabled: false,
    reason: `${label} is unavailable — ${which} does not support it (capability “${capability}”).`,
  };
}

/**
 * Bare gate for optional flags/sub-features where no message is needed — e.g.
 * whether to pass `--allocation-stacks`. A null/absent info reads as "supported"
 * so a context without the toolchain service behaves as it did before gating.
 */
export function capabilityEnabled(info: ZornuxInfo | null | undefined, capability: string): boolean {
  return info ? supports(info, capability) : true;
}
