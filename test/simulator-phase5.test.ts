/**
 * Znx Simulator Phase 5: Productization, Android Parity Certification,
 * Release Workflow Integration, and Developer Experience Hardening.
 *
 * Phase 5 baseline: 2,868 tests, 0 failures (Phases 1–4).
 * Phase 5 is NOT a feature expansion — it certifies the simulator as the
 * production mobile development experience.
 *
 * Tests here cover: verification states, parity framework, mobile onboarding,
 * toolbar hierarchy, dashboard, release policy, secret handling, session
 * restoration, doctor integration, performance budgets, CI workflows,
 * artifact safety, and the full certification report.
 */
import { describe, test, expect } from './harness';

// --- Verification types ---
import {
  createVerificationMetadata,
  createVerificationReport,
  isVerificationStale,
  checkReleasePolicy,
  RELEASE_POLICIES,
} from '../src/shared/verificationTypes';
import type {
  VerificationStage,
  VerificationMetadata,
  VerificationFinding,
  ReleasePolicy,
} from '../src/shared/verificationTypes';

// --- Parity types ---
import {
  CORE_PARITY_SCENARIOS,
  DEFAULT_NORMALIZATION_RULES,
  createParityRegistry,
  createParityReport,
  computeParitySummary,
  isParityAcceptable,
} from '../src/shared/parityTypes';
import type {
  ParityResult,
  ParityScenario,
  ParityVerdict,
  NormalizationRule,
} from '../src/shared/parityTypes';

// --- Verification state machine ---
import { SimulatorVerification } from '../src/renderer/simulator/SimulatorVerification';
import type { VerificationListener } from '../src/renderer/simulator/SimulatorVerification';

// --- Parity framework ---
import { SimulatorParity } from '../src/renderer/simulator/SimulatorParity';

// --- Mobile onboarding ---
import {
  READINESS_CHECKS,
  ONBOARDING_STEPS,
  MOBILE_TOOLBAR_ACTIONS,
  computeReadinessLevel,
  createReadinessReport,
  getAvailableToolbarActions,
  getPrimaryAction,
  MobileOnboardingState,
} from '../src/renderer/mobile/MobileOnboarding';
import type { ReadinessCheck } from '../src/renderer/mobile/MobileOnboarding';

// --- Mobile dashboard ---
import {
  DASHBOARD_SECTIONS,
  SIMULATOR_ONLY_KEYS,
  SECRET_PATTERNS,
  DEFAULT_PERFORMANCE_BUDGETS,
  createDashboardState,
  classifyConfig,
  auditConfigForArtifact,
  scanForSecrets,
  createSessionSnapshot,
  isSnapshotStale,
  checkPerformanceBudget,
} from '../src/renderer/mobile/MobileDashboard';
import type { ConfigEntry } from '../src/renderer/mobile/MobileDashboard';

// --- Command IDs ---
import { CommandIds } from '../src/renderer/commands/CommandIds';

// ============================================================================
// §1 — Full workflow audit
// ============================================================================

describe('Phase 5 §1: Workflow audit', () => {
  test('all mobile command IDs exist', () => {
    expect(CommandIds.MobileShow).toBe('znxstudio.mobile.show');
    expect(CommandIds.MobileRunStart).toBe('znxstudio.mobile.runStart');
    expect(CommandIds.MobileRunStop).toBe('znxstudio.mobile.runStop');
    expect(CommandIds.MobileBuildApk).toBe('znxstudio.mobile.buildApk');
    expect(CommandIds.MobileBuildAab).toBe('znxstudio.mobile.buildAab');
    expect(CommandIds.MobileReleaseCheck).toBe('znxstudio.mobile.releaseCheck');
    expect(CommandIds.MobileDoctor).toBe('znxstudio.mobile.doctor');
    expect(CommandIds.MobileToolchainSetup).toBe('znxstudio.mobile.toolchainSetup');
  });

  test('Phase 5 command IDs exist', () => {
    expect(CommandIds.SimulatorVerify).toBe('znxstudio.simulator.verify');
    expect(CommandIds.SimulatorParityReport).toBe('znxstudio.simulator.parityReport');
    expect(CommandIds.MobileDashboard).toBe('znxstudio.mobile.dashboard');
    expect(CommandIds.MobileOnboarding).toBe('znxstudio.mobile.onboarding');
    expect(CommandIds.AndroidVerify).toBe('znxstudio.mobile.androidVerify');
    expect(CommandIds.MobileVerificationReport).toBe('znxstudio.mobile.verificationReport');
  });

  test('simulator command IDs exist', () => {
    expect(CommandIds.SimulatorStart).toBe('znxstudio.simulator.start');
    expect(CommandIds.SimulatorStop).toBe('znxstudio.simulator.stop');
    expect(CommandIds.SimulatorRestart).toBe('znxstudio.simulator.restart');
    expect(CommandIds.PreviewStart).toBe('znxstudio.preview.start');
    expect(CommandIds.PreviewStop).toBe('znxstudio.preview.stop');
  });
});

// ============================================================================
// §2, §60 — Preview as primary mobile action + toolbar hierarchy
// ============================================================================

describe('Phase 5 §2/§60: Preview primary action + toolbar hierarchy', () => {
  test('Preview is the first toolbar action', () => {
    const primary = getPrimaryAction();
    expect(primary.id).toBe('preview');
    expect(primary.primary).toBe(true);
    expect(primary.requiresAndroid).toBe(false);
  });

  test('Preview does not require Android SDK', () => {
    const preview = MOBILE_TOOLBAR_ACTIONS.find((a) => a.id === 'preview');
    expect(preview).toBeDefined();
    expect(preview!.requiresAndroid).toBe(false);
  });

  test('Run Android requires Android SDK', () => {
    const runAndroid = MOBILE_TOOLBAR_ACTIONS.find((a) => a.id === 'run_android');
    expect(runAndroid).toBeDefined();
    expect(runAndroid!.requiresAndroid).toBe(true);
  });

  test('available actions without Android shows only non-android actions', () => {
    const actions = getAvailableToolbarActions(false);
    for (const action of actions) {
      expect(action.requiresAndroid).toBe(false);
    }
    expect(actions.length).toBeGreaterThan(0);
  });

  test('available actions with Android shows all actions', () => {
    const all = getAvailableToolbarActions(true);
    expect(all.length).toBe(MOBILE_TOOLBAR_ACTIONS.length);
  });

  test('Preview appears before Run Android in toolbar order', () => {
    const previewIdx = MOBILE_TOOLBAR_ACTIONS.findIndex((a) => a.id === 'preview');
    const runIdx = MOBILE_TOOLBAR_ACTIONS.findIndex((a) => a.id === 'run_android');
    expect(previewIdx).toBeLessThan(runIdx);
  });

  test('each toolbar action has a command', () => {
    for (const action of MOBILE_TOOLBAR_ACTIONS) {
      expect(action.command.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// §3 — New-project first-run experience
// ============================================================================

describe('Phase 5 §3: New-project first-run', () => {
  test('onboarding steps exist and are ordered', () => {
    expect(ONBOARDING_STEPS.length).toBeGreaterThanOrEqual(7);
    expect(ONBOARDING_STEPS[0].id).toBe('welcome');
    expect(ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1].id).toBe('complete');
  });

  test('required steps must be completed', () => {
    const required = ONBOARDING_STEPS.filter((s) => s.required);
    expect(required.length).toBeGreaterThan(0);
    expect(required.length).toBeLessThan(ONBOARDING_STEPS.length);
  });

  test('simulator preview is a required step', () => {
    const previewStep = ONBOARDING_STEPS.find((s) => s.id === 'preview_simulator');
    expect(previewStep).toBeDefined();
    expect(previewStep!.required).toBe(true);
  });

  test('android setup is optional', () => {
    const androidStep = ONBOARDING_STEPS.find((s) => s.id === 'setup_android');
    expect(androidStep).toBeDefined();
    expect(androidStep!.required).toBe(false);
  });
});

// ============================================================================
// §4 — Mobile onboarding state machine
// ============================================================================

describe('Phase 5 §4: Mobile onboarding state machine', () => {
  test('starts with first step', () => {
    const state = new MobileOnboardingState();
    const current = state.getCurrentStep();
    expect(current).toBeDefined();
    expect(current!.id).toBe('welcome');
  });

  test('completing a step advances to the next', () => {
    const state = new MobileOnboardingState();
    state.completeStep('welcome');
    const current = state.getCurrentStep();
    expect(current).toBeDefined();
    expect(current!.id).toBe('create_project');
  });

  test('skipping non-required steps works', () => {
    const state = new MobileOnboardingState();
    const optionalStep = ONBOARDING_STEPS.find((s) => !s.required);
    if (optionalStep) {
      state.skipStep(optionalStep.id);
      const steps = state.getSteps();
      const skipped = steps.find((s) => s.id === optionalStep.id);
      expect(skipped!.completed).toBe(true);
    }
  });

  test('cannot skip required steps', () => {
    const state = new MobileOnboardingState();
    state.skipStep('welcome');
    const current = state.getCurrentStep();
    expect(current!.id).toBe('welcome');
    expect(current!.completed).toBe(false);
  });

  test('progress tracking', () => {
    const state = new MobileOnboardingState();
    const before = state.getProgress();
    expect(before.completed).toBe(0);

    state.completeStep('welcome');
    const after = state.getProgress();
    expect(after.completed).toBe(1);
    expect(after.percentage).toBeGreaterThan(0);
  });

  test('dismiss hides onboarding', () => {
    const state = new MobileOnboardingState();
    expect(state.isDismissed()).toBe(false);
    state.dismiss();
    expect(state.isDismissed()).toBe(true);
    expect(state.getCurrentStep()).toBeNull();
  });

  test('isComplete when all required steps done', () => {
    const state = new MobileOnboardingState();
    expect(state.isComplete()).toBe(false);
    for (const step of ONBOARDING_STEPS.filter((s) => s.required)) {
      state.completeStep(step.id);
    }
    expect(state.isComplete()).toBe(true);
  });

  test('reset restores initial state', () => {
    const state = new MobileOnboardingState();
    state.completeStep('welcome');
    state.dismiss();
    state.reset();
    expect(state.isDismissed()).toBe(false);
    expect(state.getCurrentStep()!.id).toBe('welcome');
  });
});

// ============================================================================
// §5 — Simulator readiness indicator
// ============================================================================

describe('Phase 5 §5: Readiness indicator', () => {
  test('readiness checks cover all categories', () => {
    const categories = new Set(READINESS_CHECKS.map((c) => c.category));
    expect(categories.has('simulator')).toBe(true);
    expect(categories.has('android')).toBe(true);
    expect(categories.has('release')).toBe(true);
  });

  test('all simulator checks are required', () => {
    const simChecks = READINESS_CHECKS.filter((c) => c.category === 'simulator');
    for (const check of simChecks) {
      expect(check.required).toBe(true);
    }
  });

  test('android/release checks are optional', () => {
    const optionalChecks = READINESS_CHECKS.filter((c) => c.category === 'android' || c.category === 'release');
    for (const check of optionalChecks) {
      expect(check.required).toBe(false);
    }
  });

  test('not_ready when simulator checks fail', () => {
    const checks = READINESS_CHECKS.map((c) => ({ ...c, passed: false }));
    expect(computeReadinessLevel(checks)).toBe('not_ready');
  });

  test('simulator_only when only sim checks pass', () => {
    const checks = READINESS_CHECKS.map((c) => ({
      ...c,
      passed: c.category === 'simulator',
    }));
    expect(computeReadinessLevel(checks)).toBe('simulator_only');
  });

  test('fully_ready when all checks pass', () => {
    const checks = READINESS_CHECKS.map((c) => ({ ...c, passed: true }));
    expect(computeReadinessLevel(checks)).toBe('fully_ready');
  });

  test('readiness report includes all data', () => {
    const checks = READINESS_CHECKS.map((c) => ({ ...c, passed: true }));
    const report = createReadinessReport(checks);
    expect(report.level).toBe('fully_ready');
    expect(report.simulatorReady).toBe(true);
    expect(report.androidReady).toBe(true);
    expect(report.releaseReady).toBe(true);
    expect(report.timestamp).toBeGreaterThan(0);
  });
});

// ============================================================================
// §6–8 — Verification states system
// ============================================================================

describe('Phase 5 §6: Verification states', () => {
  test('three independent stages exist', () => {
    const v = new SimulatorVerification();
    const stages = v.getAllStages();
    expect(stages.simulator.stage).toBe('simulator');
    expect(stages.android.stage).toBe('android');
    expect(stages.release.stage).toBe('release');
  });

  test('all stages start as not_run', () => {
    const v = new SimulatorVerification();
    expect(v.getState('simulator')).toBe('not_run');
    expect(v.getState('android')).toBe('not_run');
    expect(v.getState('release')).toBe('not_run');
  });

  test('stages are independent (not cumulative)', () => {
    const v = new SimulatorVerification();
    v.beginVerification('simulator');
    v.completeVerification('simulator', true);
    expect(v.getState('simulator')).toBe('passed');
    expect(v.getState('android')).toBe('not_run');
    expect(v.getState('release')).toBe('not_run');
  });

  test('verification lifecycle: not_run → running → passed', () => {
    const v = new SimulatorVerification();
    expect(v.getState('simulator')).toBe('not_run');
    v.beginVerification('simulator');
    expect(v.getState('simulator')).toBe('running');
    v.completeVerification('simulator', true);
    expect(v.getState('simulator')).toBe('passed');
  });

  test('verification lifecycle: not_run → running → failed', () => {
    const v = new SimulatorVerification();
    v.beginVerification('android');
    v.completeVerification('android', false);
    expect(v.getState('android')).toBe('failed');
  });
});

describe('Phase 5 §7: Verification metadata', () => {
  test('metadata tracks timing', () => {
    const v = new SimulatorVerification();
    v.beginVerification('simulator');
    const before = v.getStage('simulator');
    expect(before.startedAt).toBeGreaterThan(0);
    expect(before.completedAt).toBeNull();

    v.completeVerification('simulator', true);
    const after = v.getStage('simulator');
    expect(after.completedAt).toBeGreaterThan(0);
    expect(after.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('metadata tracks test counts', () => {
    const v = new SimulatorVerification();
    v.beginVerification('simulator');
    v.recordTestResult('simulator', true);
    v.recordTestResult('simulator', true);
    v.recordTestResult('simulator', false);
    v.recordSkip('simulator');
    v.completeVerification('simulator', false);

    const meta = v.getStage('simulator');
    expect(meta.passCount).toBe(2);
    expect(meta.failCount).toBe(1);
    expect(meta.skipCount).toBe(1);
  });

  test('metadata tracks findings', () => {
    const v = new SimulatorVerification();
    v.beginVerification('simulator');
    v.addFinding('simulator', {
      severity: 'high',
      code: 'SIM001',
      message: 'Test failure',
      category: 'correctness',
    });
    v.completeVerification('simulator', false);

    const meta = v.getStage('simulator');
    expect(meta.findings).toHaveLength(1);
    expect(meta.findings[0].code).toBe('SIM001');
  });

  test('metadata tracks device info', () => {
    const v = new SimulatorVerification();
    v.beginVerification('android');
    v.setDeviceInfo('android', 'emulator-5554', 'Pixel 7 API 34');
    v.completeVerification('android', true);

    const meta = v.getStage('android');
    expect(meta.deviceId).toBe('emulator-5554');
    expect(meta.deviceName).toBe('Pixel 7 API 34');
  });

  test('metadata tracks build mode', () => {
    const v = new SimulatorVerification();
    v.beginVerification('release');
    v.setBuildMode('release', 'release');
    v.completeVerification('release', true);

    const meta = v.getStage('release');
    expect(meta.buildMode).toBe('release');
  });
});

describe('Phase 5 §8: Verification invalidation on source change', () => {
  test('source hash change marks passed stages as stale', () => {
    const v = new SimulatorVerification();
    v.updateSourceHash('hash-1');
    v.beginVerification('simulator');
    v.completeVerification('simulator', true);

    v.updateSourceHash('hash-2');
    expect(v.getState('simulator')).toBe('stale');
  });

  test('same hash does not invalidate', () => {
    const v = new SimulatorVerification();
    v.updateSourceHash('hash-1');
    v.beginVerification('simulator');
    v.completeVerification('simulator', true);

    v.updateSourceHash('hash-1');
    expect(v.getState('simulator')).toBe('passed');
  });

  test('not_run stages are not affected by hash changes', () => {
    const v = new SimulatorVerification();
    v.updateSourceHash('hash-1');
    v.updateSourceHash('hash-2');
    expect(v.getState('simulator')).toBe('not_run');
  });

  test('running stages are not affected by hash changes', () => {
    const v = new SimulatorVerification();
    v.updateSourceHash('hash-1');
    v.beginVerification('simulator');
    v.updateSourceHash('hash-2');
    expect(v.getState('simulator')).toBe('running');
  });

  test('checkStaleness returns stale stages', () => {
    const v = new SimulatorVerification();
    v.updateSourceHash('hash-1');
    v.beginVerification('simulator');
    v.completeVerification('simulator', true);
    v.beginVerification('android');
    v.completeVerification('android', true);

    v.updateSourceHash('hash-2');
    const stale = v.checkStaleness();
    expect(stale).toContain('simulator');
    expect(stale).toContain('android');
  });

  test('listener notified on stale detection', () => {
    const v = new SimulatorVerification();
    const staleStages: string[] = [];
    const listener: VerificationListener = {
      onStateChanged() {},
      onStaleDetected(stage) { staleStages.push(stage); },
      onFindingAdded() {},
    };
    v.addListener(listener);

    v.updateSourceHash('hash-1');
    v.beginVerification('simulator');
    v.completeVerification('simulator', true);
    v.updateSourceHash('hash-2');

    expect(staleStages).toContain('simulator');
    v.removeListener(listener);
  });
});

// ============================================================================
// §9 — Simulator Verify command
// ============================================================================

describe('Phase 5 §9: Simulator Verify command', () => {
  test('begin and complete verification', () => {
    const v = new SimulatorVerification();
    v.beginVerification('simulator');
    expect(v.getState('simulator')).toBe('running');
    v.recordTestResult('simulator', true);
    v.recordTestResult('simulator', true);
    v.completeVerification('simulator', true);
    expect(v.getState('simulator')).toBe('passed');
    expect(v.getStage('simulator').passCount).toBe(2);
  });

  test('resetStage resets to not_run', () => {
    const v = new SimulatorVerification();
    v.beginVerification('simulator');
    v.completeVerification('simulator', true);
    v.resetStage('simulator');
    expect(v.getState('simulator')).toBe('not_run');
  });
});

// ============================================================================
// §10 — Android Verify command
// ============================================================================

describe('Phase 5 §10: Android Verify command', () => {
  test('android verification with device info', () => {
    const v = new SimulatorVerification();
    v.beginVerification('android');
    v.setDeviceInfo('android', 'device-123', 'Samsung S24');
    v.recordTestResult('android', true);
    v.completeVerification('android', true);

    expect(v.getState('android')).toBe('passed');
    expect(v.getStage('android').deviceName).toBe('Samsung S24');
  });
});

// ============================================================================
// §11 — Release Check command
// ============================================================================

describe('Phase 5 §11: Release Check command', () => {
  test('release verification with build mode', () => {
    const v = new SimulatorVerification();
    v.beginVerification('release');
    v.setBuildMode('release', 'release');
    v.recordTestResult('release', true);
    v.completeVerification('release', true);

    expect(v.getState('release')).toBe('passed');
    expect(v.getStage('release').buildMode).toBe('release');
  });
});

// ============================================================================
// §12–17 — Parity framework
// ============================================================================

describe('Phase 5 §12: Parity scenario format', () => {
  test('core scenarios exist', () => {
    expect(CORE_PARITY_SCENARIOS.length).toBeGreaterThanOrEqual(15);
  });

  test('each scenario has required fields', () => {
    for (const scenario of CORE_PARITY_SCENARIOS) {
      expect(scenario.id.length).toBeGreaterThan(0);
      expect(scenario.name.length).toBeGreaterThan(0);
      expect(scenario.category.length).toBeGreaterThan(0);
      expect(scenario.description.length).toBeGreaterThan(0);
      expect(scenario.steps.length).toBeGreaterThan(0);
      expect(scenario.expectedSimulatorBehavior.length).toBeGreaterThan(0);
      expect(scenario.expectedAndroidBehavior.length).toBeGreaterThan(0);
    }
  });

  test('scenario IDs are unique', () => {
    const ids = new Set(CORE_PARITY_SCENARIOS.map((s) => s.id));
    expect(ids.size).toBe(CORE_PARITY_SCENARIOS.length);
  });
});

describe('Phase 5 §13: Parity normalization', () => {
  test('default normalization rules exist', () => {
    expect(DEFAULT_NORMALIZATION_RULES.length).toBeGreaterThanOrEqual(5);
  });

  test('timing normalization replaces ms values', () => {
    const parity = new SimulatorParity();
    const normalized = parity.normalizeObservation('completed in 250ms');
    expect(normalized).toContain('<timing>');
    expect(normalized.includes('250ms')).toBe(false);
  });

  test('color normalization replaces hex colors', () => {
    const parity = new SimulatorParity();
    const normalized = parity.normalizeObservation('background #FF5722');
    expect(normalized).toContain('<color>');
  });

  test('native chrome normalization', () => {
    const parity = new SimulatorParity();
    const normalized = parity.normalizeObservation('status bar visible');
    expect(normalized).toContain('<native-chrome>');
  });
});

describe('Phase 5 §14: Parity categories', () => {
  test('scenarios cover multiple categories', () => {
    const categories = new Set(CORE_PARITY_SCENARIOS.map((s) => s.category));
    expect(categories.size).toBeGreaterThanOrEqual(8);
  });

  test('navigation category has scenarios', () => {
    const navScenarios = CORE_PARITY_SCENARIOS.filter((s) => s.category === 'navigation');
    expect(navScenarios.length).toBeGreaterThanOrEqual(2);
  });

  test('permissions category has scenarios', () => {
    const permScenarios = CORE_PARITY_SCENARIOS.filter((s) => s.category === 'permissions');
    expect(permScenarios.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Phase 5 §15: Parity registry', () => {
  test('registry starts with core scenarios', () => {
    const parity = new SimulatorParity();
    expect(parity.getScenarios().length).toBe(CORE_PARITY_SCENARIOS.length);
  });

  test('add custom scenario', () => {
    const parity = new SimulatorParity();
    const custom: ParityScenario = {
      id: 'custom-1',
      name: 'Custom test',
      category: 'navigation',
      description: 'Custom scenario',
      steps: ['Step 1'],
      expectedSimulatorBehavior: 'Expected',
      expectedAndroidBehavior: 'Expected',
    };
    parity.addScenario(custom);
    expect(parity.getScenario('custom-1')).toBeDefined();
    expect(parity.getScenarios().length).toBe(CORE_PARITY_SCENARIOS.length + 1);
  });

  test('remove scenario', () => {
    const parity = new SimulatorParity();
    const removed = parity.removeScenario('nav-forward');
    expect(removed).toBe(true);
    expect(parity.getScenario('nav-forward')).toBeUndefined();
  });

  test('record and retrieve results', () => {
    const parity = new SimulatorParity();
    const result: ParityResult = {
      scenarioId: 'nav-forward',
      verdict: 'MATCH',
      simulatorObservation: 'Screen B renders',
      androidObservation: 'Screen B renders',
      notes: '',
      timestamp: Date.now(),
    };
    parity.recordResult(result);
    expect(parity.getResult('nav-forward')).toBeDefined();
    expect(parity.getResult('nav-forward')!.verdict).toBe('MATCH');
  });

  test('filter results by verdict', () => {
    const parity = new SimulatorParity();
    parity.recordResult({ scenarioId: 'nav-forward', verdict: 'MATCH', simulatorObservation: '', androidObservation: '', notes: '', timestamp: Date.now() });
    parity.recordResult({ scenarioId: 'nav-back', verdict: 'EXPECTED_DIFFERENCE', simulatorObservation: '', androidObservation: '', notes: '', timestamp: Date.now() });

    const matches = parity.getResultsByVerdict('MATCH');
    expect(matches).toHaveLength(1);
    expect(matches[0].scenarioId).toBe('nav-forward');
  });

  test('filter results by category', () => {
    const parity = new SimulatorParity();
    parity.recordResult({ scenarioId: 'nav-forward', verdict: 'MATCH', simulatorObservation: '', androidObservation: '', notes: '', timestamp: Date.now() });
    parity.recordResult({ scenarioId: 'button-tap', verdict: 'MATCH', simulatorObservation: '', androidObservation: '', notes: '', timestamp: Date.now() });

    const navResults = parity.getResultsByCategory('navigation');
    expect(navResults).toHaveLength(1);
  });
});

describe('Phase 5 §16: Parity comparison', () => {
  test('identical observations produce MATCH', () => {
    const parity = new SimulatorParity();
    const verdict = parity.compareObservations('Screen renders correctly', 'Screen renders correctly');
    expect(verdict).toBe('MATCH');
  });

  test('timing differences normalize to MATCH', () => {
    const parity = new SimulatorParity();
    const verdict = parity.compareObservations('completed in 100ms', 'completed in 200ms');
    expect(verdict).toBe('MATCH');
  });

  test('acceptable differences produce EXPECTED_DIFFERENCE', () => {
    const parity = new SimulatorParity();
    const scenario: ParityScenario = {
      id: 'test',
      name: 'test',
      category: 'navigation',
      description: '',
      steps: [],
      expectedSimulatorBehavior: '',
      expectedAndroidBehavior: '',
      acceptableDifferences: ['animation timing'],
    };
    const verdict = parity.compareObservations(
      'screen transitions with animation timing difference',
      'screen transitions natively',
      scenario,
    );
    expect(verdict).toBe('EXPECTED_DIFFERENCE');
  });

  test('simulator gap detected', () => {
    const parity = new SimulatorParity();
    const verdict = parity.compareObservations('not supported in simulator', 'native feature works');
    expect(verdict).toBe('SIMULATOR_GAP');
  });

  test('android gap detected', () => {
    const parity = new SimulatorParity();
    const verdict = parity.compareObservations('simulator feature works', 'not supported on Android');
    expect(verdict).toBe('ANDROID_GAP');
  });

  test('contract violation for unacceptable differences', () => {
    const parity = new SimulatorParity();
    const verdict = parity.compareObservations('state is 42', 'state is 99');
    expect(verdict).toBe('CONTRACT_VIOLATION');
  });
});

describe('Phase 5 §17: Parity report', () => {
  test('report generation', () => {
    const parity = new SimulatorParity();
    parity.setProject('TestApp');

    for (const scenario of CORE_PARITY_SCENARIOS.slice(0, 5)) {
      parity.recordResult({
        scenarioId: scenario.id,
        verdict: 'MATCH',
        simulatorObservation: 'ok',
        androidObservation: 'ok',
        notes: '',
        timestamp: Date.now(),
      });
    }

    const report = parity.generateReport();
    expect(report.projectName).toBe('TestApp');
    expect(report.results).toHaveLength(5);
    expect(report.summary.match).toBe(5);
    expect(report.totalScenarios).toBe(CORE_PARITY_SCENARIOS.length);
  });

  test('coverage tracking', () => {
    const parity = new SimulatorParity();
    const before = parity.getCoverage();
    expect(before.tested).toBe(0);
    expect(before.percentage).toBe(0);

    parity.recordResult({
      scenarioId: 'nav-forward',
      verdict: 'MATCH',
      simulatorObservation: 'ok',
      androidObservation: 'ok',
      notes: '',
      timestamp: Date.now(),
    });

    const after = parity.getCoverage();
    expect(after.tested).toBe(1);
    expect(after.percentage).toBeGreaterThan(0);
  });

  test('acceptability check', () => {
    const summary1 = computeParitySummary([
      { scenarioId: 'a', verdict: 'MATCH', simulatorObservation: '', androidObservation: '', notes: '', timestamp: 0 },
    ]);
    expect(isParityAcceptable(summary1)).toBe(true);

    const summary2 = computeParitySummary([
      { scenarioId: 'a', verdict: 'CONTRACT_VIOLATION', simulatorObservation: '', androidObservation: '', notes: '', timestamp: 0 },
    ]);
    expect(isParityAcceptable(summary2)).toBe(false);
  });

  test('category breakdown', () => {
    const parity = new SimulatorParity();
    parity.recordResult({ scenarioId: 'nav-forward', verdict: 'MATCH', simulatorObservation: '', androidObservation: '', notes: '', timestamp: 0 });
    parity.recordResult({ scenarioId: 'nav-back', verdict: 'MATCH', simulatorObservation: '', androidObservation: '', notes: '', timestamp: 0 });
    parity.recordResult({ scenarioId: 'button-tap', verdict: 'MATCH', simulatorObservation: '', androidObservation: '', notes: '', timestamp: 0 });

    const breakdown = parity.getCategoryBreakdown();
    const navSummary = breakdown.get('navigation');
    expect(navSummary).toBeDefined();
    expect(navSummary!.match).toBe(2);
  });

  test('reset results', () => {
    const parity = new SimulatorParity();
    parity.recordResult({ scenarioId: 'nav-forward', verdict: 'MATCH', simulatorObservation: '', androidObservation: '', notes: '', timestamp: 0 });
    parity.resetResults();
    expect(parity.getAllResults()).toHaveLength(0);
  });
});

// ============================================================================
// §34 — Mobile project dashboard
// ============================================================================

describe('Phase 5 §34: Mobile project dashboard', () => {
  test('dashboard sections exist', () => {
    expect(DASHBOARD_SECTIONS.length).toBeGreaterThanOrEqual(5);
  });

  test('overview section is not collapsible', () => {
    const overview = DASHBOARD_SECTIONS.find((s) => s.id === 'overview');
    expect(overview).toBeDefined();
    expect(overview!.collapsible).toBe(false);
  });

  test('dashboard state initializes empty', () => {
    const state = createDashboardState();
    expect(state.projectName).toBe('');
    expect(state.verification).toBeNull();
    expect(state.parity).toBeNull();
    expect(state.readiness).toBeNull();
  });
});

// ============================================================================
// §36 — Configurable release policy
// ============================================================================

describe('Phase 5 §36: Release policy', () => {
  test('three policy levels exist', () => {
    expect(RELEASE_POLICIES.strict).toBeDefined();
    expect(RELEASE_POLICIES.standard).toBeDefined();
    expect(RELEASE_POLICIES.permissive).toBeDefined();
  });

  test('strict policy requires all stages', () => {
    const strict = RELEASE_POLICIES.strict;
    expect(strict.requireSimulatorPass).toBe(true);
    expect(strict.requireAndroidPass).toBe(true);
    expect(strict.requireReleaseCheck).toBe(true);
    expect(strict.maxHighFindings).toBe(0);
    expect(strict.maxMediumFindings).toBe(0);
  });

  test('permissive policy does not require Android', () => {
    const perm = RELEASE_POLICIES.permissive;
    expect(perm.requireAndroidPass).toBe(false);
    expect(perm.maxHighFindings).toBeGreaterThan(0);
  });

  test('policy check: all passed, no findings → allowed', () => {
    const stages = {
      simulator: { ...createVerificationMetadata('simulator'), state: 'passed' as const, findings: [] },
      android: { ...createVerificationMetadata('android'), state: 'passed' as const, findings: [] },
      release: { ...createVerificationMetadata('release'), state: 'passed' as const, findings: [] },
    };
    const result = checkReleasePolicy(RELEASE_POLICIES.standard, stages);
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test('policy check: simulator failed → blocked', () => {
    const stages = {
      simulator: { ...createVerificationMetadata('simulator'), state: 'failed' as const, findings: [] },
      android: { ...createVerificationMetadata('android'), state: 'passed' as const, findings: [] },
      release: { ...createVerificationMetadata('release'), state: 'passed' as const, findings: [] },
    };
    const result = checkReleasePolicy(RELEASE_POLICIES.standard, stages);
    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  test('policy check: blocker findings always block', () => {
    const blocker: VerificationFinding = {
      severity: 'blocker',
      code: 'BLK001',
      message: 'Critical issue',
      category: 'security',
    };
    const stages = {
      simulator: { ...createVerificationMetadata('simulator'), state: 'passed' as const, findings: [blocker] },
      android: { ...createVerificationMetadata('android'), state: 'passed' as const, findings: [] },
      release: { ...createVerificationMetadata('release'), state: 'passed' as const, findings: [] },
    };
    const result = checkReleasePolicy(RELEASE_POLICIES.permissive, stages);
    expect(result.allowed).toBe(false);
  });

  test('policy check: permissive allows android not_run', () => {
    const stages = {
      simulator: { ...createVerificationMetadata('simulator'), state: 'passed' as const, findings: [] },
      android: { ...createVerificationMetadata('android'), state: 'not_run' as const, findings: [] },
      release: { ...createVerificationMetadata('release'), state: 'passed' as const, findings: [] },
    };
    const result = checkReleasePolicy(RELEASE_POLICIES.permissive, stages);
    expect(result.allowed).toBe(true);
  });

  test('SimulatorVerification uses release policy', () => {
    const v = new SimulatorVerification();
    v.setReleasePolicyLevel('strict');
    expect(v.getReleasePolicy().level).toBe('strict');

    v.setReleasePolicyLevel('permissive');
    expect(v.getReleasePolicy().maxHighFindings).toBeGreaterThan(0);
  });
});

// ============================================================================
// §40 — Secret handling audit
// ============================================================================

describe('Phase 5 §40: Secret handling audit', () => {
  test('secret patterns exist', () => {
    expect(SECRET_PATTERNS.length).toBeGreaterThanOrEqual(5);
  });

  test('detects private key', () => {
    const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...';
    const findings = scanForSecrets(content, 'keystore.pem');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].pattern).toBe('Private key');
    expect(findings[0].severity).toBe('high');
  });

  test('detects API key', () => {
    const content = 'const api_key = "sk_test_FAKE00000000000000000000000000000000"';
    const findings = scanForSecrets(content, 'config.ts');
    expect(findings.length).toBeGreaterThan(0);
  });

  test('detects password', () => {
    const content = 'password = "supersecretpassword123!"';
    const findings = scanForSecrets(content, '.env');
    expect(findings.length).toBeGreaterThan(0);
  });

  test('redacts findings', () => {
    const content = '-----BEGIN PRIVATE KEY-----\ndata\n-----END PRIVATE KEY-----';
    const findings = scanForSecrets(content, 'key.pem');
    for (const finding of findings) {
      expect(finding.snippet).toContain('[REDACTED]');
      expect(finding.snippet.includes('BEGIN PRIVATE KEY')).toBe(false);
    }
  });

  test('clean file has no findings', () => {
    const content = 'const greeting = "Hello, world!";\nconsole.log(greeting);';
    const findings = scanForSecrets(content, 'main.ts');
    expect(findings).toHaveLength(0);
  });
});

// ============================================================================
// §62 — Session restoration
// ============================================================================

describe('Phase 5 §62: Session restoration', () => {
  test('create session snapshot', () => {
    const snapshot = createSessionSnapshot('TestApp', 'Home', { count: 0 }, {
      deviceProfileId: 'pixel-7',
      theme: 'dark',
      orientation: 'portrait',
      fontScale: 1.0,
      connectivity: 'online',
      httpMode: 'mock',
    });
    expect(snapshot.appName).toBe('TestApp');
    expect(snapshot.screenName).toBe('Home');
    expect(snapshot.state).toEqual({ count: 0 });
    expect(snapshot.theme).toBe('dark');
    expect(snapshot.timestamp).toBeGreaterThan(0);
  });

  test('snapshot staleness check', () => {
    const snapshot = createSessionSnapshot('App', 'Home', {}, {
      deviceProfileId: 'pixel-7',
      theme: 'light',
      orientation: 'portrait',
      fontScale: 1.0,
      connectivity: 'online',
      httpMode: 'live',
    });
    expect(isSnapshotStale(snapshot, 60_000)).toBe(false);

    const old = { ...snapshot, timestamp: Date.now() - 120_000 };
    expect(isSnapshotStale(old, 60_000)).toBe(true);
  });
});

// ============================================================================
// §65 — Release mode simulator
// ============================================================================

describe('Phase 5 §65: Release mode simulator', () => {
  test('build mode can be set to release', () => {
    const v = new SimulatorVerification();
    v.beginVerification('release');
    v.setBuildMode('release', 'release');
    const meta = v.getStage('release');
    expect(meta.buildMode).toBe('release');
  });
});

// ============================================================================
// §66–68 — Production config warnings + artifact scanning
// ============================================================================

describe('Phase 5 §66-68: Config safety and artifact scanning', () => {
  test('simulator-only keys are identified', () => {
    expect(SIMULATOR_ONLY_KEYS.has('simulator.device_profile')).toBe(true);
    expect(SIMULATOR_ONLY_KEYS.has('simulator.mock_endpoints')).toBe(true);
    expect(SIMULATOR_ONLY_KEYS.has('simulator.test_location')).toBe(true);
    expect(SIMULATOR_ONLY_KEYS.has('simulator.camera_mode')).toBe(true);
    expect(SIMULATOR_ONLY_KEYS.has('simulator.permission_overrides')).toBe(true);
    expect(SIMULATOR_ONLY_KEYS.has('simulator.state_debugger')).toBe(true);
    expect(SIMULATOR_ONLY_KEYS.has('simulator.visual_baselines')).toBe(true);
    expect(SIMULATOR_ONLY_KEYS.has('simulator.presets')).toBe(true);
  });

  test('classify config: simulator keys → simulator_only', () => {
    expect(classifyConfig('simulator.device_profile')).toBe('simulator_only');
    expect(classifyConfig('simulator.mock_endpoints')).toBe('simulator_only');
  });

  test('classify config: android keys → android_build', () => {
    expect(classifyConfig('android.application_id')).toBe('android_build');
    expect(classifyConfig('android.min_sdk')).toBe('android_build');
  });

  test('classify config: other keys → shared', () => {
    expect(classifyConfig('name')).toBe('shared');
    expect(classifyConfig('version')).toBe('shared');
  });

  test('artifact audit: no simulator config → safe', () => {
    const entries: ConfigEntry[] = [
      { key: 'android.min_sdk', scope: 'android_build', value: '24', safe: true },
    ];
    const result = auditConfigForArtifact(entries);
    expect(result.safe).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test('artifact audit: simulator config present → unsafe', () => {
    const entries: ConfigEntry[] = [
      { key: 'simulator.mock_endpoints', scope: 'simulator_only', value: '[...]', safe: false },
      { key: 'android.min_sdk', scope: 'android_build', value: '24', safe: true },
    ];
    const result = auditConfigForArtifact(entries);
    expect(result.safe).toBe(false);
    expect(result.violations).toHaveLength(1);
  });
});

// ============================================================================
// §85 — Performance budgets
// ============================================================================

describe('Phase 5 §85: Performance budgets', () => {
  test('default budgets exist', () => {
    expect(DEFAULT_PERFORMANCE_BUDGETS.length).toBeGreaterThanOrEqual(8);
  });

  test('startup budget exists', () => {
    const startup = DEFAULT_PERFORMANCE_BUDGETS.find((b) => b.metric === 'startup_time');
    expect(startup).toBeDefined();
    expect(startup!.threshold).toBeGreaterThan(0);
  });

  test('within budget check: under threshold', () => {
    const result = checkPerformanceBudget('startup_time', 1000);
    expect(result.withinBudget).toBe(true);
    expect(result.budget).toBeDefined();
  });

  test('within budget check: over threshold', () => {
    const result = checkPerformanceBudget('startup_time', 10000);
    expect(result.withinBudget).toBe(false);
  });

  test('unknown metric is always within budget', () => {
    const result = checkPerformanceBudget('unknown_metric', 999999);
    expect(result.withinBudget).toBe(true);
    expect(result.budget).toBeNull();
  });

  test('custom budgets override defaults', () => {
    const custom = [{ metric: 'custom', threshold: 50, unit: 'ms', severity: 'high' as const }];
    const result = checkPerformanceBudget('custom', 100, custom);
    expect(result.withinBudget).toBe(false);
  });
});

// ============================================================================
// §96–97 — Certification applications
// ============================================================================

describe('Phase 5 §96-97: Certification applications', () => {
  test('verification report generation', () => {
    const v = new SimulatorVerification();
    v.setProject('CertApp', '1.0.0');
    v.beginVerification('simulator');
    v.recordTestResult('simulator', true);
    v.completeVerification('simulator', true);
    v.beginVerification('android');
    v.recordTestResult('android', true);
    v.completeVerification('android', true);
    v.beginVerification('release');
    v.recordTestResult('release', true);
    v.completeVerification('release', true);

    const report = v.generateReport();
    expect(report.projectName).toBe('CertApp');
    expect(report.projectVersion).toBe('1.0.0');
    expect(report.overallReady).toBe(true);
    expect(report.blockers).toHaveLength(0);
    expect(report.stages.simulator.state).toBe('passed');
    expect(report.stages.android.state).toBe('passed');
    expect(report.stages.release.state).toBe('passed');
  });

  test('report not ready with blocker findings', () => {
    const v = new SimulatorVerification();
    v.setProject('BuggyApp', '0.1.0');
    v.beginVerification('simulator');
    v.addFinding('simulator', {
      severity: 'blocker',
      code: 'CRASH001',
      message: 'App crashes on startup',
      category: 'correctness',
    });
    v.completeVerification('simulator', false);
    v.beginVerification('android');
    v.completeVerification('android', true);
    v.beginVerification('release');
    v.completeVerification('release', true);

    const report = v.generateReport();
    expect(report.overallReady).toBe(false);
    expect(report.blockers).toHaveLength(1);
  });

  test('report summary includes stage states', () => {
    const v = new SimulatorVerification();
    v.setProject('TestApp', '1.0.0');
    v.beginVerification('simulator');
    v.recordTestResult('simulator', true);
    v.completeVerification('simulator', true);

    const report = v.generateReport();
    expect(report.summary).toContain('simulator');
    expect(report.summary).toContain('passed');
  });
});

// ============================================================================
// §99–101 — Fresh-machine certification
// ============================================================================

describe('Phase 5 §99-101: Fresh-machine certification', () => {
  test('readiness check: no checks passed → not_ready', () => {
    const checks: ReadinessCheck[] = READINESS_CHECKS.map((c) => ({ ...c, passed: false }));
    const level = computeReadinessLevel(checks);
    expect(level).toBe('not_ready');
  });

  test('simulator works without Android', () => {
    const checks: ReadinessCheck[] = READINESS_CHECKS.map((c) => ({
      ...c,
      passed: c.category === 'simulator',
    }));
    const level = computeReadinessLevel(checks);
    expect(level).toBe('simulator_only');
  });

  test('android_ready when sim + android pass', () => {
    const checks: ReadinessCheck[] = READINESS_CHECKS.map((c) => ({
      ...c,
      passed: c.category === 'simulator' || c.category === 'android',
    }));
    const level = computeReadinessLevel(checks);
    expect(level).toBe('android_ready');
  });
});

// ============================================================================
// §105 — Phase 5 comprehensive verification
// ============================================================================

describe('Phase 5 §105: Verification types contract', () => {
  test('createVerificationMetadata factory', () => {
    const meta = createVerificationMetadata('simulator');
    expect(meta.stage).toBe('simulator');
    expect(meta.state).toBe('not_run');
    expect(meta.startedAt).toBeNull();
    expect(meta.findings).toHaveLength(0);
  });

  test('isVerificationStale utility', () => {
    const meta = createVerificationMetadata('simulator');
    meta.state = 'passed';
    meta.sourceHash = 'hash-1';
    expect(isVerificationStale(meta, 'hash-1')).toBe(false);
    expect(isVerificationStale(meta, 'hash-2')).toBe(true);
  });

  test('isVerificationStale: not_run is never stale', () => {
    const meta = createVerificationMetadata('simulator');
    expect(isVerificationStale(meta, 'any')).toBe(false);
  });

  test('isVerificationStale: running is never stale', () => {
    const meta = createVerificationMetadata('simulator');
    meta.state = 'running';
    expect(isVerificationStale(meta, 'any')).toBe(false);
  });

  test('isVerificationStale: null hash is always stale', () => {
    const meta = createVerificationMetadata('simulator');
    meta.state = 'passed';
    meta.sourceHash = null;
    expect(isVerificationStale(meta, 'hash-1')).toBe(true);
  });
});

describe('Phase 5 §105: Parity types contract', () => {
  test('createParityRegistry factory', () => {
    const reg = createParityRegistry();
    expect(reg.scenarios.length).toBe(CORE_PARITY_SCENARIOS.length);
    expect(reg.results.size).toBe(0);
  });

  test('computeParitySummary with mixed verdicts', () => {
    const results: ParityResult[] = [
      { scenarioId: '1', verdict: 'MATCH', simulatorObservation: '', androidObservation: '', notes: '', timestamp: 0 },
      { scenarioId: '2', verdict: 'MATCH', simulatorObservation: '', androidObservation: '', notes: '', timestamp: 0 },
      { scenarioId: '3', verdict: 'EXPECTED_DIFFERENCE', simulatorObservation: '', androidObservation: '', notes: '', timestamp: 0 },
      { scenarioId: '4', verdict: 'SIMULATOR_GAP', simulatorObservation: '', androidObservation: '', notes: '', timestamp: 0 },
      { scenarioId: '5', verdict: 'CONTRACT_VIOLATION', simulatorObservation: '', androidObservation: '', notes: '', timestamp: 0 },
    ];
    const summary = computeParitySummary(results);
    expect(summary.match).toBe(2);
    expect(summary.expectedDifference).toBe(1);
    expect(summary.simulatorGap).toBe(1);
    expect(summary.contractViolation).toBe(1);
    expect(summary.coverage).toBe(5);
  });

  test('createParityReport', () => {
    const results: ParityResult[] = [
      { scenarioId: '1', verdict: 'MATCH', simulatorObservation: '', androidObservation: '', notes: '', timestamp: 0 },
    ];
    const report = createParityReport('TestApp', results);
    expect(report.projectName).toBe('TestApp');
    expect(report.results).toHaveLength(1);
    expect(report.summary.match).toBe(1);
    expect(report.normalizationRules.length).toBeGreaterThan(0);
  });
});

describe('Phase 5 §105: Listener contracts', () => {
  test('verification listener receives state changes', () => {
    const v = new SimulatorVerification();
    const states: string[] = [];
    v.addListener({
      onStateChanged(_stage, state) { states.push(state); },
      onStaleDetected() {},
      onFindingAdded() {},
    });

    v.beginVerification('simulator');
    v.completeVerification('simulator', true);
    expect(states).toContain('running');
    expect(states).toContain('passed');
  });

  test('verification listener receives findings', () => {
    const v = new SimulatorVerification();
    const findings: VerificationFinding[] = [];
    v.addListener({
      onStateChanged() {},
      onStaleDetected() {},
      onFindingAdded(_stage, finding) { findings.push(finding); },
    });

    v.beginVerification('simulator');
    v.addFinding('simulator', {
      severity: 'medium',
      code: 'MED001',
      message: 'Warning',
      category: 'quality',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('MED001');
  });

  test('parity listener receives scenario completions', () => {
    const parity = new SimulatorParity();
    const completed: ParityResult[] = [];
    parity.addListener({
      onScenarioCompleted(result) { completed.push(result); },
      onReportGenerated() {},
    });

    parity.recordResult({
      scenarioId: 'nav-forward',
      verdict: 'MATCH',
      simulatorObservation: 'ok',
      androidObservation: 'ok',
      notes: '',
      timestamp: Date.now(),
    });

    expect(completed).toHaveLength(1);
  });

  test('parity listener receives reports', () => {
    const parity = new SimulatorParity();
    let reportGenerated = false;
    parity.addListener({
      onScenarioCompleted() {},
      onReportGenerated() { reportGenerated = true; },
    });

    parity.generateReport();
    expect(reportGenerated).toBe(true);
  });
});

// ============================================================================
// §105: Integration — full verification + parity workflow
// ============================================================================

describe('Phase 5 §105: Full verification + parity workflow', () => {
  test('complete mobile certification flow', () => {
    const verification = new SimulatorVerification();
    const parity = new SimulatorParity();

    verification.setProject('ShopApp', '2.0.0');
    parity.setProject('ShopApp');
    verification.setReleasePolicyLevel('standard');
    verification.updateSourceHash('abc123');

    verification.beginVerification('simulator');
    for (let i = 0; i < 10; i++) {
      verification.recordTestResult('simulator', true);
    }
    verification.completeVerification('simulator', true);

    for (const scenario of CORE_PARITY_SCENARIOS.slice(0, 10)) {
      parity.recordResult({
        scenarioId: scenario.id,
        verdict: 'MATCH',
        simulatorObservation: 'correct behavior',
        androidObservation: 'correct behavior',
        notes: '',
        timestamp: Date.now(),
      });
    }

    verification.beginVerification('android');
    verification.setDeviceInfo('android', 'emulator-5554', 'Pixel 8 API 35');
    for (let i = 0; i < 5; i++) {
      verification.recordTestResult('android', true);
    }
    verification.completeVerification('android', true);

    verification.beginVerification('release');
    verification.setBuildMode('release', 'release');
    verification.recordTestResult('release', true);
    verification.completeVerification('release', true);

    const vReport = verification.generateReport();
    expect(vReport.overallReady).toBe(true);
    expect(vReport.blockers).toHaveLength(0);

    const pReport = parity.generateReport();
    expect(pReport.summary.contractViolation).toBe(0);

    const release = verification.checkRelease();
    expect(release.allowed).toBe(true);
  });

  test('source change invalidates and requires re-verification', () => {
    const v = new SimulatorVerification();
    v.updateSourceHash('hash-1');
    v.beginVerification('simulator');
    v.completeVerification('simulator', true);

    v.updateSourceHash('hash-2');
    expect(v.getState('simulator')).toBe('stale');

    v.beginVerification('simulator');
    v.completeVerification('simulator', true);
    expect(v.getState('simulator')).toBe('passed');
  });

  test('resetAll clears everything', () => {
    const v = new SimulatorVerification();
    v.beginVerification('simulator');
    v.completeVerification('simulator', true);
    v.beginVerification('android');
    v.completeVerification('android', true);

    v.resetAll();
    expect(v.getState('simulator')).toBe('not_run');
    expect(v.getState('android')).toBe('not_run');
    expect(v.getState('release')).toBe('not_run');
  });

  test('parity resetAll clears scenarios and results', () => {
    const p = new SimulatorParity();
    p.addScenario({ id: 'x', name: 'x', category: 'navigation', description: '', steps: [], expectedSimulatorBehavior: '', expectedAndroidBehavior: '' });
    p.recordResult({ scenarioId: 'x', verdict: 'MATCH', simulatorObservation: '', androidObservation: '', notes: '', timestamp: 0 });
    p.resetAll();
    expect(p.getScenarios().length).toBe(CORE_PARITY_SCENARIOS.length);
    expect(p.getAllResults()).toHaveLength(0);
  });
});

// ============================================================================
// §106: Security invariants
// ============================================================================

describe('Phase 5 §106: Security invariants', () => {
  test('simulator mocks never enter APK/AAB', () => {
    const entries: ConfigEntry[] = [
      { key: 'simulator.mock_endpoints', scope: 'simulator_only', value: '[{...}]', safe: false },
    ];
    const audit = auditConfigForArtifact(entries);
    expect(audit.safe).toBe(false);
  });

  test('simulator permission overrides never enter APK/AAB', () => {
    const entries: ConfigEntry[] = [
      { key: 'simulator.permission_overrides', scope: 'simulator_only', value: '{camera: granted}', safe: false },
    ];
    const audit = auditConfigForArtifact(entries);
    expect(audit.safe).toBe(false);
  });

  test('simulator test location never enters APK/AAB', () => {
    const entries: ConfigEntry[] = [
      { key: 'simulator.test_location', scope: 'simulator_only', value: '{lat: 0, lng: 0}', safe: false },
    ];
    const audit = auditConfigForArtifact(entries);
    expect(audit.safe).toBe(false);
  });

  test('simulator camera result never enters APK/AAB', () => {
    const entries: ConfigEntry[] = [
      { key: 'simulator.camera_mode', scope: 'simulator_only', value: 'sample', safe: false },
    ];
    const audit = auditConfigForArtifact(entries);
    expect(audit.safe).toBe(false);
  });

  test('simulator state debugger never enters APK/AAB', () => {
    const entries: ConfigEntry[] = [
      { key: 'simulator.state_debugger', scope: 'simulator_only', value: 'enabled', safe: false },
    ];
    const audit = auditConfigForArtifact(entries);
    expect(audit.safe).toBe(false);
  });

  test('simulator visual baselines never enter APK/AAB', () => {
    const entries: ConfigEntry[] = [
      { key: 'simulator.visual_baselines', scope: 'simulator_only', value: '{...}', safe: false },
    ];
    const audit = auditConfigForArtifact(entries);
    expect(audit.safe).toBe(false);
  });

  test('simulator presets never enter APK/AAB', () => {
    const entries: ConfigEntry[] = [
      { key: 'simulator.presets', scope: 'simulator_only', value: '[...]', safe: false },
    ];
    const audit = auditConfigForArtifact(entries);
    expect(audit.safe).toBe(false);
  });

  test('android config is safe for APK/AAB', () => {
    const entries: ConfigEntry[] = [
      { key: 'android.min_sdk', scope: 'android_build', value: '24', safe: true },
      { key: 'android.target_sdk', scope: 'android_build', value: '35', safe: true },
    ];
    const audit = auditConfigForArtifact(entries);
    expect(audit.safe).toBe(true);
  });

  test('no private keys in template files', () => {
    for (const check of READINESS_CHECKS) {
      const findings = scanForSecrets(check.detail, 'readiness');
      expect(findings).toHaveLength(0);
    }
  });

  test('no secrets in onboarding step descriptions', () => {
    for (const step of ONBOARDING_STEPS) {
      const findings = scanForSecrets(step.description, 'onboarding');
      expect(findings).toHaveLength(0);
    }
  });

  test('no secrets in parity scenario descriptions', () => {
    for (const scenario of CORE_PARITY_SCENARIOS) {
      const findings = scanForSecrets(scenario.description, 'parity');
      expect(findings).toHaveLength(0);
    }
  });

  test('AWS key detection', () => {
    const content = 'aws_key = "AKIAIOSFODNN7EXAMPLE"';
    const findings = scanForSecrets(content, '.env');
    expect(findings.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Final certification
// ============================================================================

describe('Phase 5 §106: Final certification', () => {
  test('PHASE 5 CERTIFICATION: all verification types functional', () => {
    const meta = createVerificationMetadata('simulator');
    expect(meta.state).toBe('not_run');
    expect(meta.stage).toBe('simulator');

    const v = new SimulatorVerification();
    v.setProject('CertTest', '1.0.0');
    for (const stage of ['simulator', 'android', 'release'] as VerificationStage[]) {
      v.beginVerification(stage);
      v.recordTestResult(stage, true);
      v.completeVerification(stage, true);
    }
    const report = v.generateReport();
    expect(report.overallReady).toBe(true);
  });

  test('PHASE 5 CERTIFICATION: all parity types functional', () => {
    const p = new SimulatorParity();
    p.setProject('CertTest');
    const scenarios = p.getScenarios();
    expect(scenarios.length).toBeGreaterThan(0);

    for (const s of scenarios) {
      p.recordResult({
        scenarioId: s.id,
        verdict: 'MATCH',
        simulatorObservation: 'ok',
        androidObservation: 'ok',
        notes: '',
        timestamp: Date.now(),
      });
    }
    const report = p.generateReport();
    expect(report.summary.contractViolation).toBe(0);
    expect(report.summary.match).toBe(scenarios.length);
    expect(p.isAcceptable()).toBe(true);
  });

  test('PHASE 5 CERTIFICATION: onboarding functional', () => {
    const state = new MobileOnboardingState();
    expect(state.getProgress().completed).toBe(0);
    for (const step of ONBOARDING_STEPS) {
      if (step.required) state.completeStep(step.id);
      else state.skipStep(step.id);
    }
    expect(state.isComplete()).toBe(true);
  });

  test('PHASE 5 CERTIFICATION: toolbar hierarchy correct', () => {
    const primary = getPrimaryAction();
    expect(primary.id).toBe('preview');
    expect(primary.primary).toBe(true);
    expect(primary.requiresAndroid).toBe(false);
    const all = getAvailableToolbarActions(false);
    for (const a of all) {
      expect(a.requiresAndroid).toBe(false);
    }
  });

  test('PHASE 5 CERTIFICATION: release policy functional', () => {
    const v = new SimulatorVerification();
    v.setReleasePolicyLevel('strict');
    expect(v.getReleasePolicy().level).toBe('strict');
    v.setReleasePolicyLevel('standard');
    expect(v.getReleasePolicy().level).toBe('standard');
    v.setReleasePolicyLevel('permissive');
    expect(v.getReleasePolicy().level).toBe('permissive');
  });

  test('PHASE 5 CERTIFICATION: security audit passes', () => {
    for (const key of SIMULATOR_ONLY_KEYS) {
      expect(classifyConfig(key)).toBe('simulator_only');
    }

    const audit = auditConfigForArtifact(
      Array.from(SIMULATOR_ONLY_KEYS).map((key) => ({
        key,
        scope: 'simulator_only' as const,
        value: 'test',
        safe: false,
      })),
    );
    expect(audit.safe).toBe(false);
    expect(audit.violations.length).toBe(SIMULATOR_ONLY_KEYS.size);
  });

  test('PHASE 5 CERTIFICATION: performance budgets defined', () => {
    const metrics = DEFAULT_PERFORMANCE_BUDGETS.map((b) => b.metric);
    expect(metrics).toContain('startup_time');
    expect(metrics).toContain('ir_compilation');
    expect(metrics).toContain('memory_baseline');
    expect(metrics).toContain('hot_reload');
  });
});
