/**
 * Verification states and metadata for the Simulator → Android → Release
 * certification pipeline (Phase 5, §6–11).
 *
 * Three verification stages exist independently — they are NOT cumulative:
 *   1. Simulator Verified — the app runs correctly in the simulator
 *   2. Android Verified — the app runs correctly on a real/emulated Android device
 *   3. Release Verified — the app passes all release checks (signing, permissions, etc.)
 *
 * Each stage tracks its own state, metadata, and staleness independently.
 * Verification becomes stale when source files change after the last verification.
 */

// ---------------------------------------------------------------------------
// Verification state
// ---------------------------------------------------------------------------

export type VerificationStage = 'simulator' | 'android' | 'release';

export type VerificationState =
  | 'not_run'
  | 'running'
  | 'passed'
  | 'failed'
  | 'stale';

export interface VerificationFinding {
  severity: 'blocker' | 'high' | 'medium' | 'low';
  code: string;
  message: string;
  file?: string;
  line?: number;
  category: string;
}

export interface VerificationMetadata {
  stage: VerificationStage;
  state: VerificationState;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  sourceHash: string | null;
  findings: VerificationFinding[];
  passCount: number;
  failCount: number;
  skipCount: number;
  deviceId?: string;
  deviceName?: string;
  buildMode?: 'debug' | 'release';
}

// ---------------------------------------------------------------------------
// Staleness detection
// ---------------------------------------------------------------------------

export interface SourceFingerprint {
  hash: string;
  fileCount: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Verification report
// ---------------------------------------------------------------------------

export interface VerificationReport {
  projectName: string;
  projectVersion: string;
  timestamp: number;
  stages: Record<VerificationStage, VerificationMetadata>;
  overallReady: boolean;
  blockers: VerificationFinding[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Release policy
// ---------------------------------------------------------------------------

export type ReleasePolicyLevel = 'strict' | 'standard' | 'permissive';

export interface ReleasePolicy {
  level: ReleasePolicyLevel;
  requireSimulatorPass: boolean;
  requireAndroidPass: boolean;
  requireReleaseCheck: boolean;
  allowKnownIssues: boolean;
  maxHighFindings: number;
  maxMediumFindings: number;
}

export const RELEASE_POLICIES: Record<ReleasePolicyLevel, ReleasePolicy> = {
  strict: {
    level: 'strict',
    requireSimulatorPass: true,
    requireAndroidPass: true,
    requireReleaseCheck: true,
    allowKnownIssues: false,
    maxHighFindings: 0,
    maxMediumFindings: 0,
  },
  standard: {
    level: 'standard',
    requireSimulatorPass: true,
    requireAndroidPass: true,
    requireReleaseCheck: true,
    allowKnownIssues: false,
    maxHighFindings: 0,
    maxMediumFindings: 5,
  },
  permissive: {
    level: 'permissive',
    requireSimulatorPass: true,
    requireAndroidPass: false,
    requireReleaseCheck: true,
    allowKnownIssues: true,
    maxHighFindings: 3,
    maxMediumFindings: 20,
  },
};

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function createVerificationMetadata(stage: VerificationStage): VerificationMetadata {
  return {
    stage,
    state: 'not_run',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    sourceHash: null,
    findings: [],
    passCount: 0,
    failCount: 0,
    skipCount: 0,
  };
}

export function createVerificationReport(
  projectName: string,
  projectVersion: string,
  stages: Record<VerificationStage, VerificationMetadata>,
): VerificationReport {
  const allFindings = [
    ...stages.simulator.findings,
    ...stages.android.findings,
    ...stages.release.findings,
  ];
  const blockers = allFindings.filter((f) => f.severity === 'blocker');
  const highCount = allFindings.filter((f) => f.severity === 'high').length;

  const overallReady =
    stages.simulator.state === 'passed' &&
    stages.android.state === 'passed' &&
    stages.release.state === 'passed' &&
    blockers.length === 0 &&
    highCount === 0;

  const parts: string[] = [];
  for (const stage of ['simulator', 'android', 'release'] as VerificationStage[]) {
    const meta = stages[stage];
    parts.push(`${stage}: ${meta.state} (${meta.passCount}/${meta.passCount + meta.failCount})`);
  }

  return {
    projectName,
    projectVersion,
    timestamp: Date.now(),
    stages,
    overallReady,
    blockers,
    summary: parts.join(' | '),
  };
}

export function isVerificationStale(meta: VerificationMetadata, currentHash: string): boolean {
  if (meta.state === 'not_run' || meta.state === 'running') return false;
  if (!meta.sourceHash) return true;
  return meta.sourceHash !== currentHash;
}

export function checkReleasePolicy(
  policy: ReleasePolicy,
  stages: Record<VerificationStage, VerificationMetadata>,
): { allowed: boolean; violations: string[] } {
  const violations: string[] = [];

  if (policy.requireSimulatorPass && stages.simulator.state !== 'passed') {
    violations.push(`Simulator verification ${stages.simulator.state} (required: passed)`);
  }
  if (policy.requireAndroidPass && stages.android.state !== 'passed') {
    violations.push(`Android verification ${stages.android.state} (required: passed)`);
  }
  if (policy.requireReleaseCheck && stages.release.state !== 'passed') {
    violations.push(`Release check ${stages.release.state} (required: passed)`);
  }

  const allFindings = [
    ...stages.simulator.findings,
    ...stages.android.findings,
    ...stages.release.findings,
  ];

  const highCount = allFindings.filter((f) => f.severity === 'high').length;
  const mediumCount = allFindings.filter((f) => f.severity === 'medium').length;
  const blockerCount = allFindings.filter((f) => f.severity === 'blocker').length;

  if (blockerCount > 0) {
    violations.push(`${blockerCount} blocker finding(s) — release blocked`);
  }
  if (highCount > policy.maxHighFindings) {
    violations.push(`${highCount} high finding(s) exceeds limit of ${policy.maxHighFindings}`);
  }
  if (mediumCount > policy.maxMediumFindings) {
    violations.push(`${mediumCount} medium finding(s) exceeds limit of ${policy.maxMediumFindings}`);
  }

  return { allowed: violations.length === 0, violations };
}
