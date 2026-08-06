/**
 * Zornux language benchmark harness with regression gates.
 *
 * Generates a large program, verifies incremental == batch, and measures the
 * two performance wins from Phase 2K (incremental tokenization, per-version
 * analysis cache). Fails (non-zero exit) if a gate regresses.
 */
import { tokenize } from '../src/renderer/language/languages/zornux/lexer';
import { IncrementalTokenizer } from '../src/renderer/language/languages/zornux/incremental';
import { LanguageServiceZornux } from '../src/renderer/language/languages/LanguageServiceZornux';
import { makeDoc } from './util';

function generate(functions: number): string {
  const lines: string[] = ['define config to "app"'];
  for (let i = 0; i < functions; i++) {
    lines.push(`function fn${i}(a, b) {`, `  let x${i} is 0`, `  say x${i}`, `}`);
  }
  return lines.join('\n') + '\n';
}

function time(fn: () => void, iters: number): number {
  fn(); // warm JIT
  const t0 = performance.now();
  for (let k = 0; k < iters; k++) fn();
  return (performance.now() - t0) / iters;
}

const gates: { name: string; ok: boolean; detail: string }[] = [];
function gate(name: string, ok: boolean, detail: string): void {
  gates.push({ name, ok, detail });
}

const src = generate(800);
const lineCount = src.split('\n').length;
const src2 = ((): string => {
  const a = src.split('\n');
  a[1600] = '  let renamed is 42';
  return a.join('\n');
})();

console.log(`\nZornux benchmark — ${lineCount} lines, ${tokenize(src).tokens.length} tokens\n`);

// --- Correctness gate ---
const incEqualsBatch =
  JSON.stringify(new IncrementalTokenizer().tokenize(src).tokens) === JSON.stringify(tokenize(src).tokens);
const warm = new IncrementalTokenizer();
warm.tokenize(src);
const incEditEqualsBatch =
  JSON.stringify(warm.tokenize(src2).tokens) === JSON.stringify(tokenize(src2).tokens);
gate('incremental output == batch output', incEqualsBatch && incEditEqualsBatch, `${incEqualsBatch}/${incEditEqualsBatch}`);

// --- Tokenization timing ---
const tBatch = time(() => tokenize(src2), 30);
const tokenizer = new IncrementalTokenizer();
tokenizer.tokenize(src);
let n = 0;
const tInc = time(() => {
  const a = src.split('\n');
  a[1600] = `  let e${n++ % 7} is 1`;
  tokenizer.tokenize(a.join('\n'));
}, 30);
gate('incremental tokenize faster than batch', tInc < tBatch, `${tInc.toFixed(3)}ms vs ${tBatch.toFixed(3)}ms`);

// --- Analysis cache timing ---
const svc = new LanguageServiceZornux();
const stableDoc = makeDoc(src, 1);
svc.diagnostics!.provideDiagnostics(stableDoc); // prime
const tHit = time(() => svc.diagnostics!.provideDiagnostics(stableDoc), 100);
let v = 100;
const tMiss = time(() => svc.diagnostics!.provideDiagnostics(makeDoc(src, v++)), 5);
gate('analysis cache hit under 1ms', tHit < 1, `${tHit.toFixed(4)}ms`);
gate('cache hit much faster than miss', tHit * 20 < tMiss, `hit ${tHit.toFixed(4)}ms vs miss ${tMiss.toFixed(3)}ms`);

// --- Report ---
const row = (label: string, value: string) => console.log(`  ${label.padEnd(42)} ${value}`);
console.log('measurements:');
row('batch tokenize', `${tBatch.toFixed(3)} ms`);
row('incremental tokenize (1-line edit)', `${tInc.toFixed(3)} ms  (${(tBatch / tInc).toFixed(1)}x)`);
row('analysis — cache miss', `${tMiss.toFixed(3)} ms`);
row('analysis — cache hit', `${tHit.toFixed(4)} ms  (${Math.round(tMiss / tHit)}x)`);

console.log('\ngates:');
let failed = 0;
for (const g of gates) {
  if (!g.ok) failed++;
  console.log(`  ${g.ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${g.name}  (${g.detail})`);
}
console.log(`\n${failed === 0 ? '\x1b[32mall gates passed\x1b[0m' : `\x1b[31m${failed} gate(s) failed\x1b[0m`}\n`);
process.exit(failed > 0 ? 1 : 0);
