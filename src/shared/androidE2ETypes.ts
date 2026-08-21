/**
 * Android E2E certification types (Phase 6).
 *
 * Types for the full Android pipeline:
 *   .zx source → Compiler → Semantic Analysis → Mobile IR → Android Backend
 *   → Kotlin/Compose → Gradle → APK → Android Emulator/Device → Real UI
 *
 * And the release path:
 *   Release Config → AAB → Signing → Artifact Inspection → Release Verification
 */

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

export type PipelineStage =
  | 'compile'
  | 'semantic_analysis'
  | 'ir_generation'
  | 'android_backend'
  | 'kotlin_generation'
  | 'gradle_build'
  | 'apk_package'
  | 'install'
  | 'launch'
  | 'ui_test';

export type PipelineStageState = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface PipelineStageResult {
  stage: PipelineStage;
  state: PipelineStageState;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  output: string;
  errors: string[];
}

export const PIPELINE_STAGES: PipelineStage[] = [
  'compile',
  'semantic_analysis',
  'ir_generation',
  'android_backend',
  'kotlin_generation',
  'gradle_build',
  'apk_package',
  'install',
  'launch',
  'ui_test',
];

export function createPipelineStageResult(stage: PipelineStage): PipelineStageResult {
  return {
    stage,
    state: 'pending',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    output: '',
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// Device targets
// ---------------------------------------------------------------------------

export interface DeviceTarget {
  id: string;
  name: string;
  type: 'physical' | 'emulator';
  apiLevel: number;
  abi: string;
  screenDensity: number;
  screenWidth: number;
  screenHeight: number;
  locale: string;
}

export const SUPPORTED_API_LEVELS = [24, 26, 28, 29, 30, 31, 33, 34, 35] as const;
export const MIN_API_LEVEL = 24;
export const TARGET_API_LEVEL = 35;
export const COMPILE_API_LEVEL = 35;

export function isApiLevelSupported(level: number): boolean {
  return level >= MIN_API_LEVEL && level <= TARGET_API_LEVEL;
}

// ---------------------------------------------------------------------------
// Build artifacts
// ---------------------------------------------------------------------------

export type ArtifactFormat = 'apk' | 'aab';
export type BuildMode = 'debug' | 'release';

export interface BuildArtifact {
  path: string;
  format: ArtifactFormat;
  mode: BuildMode;
  sizeBytes: number;
  applicationId: string;
  versionName: string;
  versionCode: number;
  minSdk: number;
  targetSdk: number;
  compileSdk: number;
  timestamp: number;
}

export interface BuildResult {
  success: boolean;
  artifact: BuildArtifact | null;
  stages: PipelineStageResult[];
  totalDurationMs: number;
  errors: string[];
  warnings: string[];
}

export function createBuildResult(): BuildResult {
  return {
    success: false,
    artifact: null,
    stages: PIPELINE_STAGES.map(createPipelineStageResult),
    totalDurationMs: 0,
    errors: [],
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Manifest inspection
// ---------------------------------------------------------------------------

export interface ManifestInspection {
  packageName: string;
  versionName: string;
  versionCode: number;
  minSdkVersion: number;
  targetSdkVersion: number;
  permissions: string[];
  activities: ManifestActivity[];
  services: string[];
  receivers: string[];
  providers: string[];
  metaData: Record<string, string>;
  debuggable: boolean;
  allowBackup: boolean;
}

export interface ManifestActivity {
  name: string;
  exported: boolean;
  launchMode: string;
  isLauncher: boolean;
}

export function createManifestInspection(): ManifestInspection {
  return {
    packageName: '',
    versionName: '',
    versionCode: 0,
    minSdkVersion: 0,
    targetSdkVersion: 0,
    permissions: [],
    activities: [],
    services: [],
    receivers: [],
    providers: [],
    metaData: {},
    debuggable: false,
    allowBackup: true,
  };
}

// ---------------------------------------------------------------------------
// Signing verification
// ---------------------------------------------------------------------------

export type SigningScheme = 'v1' | 'v2' | 'v3' | 'v4';

export interface SigningVerification {
  signed: boolean;
  schemes: SigningScheme[];
  keyAlgorithm: string | null;
  keySize: number | null;
  issuer: string | null;
  subject: string | null;
  validFrom: string | null;
  validUntil: string | null;
  sha256Fingerprint: string | null;
  debugSigned: boolean;
}

export function createSigningVerification(): SigningVerification {
  return {
    signed: false,
    schemes: [],
    keyAlgorithm: null,
    keySize: null,
    issuer: null,
    subject: null,
    validFrom: null,
    validUntil: null,
    sha256Fingerprint: null,
    debugSigned: false,
  };
}

// ---------------------------------------------------------------------------
// Artifact contamination scan
// ---------------------------------------------------------------------------

export type ContaminationType =
  | 'simulator_config'
  | 'test_telemetry'
  | 'debug_screenshot'
  | 'mock_endpoint'
  | 'permission_override'
  | 'state_debugger'
  | 'visual_baseline'
  | 'simulator_preset'
  | 'test_location'
  | 'camera_mock';

export interface ContaminationFinding {
  type: ContaminationType;
  path: string;
  detail: string;
  severity: 'blocker' | 'high';
}

export const CONTAMINATION_PATTERNS: { type: ContaminationType; patterns: RegExp[] }[] = [
  { type: 'simulator_config', patterns: [/simulator\.device_profile/, /simulator\.connectivity/, /simulator\.http_mode/] },
  { type: 'mock_endpoint', patterns: [/simulator\.mock_endpoints/, /mock_responses/, /SimulatorHttpMock/] },
  { type: 'permission_override', patterns: [/simulator\.permission_overrides/, /PermissionOverride/] },
  { type: 'state_debugger', patterns: [/simulator\.state_debugger/, /StateDebugger/, /debugger_enabled/] },
  { type: 'visual_baseline', patterns: [/simulator\.visual_baselines/, /VisualBaseline/, /screenshot_baseline/] },
  { type: 'simulator_preset', patterns: [/simulator\.presets/, /SimulatorPreset/] },
  { type: 'test_location', patterns: [/simulator\.test_location/, /mock_location/, /fake_gps/] },
  { type: 'camera_mock', patterns: [/simulator\.camera_mode/, /CameraMock/, /simulated_camera/] },
  { type: 'test_telemetry', patterns: [/test_telemetry/, /TestTelemetryCollector/, /e2e_telemetry/] },
  { type: 'debug_screenshot', patterns: [/debug_screenshot/, /test_screenshot/, /screenshot_capture_debug/] },
];

// ---------------------------------------------------------------------------
// E2E test scenarios
// ---------------------------------------------------------------------------

export type E2ECategory =
  | 'state'
  | 'navigation'
  | 'forms'
  | 'http'
  | 'storage'
  | 'permissions'
  | 'orientation'
  | 'lifecycle'
  | 'capabilities'
  | 'gestures'
  | 'theming'
  | 'accessibility';

export interface E2EScenario {
  id: string;
  name: string;
  category: E2ECategory;
  description: string;
  steps: E2EStep[];
  expectedResult: string;
  requiresDevice: boolean;
  minApiLevel: number;
}

export interface E2EStep {
  action: E2EAction;
  target?: string;
  value?: string;
  waitMs?: number;
}

export type E2EAction =
  | 'launch'
  | 'tap'
  | 'type'
  | 'scroll'
  | 'swipe'
  | 'back'
  | 'rotate'
  | 'background'
  | 'foreground'
  | 'grant_permission'
  | 'deny_permission'
  | 'assert_text'
  | 'assert_visible'
  | 'assert_state'
  | 'wait'
  | 'clear_data'
  | 'toggle_theme'
  | 'set_locale'
  | 'capture_screenshot';

export interface E2EResult {
  scenarioId: string;
  passed: boolean;
  steps: E2EStepResult[];
  durationMs: number;
  device: string;
  apiLevel: number;
  errorMessage: string | null;
  screenshot: string | null;
}

export interface E2EStepResult {
  step: E2EStep;
  passed: boolean;
  actualValue: string | null;
  errorMessage: string | null;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Built-in E2E scenarios
// ---------------------------------------------------------------------------

export const CORE_E2E_SCENARIOS: E2EScenario[] = [
  {
    id: 'e2e-state-init',
    name: 'State initialization',
    category: 'state',
    description: 'App launches with correct initial state values',
    steps: [
      { action: 'launch' },
      { action: 'assert_state', target: 'count', value: '0' },
    ],
    expectedResult: 'Initial state values match declarations',
    requiresDevice: false,
    minApiLevel: 24,
  },
  {
    id: 'e2e-state-update',
    name: 'State update via action',
    category: 'state',
    description: 'Tapping a button updates state and re-renders',
    steps: [
      { action: 'launch' },
      { action: 'tap', target: 'increment_button' },
      { action: 'assert_text', target: 'counter_display', value: '1' },
    ],
    expectedResult: 'Counter increments and display updates',
    requiresDevice: false,
    minApiLevel: 24,
  },
  {
    id: 'e2e-nav-forward',
    name: 'Forward navigation',
    category: 'navigation',
    description: 'Navigate from screen A to screen B',
    steps: [
      { action: 'launch' },
      { action: 'tap', target: 'nav_button' },
      { action: 'assert_visible', target: 'screen_b_title' },
    ],
    expectedResult: 'Screen B renders correctly',
    requiresDevice: false,
    minApiLevel: 24,
  },
  {
    id: 'e2e-nav-back',
    name: 'Back navigation',
    category: 'navigation',
    description: 'Navigate back from screen B to screen A',
    steps: [
      { action: 'launch' },
      { action: 'tap', target: 'nav_button' },
      { action: 'back' },
      { action: 'assert_visible', target: 'screen_a_title' },
    ],
    expectedResult: 'Screen A renders with preserved state',
    requiresDevice: false,
    minApiLevel: 24,
  },
  {
    id: 'e2e-form-input',
    name: 'Form text input binding',
    category: 'forms',
    description: 'Typing in a text field updates bound state',
    steps: [
      { action: 'launch' },
      { action: 'tap', target: 'name_input' },
      { action: 'type', target: 'name_input', value: 'Alice' },
      { action: 'assert_state', target: 'name', value: 'Alice' },
    ],
    expectedResult: 'State reflects typed value',
    requiresDevice: false,
    minApiLevel: 24,
  },
  {
    id: 'e2e-form-validation',
    name: 'Form validation',
    category: 'forms',
    description: 'Submitting invalid form shows error state',
    steps: [
      { action: 'launch' },
      { action: 'tap', target: 'submit_button' },
      { action: 'assert_visible', target: 'error_message' },
    ],
    expectedResult: 'Validation error displayed',
    requiresDevice: false,
    minApiLevel: 24,
  },
  {
    id: 'e2e-http-get',
    name: 'HTTP GET request',
    category: 'http',
    description: 'fetch() GET returns response and updates state',
    steps: [
      { action: 'launch' },
      { action: 'tap', target: 'fetch_button' },
      { action: 'wait', waitMs: 2000 },
      { action: 'assert_visible', target: 'response_data' },
    ],
    expectedResult: 'Response data rendered in UI',
    requiresDevice: false,
    minApiLevel: 24,
  },
  {
    id: 'e2e-storage-rw',
    name: 'Storage read/write',
    category: 'storage',
    description: 'Write to storage, close and reopen, verify data persists',
    steps: [
      { action: 'launch' },
      { action: 'tap', target: 'save_button' },
      { action: 'assert_text', target: 'status', value: 'saved' },
    ],
    expectedResult: 'Data persists across app lifecycle',
    requiresDevice: false,
    minApiLevel: 24,
  },
  {
    id: 'e2e-permission-grant',
    name: 'Permission grant flow',
    category: 'permissions',
    description: 'Request permission, grant it, verify state changes',
    steps: [
      { action: 'launch' },
      { action: 'tap', target: 'request_camera' },
      { action: 'grant_permission' },
      { action: 'assert_state', target: 'camera_permission', value: 'granted' },
    ],
    expectedResult: 'Permission state transitions to granted',
    requiresDevice: true,
    minApiLevel: 24,
  },
  {
    id: 'e2e-permission-deny',
    name: 'Permission deny flow',
    category: 'permissions',
    description: 'Request permission, deny it, verify state changes',
    steps: [
      { action: 'launch' },
      { action: 'tap', target: 'request_camera' },
      { action: 'deny_permission' },
      { action: 'assert_state', target: 'camera_permission', value: 'denied' },
    ],
    expectedResult: 'Permission state transitions to denied',
    requiresDevice: true,
    minApiLevel: 24,
  },
  {
    id: 'e2e-orientation-change',
    name: 'Orientation change',
    category: 'orientation',
    description: 'Rotate device, verify layout adjusts and state persists',
    steps: [
      { action: 'launch' },
      { action: 'tap', target: 'increment_button' },
      { action: 'rotate' },
      { action: 'assert_state', target: 'count', value: '1' },
      { action: 'assert_visible', target: 'counter_display' },
    ],
    expectedResult: 'Layout adjusts, state preserved across configuration change',
    requiresDevice: false,
    minApiLevel: 24,
  },
  {
    id: 'e2e-lifecycle-background',
    name: 'Background/foreground lifecycle',
    category: 'lifecycle',
    description: 'App goes to background and returns with state intact',
    steps: [
      { action: 'launch' },
      { action: 'tap', target: 'increment_button' },
      { action: 'background' },
      { action: 'wait', waitMs: 1000 },
      { action: 'foreground' },
      { action: 'assert_state', target: 'count', value: '1' },
    ],
    expectedResult: 'State preserved across lifecycle transitions',
    requiresDevice: true,
    minApiLevel: 24,
  },
  {
    id: 'e2e-theme-toggle',
    name: 'Theme toggle',
    category: 'theming',
    description: 'Toggle light/dark theme, verify colors change',
    steps: [
      { action: 'launch' },
      { action: 'toggle_theme' },
      { action: 'assert_visible', target: 'themed_container' },
    ],
    expectedResult: 'Theme colors update correctly',
    requiresDevice: false,
    minApiLevel: 24,
  },
  {
    id: 'e2e-scroll-list',
    name: 'List scrolling',
    category: 'gestures',
    description: 'Scroll a long list, verify items appear',
    steps: [
      { action: 'launch' },
      { action: 'scroll', target: 'item_list', value: 'down' },
      { action: 'assert_visible', target: 'item_20' },
    ],
    expectedResult: 'Scrolled items become visible',
    requiresDevice: false,
    minApiLevel: 24,
  },
  {
    id: 'e2e-accessibility-fontscale',
    name: 'Font scale accessibility',
    category: 'accessibility',
    description: 'Increased font scale renders text larger',
    steps: [
      { action: 'launch' },
      { action: 'assert_visible', target: 'scaled_text' },
    ],
    expectedResult: 'Text respects system font scale',
    requiresDevice: false,
    minApiLevel: 24,
  },
];

// ---------------------------------------------------------------------------
// Security audit types
// ---------------------------------------------------------------------------

export type SecurityTestCategory =
  | 'command_injection'
  | 'path_traversal'
  | 'secret_leak'
  | 'artifact_contamination'
  | 'release_isolation'
  | 'telemetry_containment';

export interface SecurityTestCase {
  id: string;
  category: SecurityTestCategory;
  name: string;
  description: string;
  input: string;
  expectedSafe: boolean;
}

export interface SecurityTestResult {
  testId: string;
  passed: boolean;
  safe: boolean;
  detail: string;
}

export const SECURITY_TEST_CASES: SecurityTestCase[] = [
  { id: 'sec-cmd-1', category: 'command_injection', name: 'Semicolon in project name', description: 'Project name with shell metacharacter', input: 'MyApp; rm -rf /', expectedSafe: true },
  { id: 'sec-cmd-2', category: 'command_injection', name: 'Backtick in project name', description: 'Project name with backtick substitution', input: 'App`whoami`', expectedSafe: true },
  { id: 'sec-cmd-3', category: 'command_injection', name: 'Pipe in project name', description: 'Project name with pipe', input: 'App | cat /etc/passwd', expectedSafe: true },
  { id: 'sec-cmd-4', category: 'command_injection', name: 'Dollar substitution', description: 'Project name with $()', input: 'App$(id)', expectedSafe: true },
  { id: 'sec-cmd-5', category: 'command_injection', name: 'Newline injection', description: 'Project name with newline', input: 'App\nrm -rf /', expectedSafe: true },
  { id: 'sec-path-1', category: 'path_traversal', name: 'Dot-dot in path', description: 'Path traversal via ../', input: '../../../etc/passwd', expectedSafe: true },
  { id: 'sec-path-2', category: 'path_traversal', name: 'Encoded traversal', description: 'URL-encoded path traversal', input: '..%2F..%2Fetc%2Fpasswd', expectedSafe: true },
  { id: 'sec-path-3', category: 'path_traversal', name: 'Null byte injection', description: 'Null byte in path', input: 'app.apk\x00.txt', expectedSafe: true },
  { id: 'sec-path-4', category: 'path_traversal', name: 'Absolute path escape', description: 'Absolute path injection', input: '/etc/shadow', expectedSafe: true },
  { id: 'sec-secret-1', category: 'secret_leak', name: 'Private key in artifact', description: 'RSA private key material in build output', input: '-----BEGIN RSA PRIVATE KEY-----', expectedSafe: true },
  { id: 'sec-secret-2', category: 'secret_leak', name: 'API key in generated code', description: 'API key pattern in Kotlin source', input: 'api_key = "sk_live_abc123def456"', expectedSafe: true },
  { id: 'sec-secret-3', category: 'secret_leak', name: 'Keystore password in logs', description: 'Signing password in build output', input: 'storePassword=hunter2secret', expectedSafe: true },
  { id: 'sec-contam-1', category: 'artifact_contamination', name: 'Simulator mock in APK', description: 'Mock endpoint config in release artifact', input: 'simulator.mock_endpoints', expectedSafe: true },
  { id: 'sec-contam-2', category: 'artifact_contamination', name: 'Test telemetry in APK', description: 'Test telemetry collector in release', input: 'TestTelemetryCollector', expectedSafe: true },
  { id: 'sec-contam-3', category: 'artifact_contamination', name: 'Debug screenshot in AAB', description: 'Debug screenshot capture in release', input: 'debug_screenshot', expectedSafe: true },
  { id: 'sec-release-1', category: 'release_isolation', name: 'Debug signing in release', description: 'Debug keystore used for release build', input: 'debug.keystore', expectedSafe: true },
  { id: 'sec-release-2', category: 'release_isolation', name: 'Debuggable flag in release', description: 'android:debuggable=true in release manifest', input: 'android:debuggable="true"', expectedSafe: true },
  { id: 'sec-telemetry-1', category: 'telemetry_containment', name: 'Test telemetry in release', description: 'E2E telemetry endpoints in production', input: 'e2e_telemetry_endpoint', expectedSafe: true },
  { id: 'sec-telemetry-2', category: 'telemetry_containment', name: 'Profiling hooks in release', description: 'Debug profiling hooks in production code', input: 'profiling_hook_debug', expectedSafe: true },
];

// ---------------------------------------------------------------------------
// CI configuration
// ---------------------------------------------------------------------------

export interface CIGate {
  name: string;
  type: 'simulator' | 'android' | 'release';
  required: boolean;
  blocking: boolean;
  timeout: number;
  apiLevels?: number[];
  deviceTypes?: ('emulator' | 'physical')[];
}

export const CI_GATES: CIGate[] = [
  { name: 'Simulator Tests', type: 'simulator', required: true, blocking: true, timeout: 300_000 },
  { name: 'Android Build (Debug)', type: 'android', required: true, blocking: true, timeout: 600_000, apiLevels: [24, 35] },
  { name: 'Android E2E (Emulator)', type: 'android', required: true, blocking: true, timeout: 900_000, apiLevels: [24, 30, 35], deviceTypes: ['emulator'] },
  { name: 'Android E2E (Physical)', type: 'android', required: false, blocking: false, timeout: 900_000, deviceTypes: ['physical'] },
  { name: 'Release Build (AAB)', type: 'release', required: true, blocking: true, timeout: 600_000 },
  { name: 'Release Verification', type: 'release', required: true, blocking: true, timeout: 300_000 },
];

// ---------------------------------------------------------------------------
// GA certification report
// ---------------------------------------------------------------------------

export interface GACertificationReport {
  projectName: string;
  projectVersion: string;
  timestamp: number;
  verdict: 'GA_VERIFIED' | 'GA_NOT_VERIFIED';
  pipeline: PipelineStageResult[];
  buildResults: { debug: BuildResult | null; release: BuildResult | null };
  e2eResults: E2EResult[];
  securityResults: SecurityTestResult[];
  contaminationFindings: ContaminationFinding[];
  signingVerification: SigningVerification | null;
  manifestInspection: ManifestInspection | null;
  apiLevelsCovered: number[];
  devicesCovered: string[];
  parityVerdicts: { match: number; expectedDifference: number; simulatorGap: number; androidGap: number; contractViolation: number };
  blockers: string[];
  highIssues: string[];
  knownLimitations: string[];
  notExecuted: string[];
}

export function createGACertificationReport(projectName: string, projectVersion: string): GACertificationReport {
  return {
    projectName,
    projectVersion,
    timestamp: Date.now(),
    verdict: 'GA_NOT_VERIFIED',
    pipeline: PIPELINE_STAGES.map(createPipelineStageResult),
    buildResults: { debug: null, release: null },
    e2eResults: [],
    securityResults: [],
    contaminationFindings: [],
    signingVerification: null,
    manifestInspection: null,
    apiLevelsCovered: [],
    devicesCovered: [],
    parityVerdicts: { match: 0, expectedDifference: 0, simulatorGap: 0, androidGap: 0, contractViolation: 0 },
    blockers: [],
    highIssues: [],
    knownLimitations: [],
    notExecuted: [],
  };
}

export function isGAReady(report: GACertificationReport): boolean {
  return report.blockers.length === 0 && report.highIssues.length === 0;
}
