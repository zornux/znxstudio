import { ServiceKeys, type OutputService } from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';

/**
 * Output channel. Owns the "Output" tab in the bottom panel and streams task
 * stdout/stderr into a scrollable log. Exposed as OutputService so the run/build
 * runner (and future producers) can write to it.
 */
export class OutputModule implements IModule, OutputService {
  readonly id = 'znxstudio.output';
  readonly displayName = 'Output';

  private context!: ModuleContext;
  private surface!: HTMLElement;
  private log!: HTMLElement;

  activate(context: ModuleContext): void {
    this.context = context;

    this.surface = document.createElement('div');
    this.surface.className = 'znxstudio-output';
    this.log = document.createElement('pre');
    this.log.className = 'znxstudio-output-log';
    this.surface.appendChild(this.log);

    context.layout.addPanelView({ id: 'output', title: 'Output', element: this.surface });
    context.services.register(ServiceKeys.Output, this);

    // A single output channel aggregates every task's stream.
    window.znxstudio.task.onOutput((event) => this.append(event.data));
    window.znxstudio.task.onExit((event) =>
      this.appendLine(`\n[task exited with code ${event.code ?? 0}]`),
    );
  }

  append(text: string): void {
    this.log.textContent += text;
    this.surface.scrollTop = this.surface.scrollHeight;
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
