/**
 * Simulator ↔ Android parity framework (Phase 5, §12–17).
 *
 * Provides a structured way to compare simulator behavior against Android
 * behavior and classify differences. The framework enforces:
 *   - MATCH — identical semantic behavior
 *   - EXPECTED_DIFFERENCE — known, documented divergence (e.g. native UI chrome)
 *   - SIMULATOR_GAP — simulator lacks a feature Android has
 *   - ANDROID_GAP — Android lacks a feature the simulator has
 *   - CONTRACT_VIOLATION — the behaviors diverge in a way the contract forbids
 */

// ---------------------------------------------------------------------------
// Parity verdict
// ---------------------------------------------------------------------------

export type ParityVerdict =
  | 'MATCH'
  | 'EXPECTED_DIFFERENCE'
  | 'SIMULATOR_GAP'
  | 'ANDROID_GAP'
  | 'CONTRACT_VIOLATION';

// ---------------------------------------------------------------------------
// Parity scenario
// ---------------------------------------------------------------------------

export type ParityCategory =
  | 'navigation'
  | 'state_management'
  | 'ui_rendering'
  | 'gestures'
  | 'permissions'
  | 'capabilities'
  | 'networking'
  | 'storage'
  | 'lifecycle'
  | 'accessibility'
  | 'animations'
  | 'theming'
  | 'input'
  | 'layout'
  | 'performance';

export interface ParityScenario {
  id: string;
  name: string;
  category: ParityCategory;
  description: string;
  steps: string[];
  expectedSimulatorBehavior: string;
  expectedAndroidBehavior: string;
  acceptableDifferences?: string[];
}

export interface ParityResult {
  scenarioId: string;
  verdict: ParityVerdict;
  simulatorObservation: string;
  androidObservation: string;
  notes: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export type NormalizationRule =
  | { type: 'ignore_timing'; thresholdMs: number }
  | { type: 'ignore_native_chrome' }
  | { type: 'normalize_color'; tolerance: number }
  | { type: 'normalize_font'; allowSubstitution: boolean }
  | { type: 'normalize_density'; referenceDpi: number }
  | { type: 'ignore_platform_animation' }
  | { type: 'round_coordinates'; precision: number };

export const DEFAULT_NORMALIZATION_RULES: NormalizationRule[] = [
  { type: 'ignore_timing', thresholdMs: 100 },
  { type: 'ignore_native_chrome' },
  { type: 'normalize_color', tolerance: 5 },
  { type: 'normalize_font', allowSubstitution: true },
  { type: 'normalize_density', referenceDpi: 160 },
  { type: 'ignore_platform_animation' },
  { type: 'round_coordinates', precision: 1 },
];

// ---------------------------------------------------------------------------
// Parity report
// ---------------------------------------------------------------------------

export interface ParityReport {
  projectName: string;
  timestamp: number;
  totalScenarios: number;
  results: ParityResult[];
  summary: ParitySummary;
  normalizationRules: NormalizationRule[];
}

export interface ParitySummary {
  match: number;
  expectedDifference: number;
  simulatorGap: number;
  androidGap: number;
  contractViolation: number;
  coverage: number;
}

// ---------------------------------------------------------------------------
// Parity registry
// ---------------------------------------------------------------------------

export interface ParityRegistry {
  scenarios: ParityScenario[];
  results: Map<string, ParityResult>;
}

// ---------------------------------------------------------------------------
// Built-in scenarios
// ---------------------------------------------------------------------------

export const CORE_PARITY_SCENARIOS: ParityScenario[] = [
  {
    id: 'nav-forward',
    name: 'Forward navigation',
    category: 'navigation',
    description: 'Navigate from screen A to screen B via button tap',
    steps: ['Launch app', 'Tap navigation button', 'Verify screen B is displayed'],
    expectedSimulatorBehavior: 'Screen B renders with correct state',
    expectedAndroidBehavior: 'Screen B renders with correct state',
  },
  {
    id: 'nav-back',
    name: 'Back navigation',
    category: 'navigation',
    description: 'Navigate back from screen B to screen A',
    steps: ['Navigate to screen B', 'Tap back button or system back', 'Verify screen A is displayed with preserved state'],
    expectedSimulatorBehavior: 'Screen A renders with preserved state',
    expectedAndroidBehavior: 'Screen A renders with preserved state',
    acceptableDifferences: ['Back gesture animation timing'],
  },
  {
    id: 'state-update',
    name: 'State update triggers re-render',
    category: 'state_management',
    description: 'Changing state via action updates the displayed value',
    steps: ['Launch app with initial state', 'Execute state-changing action', 'Verify display reflects new state'],
    expectedSimulatorBehavior: 'Display updates synchronously',
    expectedAndroidBehavior: 'Display updates synchronously',
  },
  {
    id: 'state-persistence',
    name: 'State persists across navigation',
    category: 'state_management',
    description: 'State on screen A survives a round-trip to screen B',
    steps: ['Set state on screen A', 'Navigate to B then back to A', 'Verify state is preserved'],
    expectedSimulatorBehavior: 'State preserved',
    expectedAndroidBehavior: 'State preserved',
  },
  {
    id: 'button-tap',
    name: 'Button tap fires event',
    category: 'ui_rendering',
    description: 'Tapping a button executes its event handler',
    steps: ['Display button', 'Tap button', 'Verify action executed'],
    expectedSimulatorBehavior: 'Action executes, state updates',
    expectedAndroidBehavior: 'Action executes, state updates',
  },
  {
    id: 'text-input',
    name: 'Text input binding',
    category: 'input',
    description: 'Typing into an input updates its bound state',
    steps: ['Display input with binding', 'Type text', 'Verify bound state matches typed text'],
    expectedSimulatorBehavior: 'State updates as user types',
    expectedAndroidBehavior: 'State updates as user types',
    acceptableDifferences: ['IME composition events', 'Keyboard appearance'],
  },
  {
    id: 'permission-request',
    name: 'Permission request flow',
    category: 'permissions',
    description: 'Requesting a permission shows dialog and updates state',
    steps: ['App declares permission', 'Execute request action', 'Grant permission', 'Verify state is granted'],
    expectedSimulatorBehavior: 'Permission state transitions to granted',
    expectedAndroidBehavior: 'System dialog shown, state transitions to granted',
    acceptableDifferences: ['System permission dialog UI'],
  },
  {
    id: 'permission-denied',
    name: 'Permission denied flow',
    category: 'permissions',
    description: 'Denying a permission request updates state to denied',
    steps: ['App declares permission', 'Execute request action', 'Deny permission', 'Verify state is denied'],
    expectedSimulatorBehavior: 'Permission state transitions to denied',
    expectedAndroidBehavior: 'System dialog shown, state transitions to denied',
    acceptableDifferences: ['System permission dialog UI'],
  },
  {
    id: 'http-get',
    name: 'HTTP GET request',
    category: 'networking',
    description: 'fetch() GET returns expected response',
    steps: ['Configure mock endpoint', 'Execute fetch action', 'Verify response body and status'],
    expectedSimulatorBehavior: 'Mock response returned',
    expectedAndroidBehavior: 'Real or mock response returned',
    acceptableDifferences: ['Network timing', 'TLS handshake'],
  },
  {
    id: 'offline-behavior',
    name: 'Offline mode behavior',
    category: 'networking',
    description: 'App handles no-connectivity gracefully',
    steps: ['Set connectivity to offline', 'Execute fetch action', 'Verify error handling'],
    expectedSimulatorBehavior: 'Request fails with network error',
    expectedAndroidBehavior: 'Request fails with network error',
  },
  {
    id: 'storage-readwrite',
    name: 'Storage read/write',
    category: 'storage',
    description: 'Writing and reading from local storage works',
    steps: ['Write key-value pair', 'Read key-value pair', 'Verify value matches'],
    expectedSimulatorBehavior: 'Value persists across reads',
    expectedAndroidBehavior: 'Value persists across reads',
  },
  {
    id: 'theme-toggle',
    name: 'Theme toggle',
    category: 'theming',
    description: 'Switching between light and dark themes updates colors',
    steps: ['Start in light theme', 'Toggle to dark', 'Verify colors change'],
    expectedSimulatorBehavior: 'Theme colors update',
    expectedAndroidBehavior: 'Theme colors update',
    acceptableDifferences: ['System status bar color', 'Navigation bar color'],
  },
  {
    id: 'font-scale',
    name: 'Font scale accessibility',
    category: 'accessibility',
    description: 'Changing font scale adjusts text sizes',
    steps: ['Set font scale to 1.5', 'Verify text sizes increased'],
    expectedSimulatorBehavior: 'Text scales proportionally',
    expectedAndroidBehavior: 'Text scales proportionally',
    acceptableDifferences: ['Line-height computation rounding'],
  },
  {
    id: 'list-scroll',
    name: 'List scrolling',
    category: 'gestures',
    description: 'Scrolling a list reveals items beyond the viewport',
    steps: ['Display list with 50+ items', 'Scroll down', 'Verify new items visible'],
    expectedSimulatorBehavior: 'Items scroll into view',
    expectedAndroidBehavior: 'Items scroll into view with fling physics',
    acceptableDifferences: ['Fling deceleration curve', 'Overscroll glow'],
  },
  {
    id: 'orientation-change',
    name: 'Orientation change',
    category: 'layout',
    description: 'Rotating device adjusts layout',
    steps: ['Start in portrait', 'Rotate to landscape', 'Verify layout adjusts'],
    expectedSimulatorBehavior: 'Layout recalculates for new dimensions',
    expectedAndroidBehavior: 'Layout recalculates, activity may recreate',
    acceptableDifferences: ['Activity recreation timing'],
  },
  {
    id: 'animation-basic',
    name: 'Basic animation',
    category: 'animations',
    description: 'A fade-in animation plays on screen entry',
    steps: ['Navigate to screen with fade_in animation', 'Verify animation plays'],
    expectedSimulatorBehavior: 'CSS-based fade animation',
    expectedAndroidBehavior: 'Native Android animation',
    acceptableDifferences: ['Animation implementation (CSS vs native)', 'Exact timing curve'],
  },
  {
    id: 'toast-show',
    name: 'Toast display',
    category: 'ui_rendering',
    description: 'show "message" displays a toast notification',
    steps: ['Execute show action', 'Verify toast appears', 'Verify toast auto-dismisses'],
    expectedSimulatorBehavior: 'Toast appears and auto-dismisses',
    expectedAndroidBehavior: 'Android Toast appears and auto-dismisses',
    acceptableDifferences: ['Toast position', 'Toast animation'],
  },
  {
    id: 'dialog-confirm',
    name: 'Dialog confirmation',
    category: 'ui_rendering',
    description: 'Dialog with confirm/cancel returns user choice',
    steps: ['Show dialog', 'Tap confirm', 'Verify result is confirmed'],
    expectedSimulatorBehavior: 'Dialog resolves with confirmed',
    expectedAndroidBehavior: 'AlertDialog resolves with confirmed',
    acceptableDifferences: ['Dialog visual style'],
  },
  {
    id: 'camera-capture',
    name: 'Camera capture',
    category: 'capabilities',
    description: 'Camera capture returns image data',
    steps: ['Request camera permission', 'Invoke camera capture', 'Verify image result'],
    expectedSimulatorBehavior: 'Returns simulated image data',
    expectedAndroidBehavior: 'Returns actual camera image',
    acceptableDifferences: ['Image source (simulated vs real)', 'Image resolution'],
  },
  {
    id: 'location-get',
    name: 'Location retrieval',
    category: 'capabilities',
    description: 'Getting location returns coordinates',
    steps: ['Request location permission', 'Get current location', 'Verify coordinates'],
    expectedSimulatorBehavior: 'Returns configured mock coordinates',
    expectedAndroidBehavior: 'Returns device GPS/network coordinates',
    acceptableDifferences: ['Coordinate source', 'Accuracy'],
  },
];

// ---------------------------------------------------------------------------
// Factory + utility
// ---------------------------------------------------------------------------

export function createParityRegistry(): ParityRegistry {
  return {
    scenarios: [...CORE_PARITY_SCENARIOS],
    results: new Map(),
  };
}

export function computeParitySummary(results: ParityResult[]): ParitySummary {
  const summary: ParitySummary = {
    match: 0,
    expectedDifference: 0,
    simulatorGap: 0,
    androidGap: 0,
    contractViolation: 0,
    coverage: 0,
  };
  for (const result of results) {
    switch (result.verdict) {
      case 'MATCH': summary.match++; break;
      case 'EXPECTED_DIFFERENCE': summary.expectedDifference++; break;
      case 'SIMULATOR_GAP': summary.simulatorGap++; break;
      case 'ANDROID_GAP': summary.androidGap++; break;
      case 'CONTRACT_VIOLATION': summary.contractViolation++; break;
    }
  }
  summary.coverage = results.length;
  return summary;
}

export function createParityReport(
  projectName: string,
  results: ParityResult[],
  rules?: NormalizationRule[],
): ParityReport {
  return {
    projectName,
    timestamp: Date.now(),
    totalScenarios: CORE_PARITY_SCENARIOS.length,
    results,
    summary: computeParitySummary(results),
    normalizationRules: rules ?? DEFAULT_NORMALIZATION_RULES,
  };
}

export function isParityAcceptable(summary: ParitySummary): boolean {
  return summary.contractViolation === 0;
}
