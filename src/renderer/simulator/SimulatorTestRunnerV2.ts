import { Emitter, type Event } from '../core/Emitter';
import type {
  MobileIRApp,
  MobileIRNode,
  SimulatorTestResult,
  SimulatorEvent,
  MockEndpoint,
  PermissionState,
  LocationConfig,
  BiometricResult,
  CameraMode,
  ConnectivityMode,
} from '../../shared/simulatorTypes';
import { SimulatorRuntime } from './SimulatorRuntime';
import type { SimulatorClock } from './SimulatorClock';
import type { SimulatorScreenshot } from './SimulatorScreenshot';

export type TestStepV2 =
  | { action: 'launch' }
  | { action: 'stop' }
  | { action: 'restart' }
  | { action: 'openScreen'; screen: string }
  | { action: 'tap'; query: string }
  | { action: 'doubleTap'; query: string }
  | { action: 'longPress'; query: string }
  | { action: 'swipe'; query: string; direction: 'left' | 'right' | 'up' | 'down' }
  | { action: 'drag'; query: string; dx: number; dy: number }
  | { action: 'enterText'; query: string; text: string }
  | { action: 'clearText'; query: string }
  | { action: 'select'; query: string; value: string }
  | { action: 'toggle'; query: string }
  | { action: 'scroll'; direction: 'up' | 'down'; amount?: number }
  | { action: 'wait'; ms: number }
  | { action: 'advanceTime'; ms: number }
  | { action: 'expectText'; query: string; text: string }
  | { action: 'expectState'; key: string; value: unknown }
  | { action: 'expectVisible'; query: string; visible: boolean }
  | { action: 'expectHidden'; query: string }
  | { action: 'expectEnabled'; query: string; enabled: boolean }
  | { action: 'expectDisabled'; query: string }
  | { action: 'expectScreen'; screen: string }
  | { action: 'expectNavigationStack'; screens: string[] }
  | { action: 'expectRequest'; method: string; urlContains: string }
  | { action: 'expectResponse'; status: number; urlContains: string }
  | { action: 'setPermission'; name: string; state: PermissionState }
  | { action: 'setLocation'; config: LocationConfig }
  | { action: 'setBiometric'; result: BiometricResult }
  | { action: 'setCamera'; mode: CameraMode }
  | { action: 'setNetwork'; mode: ConnectivityMode }
  | { action: 'mockHttp'; endpoint: MockEndpoint }
  | { action: 'captureSnapshot'; name: string }
  | { action: 'compareSnapshot'; name: string; tolerance?: number };

export interface TestCaseV2 {
  name: string;
  steps: TestStepV2[];
  tags?: string[];
}

export interface TestFailureDetail {
  test: string;
  step: number;
  stepAction: string;
  expected: string;
  actual: string;
  currentScreen: string;
  component: string;
  sourceFile: string;
  sourceLine: number;
  relevantState: Record<string, unknown>;
  lastEvents: SimulatorEvent[];
}

export interface TestResultV2 extends SimulatorTestResult {
  failureDetail?: TestFailureDetail;
}

export interface TestReport {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  results: TestResultV2[];
}

export class SimulatorTestRunnerV2 {
  private readonly clock: SimulatorClock;
  private readonly screenshot: SimulatorScreenshot | null;

  private readonly _onTestStart = new Emitter<string>();
  readonly onTestStart: Event<string> = this._onTestStart.event;
  private readonly _onTestComplete = new Emitter<TestResultV2>();
  readonly onTestComplete: Event<TestResultV2> = this._onTestComplete.event;
  private readonly _onAllComplete = new Emitter<TestReport>();
  readonly onAllComplete: Event<TestReport> = this._onAllComplete.event;

  constructor(clock: SimulatorClock, screenshot?: SimulatorScreenshot) {
    this.clock = clock;
    this.screenshot = screenshot ?? null;
  }

  async runAll(app: MobileIRApp, tests: TestCaseV2[]): Promise<TestReport> {
    const startTime = performance.now();
    const results: TestResultV2[] = [];

    for (const test of tests) {
      const runtime = new SimulatorRuntime();
      try {
        this.clock.freeze();
        const result = await this.runOne(runtime, app, test);
        results.push(result);
      } finally {
        runtime.dispose();
        this.clock.setRealtime();
      }
    }

    const report: TestReport = {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      skipped: 0,
      duration: performance.now() - startTime,
      results,
    };
    this._onAllComplete.fire(report);
    return report;
  }

  async runOne(runtime: SimulatorRuntime, app: MobileIRApp, test: TestCaseV2): Promise<TestResultV2> {
    this._onTestStart.fire(test.name);
    const startTime = performance.now();
    runtime.loadApp(app);

    let passed = true;
    let failedStep: number | undefined;
    let failedMessage: string | undefined;
    let failureDetail: TestFailureDetail | undefined;

    for (let i = 0; i < test.steps.length; i++) {
      try {
        await this.executeStep(runtime, app, test.steps[i]);
      } catch (err) {
        passed = false;
        failedStep = i;
        failedMessage = err instanceof Error ? err.message : String(err);
        const step = test.steps[i];
        const node = 'query' in step ? this.safeFind(runtime, (step as { query: string }).query) : null;
        failureDetail = {
          test: test.name,
          step: i,
          stepAction: step.action,
          expected: failedMessage,
          actual: this.describeActual(runtime, step),
          currentScreen: runtime.navigation.currentScreen(),
          component: node ? `${node.kind}#${node.id}` : '',
          sourceFile: node?.sourceLocation?.file ?? '',
          sourceLine: node?.sourceLocation?.startLine ?? 0,
          relevantState: this.redactState(runtime.stateStore.getAll()),
          lastEvents: runtime.eventLog.recent(10) as SimulatorEvent[],
        };
        break;
      }
    }

    const result: TestResultV2 = {
      name: test.name,
      passed,
      durationMs: performance.now() - startTime,
      ...(failedStep !== undefined ? { failedStep } : {}),
      ...(failedMessage ? { failedMessage } : {}),
      ...(failureDetail ? { failureDetail } : {}),
      events: [],
    };
    this._onTestComplete.fire(result);
    return result;
  }

  private async executeStep(runtime: SimulatorRuntime, app: MobileIRApp, step: TestStepV2): Promise<void> {
    switch (step.action) {
      case 'launch': runtime.loadApp(app); break;
      case 'stop': runtime.reset(); break;
      case 'restart': runtime.reset(); runtime.loadApp(app); break;
      case 'openScreen': runtime.navigation.navigate(step.screen); break;
      case 'tap': { const n = this.find(runtime, step.query); await this.fireTapped(runtime, n); break; }
      case 'doubleTap': { const n = this.find(runtime, step.query); await this.fireTapped(runtime, n); await this.fireTapped(runtime, n); break; }
      case 'longPress': { const n = this.find(runtime, step.query); const h = n.events.find(e => e.event === 'long_pressed'); if (h) await runtime.executeAction(h.body); break; }
      case 'swipe': {
        const n = this.find(runtime, step.query);
        const h = n.events.find(e => e.event === 'swiped');
        if (h) await runtime.executeAction(h.body);
        runtime.eventLog.log('gesture', `Swiped ${step.direction} on ${n.kind}`);
        break;
      }
      case 'drag': {
        const n = this.find(runtime, step.query);
        const h = n.events.find(e => e.event === 'dragged');
        if (h) await runtime.executeAction(h.body);
        runtime.eventLog.log('gesture', `Dragged on ${n.kind}`);
        break;
      }
      case 'enterText': {
        const n = this.find(runtime, step.query);
        const binding = String(n.properties.binding ?? '');
        if (binding) runtime.stateStore.set(binding, step.text);
        const h = n.events.find(e => e.event === 'changed');
        if (h) { runtime.stateStore.set('_value', step.text); await runtime.executeAction(h.body); }
        break;
      }
      case 'clearText': {
        const n = this.find(runtime, step.query);
        const binding = String(n.properties.binding ?? '');
        if (binding) runtime.stateStore.set(binding, '');
        break;
      }
      case 'select': {
        const n = this.find(runtime, step.query);
        const binding = String(n.properties.binding ?? '');
        if (binding) runtime.stateStore.set(binding, step.value);
        const h = n.events.find(e => e.event === 'changed');
        if (h) { runtime.stateStore.set('_value', step.value); await runtime.executeAction(h.body); }
        break;
      }
      case 'toggle': {
        const n = this.find(runtime, step.query);
        const binding = String(n.properties.binding ?? '');
        const current = binding ? runtime.stateStore.get(binding) : false;
        if (binding) runtime.stateStore.set(binding, !current);
        const h = n.events.find(e => e.event === 'toggled');
        if (h) { runtime.stateStore.set('_value', !current); await runtime.executeAction(h.body); }
        break;
      }
      case 'scroll': runtime.eventLog.log('lifecycle', `Scroll ${step.direction}`); break;
      case 'wait': this.clock.advance(step.ms); break;
      case 'advanceTime': this.clock.advance(step.ms); break;
      case 'expectText': {
        const n = this.find(runtime, step.query);
        const text = String(n.properties.content ?? n.properties.label ?? '');
        if (!text.includes(step.text)) throw new Error(`Expected "${step.text}" but found "${text}"`);
        break;
      }
      case 'expectState': {
        const val = runtime.stateStore.get(step.key);
        if (JSON.stringify(val) !== JSON.stringify(step.value)) throw new Error(`State "${step.key}": expected ${JSON.stringify(step.value)}, got ${JSON.stringify(val)}`);
        break;
      }
      case 'expectVisible': {
        const n = this.find(runtime, step.query);
        const vis = n.properties.visible !== false;
        if (vis !== step.visible) throw new Error(`Expected visible=${step.visible}, got ${vis}`);
        break;
      }
      case 'expectHidden': {
        const n = this.safeFind(runtime, step.query);
        if (n && n.properties.visible !== false) throw new Error(`Expected "${step.query}" hidden but it is visible`);
        break;
      }
      case 'expectEnabled': {
        const n = this.find(runtime, step.query);
        const en = n.properties.enabled !== false;
        if (en !== step.enabled) throw new Error(`Expected enabled=${step.enabled}, got ${en}`);
        break;
      }
      case 'expectDisabled': {
        const n = this.find(runtime, step.query);
        if (n.properties.enabled !== false) throw new Error(`Expected "${step.query}" disabled`);
        break;
      }
      case 'expectScreen': {
        if (runtime.navigation.currentScreen() !== step.screen) throw new Error(`Expected screen "${step.screen}", at "${runtime.navigation.currentScreen()}"`);
        break;
      }
      case 'expectNavigationStack': {
        const stack = runtime.navigation.stack().map(e => e.screen);
        if (JSON.stringify(stack) !== JSON.stringify(step.screens)) throw new Error(`Expected stack [${step.screens.join(',')}], got [${stack.join(',')}]`);
        break;
      }
      case 'expectRequest': {
        const events = runtime.eventLog.filter('http_request');
        const found = events.some(e => e.data?.method === step.method && String(e.data?.url ?? '').includes(step.urlContains));
        if (!found) throw new Error(`No ${step.method} request containing "${step.urlContains}"`);
        break;
      }
      case 'expectResponse': {
        const events = runtime.eventLog.filter('http_response');
        const found = events.some(e => e.data?.status === step.status && String(e.data?.url ?? '').includes(step.urlContains));
        if (!found) throw new Error(`No response with status ${step.status} for "${step.urlContains}"`);
        break;
      }
      case 'setPermission': runtime.permissions.setState(step.name, step.state); break;
      case 'setLocation': (runtime.capabilities.location as any).configure(step.config); break;
      case 'setBiometric': (runtime.capabilities.biometrics as any).setResult(step.result); break;
      case 'setCamera': (runtime.capabilities.camera as any).setMode(step.mode); break;
      case 'setNetwork': runtime.setConnectivity(step.mode); break;
      case 'mockHttp': runtime.http.addMock(step.endpoint); break;
      case 'captureSnapshot': break;
      case 'compareSnapshot': break;
    }
  }

  private find(runtime: SimulatorRuntime, query: string): MobileIRNode {
    const node = this.safeFind(runtime, query);
    if (!node) throw new Error(`Node not found: "${query}"`);
    return node;
  }

  private safeFind(runtime: SimulatorRuntime, query: string): MobileIRNode | null {
    for (const screen of runtime.allScreens()) {
      const found = this.searchNodes(screen.rootChildren, query);
      if (found) return found;
    }
    return null;
  }

  private searchNodes(nodes: MobileIRNode[], query: string): MobileIRNode | null {
    for (const node of nodes) {
      if (node.properties.testTag === query || node.kind === query || node.id === query) return node;
      const label = node.properties.label;
      if (typeof label === 'string' && label.includes(query)) return node;
      const content = node.properties.content;
      if (typeof content === 'string' && content.includes(query)) return node;
      const found = this.searchNodes(node.children, query);
      if (found) return found;
    }
    return null;
  }

  private async fireTapped(runtime: SimulatorRuntime, node: MobileIRNode): Promise<void> {
    const h = node.events.find(e => e.event === 'tapped');
    if (h) {
      runtime.eventLog.log('button_tapped', `Tapped: ${node.kind} (${node.id})`);
      await runtime.executeAction(h.body);
    }
  }

  private describeActual(runtime: SimulatorRuntime, step: TestStepV2): string {
    if ('query' in step) {
      const node = this.safeFind(runtime, (step as { query: string }).query);
      if (!node) return `node "${(step as { query: string }).query}" not found`;
      return `${node.kind}#${node.id}: content="${node.properties.content ?? ''}", label="${node.properties.label ?? ''}"`;
    }
    if (step.action === 'expectScreen') return `screen="${runtime.navigation.currentScreen()}"`;
    return '';
  }

  private redactState(state: Record<string, unknown>): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(state)) {
      const k = key.toLowerCase();
      if (k.includes('password') || k.includes('secret') || k.includes('token') || k.includes('apikey')) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = val;
      }
    }
    return redacted;
  }

  toJUnit(report: TestReport): string {
    const lines = [`<?xml version="1.0" encoding="UTF-8"?>`];
    lines.push(`<testsuite name="ZnxSimulator" tests="${report.total}" failures="${report.failed}" time="${(report.duration / 1000).toFixed(3)}">`);
    for (const r of report.results) {
      if (r.passed) {
        lines.push(`  <testcase name="${this.escapeXml(r.name)}" time="${(r.durationMs / 1000).toFixed(3)}" />`);
      } else {
        lines.push(`  <testcase name="${this.escapeXml(r.name)}" time="${(r.durationMs / 1000).toFixed(3)}">`);
        lines.push(`    <failure message="${this.escapeXml(r.failedMessage ?? '')}">${this.escapeXml(r.failedMessage ?? '')}</failure>`);
        lines.push(`  </testcase>`);
      }
    }
    lines.push('</testsuite>');
    return lines.join('\n');
  }

  toJSON(report: TestReport): string {
    return JSON.stringify({
      summary: { total: report.total, passed: report.passed, failed: report.failed, duration: report.duration },
      tests: report.results.map(r => ({
        name: r.name,
        passed: r.passed,
        duration: r.durationMs,
        ...(r.failedMessage ? { error: r.failedMessage } : {}),
        ...(r.failureDetail ? { detail: { step: r.failureDetail.step, expected: r.failureDetail.expected, actual: r.failureDetail.actual, screen: r.failureDetail.currentScreen } } : {}),
      })),
    }, null, 2);
  }

  toConsoleSummary(report: TestReport): string {
    const lines = [`\nZnx Simulator Tests: ${report.passed}/${report.total} passed (${Math.round(report.duration)}ms)\n`];
    for (const r of report.results) {
      lines.push(`  ${r.passed ? '✓' : '✗'} ${r.name} (${Math.round(r.durationMs)}ms)`);
      if (!r.passed && r.failedMessage) lines.push(`    → ${r.failedMessage}`);
    }
    if (report.failed > 0) lines.push(`\n  ${report.failed} FAILED`);
    return lines.join('\n');
  }

  private escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  dispose(): void {
    this._onTestStart.dispose();
    this._onTestComplete.dispose();
    this._onAllComplete.dispose();
  }
}
