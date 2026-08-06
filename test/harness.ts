/**
 * Zero-dependency test harness for the Zornux language front-end.
 *
 * Tests register via describe()/test() and run under Node (bundled by esbuild).
 * No Monaco or Electron required — the whole language front-end and service are
 * Monaco-free, so they run headless.
 */
type TestFn = () => void | Promise<void>;

interface TestCase {
  suite: string;
  name: string;
  fn: TestFn;
}

const cases: TestCase[] = [];
let currentSuite = '(root)';

export function describe(name: string, fn: () => void): void {
  const previous = currentSuite;
  currentSuite = name;
  fn();
  currentSuite = previous;
}

export function test(name: string, fn: TestFn): void {
  cases.push({ suite: currentSuite, name, fn });
}
export const it = test;

export interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(item: unknown): void;
  toHaveLength(length: number): void;
  toBeNull(): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeGreaterThan(value: number): void;
  toBeLessThan(value: number): void;
}

export function expect(actual: any): Matchers {
  const fail = (message: string): never => {
    throw new Error(message);
  };
  return {
    toBe(expected) {
      if (!Object.is(actual, expected)) fail(`expected ${format(actual)} to be ${format(expected)}`);
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        fail(`expected ${format(actual)} to equal ${format(expected)}`);
      }
    },
    toContain(item) {
      const ok = typeof actual === 'string' ? actual.includes(item as string) : actual?.includes?.(item);
      if (!ok) fail(`expected ${format(actual)} to contain ${format(item)}`);
    },
    toHaveLength(length) {
      if (actual?.length !== length) fail(`expected length ${actual?.length} to be ${length}`);
    },
    toBeNull() {
      if (actual !== null) fail(`expected ${format(actual)} to be null`);
    },
    toBeTruthy() {
      if (!actual) fail(`expected ${format(actual)} to be truthy`);
    },
    toBeFalsy() {
      if (actual) fail(`expected ${format(actual)} to be falsy`);
    },
    toBeGreaterThan(value) {
      if (!(actual > value)) fail(`expected ${format(actual)} > ${value}`);
    },
    toBeLessThan(value) {
      if (!(actual < value)) fail(`expected ${format(actual)} < ${value}`);
    },
  };
}

function format(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text && text.length > 80 ? `${text.slice(0, 77)}…` : String(text);
}

export async function runAll(): Promise<number> {
  const bySuite = new Map<string, TestCase[]>();
  for (const testCase of cases) {
    const list = bySuite.get(testCase.suite) ?? [];
    list.push(testCase);
    bySuite.set(testCase.suite, list);
  }

  let passed = 0;
  let failed = 0;
  const start = performance.now();

  for (const [suite, list] of bySuite) {
    console.log(`\n  ${suite}`);
    for (const testCase of list) {
      try {
        await testCase.fn();
        passed++;
        console.log(`    \x1b[32m✓\x1b[0m ${testCase.name}`);
      } catch (error) {
        failed++;
        console.log(`    \x1b[31m✗\x1b[0m ${testCase.name}`);
        console.log(`       \x1b[31m${(error as Error).message}\x1b[0m`);
      }
    }
  }

  const ms = (performance.now() - start).toFixed(0);
  console.log(
    `\n  ${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed} passed, ${failed} failed\x1b[0m` +
      ` (${cases.length} tests, ${ms}ms)\n`,
  );
  return failed;
}
