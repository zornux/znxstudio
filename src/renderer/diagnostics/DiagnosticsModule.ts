import {
  ServiceKeys,
  type EditorService,
  type SettingsService,
  type StatusService,
  type WorkspaceService,
} from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { LanguageServiceKeys, type Diagnostic, type DiagnosticsReader } from '../language/api';
import type { ProjectDiagnostic, WorkspaceInfo } from '../../shared/types';
import { formatProvenance, isZornuxCode } from '../language/diagnosticCatalog';

const SEVERITY_ICON: Record<string, string> = { error: '⛔', warning: '⚠️', info: 'ℹ️', hint: '💡' };
const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, info: 2, hint: 3 };

type FilterBucket = 'error' | 'warning' | 'info';

interface Row {
  severity: string;
  message: string;
  hint?: string;
  location?: string;
  code?: string;
  source?: string;
  onClick?: () => void;
}

/**
 * Problems panel. Aggregates workspace/project validation + per-document
 * language diagnostics (all layers: analyzer, compiler, build, project) into one
 * sorted, filterable list. Each row shows its provenance (which layer + ZX####
 * subsystem) and a code badge that links to the diagnostic docs when configured.
 */
export class DiagnosticsModule implements IModule {
  readonly id = 'znxstudio.diagnostics';
  readonly displayName = 'Project Diagnostics';

  private context!: ModuleContext;
  private surface!: HTMLElement;
  private engine: DiagnosticsReader | undefined;
  private workspaceInfo: WorkspaceInfo | null = null;
  private readonly filters: Record<FilterBucket, boolean> = { error: true, warning: true, info: true };

  activate(context: ModuleContext): void {
    this.context = context;

    this.surface = document.createElement('div');
    this.surface.className = 'znxstudio-diagnostics';
    context.layout.addPanelView({ id: 'diagnostics', title: 'Problems', element: this.surface });

    context.commands.register(
      CommandIds.ViewProblems,
      () => context.layout.showPanelView('diagnostics'),
      'View: Problems',
    );

    const workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    workspace.onDidChangeWorkspace((info) => {
      this.workspaceInfo = info;
      this.render(info?.diagnostics.some((d) => d.severity === 'error') ?? false);
    });

    this.engine = context.services.tryGet<DiagnosticsReader>(LanguageServiceKeys.Diagnostics);
    this.engine?.onDidChange(() => this.render(false));

    this.render(false);
  }

  private render(surfaceOnError: boolean): void {
    const projectDiags = this.workspaceInfo?.diagnostics ?? [];
    const languageUris = (this.engine?.uris() ?? []).filter((uri) => (this.engine?.get(uri).length ?? 0) > 0);
    const counts = this.countAll(projectDiags, languageUris);

    this.renderStatus(counts);

    if (projectDiags.length === 0 && languageUris.length === 0) {
      this.surface.innerHTML = `<div class="znxstudio-diagnostics-empty">✓ No problems detected.</div>`;
      return;
    }

    const container = document.createElement('div');
    container.appendChild(this.toolbar(counts));

    const list = document.createElement('div');
    list.className = 'znxstudio-diagnostics-list';
    let shown = 0;

    if (projectDiags.length) {
      const rows = projectDiags.filter((d) => this.passes(d.severity));
      if (rows.length) {
        list.appendChild(this.groupHeader('Project', this.tally(projectDiags)));
        for (const d of rows) list.appendChild(this.row({ severity: d.severity, message: d.message, hint: d.hint, code: d.code }));
        shown += rows.length;
      }
    }

    for (const uri of languageUris) {
      const diagnostics = this.sorted(this.engine?.get(uri) ?? []);
      const rows = diagnostics.filter((d) => this.passes(d.severity));
      if (!rows.length) continue;
      list.appendChild(this.groupHeader(fileName(uri), this.tally(diagnostics)));
      for (const d of rows) {
        list.appendChild(
          this.row({
            severity: d.severity,
            message: d.message,
            hint: d.hint,
            location: `Ln ${d.range.start.line + 1}, Col ${d.range.start.character + 1}`,
            code: d.code,
            source: d.source,
            onClick: () => this.reveal(uri, d),
          }),
        );
      }
      shown += rows.length;
    }

    if (shown === 0) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-diagnostics-empty';
      empty.textContent = 'No problems match the current filter.';
      list.appendChild(empty);
    }

    container.appendChild(list);
    this.surface.replaceChildren(container);

    if (surfaceOnError) this.context.layout.showPanelView('diagnostics');
  }

  /* ----- toolbar / filters ----- */
  private toolbar(counts: Record<FilterBucket, number>): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'znxstudio-diagnostics-toolbar';
    const chip = (bucket: FilterBucket, icon: string, label: string) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `znxstudio-diag-chip${this.filters[bucket] ? ' is-active' : ''}`;
      el.textContent = `${icon} ${counts[bucket]} ${label}`;
      el.setAttribute('aria-pressed', String(this.filters[bucket]));
      el.addEventListener('click', () => {
        this.filters[bucket] = !this.filters[bucket];
        this.render(false);
      });
      return el;
    };
    bar.append(
      chip('error', '⛔', 'Errors'),
      chip('warning', '⚠️', 'Warnings'),
      chip('info', 'ℹ️', 'Info'),
    );
    return bar;
  }

  private passes(severity: string): boolean {
    return this.filters[bucketOf(severity)];
  }

  private countAll(projectDiags: ProjectDiagnostic[], uris: string[]): Record<FilterBucket, number> {
    const counts: Record<FilterBucket, number> = { error: 0, warning: 0, info: 0 };
    const add = (severity: string) => (counts[bucketOf(severity)] += 1);
    for (const d of projectDiags) add(d.severity);
    for (const uri of uris) for (const d of this.engine?.get(uri) ?? []) add(d.severity);
    return counts;
  }

  private tally(diagnostics: { severity: string }[]): string {
    let errors = 0;
    let warnings = 0;
    for (const d of diagnostics) {
      if (d.severity === 'error') errors++;
      else if (d.severity === 'warning') warnings++;
    }
    const parts = [errors ? `⛔ ${errors}` : '', warnings ? `⚠️ ${warnings}` : ''].filter(Boolean);
    return parts.join('  ');
  }

  private sorted(diagnostics: Diagnostic[]): Diagnostic[] {
    return [...diagnostics].sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 2) - (SEVERITY_RANK[b.severity] ?? 2) ||
        a.range.start.line - b.range.start.line ||
        a.range.start.character - b.range.start.character,
    );
  }

  /* ----- rows ----- */
  private groupHeader(title: string, tally: string): HTMLElement {
    const header = document.createElement('div');
    header.className = 'znxstudio-diagnostics-group';
    const name = document.createElement('span');
    name.textContent = title;
    header.appendChild(name);
    if (tally) {
      const count = document.createElement('span');
      count.className = 'znxstudio-diagnostics-group-count';
      count.textContent = tally;
      header.appendChild(count);
    }
    return header;
  }

  private row(opts: Row): HTMLElement {
    const row = document.createElement('div');
    row.className = `znxstudio-diagnostic znxstudio-diagnostic--${opts.severity}`;

    const icon = document.createElement('span');
    icon.className = 'znxstudio-diagnostic-icon';
    icon.textContent = SEVERITY_ICON[opts.severity] ?? 'ℹ️';

    const body = document.createElement('div');
    body.className = 'znxstudio-diagnostic-body';

    const message = document.createElement('div');
    message.className = 'znxstudio-diagnostic-message';
    message.textContent = opts.message;
    body.appendChild(message);

    const meta = document.createElement('div');
    meta.className = 'znxstudio-diagnostic-meta';
    const provenance = formatProvenance(opts.source, opts.code);
    if (provenance) meta.appendChild(this.metaSpan('znxstudio-diagnostic-source', provenance));
    if (opts.location) meta.appendChild(this.metaSpan('znxstudio-diagnostic-loc', opts.location));
    if (opts.code) meta.appendChild(this.codeBadge(opts.code));
    if (meta.childElementCount) body.appendChild(meta);

    if (opts.hint) {
      const hint = document.createElement('div');
      hint.className = 'znxstudio-diagnostic-hint';
      hint.textContent = opts.hint;
      body.appendChild(hint);
    }

    row.append(icon, body);
    if (opts.onClick) {
      row.classList.add('is-clickable');
      row.addEventListener('click', opts.onClick);
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          opts.onClick?.();
        }
      });
    }
    return row;
  }

  private metaSpan(className: string, text: string): HTMLElement {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }

  private codeBadge(code: string): HTMLElement {
    const url = this.docsUrl();
    if (url && isZornuxCode(code)) {
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'znxstudio-diagnostic-code';
      badge.textContent = code;
      badge.classList.add('is-link');
      badge.title = 'Open diagnostic documentation';
      badge.addEventListener('click', (event) => {
        event.stopPropagation(); // don't also navigate the row
        void window.znxstudio.shell.openExternal(`${url.replace(/\/$/, '')}#${code}`).catch((error: unknown) => {
          this.context.layout.showToast(`Could not open diagnostic documentation: ${(error as Error).message}`, 'error');
        });
      });
      badge.addEventListener('keydown', (event) => event.stopPropagation());
      return badge;
    }
    const badge = document.createElement('span');
    badge.className = 'znxstudio-diagnostic-code';
    badge.textContent = code;
    return badge;
  }

  /** Navigate to a diagnostic's file + position in the editor. */
  private reveal(uri: string, diagnostic: Diagnostic): void {
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (!editor) return;
    void editor.revealLocation(uri, diagnostic.range.start.line, diagnostic.range.start.character).catch((error: unknown) => {
      this.context.layout.showToast(`Could not open problem location: ${(error as Error).message}`, 'error');
    });
  }

  private docsUrl(): string {
    const value = this.context.services
      .tryGet<SettingsService>(ServiceKeys.Settings)
      ?.get('zornux.diagnostics.docsUrl', '');
    return typeof value === 'string' ? value.trim() : '';
  }

  private renderStatus(counts: Record<FilterBucket, number>): void {
    const status = this.context.services.tryGet<StatusService>(ServiceKeys.Status);
    if (!status) return;
    const errors = counts.error;
    const warnings = counts.warning;
    status.setItem('diagnostics', {
      text: errors || warnings ? `⛔ ${errors}  ⚠️ ${warnings}` : '✓ 0',
      tooltip: 'Project + language problems',
      command: CommandIds.ViewProblems,
      side: 'right',
      priority: 16,
    });
  }
}

function bucketOf(severity: string): FilterBucket {
  if (severity === 'error') return 'error';
  if (severity === 'warning') return 'warning';
  return 'info';
}

function fileName(uri: string): string {
  try {
    return decodeURIComponent(uri.split('/').pop() ?? uri);
  } catch {
    return uri;
  }
}
