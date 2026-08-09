import {
  ServiceKeys,
  type CompilerService,
  type EditorService,
  type ProfilerRunState,
  type ProfilerService,
  type StatusService,
  type ToolchainService,
} from '../core/Contracts';
import { capabilityEnabled, capabilityStatus } from '../toolchain/capabilityGuard';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { captureTask } from '../database/runCapture';
import { joinPath } from '../explorer/paths';
import { formatStack, gcSummary, hasAllocationStacks, topAllocationSites } from './allocations';
import {
  buildProfileArgs,
  emptyReport,
  hasTimestamps,
  parseProfileReport,
  parseTimelineEvents,
  traceDurationMicroseconds,
  type ProfileMode,
  type ProfileReport,
  type ProfilerEvent,
} from './profile';

/** Each profiling mode's required toolchain capability + human label (IL-C gating). */
const PROFILE_MODE_CAPABILITY: Record<ProfileMode, { capability: string; label: string }> = {
  run: { capability: 'cpuProfiling', label: 'CPU profiling' },
  'vm-run': { capability: 'cpuProfiling', label: 'CPU profiling' },
  allocations: { capability: 'allocationTracking', label: 'Allocation profiling' },
  heap: { capability: 'heapSnapshots', label: 'Heap snapshots' },
  timeline: { capability: 'timeline', label: 'Timeline profiling' },
  serve: { capability: 'cpuProfiling', label: 'Profiling server' },
};

/**
 * Performance profiling hub (Phase 14 foundation). Drives the REAL
 * `zornux profile <mode> <file> --json` CLI (v1.0.0-rc.2), parses its report /
 * trace, and publishes them to the five profiler views. Nothing is simulated:
 * every number the views show came from the Zornux runtime.
 */
export class PerformanceModule implements IModule, ProfilerService {
  readonly id = 'znxstudio.performance';
  readonly displayName = 'Performance';

  private moduleContext!: ModuleContext;
  private editor: EditorService | undefined;
  private statusBar: StatusService | undefined;
  private view!: HTMLElement;
  private lastReport: ProfileReport | null = null;
  private lastEvents: ProfilerEvent[] = [];
  private runState: ProfilerRunState = { running: false, file: null, engine: 'interpreter' };
  private readonly changeEmitter = new Emitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    this.statusBar = context.services.tryGet<StatusService>(ServiceKeys.Status);
    context.services.register(ServiceKeys.Performance, this);

    this.view = document.createElement('div');
    this.view.className = 'znxstudio-perf';
    context.layout.addActivityItem({ id: 'performance', label: 'Performance', icon: '▲', onSelect: () => this.reveal() });
    context.commands.register(CommandIds.PerfShow, () => this.reveal(), 'Performance: Show');
    context.commands.register(CommandIds.PerfProfileCpu, () => this.profile(this.runState.engine === 'vm' ? 'vm-run' : 'run'), 'Performance: Profile CPU');
    context.commands.register(CommandIds.PerfProfileAllocations, () => this.profile('allocations'), 'Performance: Profile Allocations');
    context.commands.register(CommandIds.PerfProfileHeap, () => this.profile('heap'), 'Performance: Profile Heap');
    context.commands.register(CommandIds.PerfProfileTimeline, () => this.profile('timeline'), 'Performance: Profile Timeline');

    this.render();
    void selfTestCoordinator.run('performance', () => this.maybeSelfTest());
  }

  /* ----- ProfilerService ----- */
  report(): ProfileReport | null {
    return this.lastReport;
  }
  events(): ProfilerEvent[] {
    return this.lastEvents;
  }
  state(): ProfilerRunState {
    return this.runState;
  }

  async profile(mode: ProfileMode): Promise<void> {
    const file = this.editor?.currentFile();
    if (!file || !file.toLowerCase().endsWith('.zx')) {
      this.moduleContext.layout.showToast('Open a .zx program to profile.', 'info');
      return;
    }
    const compiler = this.moduleContext.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const info = compiler ? await compiler.info() : null;
    if (!info?.available || !info.path) {
      this.moduleContext.layout.showToast('Zornux compiler unavailable.', 'error');
      return;
    }

    // Capability gate: this profiling mode must be advertised by the toolchain,
    // and we only pass an rc.4 opt-in flag when its capability is present (an
    // older binary would reject a flag it doesn't know).
    const toolchain = this.moduleContext.services.tryGet<ToolchainService>(ServiceKeys.Toolchain);
    const tc = toolchain ? await toolchain.info() : null;
    if (tc) {
      const need = PROFILE_MODE_CAPABILITY[mode];
      const status = capabilityStatus(tc, need.capability, need.label);
      if (!status.enabled) {
        this.moduleContext.layout.showToast(status.reason ?? `${need.label} is unavailable.`, 'error');
        return;
      }
    }

    this.runState = { running: true, file, engine: mode === 'vm-run' ? 'vm' : this.runState.engine };
    this.render();
    this.updateStatusBar(); // show "profiling…" progress while it runs
    this.changeEmitter.fire();

    // rc.4 opt-ins, each gated on its capability. Stacks only make sense while
    // tracking allocations; timestamps only while tracing a timeline; GC counters
    // are cheap enough to always ask for — when the toolchain supports them.
    const args = buildProfileArgs(mode, file, {
      json: true,
      trace: mode === 'timeline' ? 'all' : undefined,
      allocationStacks: mode === 'allocations' && capabilityEnabled(tc, 'allocationStacks'),
      timestamps: mode === 'timeline' && capabilityEnabled(tc, 'profileTimestamps'),
      gcStats: mode !== 'timeline' && capabilityEnabled(tc, 'gcStats'),
    });
    const cwd = file.replace(/[\\/][^\\/]*$/, '');
    const command = `"${info.path}" ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`;
    const { output } = await captureTask(command, cwd);

    if (mode === 'timeline') {
      this.lastEvents = parseTimelineEvents(output);
      this.runState = { ...this.runState, running: false, error: this.lastEvents.length ? undefined : 'No trace events captured.' };
    } else {
      const parsed = parseProfileReport(output);
      this.lastReport = parsed;
      this.runState = { ...this.runState, running: false, error: parsed ? undefined : 'Could not parse the profile report.' };
    }
    this.render();
    this.updateStatusBar();
    this.changeEmitter.fire();
    if (this.runState.error) this.moduleContext.layout.showToast(this.runState.error, 'error');
  }

  /* ----- UI ----- */
  private reveal(): void {
    this.render();
    this.moduleContext.layout.setSideBar('Performance', this.view);
    this.moduleContext.layout.focusSideBar();
  }

  private updateStatusBar(): void {
    if (!this.statusBar) return;
    // Contextual (SB-2): show profiling PROGRESS only while a profile runs; the
    // captured report lives in the Performance workspace, not the status bar.
    if (!this.runState.running) {
      this.statusBar.removeItem('editor.perf');
      return;
    }
    this.statusBar.setItem('editor.perf', {
      text: `Profiling… (${this.runState.engine})`,
      tooltip: 'Performance profile in progress',
      command: CommandIds.PerfShow,
      side: 'right',
      priority: 22,
    });
  }

  private render(): void {
    if (!this.view) return;
    this.view.replaceChildren();

    const header = document.createElement('div');
    header.className = 'znxstudio-perf-header';
    header.textContent = 'Profiler';
    this.view.appendChild(header);

    const engineRow = document.createElement('div');
    engineRow.className = 'znxstudio-perf-engine';
    const label = document.createElement('span');
    label.textContent = 'Engine';
    const select = document.createElement('select');
    select.className = 'znxstudio-select';
    select.setAttribute('aria-label', 'Execution engine');
    for (const engine of ['interpreter', 'vm'] as const) {
      const option = document.createElement('option');
      option.value = engine;
      option.textContent = engine;
      option.selected = this.runState.engine === engine;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      this.runState = { ...this.runState, engine: select.value as 'interpreter' | 'vm' };
    });
    engineRow.append(label, select);
    this.view.appendChild(engineRow);

    const modes: { label: string; mode: ProfileMode }[] = [
      { label: '⚡ Profile CPU', mode: this.runState.engine === 'vm' ? 'vm-run' : 'run' },
      { label: 'Profile Allocations', mode: 'allocations' },
      { label: 'Profile Heap', mode: 'heap' },
      { label: '⏱ Profile Timeline', mode: 'timeline' },
    ];
    for (const { label: text, mode } of modes) {
      const button = document.createElement('button');
      button.className = 'znxstudio-btn-small znxstudio-perf-action';
      button.textContent = this.runState.running ? 'Profiling…' : text;
      button.disabled = this.runState.running;
      button.addEventListener('click', () => void this.profile(mode));
      this.view.appendChild(button);
    }

    const report = this.lastReport;
    const summary = document.createElement('div');
    summary.className = 'znxstudio-perf-summary';
    if (report) {
      summary.textContent = `${report.engine} · ${report.totalSamples} samples · ${report.totalCalls} calls · ${report.totalAllocations} allocations`;
    } else if (this.lastEvents.length) {
      summary.textContent = `${this.lastEvents.length} trace events captured`;
    } else {
      summary.textContent = 'Open a .zx program and profile it. Results appear in the CPU / Memory / Timeline / Hotspots / Allocations panels.';
    }
    this.view.appendChild(summary);

    if (report?.truncated || report?.notes.length) {
      const notes = document.createElement('div');
      notes.className = 'znxstudio-perf-notes';
      notes.textContent = [report.truncated ? 'Output truncated (raise --max-samples/--max-events).' : '', ...report.notes].filter(Boolean).join(' ');
      this.view.appendChild(notes);
    }
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
    if (!enabled || !tempDir) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    try {
      const compiler = this.moduleContext.services.tryGet<CompilerService>(ServiceKeys.Compiler);
      const info = compiler ? await compiler.info() : null;
      if (!info?.available || !info.path) {
        log('perf REAL: compiler unavailable — skipped');
        return;
      }
      const file = joinPath(tempDir, 'znxstudio-perf-selftest.zx');
      await window.znxstudio.fs.writeFile(
        file,
        'function compute_rate with n\n    create total = 0\n    create i = 0\n    while i is less than n\n        total = total + i * 2\n        i = i + 1\n    end\n    give back total\nend\n\nfunction calculate_tax with amount\n    give back compute_rate(amount) * 2\nend\n\nshow calculate_tax(20000)\n',
      );
      const quote = (a: string) => (a.includes(' ') ? `"${a}"` : a);
      const run = (args: string[]) => captureTask(`"${info.path}" ${args.map(quote).join(' ')}`, tempDir);
      const version = (await captureTask(`"${info.path}" --version`, tempDir)).output.trim();
      log(`perf REAL compiler: ${version} (profiling needs >= 1.0.0-rc.2; stacks/timestamps/gc need >= rc.4)`);

      const cpu = parseProfileReport((await run(buildProfileArgs('run', file, { json: true, gcStats: true }))).output);
      const alloc = parseProfileReport((await run(buildProfileArgs('allocations', file, { json: true, allocationStacks: true, gcStats: true }))).output);
      const bare = parseProfileReport((await run(buildProfileArgs('allocations', file, { json: true }))).output);
      const heap = parseProfileReport((await run(buildProfileArgs('heap', file, { json: true }))).output);
      const events = parseTimelineEvents((await run(buildProfileArgs('timeline', file, { json: true, trace: 'all', timestamps: true }))).output);

      const hottest = cpu?.hotSpots[0];
      log(`perf REAL cpu: engine=${cpu?.engine} samples=${cpu?.totalSamples} hottest=${hottest?.name}@${hottest?.percent}% hotLines=${cpu?.hotLines.length}`);
      log(`perf REAL alloc: total=${alloc?.totalAllocations} topType=${alloc?.allocations[0]?.type}x${alloc?.allocations[0]?.count}`);
      log(`perf REAL heap: objects=${heap?.heap?.totalObjects} maxDepth=${heap?.heap?.maxDepth} types=${heap?.heap?.types.length}`);

      // rc.4 gap-closers, each proved against the real binary AND proved absent
      // without its flag, so the "not captured" path is real too.
      const site = alloc ? topAllocationSites(alloc, 1)[0] : undefined;
      log(
        `perf REAL rc.4 allocation stacks: sites=${alloc?.allocationSites.length} ` +
          `top=${site ? `${site.type}x${site.count} via ${formatStack(site.stack)}` : 'none'} · ` +
          `without the flag sites=${bare?.allocationSites.length} (expect 0) hasStacks=${bare ? hasAllocationStacks(bare) : 'n/a'}`,
      );
      log(`perf REAL rc.4 gc: ${gcSummary(alloc ?? emptyReport()) ?? 'none'} · without the flag gc=${bare?.gc}`);
      log(
        `perf REAL rc.4 timestamps: hasTimestamps=${hasTimestamps(events)} ` +
          `duration=${traceDurationMicroseconds(events)}µs over ${events.length} events`,
      );
      log(`perf REAL timeline: events=${events.length} kinds=${[...new Set(events.map((e) => e.kind))].join('/')} maxDepth=${Math.max(0, ...events.map((e) => e.depth))}`);
    } catch (error) {
      log(`perf REAL failed: ${(error as Error).message}`);
    }
  }
}
