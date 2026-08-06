import { spawn } from 'node:child_process';
import type { GitExecRequest, GitExecResult } from '../../shared/types';

const TIMEOUT_MS = 30_000;

/**
 * Runs the GitHub CLI (`gh`) for pull-request features (Phase 12C). Optional:
 * `gh` may be absent or unauthenticated — that surfaces as a non-zero exit, and
 * the renderer degrades to opening GitHub URLs directly. Only ever spawns `gh`.
 */
export class GhService {
  async exec(request: GitExecRequest): Promise<GitExecResult> {
    if (!Array.isArray(request.args) || request.args.length === 0) {
      return { code: 1, stdout: '', stderr: 'gh: no arguments' };
    }
    try {
      return await this.run(request.args, request.cwd);
    } catch (error) {
      // gh not installed / not on PATH → treated as unavailable, not a crash.
      return { code: 127, stdout: '', stderr: (error as Error).message };
    }
  }

  private run(args: string[], cwd: string): Promise<GitExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('gh', args, { cwd, windowsHide: true });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`'gh ${args.join(' ')}' timed out.`));
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
