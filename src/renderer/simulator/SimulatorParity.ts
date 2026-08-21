/**
 * Simulator ↔ Android parity framework (Phase 5, §12–17).
 *
 * Manages parity scenarios, normalization rules, and comparison results.
 * Generates structured reports classifying every behavioral difference.
 */
import type {
  ParityCategory,
  ParityRegistry,
  ParityReport,
  ParityResult,
  ParityScenario,
  ParitySummary,
  ParityVerdict,
  NormalizationRule,
} from '../../shared/parityTypes';
import {
  CORE_PARITY_SCENARIOS,
  DEFAULT_NORMALIZATION_RULES,
  createParityRegistry,
  createParityReport,
  computeParitySummary,
  isParityAcceptable,
} from '../../shared/parityTypes';

export interface ParityListener {
  onScenarioCompleted(result: ParityResult): void;
  onReportGenerated(report: ParityReport): void;
}

export class SimulatorParity {
  private registry: ParityRegistry;
  private normalizationRules: NormalizationRule[];
  private listeners: ParityListener[] = [];
  private projectName = '';

  constructor() {
    this.registry = createParityRegistry();
    this.normalizationRules = [...DEFAULT_NORMALIZATION_RULES];
  }

  setProject(name: string): void {
    this.projectName = name;
  }

  addListener(listener: ParityListener): void {
    this.listeners.push(listener);
  }

  removeListener(listener: ParityListener): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  getScenarios(): ParityScenario[] {
    return [...this.registry.scenarios];
  }

  getScenariosByCategory(category: ParityCategory): ParityScenario[] {
    return this.registry.scenarios.filter((s) => s.category === category);
  }

  getScenario(id: string): ParityScenario | undefined {
    return this.registry.scenarios.find((s) => s.id === id);
  }

  addScenario(scenario: ParityScenario): void {
    const existing = this.registry.scenarios.findIndex((s) => s.id === scenario.id);
    if (existing >= 0) {
      this.registry.scenarios[existing] = scenario;
    } else {
      this.registry.scenarios.push(scenario);
    }
  }

  removeScenario(id: string): boolean {
    const idx = this.registry.scenarios.findIndex((s) => s.id === id);
    if (idx < 0) return false;
    this.registry.scenarios.splice(idx, 1);
    this.registry.results.delete(id);
    return true;
  }

  recordResult(result: ParityResult): void {
    this.registry.results.set(result.scenarioId, result);
    for (const listener of this.listeners) {
      listener.onScenarioCompleted(result);
    }
  }

  getResult(scenarioId: string): ParityResult | undefined {
    return this.registry.results.get(scenarioId);
  }

  getAllResults(): ParityResult[] {
    return Array.from(this.registry.results.values());
  }

  getResultsByVerdict(verdict: ParityVerdict): ParityResult[] {
    return this.getAllResults().filter((r) => r.verdict === verdict);
  }

  getResultsByCategory(category: ParityCategory): ParityResult[] {
    const scenarioIds = new Set(
      this.registry.scenarios.filter((s) => s.category === category).map((s) => s.id),
    );
    return this.getAllResults().filter((r) => scenarioIds.has(r.scenarioId));
  }

  getSummary(): ParitySummary {
    return computeParitySummary(this.getAllResults());
  }

  getCoverage(): { total: number; tested: number; percentage: number } {
    const total = this.registry.scenarios.length;
    const tested = this.registry.results.size;
    return { total, tested, percentage: total > 0 ? (tested / total) * 100 : 0 };
  }

  isAcceptable(): boolean {
    return isParityAcceptable(this.getSummary());
  }

  getCategories(): ParityCategory[] {
    const categories = new Set<ParityCategory>();
    for (const scenario of this.registry.scenarios) {
      categories.add(scenario.category);
    }
    return Array.from(categories).sort();
  }

  getCategoryBreakdown(): Map<ParityCategory, ParitySummary> {
    const breakdown = new Map<ParityCategory, ParitySummary>();
    for (const category of this.getCategories()) {
      const results = this.getResultsByCategory(category);
      breakdown.set(category, computeParitySummary(results));
    }
    return breakdown;
  }

  getNormalizationRules(): NormalizationRule[] {
    return [...this.normalizationRules];
  }

  setNormalizationRules(rules: NormalizationRule[]): void {
    this.normalizationRules = [...rules];
  }

  addNormalizationRule(rule: NormalizationRule): void {
    this.normalizationRules.push(rule);
  }

  normalizeObservation(observation: string): string {
    let normalized = observation;
    for (const rule of this.normalizationRules) {
      switch (rule.type) {
        case 'ignore_timing':
          normalized = normalized.replace(/\d+ms/g, '<timing>');
          break;
        case 'ignore_native_chrome':
          normalized = normalized.replace(/\b(system bar|status bar|navigation bar|action bar)\b/gi, '<native-chrome>');
          break;
        case 'normalize_color':
          normalized = normalized.replace(/#[0-9a-fA-F]{6}/g, '<color>');
          break;
        case 'round_coordinates':
          normalized = normalized.replace(/\d+\.\d+/g, (match) => {
            return Number(match).toFixed(rule.precision);
          });
          break;
      }
    }
    return normalized;
  }

  compareObservations(simulatorObs: string, androidObs: string, scenario?: ParityScenario): ParityVerdict {
    const normSim = this.normalizeObservation(simulatorObs);
    const normAndroid = this.normalizeObservation(androidObs);

    if (normSim === normAndroid) return 'MATCH';

    if (scenario?.acceptableDifferences) {
      for (const diff of scenario.acceptableDifferences) {
        if (simulatorObs.includes(diff) || androidObs.includes(diff)) {
          return 'EXPECTED_DIFFERENCE';
        }
      }
    }

    if (simulatorObs.includes('not supported') || simulatorObs.includes('unavailable')) {
      return 'SIMULATOR_GAP';
    }
    if (androidObs.includes('not supported') || androidObs.includes('unavailable')) {
      return 'ANDROID_GAP';
    }

    return 'CONTRACT_VIOLATION';
  }

  generateReport(): ParityReport {
    const report = createParityReport(
      this.projectName,
      this.getAllResults(),
      this.normalizationRules,
    );
    for (const listener of this.listeners) {
      listener.onReportGenerated(report);
    }
    return report;
  }

  resetResults(): void {
    this.registry.results.clear();
  }

  resetAll(): void {
    this.registry = createParityRegistry();
    this.normalizationRules = [...DEFAULT_NORMALIZATION_RULES];
  }
}
