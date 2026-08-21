/**
 * Android parity runner (Phase 6).
 *
 * Runs the same semantic parity scenarios in Znx Simulator AND on a real
 * Android device, then compares results using the Phase 5 normalization
 * framework. Reports per-scenario verdicts:
 *   MATCH, EXPECTED_DIFFERENCE, SIMULATOR_GAP, ANDROID_GAP, CONTRACT_VIOLATION
 *
 * This is the real-device counterpart to SimulatorParity (Phase 5).
 */
import type {
  ParityVerdict,
  ParityCategory,
  ParityScenario,
  ParityResult,
  ParitySummary,
} from '../../shared/parityTypes';
import {
  CORE_PARITY_SCENARIOS,
  computeParitySummary,
  isParityAcceptable,
} from '../../shared/parityTypes';
import type { E2EResult } from '../../shared/androidE2ETypes';

// ---------------------------------------------------------------------------
// Parity pair
// ---------------------------------------------------------------------------

export interface ParityPair {
  scenario: ParityScenario;
  simulatorResult: ParityResult | null;
  androidResult: ParityResult | null;
  verdict: ParityVerdict | null;
  compared: boolean;
}

// ---------------------------------------------------------------------------
// Parity runner
// ---------------------------------------------------------------------------

export class AndroidParityRunner {
  private pairs: Map<string, ParityPair> = new Map();
  private projectName = '';

  constructor() {
    for (const scenario of CORE_PARITY_SCENARIOS) {
      this.pairs.set(scenario.id, {
        scenario,
        simulatorResult: null,
        androidResult: null,
        verdict: null,
        compared: false,
      });
    }
  }

  setProject(name: string): void {
    this.projectName = name;
  }

  getPairs(): ParityPair[] {
    return Array.from(this.pairs.values());
  }

  getPair(scenarioId: string): ParityPair | undefined {
    return this.pairs.get(scenarioId);
  }

  recordSimulatorResult(result: ParityResult): void {
    const pair = this.pairs.get(result.scenarioId);
    if (pair) {
      pair.simulatorResult = result;
      pair.compared = false;
      pair.verdict = null;
    }
  }

  recordAndroidResult(result: ParityResult): void {
    const pair = this.pairs.get(result.scenarioId);
    if (pair) {
      pair.androidResult = result;
      pair.compared = false;
      pair.verdict = null;
    }
  }

  compare(scenarioId: string): ParityVerdict | null {
    const pair = this.pairs.get(scenarioId);
    if (!pair || !pair.simulatorResult || !pair.androidResult) return null;

    const simObs = pair.simulatorResult.simulatorObservation;
    const androidObs = pair.androidResult.androidObservation;

    let verdict: ParityVerdict;

    if (simObs === androidObs) {
      verdict = 'MATCH';
    } else if (pair.scenario.acceptableDifferences) {
      const isAcceptable = pair.scenario.acceptableDifferences.some(
        (diff) => simObs.includes(diff) || androidObs.includes(diff),
      );
      verdict = isAcceptable ? 'EXPECTED_DIFFERENCE' : this.classifyDifference(simObs, androidObs);
    } else {
      verdict = this.classifyDifference(simObs, androidObs);
    }

    pair.verdict = verdict;
    pair.compared = true;
    return verdict;
  }

  compareAll(): Map<string, ParityVerdict> {
    const verdicts = new Map<string, ParityVerdict>();
    for (const [id, pair] of this.pairs) {
      if (pair.simulatorResult && pair.androidResult) {
        const verdict = this.compare(id);
        if (verdict) verdicts.set(id, verdict);
      }
    }
    return verdicts;
  }

  getSummary(): ParitySummary {
    const results: ParityResult[] = [];
    for (const pair of this.pairs.values()) {
      if (pair.compared && pair.verdict && pair.simulatorResult) {
        results.push({
          ...pair.simulatorResult,
          verdict: pair.verdict,
        });
      }
    }
    return computeParitySummary(results);
  }

  isAcceptable(): boolean {
    return isParityAcceptable(this.getSummary());
  }

  getCoverage(): { total: number; compared: number; percentage: number } {
    const total = this.pairs.size;
    const compared = Array.from(this.pairs.values()).filter((p) => p.compared).length;
    return { total, compared, percentage: total > 0 ? (compared / total) * 100 : 0 };
  }

  getCategoryBreakdown(): Map<ParityCategory, { total: number; match: number; violation: number }> {
    const breakdown = new Map<ParityCategory, { total: number; match: number; violation: number }>();
    for (const pair of this.pairs.values()) {
      const cat = pair.scenario.category;
      let entry = breakdown.get(cat);
      if (!entry) {
        entry = { total: 0, match: 0, violation: 0 };
        breakdown.set(cat, entry);
      }
      entry.total++;
      if (pair.compared && pair.verdict) {
        if (pair.verdict === 'MATCH' || pair.verdict === 'EXPECTED_DIFFERENCE') entry.match++;
        if (pair.verdict === 'CONTRACT_VIOLATION') entry.violation++;
      }
    }
    return breakdown;
  }

  getVerdictCounts(): Record<ParityVerdict, number> {
    const counts: Record<ParityVerdict, number> = {
      MATCH: 0,
      EXPECTED_DIFFERENCE: 0,
      SIMULATOR_GAP: 0,
      ANDROID_GAP: 0,
      CONTRACT_VIOLATION: 0,
    };
    for (const pair of this.pairs.values()) {
      if (pair.compared && pair.verdict) {
        counts[pair.verdict]++;
      }
    }
    return counts;
  }

  resetAll(): void {
    for (const pair of this.pairs.values()) {
      pair.simulatorResult = null;
      pair.androidResult = null;
      pair.verdict = null;
      pair.compared = false;
    }
  }

  private classifyDifference(simObs: string, androidObs: string): ParityVerdict {
    if (simObs.includes('not supported') || simObs.includes('unavailable') || simObs.includes('not implemented')) {
      return 'SIMULATOR_GAP';
    }
    if (androidObs.includes('not supported') || androidObs.includes('unavailable') || androidObs.includes('not implemented')) {
      return 'ANDROID_GAP';
    }
    return 'CONTRACT_VIOLATION';
  }
}
