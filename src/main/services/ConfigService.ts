import { spawn } from 'node:child_process';
import type { ConfigQueryRequest, ConfigQueryResult } from '../../shared/types';
import { resolveZornux } from '../util/zornuxRuntime';

const TIMEOUT_MS = 30_000;

/**
 * Runs `zornux config show|validate <file> --profile <name>` in a project
 * directory and returns the raw process result. The CLI prints human-readable
 * text (not JSON), so the renderer parses it with the pure `environmentProfiles`
 * helpers. Never throws to the renderer — a spawn failure becomes exit 1.
 */
export class ConfigService {
  async query(request: ConfigQueryRequest): Promise<ConfigQueryResult> {
    const command = request.compilerPath?.trim() || resolveZornux().path;
    const args = ['config', request.subcommand, request.file, '--profile', request.profile];

    return new Promise<ConfigQueryResult>((resolve) => {
      const child = spawn(command, args, { cwd: request.cwd, windowsHide: true });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        resolve({ exitCode: 1, stdout, stderr: stderr || `'zornux config ${request.subcommand}' timed out.` });
      }, TIMEOUT_MS);

      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ exitCode: 1, stdout, stderr: (error as Error).message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
  }
}
