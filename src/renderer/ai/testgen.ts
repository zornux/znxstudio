import type { AiMessage } from '../../shared/ai/providers';

/**
 * Pure core for AI test generation (Phase 10F). Frames a request for real Zornux
 * `test "…" … end` blocks, extracts just the test code from the model reply
 * (dropping prose/fences), and composes a runnable program (source + tests) that
 * the real `zornux test` CLI executes. Kept pure so extraction + composition are
 * unit-tested, and the generated tests are verified against the actual compiler.
 */

/** Build the provider-agnostic request for Zornux test blocks. */
export function buildTestGenMessages(
  code: string,
  fileName: string | null,
  target?: string | null,
): { system: string; messages: AiMessage[] } {
  const system = [
    'You generate unit tests for the Zornux language (.zx).',
    'Zornux tests look like:',
    'test "describes the case"',
    '    expect <actual> to equal <expected>',
    'end',
    'The closing `end` is at column 0. Tests live in the same file as the code and call its functions directly.',
    'Write focused tests covering normal cases and important edge cases. Use clear descriptions.',
    'Output ONLY Zornux test blocks — no prose, no Markdown code fences, and do not restate the source code.',
  ].join('\n');
  const where = fileName ? `File: ${fileName}\n` : '';
  const focus = target ? `Focus on the function \`${target}\`.\n` : '';
  const user = `${where}${focus}Write tests for this code:\n\n${code}`;
  return { system, messages: [{ role: 'user', content: user }] };
}

function stripFences(text: string): string {
  const fence = text.match(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/);
  return fence ? fence[1] : text;
}

/** Remove the smallest common leading indentation from every non-blank line. */
export function dedent(text: string): string {
  const lines = text.split('\n');
  let min = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;
    if (indent < min) min = indent;
  }
  if (!Number.isFinite(min) || min === 0) return text;
  return lines.map((line) => (line.trim() ? line.slice(min) : line)).join('\n');
}

/**
 * Extract just the `test "…" … end` region from a model reply: unwrap a fence,
 * slice from the first `test "` to the last column-`end`, and dedent so `test`
 * and its `end` sit at column 0.
 */
export function extractTestBlocks(raw: string): string {
  const text = stripFences(raw.replace(/\r\n/g, '\n'));
  const lines = text.split('\n');
  const first = lines.findIndex((line) => /^\s*test\s+"/.test(line));
  if (first < 0) return '';
  let last = -1;
  for (let i = lines.length - 1; i > first; i--) {
    if (/^\s*end\b/.test(lines[i])) {
      last = i;
      break;
    }
  }
  if (last < 0) return '';
  return dedent(lines.slice(first, last + 1).join('\n')).replace(/\s+$/, '');
}

/** Number of `test "…"` blocks in the (already-extracted) test source. */
export function countTests(testSource: string): number {
  return (testSource.match(/^test\s+"/gm) ?? []).length;
}

/**
 * Compose a runnable program: the original source followed by the generated
 * tests (which call into it). This is what the real `zornux test` CLI runs.
 */
export function composeTestProgram(source: string, testSource: string): string {
  return `${source.replace(/\s+$/, '')}\n\n${testSource.trim()}\n`;
}

/**
 * Whether the source can be run standalone for testing. Files declaring a
 * `service` or `publish`ing block need a host/composition to run, so we generate
 * tests but skip the auto-run (matching Phases 8–9's repo-safe run gating).
 */
export function isRunnableSource(source: string): boolean {
  return !/(^|\n)\s*(service|publish)\b/.test(source);
}
