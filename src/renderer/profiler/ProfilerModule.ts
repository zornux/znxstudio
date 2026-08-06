import { ServiceKeys, type CompilerService, type StatusService } from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { LanguageServiceKeys } from '../language/api';
import { DocumentManager } from '../language/DocumentManager';
import type { CompilerProfile } from '../../shared/compilerProfiler';

/**
 * Compiler Profiler. Visualizes the performance profile the main-process
 * CompilerService accumulates across every check/build/project-check: overall
 * cache hit-rate, per-command timings, and the slowest files. A consumer of the
 * compiler service — it computes nothing itself.
 */
export class ProfilerModule implements IModule {
  readonly id = 'znxstudio.profiler';
  readonly displayName = 'Compiler Profiler';

  private context!: ModuleContext;
  private surface!: HTMLElement;
  private compiler: CompilerService | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  activate(context: ModuleContext): void {
    this.context = context;
    this.compiler = context.services.tryGet<CompilerService>(ServiceKeys.Compiler);

    this.surface = document.createElement('div');
    this.surface.className = 'znxstudio-profiler';
    context.layout.addPanelView({ id: 'profiler', title: 'Profiler', element: this.surface });

    context.commands.register(
      CommandIds.ViewProfiler,
      () => {
        context.layout.showPanelView('profiler');
        void this.refresh();
      },
      'Profiler: Show Compiler Profile',
    );
    context.commands.register(
      CommandIds.ProfilerReset,
      async () => {
        await this.compiler?.profileReset();
        await this.refresh();
      },
      'Profiler: Reset Compiler Profile',
    );

    // A compile likely ran shortly after a save — refresh once it settles.
    const documents = context.services.tryGet<DocumentManager>(LanguageServiceKeys.Documents);
    documents?.onDidSave(() => this.schedule(1500));
    documents?.onDidChange(() => this.schedule(1500));

    void this.refresh();
  }

  private schedule(delay: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), delay);
  }

  private async refresh(): Promise<void> {
    if (!this.compiler) return;
    let profile: CompilerProfile;
    try {
      profile = await this.compiler.profile();
    } catch {
      return;
    }
    this.render(profile);
    this.updateStatus(profile);
  }

  /* ----- rendering ----- */
  private render(profile: CompilerProfile): void {
    if (profile.totalOps === 0) {
      this.surface.innerHTML = `<div class="znxstudio-profiler-empty">No compiler activity yet.</div>`;
      return;
    }

    const container = document.createElement('div');
    container.className = 'znxstudio-profiler-body';

    container.appendChild(this.toolbar());
    container.appendChild(
      this.summary(
        `${profile.totalOps} operation${profile.totalOps === 1 ? '' : 's'} · ` +
          `${hitRate(profile.totalCached, profile.totalOps)}% served from cache`,
      ),
    );

    // Per-command table.
    const table = document.createElement('div');
    table.className = 'znxstudio-profiler-table';
    table.appendChild(this.tableRow(['Command', 'Runs', 'Cached', 'Avg', 'Max'], true));
    for (const command of profile.commands) {
      const realRuns = command.total - command.cached;
      const avg = realRuns > 0 ? `${(command.ranMs / realRuns).toFixed(0)}ms` : '—';
      table.appendChild(
        this.tableRow([
          command.command,
          String(command.total),
          `${hitRate(command.cached, command.total)}%`,
          avg,
          command.maxMs > 0 ? `${command.maxMs.toFixed(0)}ms` : '—',
        ]),
      );
    }
    container.appendChild(table);

    if (profile.slowestFiles.length) {
      container.appendChild(this.summary('Slowest files (real compiles)'));
      for (const file of profile.slowestFiles) {
        container.appendChild(
          this.line(`${file.maxMs.toFixed(0)}ms  ·  ${fileName(file.path)}  ·  ${file.runs} run${file.runs === 1 ? '' : 's'}`),
        );
      }
    }

    this.surface.replaceChildren(container);
  }

  private toolbar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'znxstudio-profiler-toolbar';
    bar.append(
      this.button('↻ Refresh', () => void this.refresh()),
      this.button('Reset', () => void this.context.commands.execute(CommandIds.ProfilerReset)),
    );
    return bar;
  }

  private button(text: string, onClick: () => void): HTMLElement {
    const el = document.createElement('button');
    el.className = 'znxstudio-profiler-btn';
    el.textContent = text;
    el.addEventListener('click', onClick);
    return el;
  }

  private summary(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-profiler-group';
    el.textContent = text;
    return el;
  }

  private line(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-profiler-line';
    el.textContent = text;
    return el;
  }

  private tableRow(cells: string[], header = false): HTMLElement {
    const row = document.createElement('div');
    row.className = header ? 'znxstudio-profiler-row znxstudio-profiler-row--head' : 'znxstudio-profiler-row';
    for (const cell of cells) {
      const span = document.createElement('span');
      span.textContent = cell;
      row.appendChild(span);
    }
    return row;
  }

  private updateStatus(profile: CompilerProfile): void {
    const status = this.context.services.tryGet<StatusService>(ServiceKeys.Status);
    if (!status) return;
    if (profile.totalOps === 0) {
      status.removeItem('profiler');
      return;
    }
    status.setItem('profiler', {
      text: `⏱ ${hitRate(profile.totalCached, profile.totalOps)}% cached`,
      tooltip: 'Compiler cache hit-rate — click for the full profile',
      command: CommandIds.ViewProfiler,
      side: 'right',
      priority: 14,
    });
  }
}

function hitRate(cached: number, total: number): number {
  return total > 0 ? Math.round((cached / total) * 100) : 0;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
