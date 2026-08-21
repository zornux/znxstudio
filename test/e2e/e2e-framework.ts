/**
 * Phase 4: E2E Automation Framework for ZnxStudio Simulator.
 *
 * Wraps Playwright's Electron test API to launch the real ZnxStudio app,
 * interact with simulator components, capture screenshots, and assert UI state.
 *
 * This file is consumed by E2E test suites in test/e2e/*.e2e.ts.
 * E2E tests run under Playwright (not the headless harness) and require Electron.
 */

// NOTE: This framework defines the API contract for E2E tests.
// Playwright and Electron are imported dynamically to avoid breaking the headless build.

export interface E2EConfig {
  appPath: string;
  workspacePath: string;
  timeout?: number;
  headless?: boolean;
  slowMo?: number;
  screenshotDir?: string;
  artifactDir?: string;
}

export interface SimulatorPageObjects {
  viewport: string;
  toolbar: string;
  statusBar: string;
  deviceFrame: string;
  inspector: string;
  inspectorTabs: string;
}

export const SELECTORS: SimulatorPageObjects = {
  viewport: '.zsim-viewport',
  toolbar: '.zsim-toolbar',
  statusBar: '.zsim-status-bar',
  deviceFrame: '.zsim-device-frame',
  inspector: '.zsim-inspector',
  inspectorTabs: '.zsim-inspector-tabs',
};

export interface TestIsolationState {
  workspace: string;
  sessionId: string;
  localStorageKeys: string[];
  permissions: Record<string, string>;
  networkMocks: Array<{ method: string; path: string; status: number; body: string }>;
  environment: Record<string, string>;
  snapshots: string[];
}

export function createIsolatedState(workspace: string): TestIsolationState {
  return {
    workspace,
    sessionId: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    localStorageKeys: [],
    permissions: {},
    networkMocks: [],
    environment: {},
    snapshots: [],
  };
}

export interface E2ETestContext {
  config: E2EConfig;
  isolation: TestIsolationState;
  screenshotCount: number;
}

export function createTestContext(config: E2EConfig, workspace: string): E2ETestContext {
  return {
    config,
    isolation: createIsolatedState(workspace),
    screenshotCount: 0,
  };
}

export interface E2EResult {
  testName: string;
  passed: boolean;
  durationMs: number;
  screenshots: string[];
  errors: string[];
  artifacts: string[];
}

export interface E2ESuite {
  name: string;
  tests: E2EResult[];
  totalDurationMs: number;
  passCount: number;
  failCount: number;
}

export function createSuiteReport(name: string, results: E2EResult[]): E2ESuite {
  return {
    name,
    tests: results,
    totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
    passCount: results.filter(r => r.passed).length,
    failCount: results.filter(r => !r.passed).length,
  };
}

export function toJUnit(suite: E2ESuite): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="${escapeXml(suite.name)}" tests="${suite.tests.length}" failures="${suite.failCount}" time="${(suite.totalDurationMs / 1000).toFixed(3)}">`,
  ];
  for (const t of suite.tests) {
    if (t.passed) {
      lines.push(`  <testcase name="${escapeXml(t.testName)}" time="${(t.durationMs / 1000).toFixed(3)}" />`);
    } else {
      lines.push(`  <testcase name="${escapeXml(t.testName)}" time="${(t.durationMs / 1000).toFixed(3)}">`);
      for (const err of t.errors) {
        lines.push(`    <failure message="${escapeXml(err)}">${escapeXml(err)}</failure>`);
      }
      lines.push(`  </testcase>`);
    }
  }
  lines.push('</testsuite>');
  return lines.join('\n');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface SimulatorCommand {
  id: string;
  label: string;
}

export const SIMULATOR_COMMANDS: SimulatorCommand[] = [
  { id: 'znxstudio.simulator.open', label: 'Open Simulator' },
  { id: 'znxstudio.simulator.close', label: 'Close Simulator' },
  { id: 'znxstudio.simulator.start', label: 'Start Simulator' },
  { id: 'znxstudio.simulator.stop', label: 'Stop Simulator' },
  { id: 'znxstudio.simulator.restart', label: 'Restart Simulator' },
  { id: 'znxstudio.simulator.reset', label: 'Reset Simulator' },
  { id: 'znxstudio.simulator.themeToggle', label: 'Toggle Theme' },
  { id: 'znxstudio.simulator.orientationToggle', label: 'Toggle Orientation' },
  { id: 'znxstudio.simulator.screenshot', label: 'Take Screenshot' },
  { id: 'znxstudio.simulator.testRun', label: 'Run Tests' },
  { id: 'znxstudio.simulator.inspectToggle', label: 'Toggle Inspector' },
  { id: 'znxstudio.simulator.deviceSelect', label: 'Select Device' },
  { id: 'znxstudio.simulator.connectivity', label: 'Set Connectivity' },
  { id: 'znxstudio.simulator.fontScaleUp', label: 'Font Scale Up' },
  { id: 'znxstudio.simulator.fontScaleDown', label: 'Font Scale Down' },
  { id: 'znxstudio.simulator.fontScaleReset', label: 'Font Scale Reset' },
];

export const FIXTURE_APPS = [
  'counter', 'todo', 'login', 'navigation', 'forms',
  'http-products', 'permissions', 'dialog-snackbar', 'animations',
  'responsive', 'large-list', 'accessibility', 'image-gallery',
  'biometrics', 'gesture-showcase', 'tablet-master-detail',
  'multi-screen-state',
] as const;
export type FixtureApp = typeof FIXTURE_APPS[number];
