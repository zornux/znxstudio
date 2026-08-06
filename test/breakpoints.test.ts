import { describe, expect, test } from './harness';
import { BreakpointStore } from '../src/renderer/debug/breakpointStore';

const path = (uri: string) => uri.replace('file://', '');
const uri = (p: string) => `file://${p}`;

describe('breakpoint store: toggle', () => {
  test('adds and removes, keeping lines sorted', () => {
    const store = new BreakpointStore();
    expect(store.toggle('u', 5)).toBeTruthy(); // added
    store.toggle('u', 2);
    expect(store.forUri('u').map((b) => b.line)).toEqual([2, 5]);
    expect(store.toggle('u', 5)).toBeFalsy(); // removed
    expect(store.forUri('u').map((b) => b.line)).toEqual([2]);
  });

  test('drops the file entry when its last breakpoint is removed', () => {
    const store = new BreakpointStore();
    store.toggle('u', 1);
    store.toggle('u', 1);
    expect(store.uris()).toHaveLength(0);
  });
});

describe('breakpoint store: launch list', () => {
  test('emits 1-based lines and mapped paths', () => {
    const store = new BreakpointStore();
    store.toggle('file:///a.zx', 0); // line 1
    store.toggle('file:///a.zx', 4); // line 5
    const list = store.launchList(path);
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe('/a.zx');
    expect(list[0].lines.map((l) => l.line)).toEqual([1, 5]);
  });

  test('carries conditions', () => {
    const store = new BreakpointStore();
    store.toggle('u', 3);
    store.setCondition('u', 3, 'x > 5');
    expect(store.launchList((u) => u)[0].lines[0].condition).toBe('x > 5');
  });
});

describe('breakpoint store: verified verdicts', () => {
  test('zips response verdicts back by index', () => {
    const store = new BreakpointStore();
    store.toggle('file:///a.zx', 0);
    store.toggle('file:///a.zx', 9);
    store.applyVerified(uri, [
      { path: '/a.zx', breakpoints: [{ verified: true }, { verified: false, message: 'no code here' }] },
    ]);
    const bps = store.forUri('file:///a.zx');
    expect(bps[0].verified).toBeTruthy();
    expect(bps[1].verified).toBeFalsy();
  });

  test('resetVerified marks all verified again', () => {
    const store = new BreakpointStore();
    store.toggle('u', 1);
    store.applyVerified((p) => p, [{ path: 'u', breakpoints: [{ verified: false }] }]);
    expect(store.forUri('u')[0].verified).toBeFalsy();
    store.resetVerified();
    expect(store.forUri('u')[0].verified).toBeTruthy();
  });
});
