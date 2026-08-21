/**
 * Android E2E pipeline runner (Phase 6).
 *
 * Orchestrates the full path:
 *   .zx source → Compiler → Semantic Analysis → Mobile IR → Android Backend
 *   → Kotlin/Compose → Gradle → APK → Install → Launch → UI Test
 *
 * Each stage is tracked independently with timing and error reporting.
 * The runner does NOT short-circuit: it continues as far as possible and
 * marks unreachable stages as skipped so the report shows exactly what ran.
 */
import type {
  PipelineStage,
  PipelineStageResult,
  BuildResult,
  BuildArtifact,
  DeviceTarget,
  E2EScenario,
  E2EResult,
  E2EStepResult,
  E2EStep,
} from '../../shared/androidE2ETypes';
import {
  PIPELINE_STAGES,
  createPipelineStageResult,
  createBuildResult,
  CORE_E2E_SCENARIOS,
} from '../../shared/androidE2ETypes';

// ---------------------------------------------------------------------------
// Pipeline listener
// ---------------------------------------------------------------------------

export interface PipelineListener {
  onStageStarted(stage: PipelineStage): void;
  onStageCompleted(stage: PipelineStage, result: PipelineStageResult): void;
  onPipelineCompleted(result: BuildResult): void;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const SAFE_PROJECT_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SAFE_PATH = /^[A-Za-z0-9_./ -]+$/;
const SHELL_METACHARACTERS = /[;&|`$(){}[\]<>!#~*?\n\r\\'"]/;
const PATH_TRAVERSAL = /\.\.[/\\]|%2[eE]%2[eE]|%2[fF]/;
const NULL_BYTE = /\x00/;

export function validateProjectName(name: string): { valid: boolean; reason: string } {
  if (!name || name.length === 0) return { valid: false, reason: 'Project name is empty' };
  if (name.length > 64) return { valid: false, reason: 'Project name exceeds 64 characters' };
  if (NULL_BYTE.test(name)) return { valid: false, reason: 'Project name contains null byte' };
  if (SHELL_METACHARACTERS.test(name)) return { valid: false, reason: 'Project name contains shell metacharacters' };
  if (!SAFE_PROJECT_NAME.test(name)) return { valid: false, reason: 'Project name must start with a letter and contain only alphanumeric, hyphen, or underscore' };
  return { valid: true, reason: '' };
}

export function validatePath(path: string): { valid: boolean; reason: string } {
  if (!path || path.length === 0) return { valid: false, reason: 'Path is empty' };
  if (NULL_BYTE.test(path)) return { valid: false, reason: 'Path contains null byte' };
  if (PATH_TRAVERSAL.test(path)) return { valid: false, reason: 'Path contains traversal sequence' };
  if (path.startsWith('/') && !path.startsWith('/home/') && !path.startsWith('/tmp/')) {
    return { valid: false, reason: 'Absolute path outside allowed directories' };
  }
  if (!SAFE_PATH.test(path)) return { valid: false, reason: 'Path contains disallowed characters' };
  return { valid: true, reason: '' };
}

export function sanitizeForShell(input: string): string {
  return input.replace(SHELL_METACHARACTERS, '');
}

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

export class AndroidE2ERunner {
  private stages: Map<PipelineStage, PipelineStageResult> = new Map();
  private listeners: PipelineListener[] = [];
  private device: DeviceTarget | null = null;
  private projectName = '';
  private workspaceRoot = '';

  constructor() {
    this.reset();
  }

  setProject(name: string, workspaceRoot: string): { valid: boolean; reason: string } {
    const nameCheck = validateProjectName(name);
    if (!nameCheck.valid) return nameCheck;
    const pathCheck = validatePath(workspaceRoot);
    if (!pathCheck.valid) return pathCheck;
    this.projectName = name;
    this.workspaceRoot = workspaceRoot;
    return { valid: true, reason: '' };
  }

  setDevice(device: DeviceTarget): void {
    this.device = device;
  }

  getDevice(): DeviceTarget | null {
    return this.device;
  }

  addListener(listener: PipelineListener): void {
    this.listeners.push(listener);
  }

  removeListener(listener: PipelineListener): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  getStage(stage: PipelineStage): PipelineStageResult {
    return { ...this.stages.get(stage)! };
  }

  getAllStages(): PipelineStageResult[] {
    return PIPELINE_STAGES.map((s) => this.getStage(s));
  }

  beginStage(stage: PipelineStage): void {
    const result = this.stages.get(stage)!;
    result.state = 'running';
    result.startedAt = Date.now();
    for (const listener of this.listeners) {
      listener.onStageStarted(stage);
    }
  }

  completeStage(stage: PipelineStage, passed: boolean, output?: string, errors?: string[]): void {
    const result = this.stages.get(stage)!;
    result.state = passed ? 'passed' : 'failed';
    result.completedAt = Date.now();
    result.durationMs = result.startedAt ? result.completedAt - result.startedAt : null;
    if (output) result.output = output;
    if (errors) result.errors = errors;
    for (const listener of this.listeners) {
      listener.onStageCompleted(stage, { ...result });
    }
  }

  skipStage(stage: PipelineStage, reason: string): void {
    const result = this.stages.get(stage)!;
    result.state = 'skipped';
    result.output = reason;
  }

  skipRemainingFrom(failedStage: PipelineStage): void {
    const idx = PIPELINE_STAGES.indexOf(failedStage);
    for (let i = idx + 1; i < PIPELINE_STAGES.length; i++) {
      this.skipStage(PIPELINE_STAGES[i], `Skipped: ${failedStage} failed`);
    }
  }

  isStageReady(stage: PipelineStage): boolean {
    const idx = PIPELINE_STAGES.indexOf(stage);
    if (idx === 0) return true;
    const prev = this.stages.get(PIPELINE_STAGES[idx - 1])!;
    return prev.state === 'passed';
  }

  isPipelinePassed(): boolean {
    return PIPELINE_STAGES.every((s) => this.stages.get(s)!.state === 'passed');
  }

  getFailedStages(): PipelineStage[] {
    return PIPELINE_STAGES.filter((s) => this.stages.get(s)!.state === 'failed');
  }

  getSkippedStages(): PipelineStage[] {
    return PIPELINE_STAGES.filter((s) => this.stages.get(s)!.state === 'skipped');
  }

  generateBuildResult(artifact: BuildArtifact | null): BuildResult {
    const stages = this.getAllStages();
    const errors = stages.flatMap((s) => s.errors);
    const totalMs = stages.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
    const result: BuildResult = {
      success: this.isPipelinePassed(),
      artifact,
      stages,
      totalDurationMs: totalMs,
      errors,
      warnings: [],
    };
    for (const listener of this.listeners) {
      listener.onPipelineCompleted(result);
    }
    return result;
  }

  reset(): void {
    this.stages.clear();
    for (const stage of PIPELINE_STAGES) {
      this.stages.set(stage, createPipelineStageResult(stage));
    }
  }
}

// ---------------------------------------------------------------------------
// E2E test executor
// ---------------------------------------------------------------------------

export class AndroidE2EExecutor {
  private scenarios: E2EScenario[] = [...CORE_E2E_SCENARIOS];
  private results: Map<string, E2EResult> = new Map();

  getScenarios(): E2EScenario[] {
    return [...this.scenarios];
  }

  getScenariosByCategory(category: string): E2EScenario[] {
    return this.scenarios.filter((s) => s.category === category);
  }

  getScenariosForApiLevel(apiLevel: number): E2EScenario[] {
    return this.scenarios.filter((s) => s.minApiLevel <= apiLevel);
  }

  addScenario(scenario: E2EScenario): void {
    const idx = this.scenarios.findIndex((s) => s.id === scenario.id);
    if (idx >= 0) this.scenarios[idx] = scenario;
    else this.scenarios.push(scenario);
  }

  recordResult(result: E2EResult): void {
    this.results.set(result.scenarioId, result);
  }

  getResult(scenarioId: string): E2EResult | undefined {
    return this.results.get(scenarioId);
  }

  getAllResults(): E2EResult[] {
    return Array.from(this.results.values());
  }

  getPassedResults(): E2EResult[] {
    return this.getAllResults().filter((r) => r.passed);
  }

  getFailedResults(): E2EResult[] {
    return this.getAllResults().filter((r) => !r.passed);
  }

  getCoverage(): { total: number; tested: number; passed: number; failed: number; percentage: number } {
    const total = this.scenarios.length;
    const tested = this.results.size;
    const passed = this.getPassedResults().length;
    const failed = this.getFailedResults().length;
    return { total, tested, passed, failed, percentage: total > 0 ? (tested / total) * 100 : 0 };
  }

  getApiLevelCoverage(): Map<number, { tested: number; passed: number; failed: number }> {
    const coverage = new Map<number, { tested: number; passed: number; failed: number }>();
    for (const result of this.results.values()) {
      let entry = coverage.get(result.apiLevel);
      if (!entry) {
        entry = { tested: 0, passed: 0, failed: 0 };
        coverage.set(result.apiLevel, entry);
      }
      entry.tested++;
      if (result.passed) entry.passed++;
      else entry.failed++;
    }
    return coverage;
  }

  getDeviceCoverage(): string[] {
    const devices = new Set<string>();
    for (const result of this.results.values()) {
      devices.add(result.device);
    }
    return Array.from(devices);
  }

  validateStep(step: E2EStep): { valid: boolean; reason: string } {
    if (step.target && SHELL_METACHARACTERS.test(step.target)) {
      return { valid: false, reason: `Step target contains shell metacharacters: ${step.target}` };
    }
    if (step.value && NULL_BYTE.test(step.value)) {
      return { valid: false, reason: 'Step value contains null byte' };
    }
    return { valid: true, reason: '' };
  }

  resetResults(): void {
    this.results.clear();
  }
}
