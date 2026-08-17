import type { AiMessage } from '../../shared/ai/providers';

/**
 * Pure core for Inline AI actions. Editor context menu actions that operate
 * on the selected code: Explain, Generate (from comment), Rewrite (custom
 * instruction), and Fix (selection-scoped). Each builds a provider-agnostic
 * prompt and defines how to apply the result.
 */

export type InlineActionId = 'explain' | 'generate' | 'rewrite' | 'simplify' | 'addTypes' | 'addTests';

export interface InlineAction {
  id: InlineActionId;
  label: string;
  description: string;
  /** Whether the result replaces the selection (vs. shown in a panel). */
  replaces: boolean;
  /** Whether a custom instruction prompt is shown first. */
  needsInstruction: boolean;
}

export const INLINE_ACTIONS: readonly InlineAction[] = [
  {
    id: 'explain',
    label: 'Explain',
    description: 'Explain what this code does in plain language.',
    replaces: false,
    needsInstruction: false,
  },
  {
    id: 'generate',
    label: 'Generate',
    description: 'Generate code from a natural-language description.',
    replaces: true,
    needsInstruction: true,
  },
  {
    id: 'rewrite',
    label: 'Rewrite',
    description: 'Rewrite this code with a custom instruction.',
    replaces: true,
    needsInstruction: true,
  },
  {
    id: 'simplify',
    label: 'Simplify',
    description: 'Simplify this code without changing behavior.',
    replaces: true,
    needsInstruction: false,
  },
  {
    id: 'addTypes',
    label: 'Add Types',
    description: 'Add explicit type annotations to this code.',
    replaces: true,
    needsInstruction: false,
  },
  {
    id: 'addTests',
    label: 'Generate Tests',
    description: 'Generate test cases for this code.',
    replaces: false,
    needsInstruction: false,
  },
];

export function findInlineAction(id: InlineActionId): InlineAction | undefined {
  return INLINE_ACTIONS.find((a) => a.id === id);
}

/** Build the prompt for an inline action on a code selection. */
export function buildInlineMessages(
  action: InlineAction,
  code: string,
  fileName: string | null,
  instruction?: string,
): { system: string; messages: AiMessage[] } {
  const systemParts: string[] = [
    'You are an AI assistant inside the ZnxStudio IDE for the Zornux language (.zx) and the Zoijs framework.',
  ];

  switch (action.id) {
    case 'explain':
      systemParts.push(
        'Explain the selected code in plain language. Be concise and specific.',
        'Use Markdown formatting. Mention what the code does, any edge cases, and potential issues.',
      );
      break;
    case 'generate':
      systemParts.push(
        'Generate Zornux code based on the user\'s description.',
        'Return ONLY the generated code — no explanation, no Markdown code fences.',
        'Match the surrounding indentation style. Use Zornux idioms (English-readable keywords, column-0 `end`).',
      );
      break;
    case 'rewrite':
      systemParts.push(
        'Rewrite the selected code according to the user\'s instruction.',
        'Return ONLY the rewritten code — no explanation, no Markdown code fences.',
        'Preserve behavior unless the instruction says otherwise.',
      );
      break;
    case 'simplify':
      systemParts.push(
        'Simplify the selected code: remove redundancy, flatten nesting, eliminate dead code.',
        'Return ONLY the simplified code — no explanation, no Markdown code fences.',
        'Preserve behavior exactly.',
      );
      break;
    case 'addTypes':
      systemParts.push(
        'Add explicit Zornux type annotations to the selected code.',
        'Return ONLY the annotated code — no explanation, no Markdown code fences.',
        'Add types to function parameters, return values, and variable declarations where missing.',
      );
      break;
    case 'addTests':
      systemParts.push(
        'Generate Zornux test cases for the selected code.',
        'Use `test "description" ... end` syntax. Cover the happy path and edge cases.',
        'Include assertions using `check that` / `check_equal`.',
        'Show the test code only — no explanation beyond the test names.',
      );
      break;
  }

  const where = fileName ? `File: ${fileName}\n` : '';
  let userContent: string;

  if (action.id === 'generate') {
    userContent = `${where}Description: ${instruction ?? code}\n\nContext (surrounding code):\n${code}`;
  } else if (instruction) {
    userContent = `${where}Instruction: ${instruction}\n\nSelected code:\n${code}`;
  } else {
    userContent = `${where}Selected code:\n${code}`;
  }

  return {
    system: systemParts.join('\n'),
    messages: [{ role: 'user', content: userContent }],
  };
}

/** Strip code fences the model may wrap around its output. */
export function cleanInlineOutput(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n');
  const fence = text.match(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/);
  if (fence) text = fence[1];
  return text.replace(/^\n+/, '').replace(/\s+$/, '');
}
