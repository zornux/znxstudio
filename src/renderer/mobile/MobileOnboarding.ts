/**
 * Mobile onboarding and readiness (Phase 5, §3–5).
 *
 * Manages the first-run experience for new mobile projects. Guides users
 * through simulator setup, Android toolchain configuration, and the initial
 * verification workflow. Provides a readiness indicator so users know when
 * the environment is ready for mobile development.
 *
 * Key spec constraint: new mobile apps must work WITHOUT Android SDK installed.
 * The simulator is the primary development experience; Android is optional.
 */

// ---------------------------------------------------------------------------
// Readiness model
// ---------------------------------------------------------------------------

export type ReadinessLevel = 'not_ready' | 'simulator_only' | 'android_ready' | 'fully_ready';

export interface ReadinessCheck {
  id: string;
  label: string;
  category: 'simulator' | 'android' | 'release';
  passed: boolean;
  required: boolean;
  detail: string;
}

export interface ReadinessReport {
  level: ReadinessLevel;
  checks: ReadinessCheck[];
  simulatorReady: boolean;
  androidReady: boolean;
  releaseReady: boolean;
  timestamp: number;
}

export const READINESS_CHECKS: ReadinessCheck[] = [
  { id: 'project-detected', label: 'Mobile project detected', category: 'simulator', passed: false, required: true, detail: 'Open a zornux-mobile workspace' },
  { id: 'compiler-available', label: 'Zornux compiler available', category: 'simulator', passed: false, required: true, detail: 'Zornux CLI must be installed' },
  { id: 'ir-compilation', label: 'IR compilation succeeds', category: 'simulator', passed: false, required: true, detail: 'Designer can compile screens to Mobile IR' },
  { id: 'simulator-start', label: 'Simulator can start', category: 'simulator', passed: false, required: true, detail: 'Simulator runtime initializes without errors' },
  { id: 'jdk-installed', label: 'JDK 21+ installed', category: 'android', passed: false, required: false, detail: 'Required for Android builds' },
  { id: 'android-sdk', label: 'Android SDK installed', category: 'android', passed: false, required: false, detail: 'Required for Android builds' },
  { id: 'build-tools', label: 'Build tools available', category: 'android', passed: false, required: false, detail: 'Android build tools for APK/AAB' },
  { id: 'device-available', label: 'Device or emulator available', category: 'android', passed: false, required: false, detail: 'Physical device or AVD for testing' },
  { id: 'signing-config', label: 'Signing configured', category: 'release', passed: false, required: false, detail: 'Keystore configured for release builds' },
  { id: 'release-check', label: 'Release checks pass', category: 'release', passed: false, required: false, detail: 'No blocking release issues' },
];

export function computeReadinessLevel(checks: ReadinessCheck[]): ReadinessLevel {
  const simChecks = checks.filter((c) => c.category === 'simulator');
  const androidChecks = checks.filter((c) => c.category === 'android');
  const releaseChecks = checks.filter((c) => c.category === 'release');

  const simReady = simChecks.every((c) => c.passed || !c.required);
  const androidReady = androidChecks.every((c) => c.passed);
  const releaseReady = releaseChecks.every((c) => c.passed);

  if (!simReady) return 'not_ready';
  if (simReady && androidReady && releaseReady) return 'fully_ready';
  if (simReady && androidReady) return 'android_ready';
  return 'simulator_only';
}

export function createReadinessReport(checks: ReadinessCheck[]): ReadinessReport {
  const level = computeReadinessLevel(checks);
  return {
    level,
    checks: [...checks],
    simulatorReady: checks.filter((c) => c.category === 'simulator').every((c) => c.passed || !c.required),
    androidReady: checks.filter((c) => c.category === 'android').every((c) => c.passed),
    releaseReady: checks.filter((c) => c.category === 'release').every((c) => c.passed),
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Onboarding steps
// ---------------------------------------------------------------------------

export type OnboardingStepId =
  | 'welcome'
  | 'create_project'
  | 'open_designer'
  | 'preview_simulator'
  | 'run_verification'
  | 'setup_android'
  | 'first_build'
  | 'complete';

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  description: string;
  command?: string;
  required: boolean;
  completed: boolean;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  { id: 'welcome', title: 'Welcome to Zornux Mobile', description: 'Create your first mobile app or open an existing project.', required: true, completed: false },
  { id: 'create_project', title: 'Create or open a project', description: 'Use the New Project wizard to scaffold a mobile app, or open a zornux-mobile workspace.', command: 'znxstudio.wizard.newProject', required: true, completed: false },
  { id: 'open_designer', title: 'Open the designer', description: 'Use the visual designer to build your app screens.', command: 'znxstudio.designer.open', required: true, completed: false },
  { id: 'preview_simulator', title: 'Preview in simulator', description: 'Click Preview to see your app running instantly — no Android SDK needed.', command: 'znxstudio.preview.start', required: true, completed: false },
  { id: 'run_verification', title: 'Run simulator verification', description: 'Verify your app works correctly in the simulator.', command: 'znxstudio.simulator.verify', required: false, completed: false },
  { id: 'setup_android', title: 'Set up Android (optional)', description: 'Install the Android toolchain to build APKs and test on real devices.', command: 'znxstudio.mobile.toolchainSetup', required: false, completed: false },
  { id: 'first_build', title: 'Build your first APK', description: 'Build a debug APK and install it on a device or emulator.', command: 'znxstudio.mobile.buildApk', required: false, completed: false },
  { id: 'complete', title: 'Ready to develop!', description: 'Your mobile development environment is configured.', required: false, completed: false },
];

// ---------------------------------------------------------------------------
// Onboarding state machine
// ---------------------------------------------------------------------------

export class MobileOnboardingState {
  private steps: OnboardingStep[];
  private currentStepIndex = 0;
  private dismissed = false;

  constructor() {
    this.steps = ONBOARDING_STEPS.map((s) => ({ ...s }));
  }

  getSteps(): OnboardingStep[] {
    return this.steps.map((s) => ({ ...s }));
  }

  getCurrentStep(): OnboardingStep | null {
    if (this.dismissed || this.currentStepIndex >= this.steps.length) return null;
    return { ...this.steps[this.currentStepIndex] };
  }

  completeStep(id: OnboardingStepId): void {
    const step = this.steps.find((s) => s.id === id);
    if (step) {
      step.completed = true;
      if (this.steps[this.currentStepIndex]?.id === id) {
        this.advanceToNextIncomplete();
      }
    }
  }

  skipStep(id: OnboardingStepId): void {
    const step = this.steps.find((s) => s.id === id);
    if (step && !step.required) {
      step.completed = true;
      if (this.steps[this.currentStepIndex]?.id === id) {
        this.advanceToNextIncomplete();
      }
    }
  }

  dismiss(): void {
    this.dismissed = true;
  }

  isDismissed(): boolean {
    return this.dismissed;
  }

  isComplete(): boolean {
    return this.steps.filter((s) => s.required).every((s) => s.completed);
  }

  getProgress(): { completed: number; total: number; percentage: number } {
    const total = this.steps.length;
    const completed = this.steps.filter((s) => s.completed).length;
    return { completed, total, percentage: total > 0 ? (completed / total) * 100 : 0 };
  }

  reset(): void {
    this.steps = ONBOARDING_STEPS.map((s) => ({ ...s }));
    this.currentStepIndex = 0;
    this.dismissed = false;
  }

  private advanceToNextIncomplete(): void {
    for (let i = this.currentStepIndex + 1; i < this.steps.length; i++) {
      if (!this.steps[i].completed) {
        this.currentStepIndex = i;
        return;
      }
    }
    this.currentStepIndex = this.steps.length;
  }
}

// ---------------------------------------------------------------------------
// Toolbar hierarchy
// ---------------------------------------------------------------------------

export type ToolbarAction = 'preview' | 'run_android' | 'build_apk' | 'build_aab' | 'verify' | 'release_check';

export interface ToolbarActionConfig {
  id: ToolbarAction;
  label: string;
  icon: string;
  command: string;
  primary: boolean;
  requiresAndroid: boolean;
  tooltip: string;
}

export const MOBILE_TOOLBAR_ACTIONS: ToolbarActionConfig[] = [
  { id: 'preview', label: 'Preview', icon: '▶', command: 'znxstudio.preview.start', primary: true, requiresAndroid: false, tooltip: 'Preview in Znx Simulator (no Android SDK needed)' },
  { id: 'verify', label: 'Verify', icon: '✓', command: 'znxstudio.simulator.verify', primary: false, requiresAndroid: false, tooltip: 'Run simulator verification' },
  { id: 'run_android', label: 'Run Android', icon: '📱', command: 'znxstudio.mobile.runStart', primary: false, requiresAndroid: true, tooltip: 'Run on Android device (requires Android SDK)' },
  { id: 'build_apk', label: 'Build APK', icon: '📦', command: 'znxstudio.mobile.buildApk', primary: false, requiresAndroid: true, tooltip: 'Build debug APK' },
  { id: 'build_aab', label: 'Build AAB', icon: '📦', command: 'znxstudio.mobile.buildAab', primary: false, requiresAndroid: true, tooltip: 'Build release App Bundle' },
  { id: 'release_check', label: 'Release Check', icon: '🔍', command: 'znxstudio.mobile.releaseCheck', primary: false, requiresAndroid: true, tooltip: 'Run release readiness checks' },
];

export function getAvailableToolbarActions(androidReady: boolean): ToolbarActionConfig[] {
  return MOBILE_TOOLBAR_ACTIONS.filter((a) => !a.requiresAndroid || androidReady);
}

export function getPrimaryAction(): ToolbarActionConfig {
  return MOBILE_TOOLBAR_ACTIONS[0];
}
