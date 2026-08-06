/**
 * Pure interpretation of `zornux` package-command output (add / remove /
 * restore). Run with `--json`, the CLI prints nothing on success (exit 0) and a
 * JSON array of `{ code, message, help }` diagnostics on failure. Kept pure so
 * it is unit-testable without spawning the CLI.
 */
export interface PackageDiagnostic {
  code: string;
  message: string;
  help?: string;
}

export interface PackageCommandResult {
  success: boolean;
  /** Human-readable success message (empty under --json), else a failure summary. */
  message: string;
  diagnostics: PackageDiagnostic[];
}

interface RawDiagnostic {
  code?: string;
  Code?: string;
  message?: string;
  Message?: string;
  help?: string;
  Help?: string;
}

export function parsePackageDiagnostics(stdout: string): PackageDiagnostic[] {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('[')) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => {
      const raw = entry as RawDiagnostic;
      return {
        code: raw.code ?? raw.Code ?? '',
        message: raw.message ?? raw.Message ?? '',
        help: raw.help ?? raw.Help,
      };
    });
  } catch {
    return [];
  }
}

export function interpretPackageOutput(exitCode: number, stdout: string, stderr: string): PackageCommandResult {
  if (exitCode === 0) {
    return { success: true, message: stdout.trim(), diagnostics: [] };
  }
  const diagnostics = parsePackageDiagnostics(stdout);
  const message = diagnostics.length > 0 ? '' : stderr.trim() || stdout.trim() || `Package command failed (exit ${exitCode}).`;
  return { success: false, message, diagnostics };
}
