import type { AiMessage } from '../../shared/ai/providers';

/**
 * Pure conversation state for the AI Chat panel (Phase 10A). Holds the visible
 * turns (user/assistant) — the system prompt is composed fresh per request from
 * the current editor context, so it never becomes stale in the history.
 */
export class ChatSession {
  private readonly turns: AiMessage[] = [];

  addUser(content: string): void {
    this.turns.push({ role: 'user', content });
  }

  addAssistant(content: string): void {
    this.turns.push({ role: 'assistant', content });
  }

  /** A copy of the visible turns (no system message). */
  history(): AiMessage[] {
    return this.turns.map((m) => ({ ...m }));
  }

  isEmpty(): boolean {
    return this.turns.length === 0;
  }

  reset(): void {
    this.turns.length = 0;
  }
}

const MAX_CONTEXT_CHARS = 6000;

/** Bound a code blob so a large file can't blow the request size. */
export function truncateForContext(code: string, max = MAX_CONTEXT_CHARS): string {
  if (code.length <= max) return code;
  const head = code.slice(0, max);
  return `${head}\n… (${code.length - max} more characters truncated)`;
}

export interface ChatContext {
  /** Base name of the active file, if any. */
  activeFile?: string | null;
  /** Active file's source, included only when the user opts in. */
  code?: string | null;
  /** Additional context assembled from the context store. */
  additionalContext?: string | null;
  /** Project structure map. */
  projectMap?: string | null;
}

/**
 * Compose the system prompt: a Zornux/Zoijs-aware assistant persona plus, when
 * the user opts to share it, the active file as grounding context.
 */
export function composeSystemPrompt(context: ChatContext = {}): string {
  const lines = [
    'You are the AI assistant embedded in ZnxStudio, the IDE for the Zornux language and the Zoijs frontend framework.',
    'Zornux is an English-readable, statically-typed language (files end in .zx). Zoijs is a no-build client-side JS UI framework.',
    'Be concise and practical. When you show Zornux code, keep it idiomatic (English-readable keywords, column-0 `end`).',
    'If you are unsure about a Zornux detail, say so rather than inventing syntax.',
  ];
  if (context.projectMap) {
    lines.push('', 'Project structure:', context.projectMap);
  }
  if (context.activeFile && context.code && context.code.trim()) {
    lines.push('', `The user is currently editing \`${context.activeFile}\`. Its contents:`, '```', truncateForContext(context.code), '```');
  } else if (context.activeFile) {
    lines.push('', `The user is currently editing \`${context.activeFile}\` (contents not shared).`);
  }
  if (context.additionalContext) {
    lines.push('', 'Additional context:', context.additionalContext);
  }
  return lines.join('\n');
}
