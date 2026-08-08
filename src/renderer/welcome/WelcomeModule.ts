import { ServiceKeys, type EditorService } from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';

/**
 * Welcome / start screen. Renders the start screen via the editor overlay and
 * routes project creation through the shared guided wizard.
 */
export class WelcomeModule implements IModule {
  readonly id = 'znxstudio.welcome';
  readonly displayName = 'Welcome';

  private context!: ModuleContext;

  activate(context: ModuleContext): void {
    this.context = context;
    context.commands.register(CommandIds.ViewWelcome, () => this.show(), 'Help: Welcome');
    // Keep the older command id as a compatibility alias, but give every entry
    // point the same validated template/location/dependency/profile workflow.
    context.commands.register(
      CommandIds.ProjectCreate,
      () => context.commands.execute(CommandIds.WizardNewProject),
      'Project: New…',
    );
  }

  private show(): void {
    this.context.services.get<EditorService>(ServiceKeys.Editor).showView(this.build());
  }

  private build(): HTMLElement {
    const view = document.createElement('div');
    view.className = 'znxstudio-welcome';
    // A clean start screen: the product name and the primary actions. Recent
    // projects live in the File menu (File → Open Recent), so they're not
    // duplicated here.
    view.innerHTML = `
      <div class="znxstudio-welcome-inner">
        <h1 class="znxstudio-welcome-title znxstudio-wordmark" aria-label="ZnxStudio">
          <span class="znxstudio-wordmark-core" aria-hidden="true">Znx</span><span class="znxstudio-wordmark-studio" aria-hidden="true">Studio</span><span class="znxstudio-wordmark-accent" aria-hidden="true"></span>
        </h1>
        <p class="znxstudio-welcome-subtitle">Build, debug, and ship Zornux projects.</p>
        <div class="znxstudio-welcome-actions">
          <button type="button" class="znxstudio-welcome-btn primary" data-cmd="create"><span aria-hidden="true">＋</span><span>New Project</span></button>
          <button type="button" class="znxstudio-welcome-btn" data-cmd="folder"><span aria-hidden="true">▱</span><span>Open Folder</span></button>
          <button type="button" class="znxstudio-welcome-btn" data-cmd="palette"><span aria-hidden="true">›_</span><span>Command Palette</span><kbd>Ctrl+Shift+P</kbd></button>
        </div>
      </div>
    `;

    const dispatch = (selector: string, command: string) =>
      view
        .querySelector(selector)
        ?.addEventListener('click', () => void this.execute(command));

    dispatch('[data-cmd="create"]', CommandIds.WizardNewProject);
    dispatch('[data-cmd="folder"]', CommandIds.WorkspaceOpenFolder);
    dispatch('[data-cmd="palette"]', CommandIds.PaletteShow);

    return view;
  }

  private async execute(command: string): Promise<void> {
    if (!this.context.commands.isEnabled(command)) {
      this.context.layout.showToast('That action is currently unavailable.', 'info');
      return;
    }
    try {
      await this.context.commands.execute(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.context.layout.showToast(`Could not complete the action: ${message}`, 'error');
    }
  }
}
