import { ServiceKeys, type EditorService, type SecurityService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { findingsToDecorations, type Confidence, type SecurityFinding, type SecuritySeverity } from './findings';
import { filterFindings, groupByFile, presentCategories, scanSummary, summaryLine, type ScanFilter } from './scanner';

const DECORATION_OWNER = 'security.scan';
const SEVERITIES: SecuritySeverity[] = ['Critical', 'Error', 'Warning', 'Info'];
const CONFIDENCES: Confidence[] = ['Low', 'Medium', 'High'];

/**
 * Vulnerability scanner (Phase 15B). Lists every finding the REAL Zornux
 * analyzer returned — across all nine rule categories, not just secrets —
 * filterable by severity, category, confidence and text, and mirrors the active
 * file's findings inline in the editor as error-lens decorations.
 */
export class ScannerModule implements IModule {
  readonly id = 'znxstudio.security.scanner';
  readonly displayName = 'Security Scan';

  private moduleContext!: ModuleContext;
  private security: SecurityService | undefined;
  private editor: EditorService | undefined;
  private panel!: HTMLElement;
  private filter: ScanFilter = {};

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.security = context.services.tryGet<SecurityService>(ServiceKeys.Security);
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-scanner';
    context.layout.addPanelView({ id: 'security-scan', title: 'Security Scan', element: this.panel });

    context.commands.register(CommandIds.SecurityScannerShow, () => this.reveal(), 'Security: Show Scan Results');

    this.security?.onDidChange(() => {
      this.render();
      this.decorateActiveFile();
    });
    this.editor?.onDidChangeActiveFile(() => this.decorateActiveFile());

    this.render();
    void selfTestCoordinator.run('security-scanner', () => this.maybeSelfTest());
  }

  private reveal(): void {
    this.render();
    this.moduleContext.layout.showPanelView('security-scan');
  }

  /** Mirror the active file's findings inline; a file with none gets a clean gutter. */
  private decorateActiveFile(): void {
    if (!this.editor) return;
    const file = this.editor.currentFile();
    if (!file) {
      this.editor.clearDecorations(DECORATION_OWNER);
      return;
    }
    const findings = (this.security?.findings() ?? []).filter((f) => samePath(f.file, file));
    this.editor.setDecorations(DECORATION_OWNER, findingsToDecorations(findings));
  }

  private render(): void {
    if (!this.panel) return;
    this.panel.replaceChildren();

    const results = this.security?.results() ?? [];
    const all = this.security?.findings() ?? [];

    const summary = document.createElement('div');
    summary.className = 'znxstudio-scanner-summary';
    summary.textContent = summaryLine(scanSummary(results));
    this.panel.appendChild(summary);

    if (!results.length) return;

    this.panel.appendChild(this.renderFilters(all));

    const unanalyzed = results.filter((r) => !r.analyzed);
    if (unanalyzed.length) {
      const note = document.createElement('div');
      note.className = 'znxstudio-scanner-unanalyzed';
      note.textContent = `Not analyzed (the program must compile first): ${unanalyzed
        .map((r) => `${basename(r.file)} — ${r.diagnostics[0]?.code ?? 'compile error'}`)
        .join(', ')}`;
      this.panel.appendChild(note);
    }

    const shown = filterFindings(all, this.filter);
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-scanner-empty';
      empty.textContent = all.length ? 'No findings match the filter.' : 'No findings.';
      this.panel.appendChild(empty);
      return;
    }

    for (const group of groupByFile(shown)) {
      this.panel.appendChild(this.renderFileGroup(group.file, group.findings));
    }
  }

  private renderFilters(all: SecurityFinding[]): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'znxstudio-scanner-filters';

    for (const severity of SEVERITIES) {
      const label = document.createElement('label');
      label.className = 'znxstudio-scanner-toggle';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !this.filter.severities?.length || this.filter.severities.includes(severity);
      box.addEventListener('change', () => {
        const active = new Set(this.filter.severities?.length ? this.filter.severities : SEVERITIES);
        if (box.checked) active.add(severity);
        else active.delete(severity);
        this.filter = { ...this.filter, severities: SEVERITIES.filter((s) => active.has(s)) };
        this.render();
      });
      const text = document.createElement('span');
      text.className = `znxstudio-severity znxstudio-severity-${severity.toLowerCase()}`;
      text.textContent = `${severity} ${all.filter((f) => f.severity === severity).length}`;
      label.append(box, text);
      bar.appendChild(label);
    }

    const category = document.createElement('select');
    category.className = 'znxstudio-select';
    category.setAttribute('aria-label', 'Category filter');
    const any = document.createElement('option');
    any.value = '';
    any.textContent = 'all categories';
    category.appendChild(any);
    for (const name of presentCategories(all)) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      option.selected = this.filter.categories?.[0] === name;
      category.appendChild(option);
    }
    category.addEventListener('change', () => {
      this.filter = { ...this.filter, categories: category.value ? [category.value] : [] };
      this.render();
    });
    bar.appendChild(category);

    const confidence = document.createElement('select');
    confidence.className = 'znxstudio-select';
    confidence.setAttribute('aria-label', 'Confidence filter');
    for (const level of CONFIDENCES) {
      const option = document.createElement('option');
      option.value = level;
      option.textContent = `${level}+ confidence`;
      option.selected = (this.filter.minConfidence ?? 'Low') === level;
      confidence.appendChild(option);
    }
    confidence.addEventListener('change', () => {
      this.filter = { ...this.filter, minConfidence: confidence.value as Confidence };
      this.render();
    });
    bar.appendChild(confidence);

    const search = document.createElement('input');
    search.className = 'znxstudio-input';
    search.placeholder = 'Filter findings…';
    search.value = this.filter.query ?? '';
    search.addEventListener('input', () => {
      this.filter = { ...this.filter, query: search.value };
      this.render();
    });
    bar.appendChild(search);

    return bar;
  }

  private renderFileGroup(file: string, findings: SecurityFinding[]): HTMLElement {
    const group = document.createElement('div');
    group.className = 'znxstudio-scanner-group';

    const header = document.createElement('div');
    header.className = 'znxstudio-scanner-file';
    header.textContent = `${basename(file)} · ${findings.length}`;
    header.title = file;
    group.appendChild(header);

    for (const finding of findings) {
      const row = document.createElement('div');
      row.className = 'znxstudio-scanner-row';

      const line = document.createElement('button');
      line.className = 'znxstudio-scanner-hit';
      const badge = document.createElement('span');
      badge.className = `znxstudio-severity znxstudio-severity-${finding.severity.toLowerCase()}`;
      badge.textContent = finding.severity;
      const code = document.createElement('span');
      code.className = 'znxstudio-scanner-code';
      code.textContent = finding.code;
      const message = document.createElement('span');
      message.textContent = finding.message;
      const where = document.createElement('span');
      where.className = 'znxstudio-scanner-where';
      where.textContent = `:${finding.startLine}`;
      line.append(badge, code, message, where);
      line.addEventListener('click', () => {
        void this.editor?.revealLocation(toUri(finding.file), finding.startLine - 1, finding.startColumn - 1);
      });
      row.appendChild(line);

      const detail = document.createElement('div');
      detail.className = 'znxstudio-scanner-detail';
      detail.textContent = `${finding.explanation} — ${finding.suggestedFix}`;
      row.appendChild(detail);

      for (const related of finding.related) {
        const link = document.createElement('button');
        link.className = 'znxstudio-scanner-related';
        link.textContent = `see line ${related.line}: ${related.message}`;
        link.addEventListener('click', () => {
          void this.editor?.revealLocation(toUri(finding.file), related.line - 1, related.column - 1);
        });
        row.appendChild(link);
      }

      group.appendChild(row);
    }

    return group;
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    let tempDir = '';
    try {
      const info = await window.znxstudio.app.getInfo();
      enabled = info.selftest === true;
      tempDir = info.tempDir;
    } catch {
      enabled = false;
    }
    if (!enabled || !tempDir || !this.security) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    try {
      // One program that trips FOUR different rules at once: an unsafe API, a
      // never-closed connection, an unguarded state-changing route, and an
      // unencoded reflection of request data.
      const file = `${tempDir}\\znxstudio-security-scan.zx`;
      await window.znxstudio.fs.writeFile(
        file,
        [
          'import db',
          'create where_to = "memory"',
          'create store = db.open("sqlite", where_to)',
          'show db.unsafe_query(store, "select 1")',
          '',
          'service Items',
          '    on POST "/items" with input',
          '        give back "<p>" + input + "</p>"',
          '    end',
          'end',
          '',
        ].join('\n'),
      );
      const result = await this.security.scanFile(file);
      if (!result) {
        log('scanner REAL: scan returned nothing');
        return;
      }
      const codes = result.findings.map((f) => `${f.code}/${f.severity}`).join(' ');
      log(`scanner REAL multi-rule: analyzed=${result.analyzed} findings=${result.findings.length} [${codes}]`);

      const summary = scanSummary([result]);
      log(`scanner REAL summary: ${summaryLine(summary)}`);
      log(`scanner REAL categories: ${presentCategories(result.findings).join(', ')}`);

      const criticalOnly = filterFindings(result.findings, { severities: ['Error'] });
      log(`scanner filter severity=Error → ${criticalOnly.length} of ${result.findings.length}`);
      const decorations = findingsToDecorations(result.findings);
      log(
        `scanner decorations: ${decorations.length} (first line ${decorations[0]?.startLine} 0-based, ` +
          `from CLI line ${result.findings[0]?.startLine} 1-based)`,
      );
    } catch (error) {
      log(`scanner REAL failed: ${(error as Error).message}`);
    }
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function toUri(path: string): string {
  return `file:///${path.replace(/\\/g, '/')}`;
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
}
