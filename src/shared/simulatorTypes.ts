/**
 * Znx Simulator types — the shared contract between the renderer-side simulator
 * runtime and the main-process simulator service. Pure types, no runtime imports.
 *
 * Mobile IR is the shared contract between the Znx Simulator and the Android
 * Backend. The simulator consumes validated Mobile IR directly — it never
 * re-parses .zx source.
 */

// ---------------------------------------------------------------------------
// Mobile IR — the shared semantic model
// ---------------------------------------------------------------------------

export interface MobileIRSourceLocation {
  file: string;
  startLine: number;
  endLine: number;
}

export interface MobileIRProperty {
  key: string;
  value: string | number | boolean;
}

export interface MobileIREventHandler {
  event: string;
  body: string;
}

export interface MobileIRNode {
  id: string;
  kind: string;
  properties: Record<string, string | number | boolean>;
  events: MobileIREventHandler[];
  children: MobileIRNode[];
  sourceLocation?: MobileIRSourceLocation;
}

export interface MobileIRStateDeclaration {
  name: string;
  type: 'text' | 'whole' | 'decimal' | 'truth' | 'list' | 'record' | 'any';
  initialValue: string;
}

export interface MobileIRScreen {
  name: string;
  states: MobileIRStateDeclaration[];
  rootChildren: MobileIRNode[];
}

export interface MobileIRValidation {
  field: string;
  rule: string;
  message: string;
}

export interface MobileIRApp {
  name: string;
  startScreen: string;
  screens: MobileIRScreen[];
  permissions: string[];
  capabilities: string[];
  styles?: MobileIRStyleBlock;
}

export interface MobileIRStyleBlock {
  theme?: { light?: Record<string, string>; dark?: Record<string, string> };
  tokens?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Change classification for hot reload
// ---------------------------------------------------------------------------

export type ChangeClassification =
  | 'StyleOnly'
  | 'Content'
  | 'Layout'
  | 'StateShape'
  | 'Navigation'
  | 'Capability'
  | 'ApplicationStructure';

// ---------------------------------------------------------------------------
// Simulator session state
// ---------------------------------------------------------------------------

export type SimulatorSessionState =
  | 'idle'
  | 'compiling'
  | 'starting'
  | 'running'
  | 'reloading'
  | 'paused'
  | 'failed'
  | 'stopped';

// ---------------------------------------------------------------------------
// Device profiles
// ---------------------------------------------------------------------------

export type DeviceClass = 'phone' | 'tablet' | 'foldable';

export interface SimulatorDeviceProfile {
  id: string;
  label: string;
  width: number;
  height: number;
  density: number;
  pixelRatio: number;
  safeArea: { top: number; bottom: number; left: number; right: number };
  statusBarHeight: number;
  navigationArea: number;
  deviceClass: DeviceClass;
}

export type SimulatorOrientation = 'portrait' | 'landscape';
export type SimulatorTheme = 'light' | 'dark' | 'system';

export interface SimulatorEnvironment {
  theme: SimulatorTheme;
  fontScale: number;
  reducedMotion: boolean;
  highContrast: boolean;
  orientation: SimulatorOrientation;
  deviceProfile: SimulatorDeviceProfile;
  connectivity: ConnectivityMode;
}

// ---------------------------------------------------------------------------
// Capability contracts
// ---------------------------------------------------------------------------

export type PermissionState =
  | 'not_requested'
  | 'granted'
  | 'denied'
  | 'denied_permanently'
  | 'restricted'
  | 'unavailable';

export interface CameraResult {
  success: boolean;
  imageData?: string;
  cancelled?: boolean;
  error?: string;
}

export interface LocationResult {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number;
}

export type LocationMode = 'fixed' | 'route' | 'unavailable';

export interface LocationConfig {
  mode: LocationMode;
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number;
  permissionState: PermissionState;
}

export type BiometricResult = 'success' | 'failure' | 'cancelled' | 'unavailable' | 'locked_out';

export interface NotificationConfig {
  id: string;
  title: string;
  body: string;
  scheduledMs?: number;
}

export type ShareResult = 'completed' | 'cancelled' | 'unavailable' | 'failed';

export type ConnectivityMode = 'online' | 'offline' | 'slow' | 'intermittent';

export type CameraMode = 'webcam' | 'sample' | 'local' | 'cancel' | 'unavailable' | 'failure';

// ---------------------------------------------------------------------------
// HTTP simulation
// ---------------------------------------------------------------------------

export type HttpMode = 'live' | 'mock' | 'recorded';

export interface MockEndpoint {
  method: string;
  path: string;
  status: number;
  delayMs: number;
  headers?: Record<string, string>;
  body: string;
}

export interface RecordedExchange {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: string;
  durationMs: number;
  timestamp: number;
}

export interface SimulatorHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface SimulatorHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface StorageEntry {
  key: string;
  value: string;
  store: 'local' | 'secure' | 'preferences';
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

export interface InspectedComponent {
  nodeId: string;
  kind: string;
  sourceFile?: string;
  sourceLine?: number;
  parentId: string | null;
  childCount: number;
  bounds: { x: number; y: number; width: number; height: number };
  properties: Record<string, string | number | boolean>;
  state: Record<string, unknown>;
  events: string[];
  accessibility: {
    role?: string;
    label?: string;
    hint?: string;
    focusable: boolean;
    enabled: boolean;
    touchTargetSize?: { width: number; height: number };
  };
  visible: boolean;
  enabled: boolean;
}

export interface NavigationStackEntry {
  screen: string;
  args: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

export type SimulatorEventType =
  | 'screen_opened'
  | 'button_tapped'
  | 'state_changed'
  | 'http_request'
  | 'http_response'
  | 'navigation'
  | 'permission_requested'
  | 'capability_called'
  | 'validation_failed'
  | 'animation_started'
  | 'lifecycle'
  | 'gesture'
  | 'error';

export interface SimulatorEvent {
  type: SimulatorEventType;
  timestamp: number;
  detail: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type SimulatorDiagnosticSeverity = 'error' | 'warning' | 'info';

export type SimulatorDiagnosticCategory =
  | 'capability_unavailable'
  | 'mock_missing'
  | 'invalid_state'
  | 'unsupported_ir'
  | 'render_failure'
  | 'action_failed'
  | 'navigation_error'
  | 'simulator_limitation'
  | 'application_error';

export interface SimulatorDiagnostic {
  severity: SimulatorDiagnosticSeverity;
  category: SimulatorDiagnosticCategory;
  message: string;
  nodeId?: string;
  sourceFile?: string;
  sourceLine?: number;
}

// ---------------------------------------------------------------------------
// Parity contract
// ---------------------------------------------------------------------------

export type ParityLevel = 'semantic' | 'contract' | 'visual_approximation' | 'android_only';
export type SimulatorSupport = 'SimulatorSupported' | 'SimulatorPartial' | 'AndroidOnly';

export interface ParityEntry {
  feature: string;
  simulatorBehavior: string;
  androidBehavior: string;
  parity: ParityLevel;
  support: SimulatorSupport;
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

export interface SimulatorTestCase {
  name: string;
  steps: SimulatorTestStep[];
}

export type SimulatorTestStep =
  | { action: 'launch' }
  | { action: 'openScreen'; screen: string }
  | { action: 'find'; query: string }
  | { action: 'tap'; query: string }
  | { action: 'enterText'; query: string; text: string }
  | { action: 'scroll'; direction: 'up' | 'down' }
  | { action: 'waitForState'; key: string; value: unknown; timeoutMs?: number }
  | { action: 'waitForScreen'; screen: string; timeoutMs?: number }
  | { action: 'expectText'; query: string; text: string }
  | { action: 'expectVisible'; query: string; visible: boolean }
  | { action: 'expectEnabled'; query: string; enabled: boolean }
  | { action: 'mockHttp'; endpoint: MockEndpoint }
  | { action: 'setPermission'; name: string; state: PermissionState }
  | { action: 'setLocation'; config: LocationConfig }
  | { action: 'setConnectivity'; mode: ConnectivityMode }
  | { action: 'setBiometric'; result: BiometricResult }
  | { action: 'setCamera'; mode: CameraMode };

export interface SimulatorTestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  failedStep?: number;
  failedMessage?: string;
  events: SimulatorEvent[];
}

// ---------------------------------------------------------------------------
// Screenshot / visual testing
// ---------------------------------------------------------------------------

export interface ScreenshotRequest {
  screen?: string;
  nodeId?: string;
  deviceProfile?: string;
  orientation?: SimulatorOrientation;
  theme?: SimulatorTheme;
  fontScale?: number;
}

export interface ScreenshotResult {
  width: number;
  height: number;
  dataUrl: string;
}

// ---------------------------------------------------------------------------
// Extension simulator support
// ---------------------------------------------------------------------------

export type ExtensionSimulatorSupport =
  | { supported: true }
  | { supported: false; reason: string };

// ---------------------------------------------------------------------------
// IPC result types
// ---------------------------------------------------------------------------

export interface SimulatorStartResult {
  ok: boolean;
  sessionId: string;
  error?: string;
}

export interface SimulatorCompileResult {
  ok: boolean;
  app: MobileIRApp | null;
  diagnostics: SimulatorDiagnostic[];
  durationMs: number;
}
