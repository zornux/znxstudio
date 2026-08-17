import {
  ServiceKeys,
  type AiService,
  type CompilerService,
  type EditorService,
  type InputBoxService,
  type TrustService,
  type WorkspaceService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { renderAiMarkdown } from './aiMarkdown';
import { diffLines, diffStats, type DiffLine } from './refactor';
import {
  AgentSession,
  buildAgentSystemPrompt,
  filterAgentOutput,
  isCommandSafe,
  parseAgentResponse,
  type AgentStep,
} from './agentSession';
import {
  ContextStore,
  fileContextItem,
  filterSecrets,
  formatProjectMap,
  scanDeclarations,
  type DeclarationSummary,
} from './context';
import {
  classifyCommand,
  filterCommandOutput,
  hasPathTraversal,
  isSensitiveFile,
  parseCommandString,
  type CommandPolicy,
} from '../../shared/ai/agentExec';

/**
 * Agent mode (Phase 10K). A multi-step AI assistant that can plan and execute
 * multi-file changes, run approved commands, inspect compiler diagnostics, and
 * iterate. Every action requires user approval: file edits show a diff preview,
 * commands require explicit consent, and the user can abort at any time.
 */
export class AgentModule implements IModule {
  readonly id = 'znxstudio.ai.agent';
  readonly displayName = 'AI Agent';

  private context!: ModuleContext;
  private ai!: AiService;
  private editor!: EditorService;
  private root!: HTMLElement;
  private readonly session = new AgentSession();
  private contextStore!: ContextStore;
  private cancel: (() => void) | null = null;

  activate(context: ModuleContext): void {
    this.context = context;
    this.ai = context.services.get<AiService>(ServiceKeys.Ai);
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);
    this.contextStore = context.services.tryGet<ContextStore>(ServiceKeys.AiContext) ?? new ContextStore();

    this.root = document.createElement('div');
    this.root.className = 'znxstudio-agent';

    context.layout.addActivityItem({
      id: 'ai-agent',
      label: 'AI Agent',
      icon: '⚡',
      onSelect: () => this.reveal(),
    });

    context.commands.register(CommandIds.AiAgentStart, () => this.startAgent(), 'AI: Start Agent');
    context.commands.register(CommandIds.AiAgentStop, () => this.stopAgent(), 'AI: Stop Agent');

    context.commands.addEnablementRule((id) => {
      if (id === CommandIds.AiAgentStart) return this.ai.isEnabled() && this.session.state === 'idle';
      if (id === CommandIds.AiAgentStop) return this.session.state !== 'idle' && this.session.state !== 'done';
      return undefined;
    });

    this.render();
    void selfTestCoordinator.run('ai-agent', () => this.maybeSelfTest());
  }

  private reveal(): void {
    this.context.layout.setSideBar('AI Agent', this.root);
    this.context.layout.focusSideBar();
  }

  private async startAgent(): Promise<void> {
    if (!this.ai.isEnabled()) {
      this.context.layout.showToast('AI is off — configure a provider first.', 'info');
      return;
    }

    // Check workspace trust for execution
    const trust = this.context.services.tryGet<TrustService>(ServiceKeys.Trust);
    if (trust && !trust.requireTrust('AI Agent mode (may run commands and modify files)')) {
      return;
    }

    const inputBox = this.context.services.tryGet<InputBoxService>(ServiceKeys.InputBox);
    const goal = await inputBox?.prompt({
      title: 'AI Agent',
      label: 'What should the agent accomplish?',
      placeholder: 'e.g. Add input validation to the User service',
      submitLabel: 'Start',
      validate: (v) => v.trim() ? null : 'Describe the goal.',
    }) ?? '';
    if (!goal.trim()) return;

    this.session.start(goal);
    this.reveal();
    this.render();
    await this.runAgentLoop(goal);
  }

  private stopAgent(): void {
    this.session.abort();
    this.cancel?.();
    this.cancel = null;
    this.render();
    this.context.layout.showToast('Agent stopped.', 'info');
  }

  private async runAgentLoop(goal: string): Promise<void> {
    // Collect project context
    const projectMap = await this.collectProjectMap();
    const systemPrompt = buildAgentSystemPrompt(projectMap);

    this.session.addTurn('user', goal);

    let maxIterations = 20;
    while (!this.session.aborted && maxIterations-- > 0) {
      this.session.state = 'executing';
      this.render();

      let result;
      try {
        result = await this.ai.complete(this.session.history(), {
          system: systemPrompt,
          temperature: 0.1,
          maxTokens: 2000,
        });
      } catch (error) {
        this.session.state = 'error';
        this.session.addStep('message', 'Error', (error as Error).message);
        this.render();
        return;
      }

      if (!result.ok) {
        this.session.state = 'error';
        this.session.addStep('message', 'Error', result.error ?? 'Unknown error');
        this.render();
        return;
      }

      const response = result.text.trim();
      this.session.addTurn('assistant', response);
      const parsed = parseAgentResponse(response);

      if (parsed.kind === 'message' && parsed.label === 'Done') {
        const step = this.session.addStep('message', 'Done', parsed.content);
        step.status = 'done';
        this.session.state = 'done';
        this.render();
        this.context.layout.showToast('Agent completed.', 'success');
        return;
      }

      if (parsed.kind === 'plan') {
        const step = this.session.addStep('plan', 'Plan', parsed.content);
        step.status = 'done';
        this.render();
        this.session.addTurn('user', 'Plan acknowledged. Proceed with the first step.');
        continue;
      }

      if (parsed.kind === 'edit' && parsed.file && parsed.proposed !== undefined) {
        const root = this.getWorkspaceRoot();
        const filePath = root ? `${root.replace(/[\\/]$/, '')}/${parsed.file.replace(/^[\\/]/, '')}` : parsed.file;

        if (hasPathTraversal(parsed.file)) {
          this.session.addStep('message', 'Blocked', `Path traversal rejected: ${parsed.file}`);
          this.session.addTurn('user', `Edit blocked: path traversal in "${parsed.file}" is not allowed.`);
          this.render();
          continue;
        }

        if (isSensitiveFile(parsed.file)) {
          this.session.addStep('message', 'Blocked', `Sensitive file rejected: ${parsed.file}`);
          this.session.addTurn('user', `Edit blocked: "${parsed.file}" is a sensitive file and cannot be modified by the agent.`);
          this.render();
          continue;
        }

        if (!this.isFileConfined(filePath)) {
          this.session.addStep('message', 'Blocked', `Path outside workspace: ${parsed.file}`);
          this.session.addTurn('user', `Edit blocked: "${parsed.file}" resolves outside the workspace boundary.`);
          this.render();
          continue;
        }

        let original = '';
        try {
          original = await this.readFile(filePath);
        } catch {
          original = '';
        }

        const step = this.session.addStep('edit', parsed.label, parsed.content, {
          file: filePath,
          proposed: parsed.proposed,
          original,
        });

        this.session.state = 'waiting';
        this.render();

        const approved = await this.awaitEditApproval(step);
        if (!approved) {
          step.status = 'rejected';
          this.session.addTurn('user', `Edit to ${parsed.file} was rejected. Try a different approach or ask for clarification.`);
          this.render();
          continue;
        }

        step.status = 'applied';
        try {
          await window.znxstudio.fs.writeFile(filePath, parsed.proposed);
          this.session.addTurn('user', `Edit to ${parsed.file} applied successfully. Continue with the next step.`);
        } catch (error) {
          step.status = 'failed';
          this.session.addTurn('user', `Failed to write ${parsed.file}: ${(error as Error).message}`);
        }
        this.render();
        continue;
      }

      if (parsed.kind === 'command' && parsed.command) {
        const { command: exe, args: cmdArgs } = parseCommandString(parsed.command);
        const policy = classifyCommand(exe, cmdArgs);
        const step = this.session.addStep('command', parsed.label, parsed.content, {
          command: parsed.command,
        });

        if (policy.verdict === 'blocked') {
          step.status = 'rejected';
          this.session.addTurn('user', `Command blocked: ${policy.reason}`);
          this.render();
          continue;
        }

        if (policy.verdict === 'needs_approval') {
          this.session.state = 'waiting';
          this.render();
          const approved = await this.awaitCommandApproval(step, policy);
          if (!approved) {
            step.status = 'rejected';
            this.session.addTurn('user', `Command "${parsed.command}" was rejected by the user.`);
            this.render();
            continue;
          }
        } else {
          step.status = 'approved';
        }

        step.status = 'running';
        this.render();

        try {
          const output = await this.executeCommand(parsed.command);
          step.status = 'done';
          step.output = filterCommandOutput(output);
          const filtered = filterCommandOutput(output);
          this.session.addTurn('user', `Command output:\n\`\`\`\n${filtered.slice(0, 3000)}\n\`\`\``);
        } catch (error) {
          step.status = 'failed';
          step.output = (error as Error).message;
          this.session.addTurn('user', `Command failed: ${(error as Error).message}`);
        }
        this.render();
        continue;
      }

      if (parsed.kind === 'diagnostic') {
        const step = this.session.addStep('diagnostic', 'Check project', parsed.content);
        step.status = 'running';
        this.render();

        try {
          const diagnostics = await this.runCheck();
          step.status = 'done';
          step.output = diagnostics;
          this.session.addTurn('user', diagnostics
            ? `Compiler check results:\n${diagnostics}`
            : 'Compiler check: no errors found.');
        } catch (error) {
          step.status = 'failed';
          this.session.addTurn('user', `Compiler check failed: ${(error as Error).message}`);
        }
        this.render();
        continue;
      }

      // Generic message step
      this.session.addStep('message', parsed.label, parsed.content);
      this.render();
      this.session.addTurn('user', 'Continue.');
    }

    if (!this.session.aborted) {
      this.session.state = 'done';
      this.session.addStep('message', 'Limit reached', 'Maximum iteration count reached.');
      this.render();
    }
  }

  private async collectProjectMap(): Promise<string | undefined> {
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    const root = workspace?.currentFolder();
    if (!root) return undefined;

    try {
      const files = await this.collectZxFiles(root);
      if (!files.length) return undefined;

      const declarations: DeclarationSummary[] = [];
      for (const file of files.slice(0, 40)) {
        try {
          const source = await window.znxstudio.fs.readFile(file);
          declarations.push(...scanDeclarations(source, file.replace(root, '').replace(/^[\\/]/, '')));
        } catch { /* skip unreadable */ }
      }
      return formatProjectMap(declarations);
    } catch {
      return undefined;
    }
  }

  private async collectZxFiles(root: string, max = 80): Promise<string[]> {
    const results: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      if (results.length >= max) return;
      const entries = await window.znxstudio.fs.readDirectory(dir);
      for (const entry of entries) {
        if (results.length >= max) break;
        if (entry.type === 'file' && entry.name.endsWith('.zx')) {
          results.push(entry.path);
        } else if (entry.type === 'directory' && !entry.name.startsWith('.')) {
          await walk(entry.path);
        }
      }
    };
    await walk(root);
    return results;
  }

  private async readFile(path: string): Promise<string> {
    return window.znxstudio.fs.readFile(path);
  }

  private nextExecId = 0;

  private async executeCommand(rawCommand: string, approved = true): Promise<string> {
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    const cwd = workspace?.currentFolder() ?? '';
    if (!cwd) throw new Error('No workspace folder open.');

    const { command, args } = parseCommandString(rawCommand);
    const execId = `agent-exec-${this.nextExecId++}`;
    const result = await window.znxstudio.agentExec.run({
      execId,
      command,
      args,
      cwd,
      timeoutMs: 30_000,
      maxOutputBytes: 256 * 1024,
      approved,
    });

    if (result.error) throw new Error(result.error);

    const combined = result.stdout + (result.stderr ? `\n--- stderr ---\n${result.stderr}` : '');
    const suffix = result.timedOut ? '\n(timed out)' : result.truncated ? '\n(output truncated)' : '';
    return combined + suffix;
  }

  private cancelExecution(execId: string): void {
    window.znxstudio.agentExec.cancel(execId);
  }

  private getWorkspaceRoot(): string | undefined {
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    return workspace?.currentFolder() ?? undefined;
  }

  private isFileConfined(filePath: string): boolean {
    const root = this.getWorkspaceRoot();
    if (!root) return false;
    if (hasPathTraversal(filePath)) return false;
    const normalized = filePath.replace(/\\/g, '/');
    const normalizedRoot = root.replace(/\\/g, '/');
    return normalized === normalizedRoot || normalized.startsWith(normalizedRoot + '/');
  }

  private async runCheck(): Promise<string> {
    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    if (!compiler) return 'Compiler unavailable.';
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    const root = workspace?.currentFolder();
    if (!root) return 'No workspace folder.';

    const result = await compiler.checkProject({ sourceDir: root });
    if (result.diagnostics.length === 0) return '';
    return result.diagnostics
      .map((d) => `[${d.code}] ${d.severity}: ${d.message} (${d.file ?? '?'}:${d.range?.start.line ?? '?'})`)
      .join('\n');
  }

  private awaitEditApproval(step: AgentStep): Promise<boolean> {
    return new Promise((resolve) => {
      this.renderWithApproval(step, resolve);
    });
  }

  private awaitCommandApproval(step: AgentStep, policy?: CommandPolicy): Promise<boolean> {
    return new Promise((resolve) => {
      this.renderWithCommandApproval(step, resolve, policy);
    });
  }

  /* ----- rendering ----- */

  private render(): void {
    this.root.replaceChildren();

    // Header
    const header = document.createElement('div');
    header.className = 'znxstudio-agent-header';
    const title = document.createElement('span');
    title.className = 'znxstudio-agent-title';
    title.textContent = this.session.state === 'idle' ? 'AI Agent' : `Agent: ${this.session.goal.slice(0, 50)}`;
    header.appendChild(title);

    if (this.session.state === 'idle') {
      const start = document.createElement('button');
      start.className = 'znxstudio-btn';
      start.textContent = 'Start Agent';
      start.disabled = !this.ai.isEnabled();
      start.addEventListener('click', () => void this.startAgent());
      header.appendChild(start);
    } else if (this.session.state !== 'done' && this.session.state !== 'error') {
      const stop = document.createElement('button');
      stop.className = 'znxstudio-btn-small is-danger';
      stop.textContent = 'Stop';
      stop.addEventListener('click', () => this.stopAgent());
      header.appendChild(stop);
    } else {
      const reset = document.createElement('button');
      reset.className = 'znxstudio-btn-small';
      reset.textContent = 'New Session';
      reset.addEventListener('click', () => {
        this.session.reset();
        this.render();
      });
      header.appendChild(reset);
    }
    this.root.appendChild(header);

    if (this.session.state === 'idle') {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-agent-empty znxstudio-muted';
      empty.textContent = this.ai.isEnabled()
        ? 'Start an agent session to plan and implement multi-file changes with AI assistance.'
        : 'Configure an AI provider to use Agent mode.';
      this.root.appendChild(empty);
      return;
    }

    // Steps list
    const steps = document.createElement('div');
    steps.className = 'znxstudio-agent-steps';
    for (const step of this.session.allSteps()) {
      steps.appendChild(this.renderStep(step));
    }

    // Status indicator
    if (this.session.state === 'executing' || this.session.state === 'planning') {
      const spinner = document.createElement('div');
      spinner.className = 'znxstudio-agent-spinner';
      spinner.textContent = this.session.state === 'planning' ? 'Planning…' : 'Thinking…';
      steps.appendChild(spinner);
    }

    this.root.appendChild(steps);

    // Stats bar
    const stats = this.session.stats();
    if (stats.total > 0) {
      const bar = document.createElement('div');
      bar.className = 'znxstudio-agent-stats';
      bar.textContent = `${stats.applied} applied · ${stats.pending} pending · ${stats.rejected} rejected`;
      this.root.appendChild(bar);
    }
  }

  private renderStep(step: AgentStep): HTMLElement {
    const el = document.createElement('div');
    el.className = `znxstudio-agent-step is-${step.kind} is-${step.status}`;

    const header = document.createElement('div');
    header.className = 'znxstudio-agent-step-header';
    const icon = document.createElement('span');
    icon.className = 'znxstudio-agent-step-icon';
    icon.textContent = this.stepIcon(step);
    const label = document.createElement('span');
    label.className = 'znxstudio-agent-step-label';
    label.textContent = step.label;
    const status = document.createElement('span');
    status.className = `znxstudio-agent-step-status is-${step.status}`;
    status.textContent = step.status;
    header.append(icon, label, status);
    el.appendChild(header);

    // Content
    if (step.kind === 'plan' || step.kind === 'message') {
      const body = document.createElement('div');
      body.className = 'znxstudio-agent-step-body';
      renderAiMarkdown(body, step.content);
      el.appendChild(body);
    }

    if (step.kind === 'edit' && step.original !== undefined && step.proposed !== undefined) {
      const diff = diffLines(step.original, step.proposed);
      const stats = diffStats(diff);
      const meta = document.createElement('div');
      meta.className = 'znxstudio-agent-step-meta';
      meta.textContent = `${step.file} · +${stats.added} −${stats.removed}`;
      el.appendChild(meta);
    }

    if (step.kind === 'command') {
      const cmd = document.createElement('pre');
      cmd.className = 'znxstudio-agent-step-command';
      cmd.textContent = step.command ?? '';
      el.appendChild(cmd);
      if (step.output) {
        const out = document.createElement('pre');
        out.className = 'znxstudio-agent-step-output';
        out.textContent = step.output.slice(0, 2000);
        el.appendChild(out);
      }
    }

    return el;
  }

  private renderWithApproval(step: AgentStep, resolve: (approved: boolean) => void): void {
    this.render();
    if (!step.original || !step.proposed) {
      resolve(false);
      return;
    }

    const diff = diffLines(step.original, step.proposed);
    const stats = diffStats(diff);
    const container = document.createElement('div');
    container.className = 'znxstudio-agent-approval';

    const title = document.createElement('div');
    title.className = 'znxstudio-agent-approval-title';
    title.textContent = `Review: ${step.file}`;
    container.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'znxstudio-ai-diff-meta';
    meta.innerHTML = `<span class="znxstudio-ai-diff-add">+${stats.added}</span> <span class="znxstudio-ai-diff-del">−${stats.removed}</span>`;
    container.appendChild(meta);

    container.appendChild(this.renderDiff(diff));

    const actions = document.createElement('div');
    actions.className = 'znxstudio-ai-diff-actions';
    const accept = document.createElement('button');
    accept.className = 'znxstudio-btn primary';
    accept.textContent = 'Accept';
    accept.addEventListener('click', () => resolve(true));
    const reject = document.createElement('button');
    reject.className = 'znxstudio-btn';
    reject.textContent = 'Reject';
    reject.addEventListener('click', () => resolve(false));
    actions.append(reject, accept);
    container.appendChild(actions);

    this.root.appendChild(container);
    accept.focus();
  }

  private renderWithCommandApproval(step: AgentStep, resolve: (approved: boolean) => void, policy?: CommandPolicy): void {
    this.render();
    const container = document.createElement('div');
    container.className = 'znxstudio-agent-approval';

    const title = document.createElement('div');
    title.className = 'znxstudio-agent-approval-title';
    title.textContent = 'Approve command execution?';
    container.appendChild(title);

    const details = document.createElement('div');
    details.className = 'znxstudio-agent-approval-details';
    const root = this.getWorkspaceRoot() ?? '(unknown)';
    details.innerHTML = '';
    const cmdLabel = document.createElement('div');
    cmdLabel.className = 'znxstudio-agent-approval-field';
    cmdLabel.textContent = `Command: ${step.command ?? ''}`;
    const cwdLabel = document.createElement('div');
    cwdLabel.className = 'znxstudio-agent-approval-field';
    cwdLabel.textContent = `Workspace: ${root}`;
    const purposeLabel = document.createElement('div');
    purposeLabel.className = 'znxstudio-agent-approval-field';
    purposeLabel.textContent = `Purpose: ${this.session.goal.slice(0, 100)}`;
    details.append(cmdLabel, cwdLabel, purposeLabel);
    container.appendChild(details);

    if (policy) {
      const reason = document.createElement('div');
      reason.className = 'znxstudio-agent-approval-warn';
      reason.textContent = policy.reason;
      container.appendChild(reason);
    }

    const cmd = document.createElement('pre');
    cmd.className = 'znxstudio-agent-step-command';
    cmd.textContent = step.command ?? '';
    container.appendChild(cmd);

    const actions = document.createElement('div');
    actions.className = 'znxstudio-ai-diff-actions';
    const accept = document.createElement('button');
    accept.className = 'znxstudio-btn primary';
    accept.textContent = 'Run';
    accept.addEventListener('click', () => resolve(true));
    const reject = document.createElement('button');
    reject.className = 'znxstudio-btn';
    reject.textContent = 'Deny';
    reject.addEventListener('click', () => resolve(false));
    actions.append(reject, accept);
    container.appendChild(actions);

    this.root.appendChild(container);
    accept.focus();
  }

  private renderDiff(diff: DiffLine[]): HTMLElement {
    const pre = document.createElement('div');
    pre.className = 'znxstudio-ai-diff';
    for (const line of diff) {
      const row = document.createElement('div');
      row.className = `znxstudio-ai-diff-line is-${line.type}`;
      const gutter = document.createElement('span');
      gutter.className = 'znxstudio-ai-diff-gutter';
      gutter.textContent = line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ';
      const text = document.createElement('span');
      text.className = 'znxstudio-ai-diff-text';
      text.textContent = line.text.length ? line.text : ' ';
      row.append(gutter, text);
      pre.appendChild(row);
    }
    return pre;
  }

  private stepIcon(step: AgentStep): string {
    switch (step.kind) {
      case 'plan': return '📋';
      case 'edit': return step.status === 'applied' ? '✓' : step.status === 'rejected' ? '✗' : '📝';
      case 'command': return step.status === 'done' ? '✓' : step.status === 'failed' ? '✗' : '▶';
      case 'diagnostic': return '🔍';
      case 'message': return step.label === 'Done' ? '✓' : 'ℹ';
      default: return '·';
    }
  }

  /* ----- self-test ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    const session = new AgentSession();
    log(`agent session idle=${session.state === 'idle'}`);
    session.start('add validation');
    log(`agent session planning=${session.state === 'planning'} goal=${session.goal}`);

    const plan = parseAgentResponse('PLAN:\n1. Read the service file\n2. Add validation');
    log(`agent parse plan: kind=${plan.kind} label=${plan.label}`);
    const edit = parseAgentResponse('EDIT src/user.zx\n```\nfunction validate\nend\n```');
    log(`agent parse edit: kind=${edit.kind} file=${edit.file} hasProposed=${Boolean(edit.proposed)}`);
    const run = parseAgentResponse('RUN: zornux check .');
    log(`agent parse run: kind=${run.kind} command=${run.command}`);
    const done = parseAgentResponse('DONE: Added validation to the User service.');
    log(`agent parse done: kind=${done.kind}`);

    log(`agent safe: ls=${isCommandSafe('ls -la')} rm=${isCommandSafe('rm -rf /')}`);
    log(`agent filter: ${filterAgentOutput('key=sk-abc123def456789012345678901234567890').includes('[REDACTED]')}`);

    session.abort();
    log(`agent aborted=${session.aborted}`);
    session.reset();
    log(`agent reset idle=${session.state === 'idle'}`);
  }
}
