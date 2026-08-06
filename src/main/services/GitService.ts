import { spawn } from 'node:child_process';
import type { GitExecRequest, GitExecResult } from '../../shared/types';

const TIMEOUT_MS = 30_000;

/**
 * Runs the real `git` binary in a working directory and returns its raw result
 * (Phase 12). The renderer builds the argument list and parses the output with
 * pure helpers, so this stays a thin, auditable seam: it ONLY ever spawns `git`
 * (never an arbitrary binary), and never throws to the renderer — a spawn failure
 * becomes a non-zero exit with the error on stderr.
 */
export class GitService {
  async exec(request: GitExecRequest): Promise<GitExecResult> {
    if (!Array.isArray(request.args) || request.args.length === 0) {
      return { code: 1, stdout: '', stderr: 'git: no arguments' };
    }
    try {
      return await this.run(request.args, request.cwd);
    } catch (error) {
      return { code: 1, stdout: '', stderr: (error as Error).message };
    }
  }

  private run(args: string[], cwd: string): Promise<GitExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd, windowsHide: true });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`'git ${args.join(' ')}' timed out.`));
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
