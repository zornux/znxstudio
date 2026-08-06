import { spawn } from 'node:child_process';
import type { GitExecResult, ToolExecRequest } from '../../shared/types';

const TIMEOUT_MS = 60_000;

/**
 * Runs an allowlisted deployment CLI (Phase 13) — docker / kubectl / cloud CLIs.
 * The renderer never names an arbitrary binary: only tools on ALLOWLIST run, and
 * anything else is rejected. Each tool is optional — a missing binary surfaces as
 * a non-zero exit, so the renderer degrades to generation-only.
 */
const ALLOWLIST = new Set([
  'docker',
  'kubectl',
  'flyctl',
  'fly',
  'gcloud',
  'aws',
  'az',
  'render',
  'railway',
]);

export class ToolService {
  async exec(request: ToolExecRequest): Promise<GitExecResult> {
    if (!ALLOWLIST.has(request.tool)) {
      return { code: 126, stdout: '', stderr: `tool "${request.tool}" is not allowed` };
    }
    if (!Array.isArray(request.args)) {
      return { code: 1, stdout: '', stderr: 'no arguments' };
    }
    try {
      return await this.run(request.tool, request.args, request.cwd);
    } catch (error) {
      return { code: 127, stdout: '', stderr: (error as Error).message };
    }
  }

  private run(tool: string, args: string[], cwd: string): Promise<GitExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(tool, args, { cwd, windowsHide: true });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`'${tool} ${args.join(' ')}' timed out.`));
      }, TIMEOUT_MS);
      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout, stderr });
      });
    });
  }
}
