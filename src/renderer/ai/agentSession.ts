import type { AiMessage } from '../../shared/ai/providers';
import { filterSecrets, truncateForContext } from './context';

/**
 * Pure session logic for Agent mode. An agent session is a multi-turn
 * conversation where the AI can propose file edits, run commands, inspect
 * diagnostics, and iterate — all gated by user approval. The session tracks
 * the plan, proposed changes, and approval state.
 */

export type StepKind = 'plan' | 'edit' | 'command' | 'diagnostic' | 'message';
export type StepStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'running' | 'done' | 'failed';

export interface AgentStep {
  id: number;
  kind: StepKind;
  /** Short label for the step list. */
  label: string;
  /** Detailed content (plan text, diff, command, diagnostic output). */
  content: string;
  status: StepStatus;
  /** For edit steps: the file being modified. */
  file?: string;
  /** For edit steps: the proposed new content. */
  proposed?: string;
  /** For edit steps: the original content before the edit. */
  original?: string;
  /** For command steps: the command to run. */
  command?: string;
  /** For command steps: the output after running. */
  output?: string;
}

export interface AgentFileChange {
  file: string;
  original: string;
  proposed: string;
  status: 'pending' | 'accepted' | 'rejected';
}

export type AgentState = 'idle' | 'planning' | 'executing' | 'waiting' | 'done' | 'error';

export class AgentSession {
  private readonly turns: AiMessage[] = [];
  private readonly steps: AgentStep[] = [];
  private nextId = 1;
  private _state: AgentState = 'idle';
  private _goal = '';
  private _aborted = false;

  get state(): AgentState { return this._state; }
  set state(s: AgentState) { this._state = s; }

  get goal(): string { return this._goal; }
  get aborted(): boolean { return this._aborted; }

  /** Start a new agent session with a goal. */
  start(goal: string): void {
    this.turns.length = 0;
    this.steps.length = 0;
    this.nextId = 1;
    this._state = 'planning';
    this._goal = goal;
    this._aborted = false;
  }

  abort(): void {
    this._aborted = true;
    this._state = 'done';
  }

  reset(): void {
    this.turns.length = 0;
    this.steps.length = 0;
    this.nextId = 1;
    this._state = 'idle';
    this._goal = '';
    this._aborted = false;
  }

  history(): AiMessage[] {
    return this.turns.map((m) => ({ ...m }));
  }

  allSteps(): AgentStep[] {
    return [...this.steps];
  }

  addTurn(role: 'user' | 'assistant', content: string): void {
    this.turns.push({ role, content });
  }

  addStep(kind: StepKind, label: string, content: string, extra?: Partial<AgentStep>): AgentStep {
    const step: AgentStep = {
      id: this.nextId++,
      kind,
      label,
      content,
      status: 'pending',
      ...extra,
    };
    this.steps.push(step);
    return step;
  }

  updateStep(id: number, updates: Partial<AgentStep>): void {
    const step = this.steps.find((s) => s.id === id);
    if (step) Object.assign(step, updates);
  }

  pendingEdits(): AgentStep[] {
    return this.steps.filter((s) => s.kind === 'edit' && s.status === 'pending');
  }

  pendingCommands(): AgentStep[] {
    return this.steps.filter((s) => s.kind === 'command' && s.status === 'pending');
  }

  /** Count steps by status. */
  stats(): { total: number; pending: number; approved: number; applied: number; rejected: number } {
    let pending = 0, approved = 0, applied = 0, rejected = 0;
    for (const s of this.steps) {
      if (s.status === 'pending') pending++;
      else if (s.status === 'approved') approved++;
      else if (s.status === 'applied' || s.status === 'done') applied++;
      else if (s.status === 'rejected') rejected++;
    }
    return { total: this.steps.length, pending, approved, applied, rejected };
  }
}

/** Build the system prompt for agent mode. */
export function buildAgentSystemPrompt(projectMap?: string): string {
  const parts = [
    'You are an AI development agent inside the ZnxStudio IDE for the Zornux language (.zx) and Zoijs framework.',
    'You can plan and implement multi-file changes to accomplish the user\'s goal.',
    '',
    'You work in steps. For each step, respond with ONE of these actions:',
    '',
    'PLAN: <describe your plan in numbered steps>',
    '',
    'EDIT <file_path>',
    '```',
    '<full updated file content>',
    '```',
    '',
    'RUN: <shell command to execute>',
    '',
    'CHECK: <ask the compiler to check the project for errors>',
    '',
    'DONE: <summary of what was accomplished>',
    '',
    'Rules:',
    '- Always start with a PLAN step.',
    '- After each EDIT, the user will tell you the compiler\'s response.',
    '- Fix any errors the compiler reports before moving on.',
    '- Only propose one action per response.',
    '- When proposing an EDIT, include the FULL file content, not a diff or partial.',
    '- Never modify files outside the workspace.',
    '- Never run destructive commands (rm -rf, git reset --hard, etc.) without explicit approval.',
    '- When you are finished, respond with DONE.',
  ];
  if (projectMap) {
    parts.push('', 'Project structure:', projectMap);
  }
  return parts.join('\n');
}

/** Parse an agent response into a step. */
export function parseAgentResponse(text: string): {
  kind: StepKind;
  label: string;
  content: string;
  file?: string;
  command?: string;
  proposed?: string;
} {
  const trimmed = text.trim();

  // PLAN:
  if (trimmed.startsWith('PLAN:') || trimmed.startsWith('PLAN\n')) {
    const content = trimmed.replace(/^PLAN:?\s*/, '');
    return { kind: 'plan', label: 'Plan', content };
  }

  // EDIT <file>
  const editMatch = trimmed.match(/^EDIT\s+(\S+)\s*\n/);
  if (editMatch) {
    const file = editMatch[1];
    const fenceMatch = trimmed.match(/```[^\n]*\n([\s\S]*?)\n?```/);
    const proposed = fenceMatch ? fenceMatch[1] : trimmed.slice(editMatch[0].length);
    return {
      kind: 'edit',
      label: `Edit ${file.split(/[\\/]/).pop()}`,
      content: trimmed,
      file,
      proposed,
    };
  }

  // RUN:
  if (trimmed.startsWith('RUN:')) {
    const command = trimmed.replace(/^RUN:\s*/, '').trim();
    return { kind: 'command', label: `Run: ${command.slice(0, 40)}`, content: trimmed, command };
  }

  // CHECK:
  if (trimmed.startsWith('CHECK:') || trimmed.startsWith('CHECK\n') || trimmed === 'CHECK') {
    return { kind: 'diagnostic', label: 'Check project', content: trimmed, command: 'zornux check' };
  }

  // DONE:
  if (trimmed.startsWith('DONE:') || trimmed.startsWith('DONE\n') || trimmed === 'DONE') {
    const content = trimmed.replace(/^DONE:?\s*/, '');
    return { kind: 'message', label: 'Done', content: content || 'Agent finished.' };
  }

  // Fallback: treat as a message
  return { kind: 'message', label: 'Message', content: trimmed };
}

/** Check if a command is safe to run (not destructive). */
export function isCommandSafe(command: string): boolean {
  const dangerous = [
    'rm -rf', 'rm -r', 'rmdir',
    'git reset --hard', 'git clean', 'git checkout .',
    'git push --force', 'git push -f',
    'format c:', 'del /s',
    'drop table', 'drop database', 'truncate',
    'shutdown', 'reboot', 'halt',
    'kill -9', 'killall',
    'chmod 777', 'chown',
    'curl | sh', 'wget | sh',
    'npm publish', 'cargo publish',
  ];
  const lower = command.toLowerCase();
  return !dangerous.some((d) => lower.includes(d));
}

/** Filter sensitive output before feeding it back to the agent. */
export function filterAgentOutput(output: string): string {
  return filterSecrets(output);
}
