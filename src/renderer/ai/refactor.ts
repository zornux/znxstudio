import type { AiMessage } from '../../shared/ai/providers';

/**
 * Pure core for AI refactoring (Phase 10C). A catalog of behavior-preserving
 * transforms, the provider-agnostic prompt that requests a rewrite of the
 * selected code, output cleanup, and a line-level diff used to preview the
 * change before it is applied. Kept pure so the prompt + diff are unit-tested.
 */

export interface RefactorAction {
  id: string;
  label: string;
  description: string;
  /** The instruction sent to the model. Empty for the custom action. */
  instruction: string;
  /** When true, the user is prompted for a free-text instruction. */
  custom?: boolean;
}

export const REFACTOR_ACTIONS: readonly RefactorAction[] = [
  {
    id: 'rename',
    label: 'Improve names',
    description: 'Clearer variable / function / parameter names.',
    instruction:
      'Rename variables, functions, and parameters to be clearer and more descriptive. Do not change behavior.',
  },
  {
    id: 'extract',
    label: 'Extract helpers',
    description: 'Pull complex or repeated logic into named functions.',
    instruction:
      'Extract repeated or complex logic into well-named helper functions. Preserve behavior exactly.',
  },
  {
    id: 'simplify',
    label: 'Simplify',
    description: 'Remove redundancy and flatten nesting.',
    instruction:
      'Simplify the code: remove redundancy and dead code and flatten nesting, without changing behavior.',
  },
  {
    id: 'errors',
    label: 'Add error handling',
    description: 'Validate inputs and handle failure cases.',
    instruction:
      'Add appropriate error handling and input validation while preserving the existing happy-path behavior.',
  },
  {
    id: 'comments',
    label: 'Add comments',
    description: 'Explain the code with concise comments.',
    instruction: 'Add concise explanatory comments. Do not change any executable code.',
  },
  {
    id: 'idiomatic',
    label: 'Make idiomatic',
    description: 'Rewrite as clearer, idiomatic Zornux.',
    instruction:
      'Rewrite to be more idiomatic and readable Zornux, preserving behavior. Keep English-readable keywords and column-0 `end`.',
  },
  {
    id: 'custom',
    label: 'Custom instruction…',
    description: 'Describe the change in your own words.',
    instruction: '',
    custom: true,
  },
];

export function findRefactorAction(id: string): RefactorAction | undefined {
  return REFACTOR_ACTIONS.find((action) => action.id === id);
}

/** Build the provider-agnostic rewrite request for a selection. */
export function buildRefactorMessages(
  action: RefactorAction,
  code: string,
  fileName: string | null,
  customInstruction = '',
): { system: string; messages: AiMessage[] } {
  const instruction = action.custom ? customInstruction.trim() : action.instruction;
  const system = [
    'You are a code refactoring engine inside the ZnxStudio IDE for the Zornux language (.zx).',
    'Rewrite the user\'s selected code according to the instruction.',
    'Return ONLY the rewritten code that will replace the selection verbatim — no explanation, no Markdown code fences.',
    'Preserve program behavior unless the instruction explicitly says otherwise.',
    'Match the surrounding indentation and keep Zornux idioms (English-readable keywords, column-0 `end`).',
  ].join('\n');
  const where = fileName ? `File: ${fileName}\n` : '';
  const user = `${where}Instruction: ${instruction || '(none)'}\n\nSelected code:\n${code}`;
  return { system, messages: [{ role: 'user', content: user }] };
}

/** Remove a Markdown code fence the model may have wrapped the rewrite in. */
export function stripCodeFences(text: string): string {
  const fence = text.match(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/);
  return fence ? fence[1] : text;
}

/** Clean a model rewrite into replacement text (unwrap fences, trim outer blank lines). */
export function cleanRefactorOutput(raw: string): string {
  return stripCodeFences(raw.replace(/\r\n/g, '\n')).replace(/^\n+/, '').replace(/\s+$/, '');
}

export type DiffType = 'context' | 'add' | 'del';
export interface DiffLine {
  type: DiffType;
  text: string;
}

/**
 * A line-level diff (LCS) of `before` → `after`, for the change preview.
 * Deletions precede additions at each divergence.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'context', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i] });
      i++;
    } else {
      out.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}

export function diffStats(diff: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.type === 'add') added++;
    else if (line.type === 'del') removed++;
  }
  return { added, removed };
}
