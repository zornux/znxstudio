import { ServiceKeys, type CompilerService } from '../core/Contracts';
import type { ModuleContext } from '../core/Module';
import { captureTask } from '../database/runCapture';
import { judge, verificationArgs, type Verification, type VerificationResult } from './verify';

/**
 * Runs a learner's program against the REAL Zornux CLI (Phase 18C/18E).
 *
 * The program is written to a file under the OS temp directory — never into the
 * workspace and never into the compiler's own repository — and the CLI is
 * invoked on that copy. Verdicts therefore come from the same compiler that
 * builds production code; there is no simulated grader anywhere in this path.
 */
export class VerificationRunner {
  constructor(private readonly context: ModuleContext) {}

  /** Where scratch programs go. One file per slot, overwritten each attempt. */
  private async scratchFile(slot: string): Promise<string> {
    const info = await window.znxstudio.app.getInfo();
    const safe = slot.replace(/[^\w.-]+/g, '-');
    return `${info.tempDir}\\znxstudio-learning\\${safe}.zx`;
  }

  /**
   * Write `code` and verify it. Returns null when the compiler is unavailable —
   * distinct from a failed attempt, and reported as such rather than as "wrong".
   */
  async run(slot: string, code: string, verification: Verification): Promise<VerificationResult | null> {
    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const info = compiler ? await compiler.info() : null;
    if (!info?.available || !info.path) {
      this.context.layout.showToast('Zornux compiler unavailable — cannot check your answer.', 'error');
      return null;
    }

    let file: string;
    try {
      file = await this.scratchFile(slot);
      await window.znxstudio.fs.writeFile(file, code.endsWith('\n') ? code : `${code}\n`);
    } catch (error) {
      this.context.layout.showToast(`Could not save your program: ${(error as Error).message}`, 'error');
      return null;
    }

    const quote = (arg: string) => (arg.includes(' ') ? `"${arg}"` : arg);
    const command = `"${info.path}" ${verificationArgs(verification, file).map(quote).join(' ')}`;
    const { code: exitCode, output } = await captureTask(command, file.replace(/[\\/][^\\/]*$/, ''));
    return judge(verification, exitCode, output);
  }
}
