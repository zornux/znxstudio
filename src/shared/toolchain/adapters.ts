/**
 * Protocol adapters (Integration Layer, IL-E). A compatibility adapter exists
 * per protocol GENERATION (CLI protocol major). It is the one place that knows a
 * generation's wire specifics, so the rest of ZnxStudio talks to a single internal
 * interface and a new generation slots in HERE — never into feature code.
 *
 * Today only generation 1 exists, so `ProtocolV1Adapter` is the identity for the
 * current behavior. When the CLI protocol majors, add a `ProtocolV2Adapter` to
 * `PROTOCOL_ADAPTERS`; `selectAdapter` then routes an older/newer toolchain to
 * the right translation, and an unknown major resolves to `null` (which the
 * compatibility layer reports as unsupported).
 */

import { parseProtocolVersion, type ZornuxInfo } from './contracts';

export interface ProtocolAdapter {
  readonly id: string;
  /** The CLI protocol MAJOR this adapter speaks. */
  readonly cliMajor: number;
  readonly label: string;
}

/** Generation 1 — the current wire contract (rc.8 `--json` envelope, etc.). */
export const ProtocolV1Adapter: ProtocolAdapter = {
  id: 'zornux-cli-v1',
  cliMajor: 1,
  label: 'Zornux CLI protocol 1.x',
};

/** Every adapter ZnxStudio ships, by CLI protocol major. Register a V2 here when it lands. */
export const PROTOCOL_ADAPTERS: readonly ProtocolAdapter[] = [ProtocolV1Adapter];

/**
 * The adapter for the toolchain's CLI protocol major, or `null` when no shipped
 * adapter speaks it (an unparseable version, or a major ZnxStudio doesn't know).
 */
export function selectAdapter(info: ZornuxInfo): ProtocolAdapter | null {
  const parsed = parseProtocolVersion(info.protocols.cli);
  if (!parsed) return null;
  return PROTOCOL_ADAPTERS.find((adapter) => adapter.cliMajor === parsed.major) ?? null;
}
