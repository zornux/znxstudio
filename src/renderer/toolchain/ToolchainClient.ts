import type { ToolchainService } from '../core/Contracts';
import type { ZornuxInfo } from '../../shared/toolchain/contracts';
import {
  checkProtocols,
  type ProtocolCompatibility,
  supports,
  toolchainCompatible,
  unavailableInfo,
  ZNXSTUDIO_PROTOCOL_SUPPORT,
} from '../../shared/toolchain/negotiation';

/**
 * Renderer-side handle to the negotiated toolchain, reached through the typed
 * `window.znxstudio.toolchain` bridge. It caches the (subprocess-backed) probe and
 * never throws — a missing bridge or failed IPC yields an `unavailable` info, so
 * feature gating degrades to "capability absent" instead of crashing.
 *
 * Registered under `ServiceKeys.Toolchain`; the single seam feature modules use
 * to ask "can the installed Zornux do X?" — by capability, never by version.
 *
 * The `fetch` seam is injectable so the negotiation can be unit-tested without
 * Electron; in the app it defaults to the real bridge.
 */
export class ToolchainClient implements ToolchainService {
  private cached: ZornuxInfo | null = null;

  constructor(private readonly fetch: (override?: string | null) => Promise<ZornuxInfo> = defaultFetch) {}

  async info(refresh = false): Promise<ZornuxInfo> {
    if (!refresh && this.cached) return this.cached;
    try {
      this.cached = await this.fetch();
    } catch {
      this.cached = unavailableInfo();
    }
    return this.cached;
  }

  async supports(capability: string): Promise<boolean> {
    return supports(await this.info(), capability);
  }

  async protocolCompatibility(): Promise<ProtocolCompatibility[]> {
    return checkProtocols(await this.info(), ZNXSTUDIO_PROTOCOL_SUPPORT);
  }

  async compatible(): Promise<boolean> {
    return toolchainCompatible(await this.protocolCompatibility());
  }
}

function defaultFetch(override?: string | null): Promise<ZornuxInfo> {
  return window.znxstudio.toolchain.info(override);
}
