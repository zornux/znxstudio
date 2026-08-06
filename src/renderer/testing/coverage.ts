/**
 * Pure static test-coverage analysis (Phase 9D). Zornux exposes no line coverage
 * (`zornux test` has no --coverage flag), so we compute FUNCTION coverage by
 * reachability: which top-level `function`s are called from a `test` block —
 * directly or transitively through other functions. Honest and grounded. No DOM.
 */
const FUNCTION_RE = /^(?:async\s+)?function\s+(\w+)/;
const CALL_RE = /\b([a-z_]\w*)\s*\(/g;

export interface DeclaredFunction {
  name: string;
  line: number;
  body: string;
}

/** Top-level functions (bounded by a column-0 `end`), with their bodies. */
export function parseFunctions(text: string): DeclaredFunction[] {
  const lines = text.split(/\r?\n/);
  const functions: DeclaredFunction[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = FUNCTION_RE.exec(lines[i]);
    if (!match) continue;
    const bodyLines: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      if (/^end\b/.test(lines[j])) break; // column-0 end closes the function
      bodyLines.push(lines[j]);
    }
    functions.push({ name: match[1], line: i, body: bodyLines.join('\n') });
    i = j;
  }
  return functions;
}

/** Identifiers called (`name(`) inside a body. */
export function callsIn(body: string): Set<string> {
  const calls = new Set<string>();
  for (const match of body.matchAll(CALL_RE)) calls.add(match[1]);
  return calls;
}

/** Identifiers called inside `test "…" … end` blocks. */
export function parseTestCalls(text: string): Set<string> {
  const calls = new Set<string>();
  let inTest = false;
  for (const raw of text.split(/\r?\n/)) {
    if (/^test\s+"/.test(raw)) {
      inTest = true;
      continue;
    }
    if (inTest && /^end\b/.test(raw)) {
      inTest = false;
      continue;
    }
    if (inTest) for (const name of callsIn(raw)) calls.add(name);
  }
  return calls;
}

export interface CoveredFunction {
  name: string;
  file: string;
  line: number;
  covered: boolean;
}

export interface CoverageReport {
  functions: CoveredFunction[];
  total: number;
  covered: number;
  percent: number;
}

/**
 * Workspace function coverage: a function is covered when it is reachable from a
 * test call through the (declared-only) call graph.
 */
export function analyzeCoverage(files: { file: string; text: string }[]): CoverageReport {
  const declared = new Map<string, { file: string; line: number }>();
  const bodies: { name: string; body: string }[] = [];
  const seeds = new Set<string>();

  for (const file of files) {
    for (const fn of parseFunctions(file.text)) {
      if (!declared.has(fn.name)) declared.set(fn.name, { file: file.file, line: fn.line });
      bodies.push({ name: fn.name, body: fn.body });
    }
    for (const call of parseTestCalls(file.text)) seeds.add(call);
  }

  const declaredNames = new Set(declared.keys());
  const callGraph = new Map<string, Set<string>>();
  for (const { name, body } of bodies) {
    const edges = callGraph.get(name) ?? new Set<string>();
    for (const called of callsIn(body)) {
      if (called !== name && declaredNames.has(called)) edges.add(called);
    }
    callGraph.set(name, edges);
  }

  const covered = new Set<string>();
  const queue = [...seeds].filter((name) => declaredNames.has(name));
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (covered.has(name)) continue;
    covered.add(name);
    for (const called of callGraph.get(name) ?? []) if (!covered.has(called)) queue.push(called);
  }

  const functions: CoveredFunction[] = [...declared.entries()]
    .map(([name, decl]) => ({ name, file: decl.file, line: decl.line, covered: covered.has(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const total = functions.length;
  const coveredCount = functions.filter((f) => f.covered).length;
  return { functions, total, covered: coveredCount, percent: total === 0 ? 100 : Math.round((coveredCount / total) * 100) };
}
