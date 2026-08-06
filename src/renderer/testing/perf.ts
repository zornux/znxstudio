/**
 * Pure test-performance analysis (Phase 9E). Builds on the per-test `durationMs`
 * the real `zornux test --json` reports, plus the two engines (interpreter / vm,
 * 8F). Ranks slow tests, flags a budget, and compares the engines per test.
 * No DOM / no Monaco.
 */
import type { TestCaseResult, TestRunResult } from './testModel';

export interface PerfStats {
  total: number;
  totalMs: number;
  meanMs: number;
  maxMs: number;
  slowest?: string;
}

export function perfStats(result: TestRunResult): PerfStats {
  const durations = result.tests.map((t) => t.durationMs);
  const totalMs = durations.reduce((sum, ms) => sum + ms, 0);
  const maxMs = durations.length ? Math.max(...durations) : 0;
  const slowest = result.tests.find((t) => t.durationMs === maxMs && maxMs > 0)?.name;
  return {
    total: result.tests.length,
    totalMs,
    meanMs: durations.length ? totalMs / durations.length : 0,
    maxMs,
    slowest,
  };
}

/** Tests slowest first. */
export function rankByDuration(result: TestRunResult): TestCaseResult[] {
  return [...result.tests].sort((a, b) => b.durationMs - a.durationMs);
}

/** Tests whose duration exceeds the budget (a perf-budget check). */
export function overBudget(result: TestRunResult, budgetMs: number): TestCaseResult[] {
  return result.tests.filter((t) => t.durationMs > budgetMs);
}

export interface EngineComparison {
  name: string;
  interpreterMs: number;
  /** NaN when the test wasn't reported by the VM run. */
  vmMs: number;
  faster: 'interpreter' | 'vm' | 'tie';
  /** Absolute difference in ms. */
  deltaMs: number;
}

/** Compare interpreter vs VM timings per test (joined by name). */
export function compareEngines(interpreter: TestRunResult, vm: TestRunResult): EngineComparison[] {
  const vmByName = new Map(vm.tests.map((t) => [t.name, t.durationMs]));
  return interpreter.tests.map((test) => {
    const interpreterMs = test.durationMs;
    const vmMs = vmByName.has(test.name) ? vmByName.get(test.name)! : NaN;
    let faster: EngineComparison['faster'] = 'tie';
    if (!Number.isNaN(vmMs)) {
      if (interpreterMs < vmMs) faster = 'interpreter';
      else if (vmMs < interpreterMs) faster = 'vm';
    }
    return { name: test.name, interpreterMs, vmMs, faster, deltaMs: Number.isNaN(vmMs) ? 0 : Math.abs(interpreterMs - vmMs) };
  });
}
