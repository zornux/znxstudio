import { ServiceKeys, type OutputService } from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';

/**
 * Workbench log channel. Owns the "Logs" tab in the bottom panel and streams task
 * stdout/stderr into a scrollable log. Exposed as OutputService so the run/build
 * runner (and future producers) can write to it.
 */
export class OutputModule implements IModule, OutputService {
  readonly id = 'znxstudio.output';
  readonly displayName = 'Logs';

  private context!: ModuleContext;
  private surface!: HTMLElement;
  private log!: HTMLElement;

  activate(context: ModuleContext): void {
    this.context = context;

    this.surface = document.createElement('div');
    this.surface.className = 'znxstudio-output';
    const channelBar = document.createElement('div');
    channelBar.className = 'znxstudio-log-channelbar';
    const identity = document.createElement('span');
    identity.className = 'znxstudio-log-channel';
    identity.textContent = 'Workbench / Tasks';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'znxstudio-log-clear';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => this.clear());
    channelBar.append(identity, clear);
    this.log = document.createElement('pre');
    this.log.className = 'znxstudio-output-log';
    this.surface.append(channelBar, this.log);

    context.layout.addPanelView({ id: 'output', title: 'Logs', element: this.surface });
    context.services.register(ServiceKeys.Output, this);

    // A single output channel aggregates every task's stream.
    const offOutput = window.znxstudio.task.onOutput((event) => this.append(event.data));
    const offExit = window.znxstudio.task.onExit((event) =>
      this.appendLine(`\n[task exited with code ${event.code ?? 0}]`),
    );
    context.subscriptions.push({ dispose: offOutput }, { dispose: offExit });
  }

  append(text: string): void {
    this.log.textContent += text;
    this.log.scrollTop = this.log.scrollHeight;
  }

  appendLine(text: string): void {
    this.append(`${text}\n`);
  }

  clear(): void {
    this.log.textContent = '';
  }

  show(): void {
    this.context.layout.showPanelView('output');
  }
}
