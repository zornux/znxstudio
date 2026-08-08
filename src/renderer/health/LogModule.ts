import { ServiceKeys, type LogService, type SettingsService } from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import {
  LOG_LEVELS,
  RingBuffer,
  countByLevel,
  filterRecords,
  formatRecord,
  logSources,
  makeRecord,
  parseLogLevel,
  shouldLog,
  type LogLevel,
  type LogRecord,
} from './logging';

export const LOG_LEVEL_SETTING = 'diagnostics.log.level';

/** How many records the in-memory buffer keeps for the Log panel. */
const BUFFER_CAPACITY = 2_000;
/** Batch disk writes; an error flushes immediately. */
const FLUSH_INTERVAL_MS = 1_000;

/**
 * Logging (Phase 19D).
 *
 * Two sinks: a bounded in-memory ring buffer (what the Log panel shows) and a
 * rotating file under `userData/logs` (what a user attaches to a bug report).
 *
 * Every message is REDACTED at record time — before it reaches either sink —
 * so a token can never sit in the buffer waiting to be copied into a report.
 * Redacting at display time would be too late.
 *
 * An `error` flushes to disk immediately. The log lines that matter most are the
 * ones written just before a crash, and a batched write loses exactly those.
 */
export class LogModule implements IModule, LogService {
  readonly id = 'znxstudio.health.log';
  readonly displayName = 'Log';

  private moduleContext!: ModuleContext;
  private settings: SettingsService | undefined;
  private view!: HTMLElement;

  private readonly buffer = new RingBuffer<LogRecord>(BUFFER_CAPACITY);
  private pending: LogRecord[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private threshold: LogLevel = 'info';
  private homeDir = '';
  private filterLevel: LogLevel = 'trace';
  private filterText = '';
  private filterSource = '';
  private readonly changeEmitter = new Emitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  async activate(context: ModuleContext): Promise<void> {
    this.moduleContext = context;
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    context.services.register(ServiceKeys.Log, this);

    this.threshold = parseLogLevel(this.settings?.get<string>(LOG_LEVEL_SETTING, 'info'));
    try {
      this.homeDir = (await window.znxstudio.app.getInfo()).homeDir;
    } catch {
      this.homeDir = '';
    }

    this.view = document.createElement('div');
    this.view.className = 'znxstudio-log';
    context.layout.addPanelView({ id: 'log', title: 'Log', element: this.view });

    context.commands.register(CommandIds.LogShow, () => this.reveal(), 'Log: Show');
    context.commands.register(CommandIds.LogClear, () => this.clear(), 'Log: Clear');
    context.commands.register(CommandIds.LogOpenFile, () => this.revealPath(), 'Log: Show Log File Path');

    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    context.subscriptions.push({
      dispose: () => {
        if (this.timer) clearInterval(this.timer);
        void this.flush();
      },
    });

    this.info('log', `Logging at level "${this.threshold}".`);
    this.render();
    void selfTestCoordinator.run('log', () => this.maybeSelfTest());
  }

  /* ----- LogService ----- */

  log(level: LogLevel, source: string, message: string): void {
    if (!shouldLog(level, this.threshold)) return;
    const record = makeRecord(level, source, message, Date.now(), this.homeDir);
    this.buffer.push(record);
    this.pending.push(record);
    // The last thing written before a crash is the thing worth having on disk.
    if (level === 'error') void this.flush();
    this.changeEmitter.fire();
    this.render();
  }

  trace(source: string, message: string): void {
    this.log('trace', source, message);
  }
  debug(source: string, message: string): void {
    this.log('debug', source, message);
  }
  info(source: string, message: string): void {
    this.log('info', source, message);
  }
  warn(source: string, message: string): void {
    this.log('warn', source, message);
  }
  error(source: string, message: string): void {
    this.log('error', source, message);
  }

  records(): LogRecord[] {
    return this.buffer.all();
  }

  level(): LogLevel {
    return this.threshold;
  }

  setLevel(level: LogLevel): void {
    this.threshold = level;
    this.settings?.set(LOG_LEVEL_SETTING, level);
    this.render();
  }

  /** The last `limit` formatted lines, already redacted, for a report. */
  tail(limit = 50): string[] {
    return this.buffer.all().slice(-limit).map(formatRecord);
  }

  async filePath(): Promise<string> {
    try {
      return await window.znxstudio.log.path();
    } catch {
      return '';
    }
  }

  async clear(): Promise<void> {
    this.buffer.clear();
    this.pending = [];
    this.filterLevel = 'trace';
    this.filterText = '';
    this.filterSource = '';
    try {
      await window.znxstudio.log.clear();
    } catch {
      /* the panel is cleared regardless */
    }
    this.render();
    this.changeEmitter.fire();
  }

  /* ----- disk ----- */

  private async flush(): Promise<void> {
    if (!this.pending.length) return;
    const lines = this.pending.map(formatRecord);
    this.pending = [];
    try {
      await window.znxstudio.log.append(lines);
    } catch {
      // A log that cannot be written must never take the IDE down. The records
      // are still in the ring buffer, so the panel and the report keep them.
    }
  }

  /* ----- UI ----- */

  private reveal(): void {
    this.moduleContext.layout.showPanelView('log');
  }

  private async revealPath(): Promise<void> {
    const path = await this.filePath();
    if (!path) {
      this.moduleContext.layout.showToast('The log file is unavailable.', 'info');
      return;
    }
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(path);
      this.moduleContext.layout.showToast('Log file path copied.', 'success');
    } catch {
      this.moduleContext.layout.showToast(`Log file: ${path}`, 'info');
    }
  }

  private render(): void {
    if (!this.view) return;
    const focusedRole = this.view.contains(document.activeElement)
      ? (document.activeElement as HTMLElement | null)?.dataset.logControl
      : undefined;
    const selection = document.activeElement instanceof HTMLInputElement
      ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] as const
      : undefined;
    this.view.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-log-toolbar';

    const levelPicker = document.createElement('select');
    levelPicker.dataset.logControl = 'capture-level';
    levelPicker.setAttribute('aria-label', 'Minimum captured log level');
    levelPicker.title = 'Minimum level written to the buffer and the file.';
    for (const level of LOG_LEVELS) {
      const option = document.createElement('option');
      option.value = level;
      option.textContent = level;
      option.selected = this.threshold === level;
      levelPicker.appendChild(option);
    }
    levelPicker.addEventListener('change', () => this.setLevel(parseLogLevel(levelPicker.value)));
    toolbar.appendChild(levelPicker);

    const filterPicker = document.createElement('select');
    filterPicker.dataset.logControl = 'filter-level';
    filterPicker.setAttribute('aria-label', 'Minimum visible log level');
    filterPicker.title = 'Hide records below this level (view only).';
    for (const level of LOG_LEVELS) {
      const option = document.createElement('option');
      option.value = level;
      option.textContent = `≥ ${level}`;
      option.selected = this.filterLevel === level;
      filterPicker.appendChild(option);
    }
    filterPicker.addEventListener('change', () => {
      this.filterLevel = parseLogLevel(filterPicker.value, 'trace');
      this.render();
    });
    toolbar.appendChild(filterPicker);

    const sourcePicker = document.createElement('select');
    sourcePicker.dataset.logControl = 'source';
    sourcePicker.setAttribute('aria-label', 'Filter logs by source');
    sourcePicker.title = 'Filter records by source.';
    const anySource = document.createElement('option');
    anySource.value = '';
    anySource.textContent = 'all sources';
    sourcePicker.appendChild(anySource);
    const sources = logSources(this.buffer.all());
    if (this.filterSource && !sources.includes(this.filterSource)) this.filterSource = '';
    for (const source of sources) {
      const option = document.createElement('option');
      option.value = source;
      option.textContent = source;
      option.selected = this.filterSource === source;
      sourcePicker.appendChild(option);
    }
    sourcePicker.addEventListener('change', () => {
      this.filterSource = sourcePicker.value;
      this.render();
    });
    toolbar.appendChild(sourcePicker);

    const search = document.createElement('input');
    search.type = 'search';
    search.dataset.logControl = 'search';
    search.setAttribute('aria-label', 'Filter log messages');
    search.placeholder = 'Filter messages…';
    search.value = this.filterText;
    search.addEventListener('input', () => {
      this.filterText = search.value;
      this.render();
    });
    toolbar.appendChild(search);

    const clear = document.createElement('button');
    clear.className = 'znxstudio-btn-small';
    clear.title = 'Clear the panel and the current log file';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => void this.clear());
    toolbar.appendChild(clear);

    const path = document.createElement('button');
    path.className = 'znxstudio-btn-small';
    path.title = 'Copy the current log file path';
    path.textContent = 'Log file';
    path.addEventListener('click', () => void this.revealPath());
    toolbar.appendChild(path);

    const counts = countByLevel(this.buffer.all());
    const summary = document.createElement('span');
    summary.className = 'znxstudio-log-counts';
    summary.textContent = `${this.buffer.size} total · ${counts.error} error · ${counts.warn} warning`;
    summary.setAttribute('aria-live', 'polite');
    toolbar.appendChild(summary);
    this.view.appendChild(toolbar);

    const visible = filterRecords(this.buffer.all(), {
      level: this.filterLevel,
      ...(this.filterSource ? { source: this.filterSource } : {}),
      text: this.filterText,
    });

    const actions = document.createElement('div');
    actions.className = 'znxstudio-log-subtoolbar';
    const visibleCount = document.createElement('span');
    visibleCount.textContent = `${visible.length} shown`;
    actions.appendChild(visibleCount);
    if (this.filterText || this.filterSource || this.filterLevel !== 'trace') {
      const reset = document.createElement('button');
      reset.className = 'znxstudio-log-link';
      reset.textContent = 'Reset filters';
      reset.addEventListener('click', () => {
        this.filterText = '';
        this.filterSource = '';
        this.filterLevel = 'trace';
        this.render();
      });
      actions.appendChild(reset);
    }
    const copy = document.createElement('button');
    copy.className = 'znxstudio-log-link';
    copy.textContent = 'Copy visible';
    copy.disabled = visible.length === 0;
    copy.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(visible.map(formatRecord).join('\n'));
        this.moduleContext.layout.showToast('Visible log entries copied.', 'success');
      } catch {
        this.moduleContext.layout.showToast('Could not copy the log entries.', 'error');
      }
    });
    actions.appendChild(copy);
    this.view.appendChild(actions);

    const list = document.createElement('div');
    list.className = 'znxstudio-log-records';
    list.setAttribute('role', 'log');
    list.setAttribute('aria-label', 'Application log records');
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-log-empty';
      empty.textContent = this.buffer.size === 0
        ? 'No log entries yet.'
        : 'No entries match the current filters.';
      list.appendChild(empty);
    } else {
      // Newest last, the way a tailed file reads.
      for (const record of visible) list.appendChild(this.renderRecord(record));
    }
    this.view.appendChild(list);
    list.scrollTop = list.scrollHeight;

    if (focusedRole) {
      const next = this.view.querySelector<HTMLElement>(`[data-log-control="${focusedRole}"]`);
      next?.focus();
      if (selection && next instanceof HTMLInputElement) {
        next.setSelectionRange(selection[0], selection[1]);
      }
    }
  }

  private renderRecord(record: LogRecord): HTMLElement {
    const row = document.createElement('div');
    row.className = `znxstudio-log-record is-${record.level}`;
    row.title = formatRecord(record);

    const time = document.createElement('time');
    time.className = 'znxstudio-log-time';
    time.dateTime = new Date(record.time).toISOString();
    time.textContent = new Date(record.time).toLocaleTimeString([], { hour12: false });
    const level = document.createElement('span');
    level.className = 'znxstudio-log-level';
    level.textContent = record.level.toUpperCase();
    const source = document.createElement('span');
    source.className = 'znxstudio-log-source';
    source.textContent = record.source;
    const message = document.createElement('span');
    message.className = 'znxstudio-log-message';
    message.textContent = record.message;
    row.append(time, level, source, message);
    return row;
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      return;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    try {
      const before = this.buffer.size;
      this.setLevel('debug');
      this.trace('selftest', 'this trace is below the threshold');
      log(`log threshold: trace suppressed at level=debug (records ${before} → ${this.buffer.size})`);

      this.error('selftest', 'registry login failed: token=abcd1234secret and Bearer eyJhbGciOiJIUzI1NiJ9');
      const last = this.buffer.all()[this.buffer.size - 1];
      log(`log REAL redaction: ${JSON.stringify(last.message)}`);
      log(`log REAL redaction: contains raw token = ${last.message.includes('abcd1234secret')} (expect false)`);

      if (this.homeDir) {
        this.warn('selftest', `reading ${this.homeDir}\\projects\\app.zx`);
        const homed = this.buffer.all()[this.buffer.size - 1];
        log(`log REAL home redaction: ${JSON.stringify(homed.message)} (expect a leading ~)`);
      }

      await this.flush();
      const path = await this.filePath();
      const lines = await window.znxstudio.log.read(200);
      const onDisk = lines.filter((line) => line.includes('[selftest]')).length;
      log(`log REAL file: ${path}`);
      log(`log REAL file: ${lines.length} lines, ${onDisk} from this self-test (a REAL file under userData)`);
      const leaked = lines.some((line) => line.includes('abcd1234secret'));
      log(`log REAL file leaked the token = ${leaked} (expect false — redaction happens before the write)`);

      this.setLevel('info');
    } catch (error) {
      log(`log REAL failed: ${(error as Error).message}`);
    }
  }
}
