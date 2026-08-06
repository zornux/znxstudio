import { describe, expect, test } from './harness';
import { computeMetrics } from '../src/renderer/metrics/metrics';

const ZX_CLASS = `# OOP sample.
class Dog
    has name

    function bark
        show name + " says Woof!"
    end
end
`;

describe('computeMetrics — line classification', () => {
  test('counts code, comment and blank lines', () => {
    const m = computeMetrics(ZX_CLASS, 'zornux');
    expect(m.total).toBe(8);
    expect(m.comment).toBe(1);
    expect(m.blank).toBe(1);
    expect(m.code).toBe(6);
  });
});

describe('computeMetrics — cyclomatic complexity', () => {
  test('base complexity of straight-line code is 1', () => {
    expect(computeMetrics('create x = 1\nshow x\n', 'zornux').cyclomatic).toBe(1);
  });

  test('each decision point adds one', () => {
    const src = 'if a is more than b\n    show a\nelse if a and b\n    show b\nend\n';
    // if + (else) if + and  → 3 decisions → cc 4
    expect(computeMetrics(src, 'zornux').cyclomatic).toBe(4);
  });

  test('keywords inside comments and strings do not count', () => {
    const src = 'create x = "if this and that"\n# while or for\ncreate y = 2\n';
    expect(computeMetrics(src, 'zornux').cyclomatic).toBe(1);
  });

  test('JS decisions include && || and ??', () => {
    const src = 'function f(a, b) {\n  if (a && b) return a || b;\n  return a ?? b;\n}\n';
    // if + && + || + ?? = 4 → cc 5
    expect(computeMetrics(src, 'javascript').cyclomatic).toBe(5);
  });

  test('JS block comments are ignored', () => {
    const src = '/* if for while */\nconst x = 1;\n';
    expect(computeMetrics(src, 'javascript').cyclomatic).toBe(1);
    expect(computeMetrics(src, 'javascript').comment).toBe(1);
  });
});

describe('computeMetrics — nesting', () => {
  test('measures the deepest indentation level', () => {
    const m = computeMetrics(ZX_CLASS, 'zornux');
    // class(0) → has/function(1) → show(2)
    expect(m.maxNesting).toBe(2);
  });

  test('flat code has zero nesting', () => {
    expect(computeMetrics('create x = 1\nshow x\n', 'zornux').maxNesting).toBe(0);
  });
});

describe('computeMetrics — maintainability + rating', () => {
  test('small simple files rate A', () => {
    const m = computeMetrics('create x = 1\nshow x\n', 'zornux');
    expect(m.maintainability).toBe(100);
    expect(m.rating).toBe('A');
  });

  test('complexity and nesting lower the score', () => {
    const simple = computeMetrics('create x = 1\n', 'zornux').maintainability;
    const complex = computeMetrics(ZX_CLASS, 'zornux').maintainability;
    expect(complex).toBeLessThan(simple);
  });
});
