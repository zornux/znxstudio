import { describe, expect, test } from './harness';
import {
  apply,
  baseLength,
  compose,
  identity,
  replaceRange,
  targetLength,
  transform,
  transformPosition,
  type Op,
} from '../src/renderer/collab/ot';

describe('lengths', () => {
  test('baseLength counts what the operation consumes', () => {
    expect(baseLength([{ retain: 3 }, { insert: 'abc' }, { delete: 2 }])).toBe(5);
  });
  test('targetLength counts what it produces', () => {
    expect(targetLength([{ retain: 3 }, { insert: 'abc' }, { delete: 2 }])).toBe(6);
  });
  test('identity spans the document and changes nothing', () => {
    expect(apply('hello', identity(5))).toBe('hello');
    expect(identity(0)).toEqual([]);
  });
});

describe('apply', () => {
  test('retain copies, insert adds, delete removes', () => {
    expect(apply('hello world', [{ retain: 6 }, { insert: 'brave ' }, { retain: 5 }])).toBe('hello brave world');
    expect(apply('hello world', [{ retain: 5 }, { delete: 6 }])).toBe('hello');
    expect(apply('abc', [{ insert: 'X' }, { retain: 3 }])).toBe('Xabc');
  });

  test('an operation that does not span the document is rejected', () => {
    let threw = false;
    try {
      apply('hello', [{ retain: 2 }]);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe('replaceRange', () => {
  test('builds the operation for one editor change', () => {
    expect(apply('hello world', replaceRange(11, 6, 11, 'there'))).toBe('hello there');
  });
  test('a pure insert', () => {
    expect(apply('ab', replaceRange(2, 1, 1, 'X'))).toBe('aXb');
  });
  test('a pure delete', () => {
    expect(apply('abc', replaceRange(3, 1, 2, ''))).toBe('ac');
  });
});

describe('compose', () => {
  test('compose(a, b) has the same effect as applying a then b', () => {
    const a: Op[] = [{ retain: 5 }, { insert: ' brave' }, { retain: 6 }];
    const b: Op[] = [{ retain: 11 }, { delete: 6 }];
    const document = 'hello world';
    expect(apply(document, compose(a, b))).toBe(apply(apply(document, a), b));
  });

  test('an insert then a delete of that insert cancels out', () => {
    const document = 'ab';
    const composed = compose([{ retain: 1 }, { insert: 'XY' }, { retain: 1 }], [{ retain: 1 }, { delete: 2 }, { retain: 1 }]);
    expect(apply(document, composed)).toBe('ab');
  });

  test('composing with the identity is a no-op', () => {
    const a: Op[] = [{ retain: 1 }, { insert: 'Z' }, { retain: 1 }];
    expect(apply('ab', compose(identity(2), a))).toBe('aZb');
    expect(apply('ab', compose(a, identity(3)))).toBe('aZb');
  });

  test('mismatched operations are rejected rather than silently misapplied', () => {
    let threw = false;
    try {
      compose([{ retain: 2 }], [{ retain: 5 }]);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe('transform', () => {
  test('two inserts at the same point: the left operation wins the tie', () => {
    const [aPrime, bPrime] = transform([{ insert: 'A' }, { retain: 2 }], [{ insert: 'B' }, { retain: 2 }]);
    expect(apply(apply('xy', [{ insert: 'A' }, { retain: 2 }]), bPrime)).toBe('ABxy');
    expect(apply(apply('xy', [{ insert: 'B' }, { retain: 2 }]), aPrime)).toBe('ABxy');
  });

  test('concurrent inserts at different points both survive', () => {
    const a: Op[] = [{ retain: 5 }, { insert: ' brave' }, { retain: 6 }];
    const b: Op[] = [{ insert: 'Oh, ' }, { retain: 11 }];
    const [aPrime, bPrime] = transform(a, b);
    expect(apply(apply('hello world', a), bPrime)).toBe('Oh, hello brave world');
    expect(apply(apply('hello world', b), aPrime)).toBe('Oh, hello brave world');
  });

  test('two people deleting the same text do not delete it twice', () => {
    const a: Op[] = [{ retain: 1 }, { delete: 1 }, { retain: 1 }];
    const b: Op[] = [{ retain: 1 }, { delete: 1 }, { retain: 1 }];
    const [aPrime, bPrime] = transform(a, b);
    expect(apply(apply('abc', a), bPrime)).toBe('ac');
    expect(apply(apply('abc', b), aPrime)).toBe('ac');
  });

  test('an insert inside a range the other deletes survives', () => {
    const insert: Op[] = [{ retain: 2 }, { insert: 'X' }, { retain: 2 }];
    const remove: Op[] = [{ retain: 1 }, { delete: 2 }, { retain: 1 }];
    const [insertPrime, removePrime] = transform(insert, remove);
    expect(apply(apply('abcd', insert), removePrime)).toBe('aXd');
    expect(apply(apply('abcd', remove), insertPrime)).toBe('aXd');
  });

  test('operations against different documents are rejected', () => {
    let threw = false;
    try {
      transform([{ retain: 2 }], [{ retain: 3 }]);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

/**
 * The TP1 property is the whole reason OT works. Assert it over generated edits
 * rather than only the examples above, using a deterministic pseudo-random
 * source so a failure is always reproducible.
 */
describe('transform satisfies TP1 (property test)', () => {
  function mulberry32(seed: number): () => number {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A random operation over a document of `length` characters. */
  function randomOp(random: () => number, length: number): Op[] {
    const ops: Op[] = [];
    let cursor = 0;
    while (cursor < length) {
      const remaining = length - cursor;
      const chunk = 1 + Math.floor(random() * Math.min(3, remaining));
      const roll = random();
      if (roll < 0.5) {
        ops.push({ retain: chunk });
        cursor += chunk;
      } else if (roll < 0.75) {
        ops.push({ insert: 'abcdefg'[Math.floor(random() * 7)] });
      } else {
        ops.push({ delete: chunk });
        cursor += chunk;
      }
    }
    if (random() < 0.3) ops.push({ insert: 'z' });
    return ops;
  }

  test('apply(apply(d, a), b′) === apply(apply(d, b), a′) over 400 random pairs', () => {
    const random = mulberry32(20260709);
    const document = 'the quick brown fox';
    let checked = 0;

    for (let i = 0; i < 400; i += 1) {
      const a = randomOp(random, document.length);
      const b = randomOp(random, document.length);
      const [aPrime, bPrime] = transform(a, b);
      const left = apply(apply(document, a), bPrime);
      const right = apply(apply(document, b), aPrime);
      if (left !== right) {
        throw new Error(`TP1 violated on pair ${i}: ${JSON.stringify({ a, b, left, right })}`);
      }
      checked += 1;
    }
    expect(checked).toBe(400);
  });

  test('compose agrees with sequential application over 400 random pairs', () => {
    const random = mulberry32(777);
    const document = 'lorem ipsum dolor';
    let checked = 0;

    for (let i = 0; i < 400; i += 1) {
      const a = randomOp(random, document.length);
      const once = apply(document, a);
      const b = randomOp(random, once.length);
      const composed = apply(document, compose(a, b));
      const sequential = apply(once, b);
      if (composed !== sequential) {
        throw new Error(`compose disagreed on pair ${i}: ${JSON.stringify({ a, b, composed, sequential })}`);
      }
      checked += 1;
    }
    expect(checked).toBe(400);
  });
});

describe('transformPosition', () => {
  test('an insert before the cursor pushes it right', () => {
    expect(transformPosition(5, [{ insert: 'abc' }, { retain: 10 }])).toBe(8);
  });

  test('an insert after the cursor leaves it alone', () => {
    expect(transformPosition(2, [{ retain: 5 }, { insert: 'abc' }, { retain: 5 }])).toBe(2);
  });

  test('an insert exactly at the cursor pushes it right by default, and not when it belongs before', () => {
    expect(transformPosition(3, [{ retain: 3 }, { insert: 'XY' }, { retain: 3 }])).toBe(5);
    expect(transformPosition(3, [{ retain: 3 }, { insert: 'XY' }, { retain: 3 }], true)).toBe(3);
  });

  test('a delete before the cursor pulls it left', () => {
    expect(transformPosition(6, [{ delete: 2 }, { retain: 8 }])).toBe(4);
  });

  test('a delete spanning the cursor collapses it onto the start of the deleted range', () => {
    expect(transformPosition(4, [{ retain: 2 }, { delete: 5 }, { retain: 3 }])).toBe(2);
  });

  test('a delete after the cursor leaves it alone', () => {
    expect(transformPosition(2, [{ retain: 5 }, { delete: 3 }])).toBe(2);
  });
});
