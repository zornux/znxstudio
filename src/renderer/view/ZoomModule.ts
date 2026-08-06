import { ServiceKeys, type SettingsService } from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { clampZoomLevel, zoomFactorForLevel, zoomPercentLabel } from '../../shared/zoom';

/**
 * UI zoom (Phase 20J WI4 accessibility — resize-text / WCAG 1.4.4). Zoom In/Out/
 * Reset scale the entire workbench (chrome + editor) via the webContents zoom
 * factor, persisted as `workbench.zoomLevel` and restored on startup. Bound to
 * the platform-standard Mod +/-/0.
 */
export class ZoomModule implements IModule {
  readonly id = 'znxstudio.zoom';
  readonly displayName = 'UI Zoom';

  private context!: ModuleContext;
  private settings: SettingsService | undefined;
  private level = 0;

  activate(context: ModuleContext): void {
    this.context = context;
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    this.level = clampZoomLevel(Number(this.settings?.get('workbench.zoomLevel', 0) ?? 0));

    context.commands.register(CommandIds.ZoomIn, () => this.setLevel(this.level + 1), 'View: Zoom In');
    context.commands.register(CommandIds.ZoomOut, () => this.setLevel(this.level - 1), 'View: Zoom Out');
    context.commands.register(CommandIds.ZoomReset, () => this.setLevel(0), 'View: Reset Zoom');

    // Apply the persisted zoom on boot (no toast).
    void this.apply(false);
  }

  private setLevel(next: number): void {
    const clamped = clampZoomLevel(next);
    if (clamped === this.level) {
      this.context.layout.showToast(`Zoom ${zoomPercentLabel(this.level)} (limit reached)`, 'info');
      return;
    }
    this.level = clamped;
    this.settings?.set('workbench.zoomLevel', this.level);
    void this.apply(true);
  }

  private async apply(announce: boolean): Promise<void> {
    await window.znxstudio.window.setZoom(zoomFactorForLevel(this.level));
    if (announce) this.context.layout.showToast(`Zoom ${zoomPercentLabel(this.level)}`, 'info');
  }
}
