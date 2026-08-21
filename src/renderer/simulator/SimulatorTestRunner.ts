import { Emitter, type Event } from '../core/Emitter';
import type {
  SimulatorTestCase,
  SimulatorTestStep,
  SimulatorTestResult,
  SimulatorEvent,
  MobileIRApp,
  MobileIRNode,
  MockEndpoint,
  PermissionState,
  LocationConfig,
  BiometricResult,
  CameraMode,
  ConnectivityMode,
} from '../../shared/simulatorTypes';
import { SimulatorRuntime } from './SimulatorRuntime';

/**
 * Headless automated test runner that executes SimulatorTestCase arrays
 * against a SimulatorRuntime. Each test run creates a fresh runtime for
 * isolation, iterates through test steps, and collects results with
 * timing and event data.
 */
export class SimulatorTestRunner {
  private readonly _onTestStart = new Emitter<string>();
  readonly onTestStart: Event<string> = this._onTestStart.event;

  private readonly _onTestComplete = new Emitter<SimulatorTestResult>();
  readonly onTestComplete: Event<SimulatorTestResult> = this._onTestComplete.event;

  private readonly _onAllComplete = new Emitter<SimulatorTestResult[]>();
  readonly onAllComplete: Event<SimulatorTestResult[]> = this._onAllComplete.event;

  async runAll(app: MobileIRApp, tests: SimulatorTestCase[]): Promise<SimulatorTestResult[]> {
    const runtime = new SimulatorRuntime();
    const results: SimulatorTestResult[] = [];

    try {
      for (const test of tests) {
        const result = await this.runOne(runtime, app, test);
        results.push(result);
      }
    } finally {
      this._onAllComplete.fire(results);
      runtime.dispose();
    }

    return results;
  }

  async runOne(
    runtime: SimulatorRuntime,
    app: MobileIRApp,
    test: SimulatorTestCase,
  ): Promise<SimulatorTestResult> {
    this._onTestStart.fire(test.name);

    const startTime = performance.now();
    const eventsBefore = runtime.eventLog.all().length;

    // Load the app for a clean slate each test
    runtime.loadApp(app);

    let passed = true;
    let failedStep: number | undefined;
    let failedMessage: string | undefined;

    for (let i = 0; i < test.steps.length; i++) {
      try {
        await this.executeStep(runtime, app, test.steps[i]);
      } catch (err) {
        passed = false;
        failedStep = i;
        failedMessage = err instanceof Error ? err.message : String(err);
        break;
      }
    }

    const durationMs = performance.now() - startTime;
    const allEvents = runtime.eventLog.all();
    const events: SimulatorEvent[] = allEvents.slice(eventsBefore);

    const result: SimulatorTestResult = {
      name: test.name,
      passed,
      durationMs,
      ...(failedStep !== undefined ? { failedStep } : {}),
      ...(failedMessage !== undefined ? { failedMessage } : {}),
      events,
    };

    this._onTestComplete.fire(result);
    return result;
  }

  async executeStep(
    runtime: SimulatorRuntime,
    app: MobileIRApp,
    step: SimulatorTestStep,
  ): Promise<void> {
    switch (step.action) {
      case 'launch': {
        // App is already loaded in runOne — treat as a reset
        runtime.loadApp(app);
        break;
      }

      case 'openScreen': {
        runtime.navigation.navigate(step.screen);
        break;
      }

      case 'find': {
        findNodeByQuery(runtime, step.query);
        break;
      }

      case 'tap': {
        const node = findNodeByQuery(runtime, step.query);
        const tapped = node.events.find((e) => e.event === 'tapped');
        if (!tapped) {
          throw new Error(`Node "${step.query}" has no 'tapped' event handler`);
        }
        await runtime.executeAction(tapped.body);
        break;
      }

      case 'enterText': {
        const node = findNodeByQuery(runtime, step.query);
        if (node.kind !== 'input') {
          throw new Error(`Node "${step.query}" is not an input (kind: ${node.kind})`);
        }
        const binding = node.properties['binding'];
        if (binding === undefined) {
          throw new Error(`Input node "${step.query}" has no binding property`);
        }
        runtime.stateStore.set(String(binding), step.text);
        break;
      }

      case 'scroll': {
        // No-op in headless mode
        runtime.eventLog.log('lifecycle', `Headless scroll ${step.direction} (no-op)`);
        break;
      }

      case 'waitForState': {
        const timeout = step.timeoutMs ?? 5000;
        const deadline = performance.now() + timeout;
        while (performance.now() < deadline) {
          const current = runtime.stateStore.get(step.key);
          if (current === step.value) return;
          await sleep(50);
        }
        throw new Error(
          `Timed out waiting for state "${step.key}" to equal ${JSON.stringify(step.value)} (timeout: ${timeout}ms)`,
        );
      }

      case 'waitForScreen': {
        const timeout = step.timeoutMs ?? 5000;
        const deadline = performance.now() + timeout;
        while (performance.now() < deadline) {
          if (runtime.navigation.currentScreen() === step.screen) return;
          await sleep(50);
        }
        throw new Error(
          `Timed out waiting for screen "${step.screen}" (timeout: ${timeout}ms)`,
        );
      }

      case 'expectText': {
        const node = findNodeByQuery(runtime, step.query);
        const content = String(node.properties['content'] ?? '');
        const label = String(node.properties['label'] ?? '');
        if (!content.includes(step.text) && !label.includes(step.text)) {
          throw new Error(
            `Expected node "${step.query}" to contain text "${step.text}", ` +
            `but found content="${content}", label="${label}"`,
          );
        }
        break;
      }

      case 'expectVisible': {
        const node = findNodeByQuery(runtime, step.query);
        const isVisible = node.properties['visible'] !== false;
        if (isVisible !== step.visible) {
          throw new Error(
            `Expected node "${step.query}" visible=${step.visible}, but got visible=${isVisible}`,
          );
        }
        break;
      }

      case 'expectEnabled': {
        const node = findNodeByQuery(runtime, step.query);
        const isEnabled = node.properties['enabled'] !== false;
        if (isEnabled !== step.enabled) {
          throw new Error(
            `Expected node "${step.query}" enabled=${step.enabled}, but got enabled=${isEnabled}`,
          );
        }
        break;
      }

      case 'mockHttp': {
        runtime.http.addMock(step.endpoint);
        break;
      }

      case 'setPermission': {
        runtime.permissions.setState(step.name, step.state);
        break;
      }

      case 'setLocation': {
        (runtime.capabilities.location as any).configure(step.config);
        break;
      }

      case 'setConnectivity': {
        runtime.setConnectivity(step.mode);
        break;
      }

      case 'setBiometric': {
        (runtime.capabilities.biometrics as any).setResult(step.result);
        break;
      }

      case 'setCamera': {
        (runtime.capabilities.camera as any).setMode(step.mode);
        break;
      }

      default: {
        const _exhaustive: never = step;
        throw new Error(`Unknown test step action: ${(_exhaustive as any).action}`);
      }
    }
  }

  dispose(): void {
    this._onTestStart.dispose();
    this._onTestComplete.dispose();
    this._onAllComplete.dispose();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findNodeByQuery(runtime: SimulatorRuntime, query: string): MobileIRNode {
  for (const screen of runtime.allScreens()) {
    const found = searchNodes(screen.rootChildren, query);
    if (found) return found;
  }
  throw new Error(`Node not found: ${query}`);
}

function searchNodes(nodes: MobileIRNode[], query: string): MobileIRNode | null {
  for (const node of nodes) {
    // Match by testTag property
    if (node.properties['testTag'] === query) return node;
    // Match by kind
    if (node.kind === query) return node;
    // Match by id
    if (node.id === query) return node;
    // Match by label or content containing query
    const label = node.properties['label'];
    if (typeof label === 'string' && label.includes(query)) return node;
    const content = node.properties['content'];
    if (typeof content === 'string' && content.includes(query)) return node;

    // Recurse into children
    const found = searchNodes(node.children, query);
    if (found) return found;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // Uses the global setTimeout available in both browser and worker contexts
    setTimeout(resolve, ms);
  });
}
