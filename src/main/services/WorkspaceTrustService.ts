import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFile } from '../util/atomicWrite';
import { isSelfTest } from '../util/selftest';
import {
  addTrustedFolder,
  isWorkspaceTrusted,
  parentFolder,
  parseTrustStore,
  removeTrustCovering,
  type TrustState,
  type TrustStore,
} from '../../shared/workspaceTrust';

const TRUST_FILE = join(homedir(), '.znxstudio', 'trust.json');

/**
 * The authoritative Workspace Trust state (Phase 20J WI1). It lives in the MAIN
 * process so every execution path — task runner, terminal, debugger, package
 * runners, allowlisted tools — can be gated at the trust boundary with no
 * renderer bypass. Trusted folders persist to ~/.znxstudio/trust.json; the current
 * workspace roots and the session "restricted" acknowledgement are in-memory.
 *
 * Under ZNXSTUDIO_SELFTEST in an UNPACKAGED (dev/CI) build the gate is open, so the
 * headless self-test harness (which spawns real subprocesses) is never blocked; a
 * shipped, packaged binary ignores the flag (see isSelfTest) so it can never disable trust.
 */
export class WorkspaceTrustService {
  private store: TrustStore = { trustedFolders: [] };
  private roots: string[] = [];
  private restrictedAck = false;
  private loaded = false;
  private readonly caseInsensitive = process.platform !== 'linux';

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(TRUST_FILE, 'utf8');
      this.store = parseTrustStore(JSON.parse(raw), this.caseInsensitive);
    } catch {
      this.store = { trustedFolders: [] };
    }
    this.loaded = true;
  }

  /** The renderer reports the open workspace roots; a new set clears the session ack. */
  setWorkspace(roots: string[]): TrustState {
    const next = roots.filter((r) => typeof r === 'string' && r.length > 0);
    const changed = next.length !== this.roots.length || next.some((r, i) => r !== this.roots[i]);
    if (changed) this.restrictedAck = false;
    this.roots = next;
    return this.state();
  }

  /** Execution is allowed only when the workspace is trusted (or under self-test). */
  isTrusted(): boolean {
    if (isSelfTest()) return true;
    return isWorkspaceTrusted(this.roots, this.store.trustedFolders, this.caseInsensitive);
  }

  /** The current open workspace roots — used to confine the fs IPC surface. */
  getRoots(): readonly string[] {
    return this.roots;
  }

  state(): TrustState {
    const trusted = this.isTrusted();
    return {
      trusted,
      decided: trusted || this.restrictedAck,
      roots: [...this.roots],
      trustedFolders: [...this.store.trustedFolders],
    };
  }

  async trustWorkspace(): Promise<TrustState> {
    for (const root of this.roots) this.store = addTrustedFolder(this.store, root, this.caseInsensitive);
    await this.persist();
    return this.state();
  }

  async trustParent(): Promise<TrustState> {
    for (const root of this.roots) {
      this.store = addTrustedFolder(this.store, parentFolder(root, this.caseInsensitive), this.caseInsensitive);
    }
    await this.persist();
    return this.state();
  }

  /** Remove trust so the current workspace becomes restricted again. */
  async revoke(): Promise<TrustState> {
    for (const root of this.roots) this.store = removeTrustCovering(this.store, root, this.caseInsensitive);
    this.restrictedAck = false;
    await this.persist();
    return this.state();
  }

  /** The user chose "Continue in Restricted Mode" — stop prompting this session. */
  acknowledgeRestricted(): TrustState {
    this.restrictedAck = true;
    return this.state();
  }

  /**
   * Throw when execution is not permitted. Every trust-requiring IPC handler
   * calls this first, so a restricted workspace cannot run code by any path.
   */
  assertTrusted(action: string): void {
    if (this.isTrusted()) return;
    throw new Error(
      `Workspace is not trusted — ${action} is disabled in Restricted Mode. Trust this workspace to enable it.`,
    );
  }

  private async persist(): Promise<void> {
    await fs.mkdir(join(homedir(), '.znxstudio'), { recursive: true });
    await atomicWriteFile(TRUST_FILE, `${JSON.stringify(this.store, null, 2)}\n`);
  }
}

let shared: WorkspaceTrustService | null = null;

/** The one process-wide trust service, shared by the trust IPC and every execution IPC. */
export function sharedWorkspaceTrust(): WorkspaceTrustService {
  if (!shared) shared = new WorkspaceTrustService();
  return shared;
}
