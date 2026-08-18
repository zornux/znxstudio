import { spawn, type ChildProcess } from 'node:child_process';
import { normalize, resolve } from 'node:path';
import {
  AGENT_EXEC_DEFAULTS,
  classifyCommand,
  filterCommandOutput,
  sanitizeEnvironment,
  truncateOutput,
  type AgentExecRequest,
  type AgentExecResult,
} from '../../shared/ai/agentExec';
import { confineToRoots } from '../util/pathBoundary';

export class AgentExecService {
  private readonly active = new Map<string, ChildProcess>();
  private readonly cancelledIds = new Set<string>();

  async run(request: AgentExecRequest, workspaceRoots: readonly string[]): Promise<AgentExecResult> {
    const start = Date.now();
    const timeoutMs = request.timeoutMs ?? AGENT_EXEC_DEFAULTS.timeoutMs;
    const maxBytes = request.maxOutputBytes ?? AGENT_EXEC_DEFAULTS.maxOutputBytes;

    const confined = confineToRoots(request.cwd, workspaceRoots);
    if (!confined) {
      return this.errorResult(request.execId, start, `Working directory '${request.cwd}' is outside the workspace.`);
    }

    const policy = classifyCommand(request.command, request.args);
    if (policy.verdict === 'blocked') {
      return this.errorResult(request.execId, start, policy.reason);
    }
    if (policy.verdict === 'needs_approval' && !request.approved) {
      return this.errorResult(request.execId, start, `Command '${request.command}' requires approval but was not approved.`);
    }

    const exe = resolve(confined, request.command);
    const args = request.args;
    const env = sanitizeEnvironment(process.env as Record<string, string | undefined>);

    return new Promise<AgentExecResult>((resolvePromise) => {
      let child: ChildProcess;
      try {
        child = spawn(exe, args, {
          cwd: confined,
          env: { ...env, PATH: process.env.PATH },
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs,
          killSignal: 'SIGTERM',
          windowsHide: true,
        });
      } catch (err) {
        resolvePromise(this.errorResult(request.execId, start, `Failed to spawn: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }

      this.active.set(request.execId, child);

      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;
      const capOutput = (chunk: Buffer, target: 'out' | 'err') => {
        const text = chunk.toString('utf-8');
        if (target === 'out') stdout += text; else stderr += text;
        if (stdout.length + stderr.length > maxBytes * 1.5) {
          truncated = true;
          this.killTree(child);
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => capOutput(chunk, 'out'));
      child.stderr?.on('data', (chunk: Buffer) => capOutput(chunk, 'err'));

      const timer = setTimeout(() => {
        timedOut = true;
        this.killTree(child);
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        this.active.delete(request.execId);
        const cancelled = this.cancelledIds.delete(request.execId);

        const outResult = truncateOutput(stdout, maxBytes);
        const errResult = truncateOutput(stderr, maxBytes);
        if (outResult.truncated || errResult.truncated) truncated = true;

        resolvePromise({
          execId: request.execId,
          ok: code === 0 && !timedOut && !cancelled,
          exitCode: code,
          stdout: filterCommandOutput(outResult.text),
          stderr: filterCommandOutput(errResult.text),
          timedOut,
          cancelled,
          truncated,
          durationMs: Date.now() - start,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        this.active.delete(request.execId);
        resolvePromise(this.errorResult(request.execId, start, err.message));
      });
    });
  }

  cancel(execId: string): void {
    const child = this.active.get(execId);
    if (child) {
      this.cancelledIds.add(execId);
      this.killTree(child);
      this.active.delete(execId);
    }
  }

  dispose(): void {
    for (const [id, child] of this.active) {
      this.killTree(child);
      this.active.delete(id);
    }
  }

  private killTree(child: ChildProcess): void {
    try {
      if (child.pid != null) {
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch {
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
    }
  }

  private errorResult(execId: string, start: number, error: string): AgentExecResult {
    return {
      execId,
      ok: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      cancelled: false,
      truncated: false,
      durationMs: Date.now() - start,
      error,
    };
  }
}
