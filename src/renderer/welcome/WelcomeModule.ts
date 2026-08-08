import { ServiceKeys, type EditorService } from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';

/**
 * Welcome / start screen. Owns the New Project flow and renders the start
 * screen via the editor overlay. Actions dispatch through the CommandRegistry.
 */
export class WelcomeModule implements IModule {
  readonly id = 'znxstudio.welcome';
  readonly displayName = 'Welcome';

  private context!: ModuleContext;

  activate(context: ModuleContext): void {
    this.context = context;
    context.commands.register(CommandIds.ViewWelcome, () => this.show(), 'Help: Welcome');
    context.commands.register(CommandIds.ProjectCreate, () => this.createProject(), 'Project: New…');
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
        <div class="znxstudio-welcome-actions">
          <button class="znxstudio-welcome-btn primary" data-cmd="create">＋  New Project</button>
          <button class="znxstudio-welcome-btn" data-cmd="folder">🗂  Open Folder</button>
          <button class="znxstudio-welcome-btn" data-cmd="palette">⌘  Command Palette</button>
        </div>
      </div>
    `;

    const dispatch = (selector: string, command: string) =>
      view
        .querySelector(selector)
        ?.addEventListener('click', () => void this.context.commands.execute(command));

    dispatch('[data-cmd="create"]', CommandIds.WizardNewProject);
    dispatch('[data-cmd="folder"]', CommandIds.WorkspaceOpenFolder);
    dispatch('[data-cmd="palette"]', CommandIds.PaletteShow);

    return view;
  }

  private async createProject(): Promise<void> {
    const name = window.prompt('Project name?', 'my-zornux-app');
    if (!name) return;
    const location = await window.znxstudio.dialog.openFolder();
    if (!location) return;

    const created = await window.znxstudio.project.create({ name, location });
    this.context.layout.showToast(`Created project “${created.name}”.`, 'success');
    await this.context.commands.execute(CommandIds.WorkspaceOpenFolder, created.path);
  }
}
