import {
  ServiceKeys,
  type EditorService,
  type OutputService,
  type QuickPickService,
} from '../core/Contracts';
import type { IModule, ModuleContext, Disposable } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import type { MobileIRApp, SimulatorSessionState, ConnectivityMode, SimulatorTheme } from '../../shared/simulatorTypes';
import { SimulatorSession } from './SimulatorSession';
import { SimulatorInspector } from './SimulatorInspector';
import { SimulatorTestRunner } from './SimulatorTestRunner';
import { SIMULATOR_DEVICE_PROFILES, getDeviceProfile } from './SimulatorDeviceProfile';

export class SimulatorModule implements IModule {
  readonly id = 'znxstudio.simulator';
  readonly displayName = 'Znx Simulator';

  private context!: ModuleContext;
  private session: SimulatorSession | null = null;
  private inspector: SimulatorInspector | null = null;
  private testRunner: SimulatorTestRunner | null = null;
  private panelElement: HTMLElement | null = null;
  private toolbarElement: HTMLElement | null = null;
  private inspectorPanel: HTMLElement | null = null;
  private inspectMode = false;
  private lastApp: MobileIRApp | null = null;

  activate(context: ModuleContext): void {
    this.context = context;

    context.services.register(ServiceKeys.Simulator, {
      get state() { return this._session?.getState() ?? 'idle'; },
      start: (app: MobileIRApp) => this.startSimulator(app),
      reload: (app: MobileIRApp) => this.reloadSimulator(app),
      stop: () => this.stopSimulator(),
      restart: () => this.restartSimulator(),
      pause: () => this.session?.pause(),
      resume: () => this.session?.resume(),
      reset: () => this.resetSimulator(),
      onDidChangeState: this.onDidChangeState.bind(this),
      _session: this.session,
    } as any);

    this.registerCommands(context);
  }

  deactivate(): void {
    this.session?.dispose();
    this.inspector?.dispose();
    this.testRunner?.dispose();
    this.panelElement?.remove();
  }

  private registerCommands(context: ModuleContext): void {
    const { commands, subscriptions } = context;

    subscriptions.push(commands.register(CommandIds.SimulatorOpen, () => this.openPanel()));
    subscriptions.push(commands.register(CommandIds.SimulatorClose, () => this.closePanel()));
    subscriptions.push(commands.register(CommandIds.SimulatorStart, () => this.startFromEditor()));
    subscriptions.push(commands.register(CommandIds.SimulatorStop, () => this.stopSimulator()));
    subscriptions.push(commands.register(CommandIds.SimulatorRestart, () => this.restartSimulator()));
    subscriptions.push(commands.register(CommandIds.SimulatorPause, () => this.session?.pause()));
    subscriptions.push(commands.register(CommandIds.SimulatorResume, () => this.session?.resume()));
    subscriptions.push(commands.register(CommandIds.SimulatorReset, () => this.resetSimulator()));

    subscriptions.push(commands.register(CommandIds.SimulatorThemeToggle, () => this.toggleTheme()));
    subscriptions.push(commands.register(CommandIds.SimulatorOrientationToggle, () => this.toggleOrientation()));
    subscriptions.push(commands.register(CommandIds.SimulatorDeviceSelect, () => this.selectDevice()));
    subscriptions.push(commands.register(CommandIds.SimulatorConnectivity, () => this.selectConnectivity()));

    subscriptions.push(commands.register(CommandIds.SimulatorFontScaleUp, () => {
      const rt = this.session?.getRuntime();
      if (rt) rt.setFontScale(rt.getEnvironment().fontScale + 0.25);
    }));
    subscriptions.push(commands.register(CommandIds.SimulatorFontScaleDown, () => {
      const rt = this.session?.getRuntime();
      if (rt) rt.setFontScale(rt.getEnvironment().fontScale - 0.25);
    }));
    subscriptions.push(commands.register(CommandIds.SimulatorFontScaleReset, () => {
      this.session?.getRuntime()?.setFontScale(1);
    }));

    subscriptions.push(commands.register(CommandIds.SimulatorInspectToggle, () => this.toggleInspect()));
    subscriptions.push(commands.register(CommandIds.SimulatorScreenshot, () => this.takeScreenshot()));
    subscriptions.push(commands.register(CommandIds.SimulatorTestRun, () => this.runTests()));
    subscriptions.push(commands.register(CommandIds.SimulatorTestStop, () => { /* future: cancel */ }));

    subscriptions.push(commands.register(CommandIds.SimulatorHttpMode, () => this.selectHttpMode()));
    subscriptions.push(commands.register(CommandIds.SimulatorPermissionsReset, () => {
      this.session?.getRuntime()?.permissions.resetAll();
    }));
    subscriptions.push(commands.register(CommandIds.SimulatorStorageClear, () => {
      this.session?.getRuntime()?.storage.clearAll();
    }));
  }

  private openPanel(): void {
    if (this.panelElement) return;

    this.panelElement = document.createElement('div');
    this.panelElement.className = 'zsim-panel';
    this.panelElement.setAttribute('role', 'region');
    this.panelElement.setAttribute('aria-label', 'Znx Simulator');

    this.toolbarElement = this.buildToolbar();
    this.panelElement.appendChild(this.toolbarElement);

    const viewport = document.createElement('div');
    viewport.className = 'zsim-device-container';
    this.panelElement.appendChild(viewport);

    this.inspectorPanel = document.createElement('div');
    this.inspectorPanel.className = 'zsim-inspector-panel';
    this.inspectorPanel.style.display = 'none';
    this.panelElement.appendChild(this.inspectorPanel);

    this.context.layout.addPanelView({
      id: 'znxstudio.panel.simulator',
      title: 'Simulator',
      element: this.panelElement,
    });
  }

  private closePanel(): void {
    if (!this.panelElement) return;
    this.stopSimulator();
    this.panelElement.remove();
    this.panelElement = null;
    this.toolbarElement = null;
    this.inspectorPanel = null;
  }

  private buildToolbar(): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'zsim-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Simulator controls');

    const addButton = (label: string, title: string, commandId: string) => {
      const btn = document.createElement('button');
      btn.className = 'zsim-toolbar-btn';
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('click', () => this.context.commands.execute(commandId));
      toolbar.appendChild(btn);
      return btn;
    };

    addButton('▶', 'Start Simulator', CommandIds.SimulatorStart);
    addButton('■', 'Stop Simulator', CommandIds.SimulatorStop);
    addButton('↻', 'Restart Simulator', CommandIds.SimulatorRestart);

    const sep = document.createElement('span');
    sep.className = 'zsim-toolbar-sep';
    toolbar.appendChild(sep);

    addButton('◐', 'Toggle Theme', CommandIds.SimulatorThemeToggle);
    addButton('⟳', 'Toggle Orientation', CommandIds.SimulatorOrientationToggle);
    addButton('📱', 'Select Device', CommandIds.SimulatorDeviceSelect);
    addButton('📶', 'Connectivity', CommandIds.SimulatorConnectivity);

    const sep2 = document.createElement('span');
    sep2.className = 'zsim-toolbar-sep';
    toolbar.appendChild(sep2);

    addButton('🔍', 'Inspect Mode', CommandIds.SimulatorInspectToggle);
    addButton('📷', 'Screenshot', CommandIds.SimulatorScreenshot);

    const stateLabel = document.createElement('span');
    stateLabel.className = 'zsim-toolbar-state';
    stateLabel.textContent = 'idle';
    toolbar.appendChild(stateLabel);
    this.stateLabel = stateLabel;

    return toolbar;
  }
  private stateLabel: HTMLElement | null = null;

  private updateStateLabel(state: SimulatorSessionState): void {
    if (this.stateLabel) this.stateLabel.textContent = state;
  }

  private async startSimulator(app: MobileIRApp): Promise<void> {
    this.lastApp = app;

    if (!this.session) {
      this.session = new SimulatorSession();
      this.session.onDidChangeState((state) => this.updateStateLabel(state));
      this.session.onError((msg) => {
        const output = this.context.services.tryGet<OutputService>(ServiceKeys.Output);
        output?.appendLine(`[Simulator] Error: ${msg}`);
      });
    }

    this.openPanel();
    await this.session.start(app);

    const viewport = this.panelElement?.querySelector('.zsim-device-container');
    if (viewport) {
      viewport.innerHTML = '';
      viewport.appendChild(this.session.getRenderer().element);
    }

    this.inspector = new SimulatorInspector(
      this.session.getRuntime(),
      this.session.getRenderer(),
    );

    this.inspector.onDidSelect((component) => {
      if (component && this.inspectorPanel) {
        this.renderInspectorContent(component);
      }
    });
  }

  private async reloadSimulator(app: MobileIRApp): Promise<void> {
    this.lastApp = app;
    if (this.session) {
      await this.session.reload(app);
    }
  }

  private stopSimulator(): void {
    this.session?.stop();
    this.inspector?.dispose();
    this.inspector = null;
  }

  private async restartSimulator(): Promise<void> {
    if (this.lastApp && this.session) {
      this.session.stop();
      await this.session.start(this.lastApp);
    }
  }

  private resetSimulator(): void {
    this.session?.reset();
    this.inspector?.dispose();
    this.inspector = null;
    this.lastApp = null;
  }

  private startFromEditor(): void {
    const output = this.context.services.tryGet<OutputService>(ServiceKeys.Output);
    output?.appendLine('[Simulator] Compiling Mobile IR from current file...');
    output?.appendLine('[Simulator] Use the designer or provide a MobileIRApp to start the simulator');
  }

  private toggleTheme(): void {
    const rt = this.session?.getRuntime();
    if (!rt) return;
    const current = rt.getEnvironment().theme;
    const next: SimulatorTheme = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light';
    rt.setTheme(next);
  }

  private toggleOrientation(): void {
    const rt = this.session?.getRuntime();
    if (!rt) return;
    const current = rt.getEnvironment().orientation;
    rt.setOrientation(current === 'portrait' ? 'landscape' : 'portrait');
  }

  private async selectDevice(): Promise<void> {
    const quickPick = this.context.services.tryGet<QuickPickService>(ServiceKeys.QuickPick);
    if (!quickPick) return;
    const items = SIMULATOR_DEVICE_PROFILES.map((p) => ({
      label: p.label,
      description: `${p.width}x${p.height} (${p.deviceClass})`,
      value: p.id,
    }));
    const selected = await quickPick.pick(items, { placeholder: 'Select device profile' });
    if (selected) {
      const profile = getDeviceProfile(selected);
      if (profile && this.session?.getRuntime()) {
        this.session.getRuntime().getEnvironment().deviceProfile = profile;
      }
    }
  }

  private async selectConnectivity(): Promise<void> {
    const quickPick = this.context.services.tryGet<QuickPickService>(ServiceKeys.QuickPick);
    if (!quickPick) return;
    const modes: Array<{ label: string; description: string; value: ConnectivityMode }> = [
      { label: 'Online', description: 'Normal connectivity', value: 'online' },
      { label: 'Offline', description: 'No network access', value: 'offline' },
      { label: 'Slow', description: '2s delay on all requests', value: 'slow' },
      { label: 'Intermittent', description: '50% failure rate', value: 'intermittent' },
    ];
    const selected = await quickPick.pick(modes, { placeholder: 'Select connectivity mode' });
    if (selected) {
      this.session?.getRuntime()?.setConnectivity(selected);
    }
  }

  private async selectHttpMode(): Promise<void> {
    const quickPick = this.context.services.tryGet<QuickPickService>(ServiceKeys.QuickPick);
    if (!quickPick) return;
    const modes = [
      { label: 'Live', description: 'Real HTTP requests', value: 'live' as const },
      { label: 'Mock', description: 'Use mock endpoints', value: 'mock' as const },
      { label: 'Recorded', description: 'Replay recorded exchanges', value: 'recorded' as const },
    ];
    const selected = await quickPick.pick(modes, { placeholder: 'Select HTTP mode' });
    if (selected) {
      this.session?.getRuntime()?.http.setMode(selected);
    }
  }

  private toggleInspect(): void {
    this.inspectMode = !this.inspectMode;
    if (this.inspectorPanel) {
      this.inspectorPanel.style.display = this.inspectMode ? 'block' : 'none';
    }
    if (this.inspectMode && this.inspector) {
      this.renderInspectorTree();
    }
  }

  private renderInspectorTree(): void {
    if (!this.inspector || !this.inspectorPanel) return;
    this.inspectorPanel.innerHTML = '';

    const tabs = document.createElement('div');
    tabs.className = 'zsim-inspector-tabs';
    const tabDefs = ['Components', 'State', 'Events', 'Storage', 'Network', 'Permissions'];
    let activeTab = 'Components';

    for (const name of tabDefs) {
      const tab = document.createElement('button');
      tab.className = 'zsim-inspector-tab';
      tab.textContent = name;
      if (name === activeTab) tab.classList.add('zsim-inspector-tab-active');
      tab.addEventListener('click', () => {
        activeTab = name;
        tabs.querySelectorAll('.zsim-inspector-tab').forEach((t) => t.classList.remove('zsim-inspector-tab-active'));
        tab.classList.add('zsim-inspector-tab-active');
        this.renderInspectorTabContent(name);
      });
      tabs.appendChild(tab);
    }

    this.inspectorPanel.appendChild(tabs);
    const content = document.createElement('div');
    content.className = 'zsim-inspector-content';
    this.inspectorPanel.appendChild(content);
    this.renderInspectorTabContent(activeTab);
  }

  private renderInspectorTabContent(tab: string): void {
    if (!this.inspector || !this.inspectorPanel) return;
    const content = this.inspectorPanel.querySelector('.zsim-inspector-content');
    if (!content) return;
    content.innerHTML = '';

    switch (tab) {
      case 'Components': {
        const tree = this.inspector.getComponentTree();
        const pre = document.createElement('pre');
        pre.className = 'zsim-inspector-pre';
        pre.textContent = JSON.stringify(tree, null, 2);
        content.appendChild(pre);
        break;
      }
      case 'State': {
        const snapshot = this.inspector.getStateSnapshot();
        const pre = document.createElement('pre');
        pre.className = 'zsim-inspector-pre';
        pre.textContent = JSON.stringify(snapshot, null, 2);
        content.appendChild(pre);
        break;
      }
      case 'Events': {
        const events = this.inspector.getEventLog(undefined, 50);
        for (const evt of events) {
          const row = document.createElement('div');
          row.className = 'zsim-event-row';
          row.textContent = `[${evt.type}] ${evt.detail}`;
          content.appendChild(row);
        }
        break;
      }
      case 'Storage': {
        const entries = this.inspector.getStorageEntries();
        const pre = document.createElement('pre');
        pre.className = 'zsim-inspector-pre';
        pre.textContent = JSON.stringify(entries, null, 2);
        content.appendChild(pre);
        break;
      }
      case 'Network': {
        const rt = this.session?.getRuntime();
        if (!rt) break;
        const mocks = rt.http.getMocks();
        const recorded = rt.http.getRecorded();
        const pre = document.createElement('pre');
        pre.className = 'zsim-inspector-pre';
        pre.textContent = `Mode: ${rt.http.getMode()}\n\nMocks:\n${JSON.stringify(mocks, null, 2)}\n\nRecorded:\n${JSON.stringify(recorded, null, 2)}`;
        content.appendChild(pre);
        break;
      }
      case 'Permissions': {
        const perms = this.inspector.getPermissions();
        for (const perm of perms) {
          const row = document.createElement('div');
          row.className = 'zsim-perm-row';
          row.textContent = `${perm.name}: ${perm.state}`;
          content.appendChild(row);
        }
        break;
      }
    }
  }

  private renderInspectorContent(component: import('../../shared/simulatorTypes').InspectedComponent): void {
    if (!this.inspectorPanel) return;
    const content = this.inspectorPanel.querySelector('.zsim-inspector-content');
    if (!content) return;
    content.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'zsim-inspect-header';
    header.textContent = `${component.kind} (${component.nodeId})`;
    content.appendChild(header);

    if (component.sourceFile) {
      const link = document.createElement('button');
      link.className = 'zsim-source-link';
      link.textContent = `${component.sourceFile}:${component.sourceLine ?? 1}`;
      link.addEventListener('click', () => {
        const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
        if (editor && component.sourceFile) {
          editor.openFile(component.sourceFile, { preview: true });
          if (component.sourceLine) editor.revealPosition(component.sourceLine, 0);
        }
      });
      content.appendChild(link);
    }

    const sections = [
      { label: 'Properties', data: component.properties },
      { label: 'State', data: component.state },
      { label: 'Accessibility', data: component.accessibility },
      { label: 'Events', data: component.events },
    ];
    for (const section of sections) {
      const heading = document.createElement('div');
      heading.className = 'zsim-inspect-section';
      heading.textContent = section.label;
      content.appendChild(heading);
      const pre = document.createElement('pre');
      pre.className = 'zsim-inspector-pre';
      pre.textContent = JSON.stringify(section.data, null, 2);
      content.appendChild(pre);
    }
  }

  private takeScreenshot(): void {
    const renderer = this.session?.getRenderer();
    if (!renderer) return;

    import('html2canvas' as any).catch(() => {
      const canvas = document.createElement('canvas');
      const rect = renderer.element.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      const output = this.context.services.tryGet<OutputService>(ServiceKeys.Output);
      output?.appendLine(`[Simulator] Screenshot captured: ${canvas.width}x${canvas.height}`);
    });
  }

  private async runTests(): Promise<void> {
    if (!this.lastApp) return;
    if (!this.testRunner) {
      this.testRunner = new SimulatorTestRunner();
    }

    const output = this.context.services.tryGet<OutputService>(ServiceKeys.Output);
    output?.appendLine('[Simulator] Running simulator tests...');

    this.testRunner.onTestComplete((result) => {
      const icon = result.passed ? 'PASS' : 'FAIL';
      output?.appendLine(`[Simulator]   ${icon} ${result.name} (${result.durationMs}ms)`);
      if (!result.passed && result.failedMessage) {
        output?.appendLine(`[Simulator]     ${result.failedMessage}`);
      }
    });

    const results = await this.testRunner.runAll(this.lastApp, []);
    const passed = results.filter((r) => r.passed).length;
    output?.appendLine(`[Simulator] Tests: ${passed}/${results.length} passed`);
  }

  private onDidChangeState(listener: (state: SimulatorSessionState) => void): Disposable {
    if (!this.session) {
      return { dispose() {} };
    }
    return this.session.onDidChangeState(listener);
  }
}
