import { describe, expect, test } from './harness';
import { Emitter } from '../src/renderer/core/Emitter';

describe('module event subscription disposal', () => {
  test('disposed subscriptions stop lifecycle callbacks', () => {
    const emitter = new Emitter<number>();
    let calls = 0;
    const subscription = emitter.event(() => { calls += 1; });
    emitter.fire(1);
    subscription.dispose();
    emitter.fire(2);
    expect(calls).toBe(1);
  });
});
