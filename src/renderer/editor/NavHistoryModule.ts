import {
  ServiceKeys,
  type EditorService,
  type StatusService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { NavHistory, isSignificantJump, type NavLocation } from './navHistory';

/**
 * Navigation history (Phase 7E). A back/forward stack across editor jumps —
 * file switches and significant same-file cursor moves are recorded; back and
 * forward replay them. Session-only (not persisted), VS Code style. Owns no
 * Monaco — it observes the Editor service and replays via revealLocation.
 */
export class NavHistoryModule implements IModule {
  readonly id = 'znxstudio.navhistory';
  readonly displayName = 'Navigation History';

  private context!: ModuleContext;
  private editor!: EditorService;
  private status: StatusService | undefined;
  private readonly history = new NavHistory();
  /** True while replaying a back/forward jump, so we don't re-record it. */
  private navigating = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);

    context.commands.register(CommandIds.NavBack, () => void this.go('back'), 'Go: Back');
    context.commands.register(CommandIds.NavForward, () => void this.go('forward'), 'Go: Forward');

    this.editor.onDidChangeActiveFile(() => this.record());
    this.editor.onDidChangeSelections(() => this.record());
    this.updateStatus();
    void selfTestCoordinator.run('navhistory', () => this.maybeSelfTest());
  }

  private location(): NavLocation | null {
    const uri = this.editor.currentUri();
    const position = this.editor.cursorPosition();
    if (!uri || !position) return null;
    return { uri, line: position.line, character: position.character };
  }

  private record(): void {
    if (this.navigating) return;
    const next = this.location();
    if (!next) return;
    if (!isSignificantJump(this.history.current(), next)) return;
    this.history.push(next);
    this.updateStatus();
  }

  private async go(direction: 'back' | 'forward'): Promise<void> {
    const target = direction === 'back' ? this.history.back() : this.history.forward();
    if (!target) {
      this.context.layout.showToast(`No ${direction} history.`, 'info');
      return;
    }
    this.navigating = true;
    try {
      await this.editor.revealLocation(target.uri, target.line, target.character);
    } finally {
      // Let the reveal's selection/active-file events settle before re-recording.
      setTimeout(() => {
        this.navigating = false;
      }, 0);
    }
    this.updateStatus();
  }

  private updateStatus(): void {
    if (!this.status) return;
    const back = this.history.canBack();
    const forward = this.history.canForward();
    if (!back && !forward) {
      this.status.removeItem('editor.navHistory');
      return;
    }
    this.status.setItem('editor.navHistory', {
      text: `${back ? '◀' : '◁'} ${forward ? '▶' : '▷'}`,
      tooltip: 'Navigation history (Go Back / Go Forward)',
      command: CommandIds.NavBack,
      side: 'right',
      priority: 21,
    });
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

    const history = new NavHistory();
    history.push({ uri: 'file:///a.zx', line: 0, character: 0 });
    history.push({ uri: 'file:///a.zx', line: 40, character: 2 });
    history.push({ uri: 'file:///b.zx', line: 5, character: 0 });
    log(`navhistory size=${history.size()} canBack=${history.canBack()} canForward=${history.canForward()}`);
    const back1 = history.back();
    const back2 = history.back();
    log(`navhistory back→ ${back1?.line} then ${back2?.line} (uri ${back2?.uri.split('/').pop()})`);
    const fwd = history.forward();
    log(`navhistory forward→ ${fwd?.line}`);
    // A push after going back truncates forward history.
    history.push({ uri: 'file:///c.zx', line: 99, character: 0 });
    log(`navhistory afterBranch canForward=${history.canForward()} current=${history.current()?.line}`);
    log(`navhistory significant small=${isSignificantJump({ uri: 'file:///a.zx', line: 0, character: 0 }, { uri: 'file:///a.zx', line: 3, character: 0 })} big=${isSignificantJump({ uri: 'file:///a.zx', line: 0, character: 0 }, { uri: 'file:///a.zx', line: 20, character: 0 })}`);
  }
}
