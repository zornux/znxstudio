/**
 * Simulator verification state machine (Phase 5, §6–11).
 *
 * Manages the three independent verification stages (simulator, android, release)
 * and tracks staleness when source files change after verification.
 */
import type {
  VerificationStage,
  VerificationState,
  VerificationMetadata,
  VerificationFinding,
  VerificationReport,
  SourceFingerprint,
  ReleasePolicy,
} from '../../shared/verificationTypes';
import {
  createVerificationMetadata,
  createVerificationReport,
  isVerificationStale,
  checkReleasePolicy,
  RELEASE_POLICIES,
} from '../../shared/verificationTypes';

export interface VerificationListener {
  onStateChanged(stage: VerificationStage, state: VerificationState): void;
  onStaleDetected(stage: VerificationStage): void;
  onFindingAdded(stage: VerificationStage, finding: VerificationFinding): void;
}

export class SimulatorVerification {
  private stages: Record<VerificationStage, VerificationMetadata>;
  private currentSourceHash: string | null = null;
  private listeners: VerificationListener[] = [];
  private releasePolicy: ReleasePolicy = RELEASE_POLICIES.standard;
  private projectName = '';
  private projectVersion = '';

  constructor() {
    this.stages = {
      simulator: createVerificationMetadata('simulator'),
      android: createVerificationMetadata('android'),
      release: createVerificationMetadata('release'),
    };
  }

  setProject(name: string, version: string): void {
    this.projectName = name;
    this.projectVersion = version;
  }

  addListener(listener: VerificationListener): void {
    this.listeners.push(listener);
  }

  removeListener(listener: VerificationListener): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  getStage(stage: VerificationStage): VerificationMetadata {
    return { ...this.stages[stage], findings: [...this.stages[stage].findings] };
  }

  getAllStages(): Record<VerificationStage, VerificationMetadata> {
    return {
      simulator: this.getStage('simulator'),
      android: this.getStage('android'),
      release: this.getStage('release'),
    };
  }

  getState(stage: VerificationStage): VerificationState {
    return this.stages[stage].state;
  }

  getReleasePolicy(): ReleasePolicy {
    return { ...this.releasePolicy };
  }

  setReleasePolicy(policy: ReleasePolicy): void {
    this.releasePolicy = { ...policy };
  }

  setReleasePolicyLevel(level: 'strict' | 'standard' | 'permissive'): void {
    this.releasePolicy = { ...RELEASE_POLICIES[level] };
  }

  beginVerification(stage: VerificationStage): void {
    const meta = this.stages[stage];
    meta.state = 'running';
    meta.startedAt = Date.now();
    meta.completedAt = null;
    meta.durationMs = null;
    meta.findings = [];
    meta.passCount = 0;
    meta.failCount = 0;
    meta.skipCount = 0;
    this.notifyStateChanged(stage, 'running');
  }

  addFinding(stage: VerificationStage, finding: VerificationFinding): void {
    this.stages[stage].findings.push(finding);
    for (const listener of this.listeners) {
      listener.onFindingAdded(stage, finding);
    }
  }

  recordTestResult(stage: VerificationStage, passed: boolean): void {
    if (passed) {
      this.stages[stage].passCount++;
    } else {
      this.stages[stage].failCount++;
    }
  }

  recordSkip(stage: VerificationStage): void {
    this.stages[stage].skipCount++;
  }

  completeVerification(stage: VerificationStage, passed: boolean): void {
    const meta = this.stages[stage];
    meta.state = passed ? 'passed' : 'failed';
    meta.completedAt = Date.now();
    meta.durationMs = meta.startedAt ? meta.completedAt - meta.startedAt : null;
    meta.sourceHash = this.currentSourceHash;
    this.notifyStateChanged(stage, meta.state);
  }

  setDeviceInfo(stage: VerificationStage, deviceId: string, deviceName: string): void {
    this.stages[stage].deviceId = deviceId;
    this.stages[stage].deviceName = deviceName;
  }

  setBuildMode(stage: VerificationStage, mode: 'debug' | 'release'): void {
    this.stages[stage].buildMode = mode;
  }

  updateSourceHash(hash: string): void {
    const previousHash = this.currentSourceHash;
    this.currentSourceHash = hash;

    if (previousHash === null || previousHash === hash) return;

    for (const stage of ['simulator', 'android', 'release'] as VerificationStage[]) {
      if (isVerificationStale(this.stages[stage], hash)) {
        this.stages[stage].state = 'stale';
        for (const listener of this.listeners) {
          listener.onStaleDetected(stage);
        }
        this.notifyStateChanged(stage, 'stale');
      }
    }
  }

  checkStaleness(): VerificationStage[] {
    if (!this.currentSourceHash) return [];
    const stale: VerificationStage[] = [];
    for (const stage of ['simulator', 'android', 'release'] as VerificationStage[]) {
      if (isVerificationStale(this.stages[stage], this.currentSourceHash)) {
        stale.push(stage);
      }
    }
    return stale;
  }

  isStageStale(stage: VerificationStage): boolean {
    if (!this.currentSourceHash) return false;
    return isVerificationStale(this.stages[stage], this.currentSourceHash);
  }

  generateReport(): VerificationReport {
    return createVerificationReport(this.projectName, this.projectVersion, this.getAllStages());
  }

  checkRelease(): { allowed: boolean; violations: string[] } {
    return checkReleasePolicy(this.releasePolicy, this.stages);
  }

  resetStage(stage: VerificationStage): void {
    this.stages[stage] = createVerificationMetadata(stage);
    this.notifyStateChanged(stage, 'not_run');
  }

  resetAll(): void {
    for (const stage of ['simulator', 'android', 'release'] as VerificationStage[]) {
      this.resetStage(stage);
    }
  }

  getSourceFingerprint(): SourceFingerprint | null {
    if (!this.currentSourceHash) return null;
    return {
      hash: this.currentSourceHash,
      fileCount: 0,
      timestamp: Date.now(),
    };
  }

  private notifyStateChanged(stage: VerificationStage, state: VerificationState): void {
    for (const listener of this.listeners) {
      listener.onStateChanged(stage, state);
    }
  }
}
