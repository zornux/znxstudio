/**
 * Android release verifier (Phase 6).
 *
 * Certifies the release path:
 *   Release Config → AAB → Signing → Artifact Inspection → Release Verification
 *
 * Validates:
 *   - Build configuration (SDK versions, application ID, version)
 *   - Signing requirements (scheme, key size, non-debug keystore)
 *   - Manifest correctness (no debuggable, proper permissions)
 *   - Artifact cleanliness (no simulator contamination)
 *   - ProGuard/R8 application (no debug symbols in release)
 *   - CI gate compliance
 */
import type {
  BuildArtifact,
  ManifestInspection,
  SigningVerification,
  ContaminationFinding,
  CIGate,
  GACertificationReport,
} from '../../shared/androidE2ETypes';
import {
  CI_GATES,
  SUPPORTED_API_LEVELS,
  MIN_API_LEVEL,
  TARGET_API_LEVEL,
  createGACertificationReport,
  isGAReady,
} from '../../shared/androidE2ETypes';
import { validateManifest, validateSigning } from './AndroidArtifactInspector';

// ---------------------------------------------------------------------------
// Release configuration validation
// ---------------------------------------------------------------------------

export interface ReleaseConfig {
  applicationId: string;
  versionName: string;
  versionCode: number;
  minSdk: number;
  targetSdk: number;
  compileSdk: number;
  signingConfigured: boolean;
  keystorePath: string | null;
  proguardEnabled: boolean;
}

export function validateReleaseConfig(config: ReleaseConfig): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.applicationId || !/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(config.applicationId)) {
    errors.push('Invalid application ID');
  }

  if (!config.versionName || config.versionName.length === 0) {
    errors.push('Missing version name');
  }

  if (config.versionCode < 1) {
    errors.push('Version code must be >= 1');
  }

  if (config.minSdk < MIN_API_LEVEL) {
    errors.push(`minSdk ${config.minSdk} below minimum ${MIN_API_LEVEL}`);
  }

  if (config.targetSdk < 33) {
    warnings.push(`targetSdk ${config.targetSdk} below recommended 33`);
  }

  if (config.minSdk > config.targetSdk) {
    errors.push('minSdk cannot exceed targetSdk');
  }

  if (config.targetSdk > config.compileSdk) {
    errors.push('targetSdk cannot exceed compileSdk');
  }

  if (!config.signingConfigured) {
    errors.push('Signing not configured for release');
  }

  if (!config.proguardEnabled) {
    warnings.push('ProGuard/R8 not enabled — release APK may contain debug symbols');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Release verification
// ---------------------------------------------------------------------------

export interface ReleaseVerificationResult {
  passed: boolean;
  configValid: boolean;
  manifestValid: boolean;
  signingValid: boolean;
  artifactClean: boolean;
  errors: string[];
  warnings: string[];
}

export function verifyRelease(
  config: ReleaseConfig,
  manifest: ManifestInspection,
  signing: SigningVerification,
  contamination: ContaminationFinding[],
): ReleaseVerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const configResult = validateReleaseConfig(config);
  errors.push(...configResult.errors);
  warnings.push(...configResult.warnings);

  const manifestResult = validateManifest(manifest, 'release');
  errors.push(...manifestResult.errors);
  warnings.push(...manifestResult.warnings);

  const signingResult = validateSigning(signing, 'release');
  errors.push(...signingResult.errors);

  if (contamination.length > 0) {
    for (const finding of contamination) {
      errors.push(`Artifact contamination: ${finding.type} in ${finding.path}`);
    }
  }

  return {
    passed: errors.length === 0,
    configValid: configResult.valid,
    manifestValid: manifestResult.valid,
    signingValid: signingResult.valid,
    artifactClean: contamination.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// CI gate validation
// ---------------------------------------------------------------------------

export function getCIGates(): CIGate[] {
  return [...CI_GATES];
}

export function getSimulatorGates(): CIGate[] {
  return CI_GATES.filter((g) => g.type === 'simulator');
}

export function getAndroidGates(): CIGate[] {
  return CI_GATES.filter((g) => g.type === 'android');
}

export function getReleaseGates(): CIGate[] {
  return CI_GATES.filter((g) => g.type === 'release');
}

export function validateCIGates(): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  const simGates = getSimulatorGates();
  if (simGates.length === 0) {
    issues.push('No simulator CI gate defined');
  }

  const androidGates = getAndroidGates();
  if (androidGates.length === 0) {
    issues.push('No Android CI gate defined');
  }

  const releaseGates = getReleaseGates();
  if (releaseGates.length === 0) {
    issues.push('No release CI gate defined');
  }

  const hasSimBlocking = simGates.some((g) => g.blocking);
  const hasAndroidBlocking = androidGates.some((g) => g.blocking);
  if (!hasSimBlocking) issues.push('No blocking simulator gate');
  if (!hasAndroidBlocking) issues.push('No blocking Android gate');

  for (const gate of CI_GATES) {
    if (gate.timeout <= 0) issues.push(`Gate "${gate.name}" has invalid timeout`);
    if (gate.apiLevels) {
      for (const level of gate.apiLevels) {
        if (level < MIN_API_LEVEL || level > TARGET_API_LEVEL) {
          issues.push(`Gate "${gate.name}" includes unsupported API level ${level}`);
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// GA certification
// ---------------------------------------------------------------------------

export class GACertification {
  private report: GACertificationReport;

  constructor(projectName: string, projectVersion: string) {
    this.report = createGACertificationReport(projectName, projectVersion);
  }

  getReport(): GACertificationReport {
    return { ...this.report };
  }

  addBlocker(issue: string): void {
    this.report.blockers.push(issue);
  }

  addHighIssue(issue: string): void {
    this.report.highIssues.push(issue);
  }

  addKnownLimitation(limitation: string): void {
    this.report.knownLimitations.push(limitation);
  }

  addNotExecuted(item: string): void {
    this.report.notExecuted.push(item);
  }

  setApiLevelsCovered(levels: number[]): void {
    this.report.apiLevelsCovered = [...levels];
  }

  setDevicesCovered(devices: string[]): void {
    this.report.devicesCovered = [...devices];
  }

  setParityVerdicts(verdicts: GACertificationReport['parityVerdicts']): void {
    this.report.parityVerdicts = { ...verdicts };
  }

  setSigningVerification(signing: SigningVerification): void {
    this.report.signingVerification = signing;
  }

  setManifestInspection(manifest: ManifestInspection): void {
    this.report.manifestInspection = manifest;
  }

  setContaminationFindings(findings: ContaminationFinding[]): void {
    this.report.contaminationFindings = [...findings];
  }

  finalize(): GACertificationReport {
    this.report.timestamp = Date.now();
    this.report.verdict = isGAReady(this.report) ? 'GA_VERIFIED' : 'GA_NOT_VERIFIED';
    return { ...this.report };
  }
}
