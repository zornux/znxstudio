import { ServiceKeys, type StatusItem, type StatusService } from '../core/Contracts';
import type { CommandRegistry } from '../commands/CommandRegistry';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { classifyStatus, type StatusLevel } from './statusPolicy';

interface Entry {
  item: StatusItem;
  element: HTMLElement;
  level: StatusLevel;
  side: 'left' | 'right';
}

/**
 * Workspace status bar. Owns the status-bar DOM and exposes a StatusService so
 * any module can publish a segment (project, active file, theme, terminal,
 * run/build, diagnostics) without importing the status bar or each other.
 */
export class StatusBarModule implements IModule, StatusService {
  readonly id = 'znxstudio.statusbar';
  readonly displayName = 'Status Bar';

  private layout!: ModuleContext['layout'];
  private commands!: CommandRegistry;
  private readonly entries = new Map<string, Entry>();
  private readonly hideTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async activate(context: ModuleContext): Promise<void> {
    this.layout = context.layout;
    this.commands = context.commands;
    context.services.register(ServiceKeys.Status, this);

    try {
      const info = await window.znxstudio.app.getInfo();
      this.setItem('app', { text: `ZnxStudio ${info.version}`, side: 'left', priority: 0 });
    } catch {
      this.setItem('app', { text: 'ZnxStudio', side: 'left', priority: 0 });
    }

    void selfTestCoordinator.run('statusbar', () => this.maybeSelfTest());
  }

  setItem(id: string, item: StatusItem): void {
    // The policy decides whether this segment renders (state vs. launcher) and,
    // when it does, which half of the bar it belongs to. Producers are unchanged.
    const policy = classifyStatus(id);
    const side = policy.side ?? item.side ?? 'left';

    const existing = this.entries.get(id);
    const element = existing?.element ?? document.createElement('button');
    element.className = 'znxstudio-status-item';
    element.textContent = item.text;
    element.title = item.tooltip ?? '';
    element.classList.toggle('is-action', Boolean(item.command));
    element.onclick = item.command ? () => void this.commands.execute(item.command!) : null;

    this.entries.set(id, { item, element, level: policy.level, side });

    // A fresh set cancels any pending auto-hide from a previous value.
    this.clearTimer(id);

    // Hidden launchers are tracked (so removeItem/late policy changes still work)
    // but never mounted — the feature lives on in the menus, palette + workspaces.
    if (policy.level === 'hidden') {
      element.remove();
      return;
    }
    // Contextual items go quiet when the producer marks them idle (active:false).
    if (policy.level === 'contextual' && item.active === false) {
      element.remove();
      return;
    }
    this.reflow(side);

    // Transient results (build ✓, task ✗) clear themselves after a short window.
    if (item.autoHideMs && item.autoHideMs > 0) {
      this.hideTimers.set(id, setTimeout(() => this.removeItem(id), item.autoHideMs));
    }
  }

  removeItem(id: string): void {
    this.clearTimer(id);
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.element.remove();
    this.entries.delete(id);
  }

  private clearTimer(id: string): void {
    const timer = this.hideTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.hideTimers.delete(id);
    }
  }

  /** Re-order a side's rendered items by ascending priority. */
  private reflow(side: 'left' | 'right'): void {
    const ordered = [...this.entries.values()]
      .filter((entry) => entry.side === side && entry.level !== 'hidden')
      .sort((a, b) => (a.item.priority ?? 100) - (b.item.priority ?? 100));
    for (const entry of ordered) this.layout.addStatusItem(side, entry.element);
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    // Drive the real service with a known launcher + a known live indicator and
    // read the actual status-bar DOM: the launcher must not mount, the live one must.
    const marker = 'ZX-SB-SELFTEST';
    this.setItem('editor.orm', { text: `ORM ${marker}`, side: 'right', command: 'znxstudio.orm.show' });
    this.setItem('editor.cursors', { text: `Ln 1 ${marker}`, side: 'right' });
    const inBar = (text: string) =>
      [...document.querySelectorAll('.znxstudio-statusbar .znxstudio-status-item')].some((el) =>
        (el.textContent ?? '').includes(text),
      );
    const launcherShown = inBar(`ORM ${marker}`);
    const liveShown = inBar(`Ln 1 ${marker}`);

    // SB-2: a contextual item marked idle (active:false) must not mount; active
    // again must bring it back.
    this.setItem('debug', { text: `dbg ${marker}`, side: 'right', active: false });
    const idleContextual = inBar(`dbg ${marker}`);
    this.setItem('debug', { text: `dbg ${marker}`, side: 'right', active: true });
    const activeContextual = inBar(`dbg ${marker}`);

    // Clean up the probes.
    this.removeItem('editor.orm');
    this.removeItem('editor.cursors');
    this.removeItem('debug');

    const rendered = document.querySelectorAll('.znxstudio-statusbar .znxstudio-status-item').length;
    let hidden = 0;
    for (const [id, entry] of this.entries) {
      if (entry.level === 'hidden' || classifyStatus(id).level === 'hidden') hidden += 1;
    }
    log(
      `statusbar REAL DOM: launcherShown=${launcherShown} liveShown=${liveShown} ` +
        `idleContextual=${idleContextual} activeContextual=${activeContextual} ` +
        `rendered=${rendered} hiddenTracked=${hidden} (launchers suppressed, contextual gated on active)`,
    );
  }
}
