import {
  ServiceKeys,
  type CompilerService,
  type SettingsService,
  type StatusService,
  type ToolchainService,
  type WorkspaceService,
} from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { evaluateToolchain, type ToolchainCompatibility } from '../../shared/toolchain/compatibility';
import { describePin, resolveToolchainPath, type ToolchainResolution } from '../../shared/toolchain/resolution';
import { editorMode, offlineExplanation, type EditorMode } from '../../shared/toolchain/offline';
import { parseZornuxManifest } from '../solution/zornuxManifest';

const COMPAT_ITEM = 'toolchain.compat';
const PIN_ITEM = 'toolchain.pin';

/**
 * Surfaces toolchain compatibility + resolution (Integration Layer, IL-E/IL-F).
 * At startup it:
 *   • evaluates the negotiated toolchain against what ZnxStudio speaks and warns
 *     (status bar + one-time toast) when it is unsupported/degraded;
 *   • resolves which toolchain path is in effect (workspace → system → bundled);
 *   • checks the project's pinned Zornux version against the resolved toolchain
 *     and warns on a mismatch — ZnxStudio NEVER switches the toolchain silently.
 * A fully compatible, matching toolchain shows nothing.
 */
export class ToolchainStatusModule implements IModule {
  readonly id = 'znxstudio.toolchain.status';
  readonly displayName = 'Toolchain Compatibility';

  private context!: ModuleContext;
  private last: ToolchainCompatibility | null = null;
  private resolution: ToolchainResolution | null = null;
  private pinNote: string | null = null;
  private mode: EditorMode = 'full';
  private offlineNote: string | null = null;

  activate(context: ModuleContext): void {
    this.context = context;
    context.commands.register(CommandIds.ToolchainStatus, () => this.showDetails(), 'Toolchain: Show Compatibility');
    void this.evaluate();
  }

  private async evaluate(): Promise<void> {
    const toolchain = this.context.services.tryGet<ToolchainService>(ServiceKeys.Toolchain);
    if (!toolchain) return;
    const info = await toolchain.info();
    const compat = evaluateToolchain(info);
    this.last = compat;

    // Offline / incompatible mode (IL-G): a missing or protocol-incompatible
    // toolchain drops to built-in editing only, with a clear explanation.
    this.mode = editorMode(compat.status);
    this.offlineNote = offlineExplanation(compat.status, info.productVersion);

    const status = this.context.services.tryGet<StatusService>(ServiceKeys.Status);

    // 1. Protocol compatibility. In basic mode prefer the offline explanation
    // (it names the reason AND reassures that basic editing stays available).
    if (compat.status === 'ok') {
      status?.removeItem(COMPAT_ITEM);
    } else {
      const message = this.offlineNote ?? compat.summary;
      const icon = compat.status === 'unsupported' ? '⛔' : '⚠';
      status?.setItem(COMPAT_ITEM, {
        text: `${icon} Zornux`,
        tooltip: message,
        command: CommandIds.ToolchainStatus,
        side: 'right',
        priority: 40,
      });
      if (compat.status === 'unsupported') this.context.layout.showToast(message, 'error');
    }

    // 2. Multi-toolchain resolution + project pin (IL-F).
    await this.resolveAndCheckPin(info.productVersion, status);
  }

  /** Resolve the effective toolchain path and check the project's version pin. */
  private async resolveAndCheckPin(resolvedVersion: string | null, status: StatusService | undefined): Promise<void> {
    const settings = this.context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const workspacePath = String(settings?.get('zornux.compiler.path', '') ?? '');
    const systemPath = compiler ? (await compiler.info()).path : null;
    this.resolution = resolveToolchainPath({ workspace: workspacePath, system: systemPath, bundled: null });

    const pin = await this.readProjectPin();
    this.pinNote = describePin(pin, resolvedVersion);
    if (!this.pinNote) {
      status?.removeItem(PIN_ITEM);
      return;
    }
    status?.setItem(PIN_ITEM, {
      text: '⚠ Zornux pin',
      tooltip: this.pinNote,
      command: CommandIds.ToolchainStatus,
      side: 'right',
      priority: 41,
    });
    this.context.layout.showToast(this.pinNote, 'error');
  }

  /** The `toolchain` pin from the workspace's `zornux.project`, or null. Never throws. */
  private async readProjectPin(): Promise<string | null> {
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    const root = workspace?.currentWorkspace()?.root;
    if (!root) return null;
    try {
      const manifestPath = `${root.replace(/[\\/]+$/, '')}/zornux.project`;
      const text = await window.znxstudio.fs.readFile(manifestPath);
      return parseZornuxManifest(text).toolchain;
    } catch {
      return null; // no manifest / unreadable — no pin.
    }
  }

  private showDetails(): void {
    const compat = this.last;
    if (!compat) {
      this.context.layout.showToast('Toolchain compatibility has not been evaluated yet.', 'info');
      return;
    }
    const perProtocol = compat.protocols.map((p) => `${p.name} ${p.remote} (${p.verdict})`).join(' · ');
    const source = this.resolution ? `source: ${this.resolution.source}` : '';
    const parts = [compat.summary, perProtocol, source, this.pinNote ?? ''].filter(Boolean);
    const level = compat.status === 'unsupported' || this.pinNote ? 'error' : 'info';
    this.context.layout.showToast(parts.join('  —  '), level);
  }

  /** The last evaluation (for the self-test / other consumers). */
  compatibility(): ToolchainCompatibility | null {
    return this.last;
  }

  /** The resolved toolchain path + candidates (for the self-test / a picker). */
  resolutionInfo(): ToolchainResolution | null {
    return this.resolution;
  }

  /** The current editing mode ('full' or 'basic') — for the self-test / consumers. */
  editorMode(): EditorMode {
    return this.mode;
  }
}
