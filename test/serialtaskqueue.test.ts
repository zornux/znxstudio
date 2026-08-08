import { describe, expect, test } from './harness';
import { SerialTaskQueue } from '../src/renderer/language/SerialTaskQueue';

describe('serial task queue', () => {
  test('keeps tasks for one document in invocation order', async () => {
    const queue = new SerialTaskQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = queue.enqueue('file', async () => {
      events.push('first:start');
      await gate;
      events.push('first:end');
    });
    const second = queue.enqueue('file', async () => { events.push('second'); });
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });

  test('continues after a failed task and does not block other documents', async () => {
    const queue = new SerialTaskQueue();
    const events: string[] = [];
    const failed = queue.enqueue('a', async () => { throw new Error('disk'); });
    const recovered = queue.enqueue('a', async () => { events.push('recovered'); });
    const parallel = queue.enqueue('b', async () => { events.push('parallel'); });
    await failed.catch(() => undefined);
    await Promise.all([recovered, parallel]);
    expect(events.includes('recovered')).toBe(true);
    expect(events.includes('parallel')).toBe(true);
  });

  test('whenIdle waits for an in-flight save before close continues', async () => {
    const queue = new SerialTaskQueue();
    let release!: () => void;
    let idle = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const save = queue.enqueue('file', () => gate);
    const waiting = queue.whenIdle('file').then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(false);
    release();
    await Promise.all([save, waiting]);
    expect(idle).toBe(true);
  });
});
