import { Emitter, type Event } from '../core/Emitter';
import type {
  InspectedComponent,
  NavigationStackEntry,
  SimulatorEvent,
  SimulatorEventType,
  StorageEntry,
} from '../../shared/simulatorTypes';
import type { SimulatorRuntime } from './SimulatorRuntime';
import type { SimulatorRenderer } from './SimulatorRenderer';
import type { NetworkEntry, RequestOverride } from './SimulatorNetworkInspector';
import type { StateHistoryEntry, TimeTravelSnapshot } from './SimulatorStateDebugger';
import type { AccessibilityIssue } from './SimulatorAccessibility';
import type { ResponsiveDiagnostic } from './SimulatorResponsive';
import type { PerformanceMetric, RenderTrace } from './SimulatorPerformance';
import type { CapabilityRegistryEntry, ComponentRegistryEntry } from './SimulatorRegistry';

interface TreeNode {
  id: string;
  kind: string;
  childCount: number;
  children: TreeNode[];
}

export type InspectorPanel =
  | 'components'
  | 'state'
  | 'network'
  | 'performance'
  | 'accessibility'
  | 'responsive'
  | 'timeline'
  | 'registry';

export class SimulatorInspector {
  private readonly runtime: SimulatorRuntime;
  private readonly renderer: SimulatorRenderer;
  private selectedNodeId: string | null = null;
  private activePanel: InspectorPanel = 'components';

  private readonly _onDidSelect = new Emitter<InspectedComponent | null>();
  readonly onDidSelect: Event<InspectedComponent | null> = this._onDidSelect.event;

  private readonly _onDidUpdate = new Emitter<void>();
  readonly onDidUpdate: Event<void> = this._onDidUpdate.event;

  private readonly _onPanelChange = new Emitter<InspectorPanel>();
  readonly onPanelChange: Event<InspectorPanel> = this._onPanelChange.event;

  constructor(runtime: SimulatorRuntime, renderer: SimulatorRenderer) {
    this.runtime = runtime;
    this.renderer = renderer;
  }

  setPanel(panel: InspectorPanel): void {
    this.activePanel = panel;
    this._onPanelChange.fire(panel);
  }

  getPanel(): InspectorPanel {
    return this.activePanel;
  }

  select(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    if (nodeId) {
      this.renderer.highlightNode(nodeId);
      const inspected = this.renderer.inspectNode(nodeId);
      this._onDidSelect.fire(inspected);
    } else {
      this.renderer.clearHighlight();
      this._onDidSelect.fire(null);
    }
  }

  getSelected(): InspectedComponent | null {
    if (!this.selectedNodeId) return null;
    return this.renderer.inspectNode(this.selectedNodeId);
  }

  getComponentTree(): { screen: string; nodes: TreeNode[] }[] {
    const screens = this.runtime.allScreens();
    return screens.map((screen) => ({
      screen: screen.name,
      nodes: screen.rootChildren.map((node) => this.buildTreeNode(node)),
    }));
  }

  getStateSnapshot(): { screen: Record<string, unknown>; app: Record<string, unknown> } {
    return this.runtime.stateStore.snapshot();
  }

  getNavigationStack(): NavigationStackEntry[] {
    return this.runtime.navigation.stack();
  }

  getEventLog(type?: SimulatorEventType, count?: number): SimulatorEvent[] {
    if (type) {
      return this.runtime.eventLog.filter(type);
    }
    return this.runtime.eventLog.recent(count ?? 100);
  }

  getStorageEntries(): StorageEntry[] {
    return this.runtime.storage.allEntries();
  }

  getDiagnostics() {
    return this.runtime.diagnostics.all();
  }

  getPermissions() {
    return this.runtime.permissions.allPermissions();
  }

  navigateToSource(nodeId: string): { file: string; line: number } | null {
    const node = this.runtime.findNode(nodeId);
    if (!node?.sourceLocation) return null;
    return { file: node.sourceLocation.file, line: node.sourceLocation.startLine };
  }

  // --- Phase 3: Network Inspector panel ---

  getNetworkEntries(): readonly NetworkEntry[] {
    return this.runtime.networkInspector.getEntries();
  }

  getNetworkEntry(id: number): NetworkEntry | undefined {
    return this.runtime.networkInspector.getEntry(id);
  }

  getNetworkOverrides(): readonly RequestOverride[] {
    return this.runtime.networkInspector.getOverrides();
  }

  addNetworkOverride(override: Omit<RequestOverride, 'id'>): string {
    return this.runtime.networkInspector.addOverride(override);
  }

  removeNetworkOverride(id: string): void {
    this.runtime.networkInspector.removeOverride(id);
  }

  clearNetworkEntries(): void {
    this.runtime.networkInspector.clear();
  }

  // --- Phase 3: State Debugger panel ---

  getStateHistory(count?: number): readonly StateHistoryEntry[] {
    return this.runtime.stateDebugger.getHistory(count);
  }

  searchStateHistory(query: string): StateHistoryEntry[] {
    return this.runtime.stateDebugger.searchHistory(query);
  }

  getStateWatches(): string[] {
    return this.runtime.stateDebugger.getWatches();
  }

  addStateWatch(key: string): void {
    this.runtime.stateDebugger.addWatch(key);
  }

  removeStateWatch(key: string): void {
    this.runtime.stateDebugger.removeWatch(key);
  }

  getWatchValues(): Record<string, unknown> {
    return this.runtime.stateDebugger.getWatchValues();
  }

  safeEditState(key: string, value: unknown): void {
    this.runtime.stateDebugger.safeEdit(key, value);
  }

  getStateOverrides(): string[] {
    return this.runtime.stateDebugger.getOverrides();
  }

  takeSnapshot(label?: string): number {
    return this.runtime.stateDebugger.takeSnapshot(label);
  }

  getSnapshots(): readonly TimeTravelSnapshot[] {
    return this.runtime.stateDebugger.getSnapshots();
  }

  travelTo(snapshotId: number): boolean {
    return this.runtime.stateDebugger.travelTo(snapshotId);
  }

  returnToLive(): boolean {
    return this.runtime.stateDebugger.returnToLive();
  }

  // --- Phase 3: Accessibility panel ---

  runAccessibilityAudit(): AccessibilityIssue[] {
    const screen = this.runtime.currentScreenModel();
    if (!screen) return [];
    return this.runtime.accessibility.audit(screen);
  }

  // --- Phase 3: Responsive panel ---

  runResponsiveAnalysis(): ResponsiveDiagnostic[] {
    const screen = this.runtime.currentScreenModel();
    if (!screen) return [];
    const env = this.runtime.environmentModel.get();
    return this.runtime.responsive.analyze(screen, env.device.width, env.device.height);
  }

  // --- Phase 3: Performance panel ---

  getPerformanceMetrics(): PerformanceMetric[] {
    return this.runtime.perf.getMetrics();
  }

  getRenderTraces(): RenderTrace[] {
    return this.runtime.perf.getTraces();
  }

  getPerformanceSummary(): Record<string, { avg: number; max: number; count: number; unit: string }> {
    return this.runtime.perf.getSummary();
  }

  getRenderCount(): number {
    return this.runtime.perf.getRenderCount();
  }

  // --- Phase 3: Registry panel ---

  getCapabilityRegistry(): readonly CapabilityRegistryEntry[] {
    return this.runtime.registry.allCapabilities();
  }

  getComponentRegistry(): readonly ComponentRegistryEntry[] {
    return this.runtime.registry.allComponents();
  }

  getRegistryCounts(): { supported: number; partial: number; androidOnly: number } {
    return this.runtime.registry.counts();
  }

  // --- Phase 3: Clock controls ---

  freezeClock(at?: number): void {
    this.runtime.clock.freeze(at);
  }

  resumeClock(): void {
    this.runtime.clock.setRealtime();
  }

  advanceClock(ms: number): void {
    this.runtime.clock.advance(ms);
  }

  getClockMode(): string {
    return this.runtime.clock.mode();
  }

  getClockTime(): number {
    return this.runtime.clock.now();
  }

  dispose(): void {
    this._onDidSelect.dispose();
    this._onDidUpdate.dispose();
    this._onPanelChange.dispose();
  }

  private buildTreeNode(node: { id: string; kind: string; children: typeof node[] }): TreeNode {
    const children = node.children.map((child) => this.buildTreeNode(child));
    return {
      id: node.id,
      kind: node.kind,
      childCount: node.children.length,
      children,
    };
  }
}
