import { spawn } from 'node:child_process';
import { interpretPackageOutput, type PackageCommandResult } from '../../shared/packageProtocol';
import type { PackageCommandRequest, PackageQueryRequest, PackageQueryResult } from '../../shared/types';
import { resolveZornux } from '../util/zornuxRuntime';

const TIMEOUT_MS = 120_000; // restore can hit a registry/network

/**
 * Runs `zornux` package operations (add / remove / restore) in a project
 * directory and returns a structured result. Uses `--json` so failures come
 * back as parseable diagnostics; success is a clean exit 0. Never throws to the
 * renderer — a spawn failure becomes a failed result.
 */
export class PackageService {
  async run(request: PackageCommandRequest): Promise<PackageCommandResult> {
    const command = request.compilerPath?.trim() || resolveZornux().path;
    const args = [request.command, ...request.args];
    if (request.registry) args.push('--registry', request.registry);
    args.push('--json');

    try {
      const { code, stdout, stderr } = await this.exec(command, args, request.cwd);
      return interpretPackageOutput(code, stdout, stderr);
    } catch (error) {
      return {
        success: false,
        message: (error as Error).message,
        diagnostics: [],
      };
    }
  }

  /**
   * Runs a read-oriented package query (search / info / registry list) and
   * returns the raw process result. Results are printed as text (only failures
   * honour `--json`), so parsing is left to the renderer's pure helpers. Never
   * throws — a spawn failure becomes exit 1 with the error on stderr.
   */
  async query(request: PackageQueryRequest): Promise<PackageQueryResult> {
    const command = request.compilerPath?.trim() || resolveZornux().path;
    const args = [request.command, ...request.args];
    if (request.registry) args.push('--registry', request.registry);
    args.push('--json');

    try {
      const { code, stdout, stderr } = await this.exec(command, args, request.cwd);
      return { exitCode: code, stdout, stderr };
    } catch (error) {
      return { exitCode: 1, stdout: '', stderr: (error as Error).message };
    }
  }

  private exec(
    command: string,
    args: string[],
    cwd: string,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, windowsHide: true });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`'zornux ${args.join(' ')}' timed out.`));
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
