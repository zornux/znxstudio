/**
 * Mobile project dashboard (Phase 5, §34).
 *
 * Provides a unified view of the mobile project state: verification status,
 * parity report, readiness indicator, release policy, and project health.
 *
 * Security constraint: simulator config must NEVER enter APK/AAB. The dashboard
 * tracks which configuration belongs to the simulator vs. the Android build.
 */
import type {
  VerificationStage,
  VerificationState,
  VerificationMetadata,
  VerificationReport,
  ReleasePolicy,
  ReleasePolicyLevel,
} from '../../shared/verificationTypes';
import type {
  ParityReport,
  ParitySummary,
} from '../../shared/parityTypes';
import type {
  ReadinessLevel,
  ReadinessReport,
} from './MobileOnboarding';

// ---------------------------------------------------------------------------
// Dashboard model
// ---------------------------------------------------------------------------

export interface DashboardState {
  projectName: string;
  projectVersion: string;
  readiness: ReadinessReport | null;
  verification: Record<VerificationStage, VerificationMetadata> | null;
  parity: ParityReport | null;
  releasePolicy: ReleasePolicy | null;
  lastRefresh: number;
}

export function createDashboardState(): DashboardState {
  return {
    projectName: '',
    projectVersion: '',
    readiness: null,
    verification: null,
    parity: null,
    releasePolicy: null,
    lastRefresh: 0,
  };
}

// ---------------------------------------------------------------------------
// Dashboard sections
// ---------------------------------------------------------------------------

export type DashboardSection =
  | 'overview'
  | 'verification'
  | 'parity'
  | 'readiness'
  | 'release'
  | 'health';

export interface DashboardSectionConfig {
  id: DashboardSection;
  title: string;
  icon: string;
  collapsible: boolean;
  defaultExpanded: boolean;
}

export const DASHBOARD_SECTIONS: DashboardSectionConfig[] = [
  { id: 'overview', title: 'Project Overview', icon: '📊', collapsible: false, defaultExpanded: true },
  { id: 'verification', title: 'Verification Status', icon: '✓', collapsible: true, defaultExpanded: true },
  { id: 'parity', title: 'Parity Report', icon: '⇆', collapsible: true, defaultExpanded: true },
  { id: 'readiness', title: 'Environment Readiness', icon: '🔧', collapsible: true, defaultExpanded: false },
  { id: 'release', title: 'Release Policy', icon: '📦', collapsible: true, defaultExpanded: false },
  { id: 'health', title: 'Project Health', icon: '❤', collapsible: true, defaultExpanded: false },
];

// ---------------------------------------------------------------------------
// Artifact safety audit
// ---------------------------------------------------------------------------

export type ConfigScope = 'simulator_only' | 'android_build' | 'shared';

export interface ConfigEntry {
  key: string;
  scope: ConfigScope;
  value: string;
  safe: boolean;
}

export const SIMULATOR_ONLY_KEYS = new Set([
  'simulator.device_profile',
  'simulator.connectivity',
  'simulator.http_mode',
  'simulator.mock_endpoints',
  'simulator.test_location',
  'simulator.camera_mode',
  'simulator.biometric_result',
  'simulator.permission_overrides',
  'simulator.state_debugger',
  'simulator.visual_baselines',
  'simulator.presets',
  'simulator.font_scale_override',
  'simulator.theme_override',
  'simulator.orientation_override',
]);

export function classifyConfig(key: string): ConfigScope {
  if (SIMULATOR_ONLY_KEYS.has(key)) return 'simulator_only';
  if (key.startsWith('android.')) return 'android_build';
  return 'shared';
}

export function auditConfigForArtifact(entries: ConfigEntry[]): { safe: boolean; violations: ConfigEntry[] } {
  const violations = entries.filter((e) => e.scope === 'simulator_only' && !e.safe);
  return { safe: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Secret scanning
// ---------------------------------------------------------------------------

export const SECRET_PATTERNS = [
  { name: 'Private key', pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/ },
  { name: 'API key', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/ },
  { name: 'Password', pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/ },
  { name: 'Token', pattern: /(?:token|secret|credential)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/ },
  { name: 'AWS key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'Base64 key', pattern: /[A-Za-z0-9+/]{40,}={0,2}/ },
];

export interface SecretFinding {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
  severity: 'high' | 'medium';
}

export function scanForSecrets(content: string, file: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(lines[i])) {
        const snippet = lines[i].length > 80 ? lines[i].substring(0, 80) + '...' : lines[i];
        findings.push({
          file,
          line: i + 1,
          pattern: name,
          snippet: snippet.replace(pattern, '[REDACTED]'),
          severity: name === 'Private key' || name === 'AWS key' ? 'high' : 'medium',
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Session restoration
// ---------------------------------------------------------------------------

export interface SimulatorSessionSnapshot {
  appName: string;
  screenName: string;
  state: Record<string, unknown>;
  deviceProfileId: string;
  theme: string;
  orientation: string;
  fontScale: number;
  connectivity: string;
  httpMode: string;
  timestamp: number;
}

export function createSessionSnapshot(
  appName: string,
  screenName: string,
  state: Record<string, unknown>,
  env: { deviceProfileId: string; theme: string; orientation: string; fontScale: number; connectivity: string; httpMode: string },
): SimulatorSessionSnapshot {
  return {
    appName,
    screenName,
    state: { ...state },
    deviceProfileId: env.deviceProfileId,
    theme: env.theme,
    orientation: env.orientation,
    fontScale: env.fontScale,
    connectivity: env.connectivity,
    httpMode: env.httpMode,
    timestamp: Date.now(),
  };
}

export function isSnapshotStale(snapshot: SimulatorSessionSnapshot, maxAgeMs: number): boolean {
  return Date.now() - snapshot.timestamp > maxAgeMs;
}

// ---------------------------------------------------------------------------
// Performance budgets
// ---------------------------------------------------------------------------

export interface PerformanceBudget {
  metric: string;
  threshold: number;
  unit: string;
  severity: 'blocker' | 'high' | 'medium';
}

export const DEFAULT_PERFORMANCE_BUDGETS: PerformanceBudget[] = [
  { metric: 'startup_time', threshold: 3000, unit: 'ms', severity: 'high' },
  { metric: 'screen_transition', threshold: 300, unit: 'ms', severity: 'medium' },
  { metric: 'ir_compilation', threshold: 5000, unit: 'ms', severity: 'high' },
  { metric: 'state_update', threshold: 16, unit: 'ms', severity: 'medium' },
  { metric: 'memory_baseline', threshold: 100, unit: 'MB', severity: 'high' },
  { metric: 'memory_per_screen', threshold: 20, unit: 'MB', severity: 'medium' },
  { metric: 'apk_size_debug', threshold: 50, unit: 'MB', severity: 'medium' },
  { metric: 'apk_size_release', threshold: 30, unit: 'MB', severity: 'high' },
  { metric: 'hot_reload', threshold: 500, unit: 'ms', severity: 'medium' },
  { metric: 'test_suite_time', threshold: 60000, unit: 'ms', severity: 'medium' },
];

export interface PerformanceMeasurement {
  metric: string;
  value: number;
  unit: string;
  timestamp: number;
  withinBudget: boolean;
}

export function checkPerformanceBudget(
  metric: string,
  value: number,
  budgets?: PerformanceBudget[],
): { withinBudget: boolean; budget: PerformanceBudget | null } {
  const allBudgets = budgets ?? DEFAULT_PERFORMANCE_BUDGETS;
  const budget = allBudgets.find((b) => b.metric === metric);
  if (!budget) return { withinBudget: true, budget: null };
  return { withinBudget: value <= budget.threshold, budget };
}
