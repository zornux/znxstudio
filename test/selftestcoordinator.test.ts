import { describe, expect, test } from './harness';
import { SelfTestCoordinator } from '../src/renderer/core/SelfTestCoordinator';

/** Flush enough microtask rounds for queued acquisitions to settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

/**
 * A controllable self-test: resolves only when its release() is called, while
 * tracking how many are running at once so we can assert the concurrency gate.
 */
function controllable(state: { active: number; peak: number; releases: Array<() => void> }) {
  return () =>
    new Promise<void>((resolve) => {
      state.active++;
      state.peak = Math.max(state.peak, state.active);
      state.releases.push(() => {
        state.active--;
        resolve();
      });
    });
}

describe('self-test coordinator: concurrency gate', () => {
  test('runs strictly one at a time by default', async () => {
    const coord = new SelfTestCoordinator(() => 0);
    const state = { active: 0, peak: 0, releases: [] as Array<() => void> };
    void coord.run('a', controllable(state));
    void coord.run('b', controllable(state));
    void coord.run('c', controllable(state));

    await flush();
    expect(state.active).toBe(1); // only the first has started
    expect(state.releases).toHaveLength(1);

    // Drain them one by one; the peak must never exceed 1.
    while (state.releases.length > 0) {
      state.releases.shift()!();
      await flush();
    }
    expect(state.peak).toBe(1);
    expect(coord.results()).toHaveLength(3);
  });

  test('honors a raised concurrency budget (env override)', async () => {
    const coord = new SelfTestCoordinator(() => 0);
    coord.configure(2);
    expect(coord.maxConcurrency).toBe(2);

    const state = { active: 0, peak: 0, releases: [] as Array<() => void> };
    void coord.run('a', controllable(state));
    void coord.run('b', controllable(state));
    void coord.run('c', controllable(state));

    await flush();
    expect(state.active).toBe(2); // two run concurrently, the third waits

    while (state.releases.length > 0) {
      state.releases.shift()!();
      await flush();
    }
    expect(state.peak).toBe(2);
  });

  test('clamps invalid concurrency to 1', () => {
    const coord = new SelfTestCoordinator(() => 0);
    coord.configure(0);
    expect(coord.maxConcurrency).toBe(1);
    coord.configure(-5);
    expect(coord.maxConcurrency).toBe(1);
    coord.configure(Number.NaN);
    expect(coord.maxConcurrency).toBe(1);
    coord.configure(3.9);
    expect(coord.maxConcurrency).toBe(3); // floored
  });
});

describe('self-test coordinator: isolation and results', () => {
  test('a failing self-test is isolated and recorded, others still run', async () => {
    const coord = new SelfTestCoordinator(() => 0);
    const ok = await coord.run('ok', () => undefined);
    const boom = await coord.run('boom', () => {
      throw new Error('kaboom');
    });
    const after = await coord.run('after', async () => undefined);

    expect(ok.status).toBe('passed');
    expect(boom.status).toBe('failed');
    expect(boom.error).toBe('kaboom');
    expect(after.status).toBe('passed'); // the failure did not stop later tests

    const results = coord.results();
    expect(results).toHaveLength(3);
    expect(results.map((r) => `${r.name}:${r.status}`).join(',')).toBe(
      'ok:passed,boom:failed,after:passed',
    );
  });

  test('rejections (async throws) are captured too', async () => {
    const coord = new SelfTestCoordinator(() => 0);
    const outcome = await coord.run('async-boom', async () => {
      await Promise.resolve();
      throw new Error('later');
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toBe('later');
  });
});
