/**
 * The Zornux `--json` envelope (rc.8+).
 *
 * Every `--json` command now prints ONE object on stdout:
 *
 *   { "zornuxJson": 1, "ok": true|false, "command": "...",
 *     "result": <payload | null>, "diagnostics": [ … ] }
 *
 * This replaced the older shapes, where success was a bare summary object and a
 * hard failure was a bare top-level ARRAY of diagnostics — a split every reader
 * had to type-sniff, and which read a failure as an empty success if you forgot.
 *
 * **Expand/contract migration.** ZnxStudio and the compiler are developed together
 * and neither has shipped, but they land asynchronously, so a developer's tree
 * may briefly pair new-ZnxStudio with an old `zornux` binary. During the expand
 * step every reader accepts BOTH the envelope and its own legacy shape:
 * `parseEnvelope` returns the envelope when it recognises one, or `null` so the
 * caller falls back to its pre-rc.8 parser. Once rc.8 is the floor, the contract
 * step deletes those fallbacks and this becomes the only path.
 *
 * Ground truth for the envelope (verified against 1.0.0-rc.8):
 *   • keys are camelCase; `range` is `{ start:{line,col}, end:{line,col} }`
 *   • line/col are 1-BASED; severity is lowercase (`error|warning|info|critical`)
 *   • `ok` means "the command ran and produced its result", NOT "no findings":
 *     `check --security` on a program with a blocking finding is `ok:true` with
 *     the finding in `result.findings` and a non-zero exit. `ok:false` is
 *     reserved for the command not producing its result at all (e.g. the program
 *     did not compile), with the reason in `diagnostics`.
 */

/** A diagnostic as it appears in the envelope's top-level `diagnostics` array. */
export interface EnvelopeDiagnostic {
  code: string;
  /** Lowercase in the envelope (`error`/`warning`/`info`). */
  severity: string;
  message: string;
  /** Present on most, absent on doc diagnostics (which name the symbol in prose). */
  file: string | null;
  /** 1-based; 0 when the diagnostic carries no position. */
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  help: string | null;
}

export interface JsonEnvelope {
  zornuxJson: number;
  ok: boolean;
  command: string;
  /** The command-specific success payload, or null when `ok` is false. */
  result: unknown;
  diagnostics: EnvelopeDiagnostic[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** A raw JSON object is an envelope iff it self-identifies with `zornuxJson`. */
function looksLikeEnvelope(value: unknown): boolean {
  const record = asRecord(value);
  return typeof record.zornuxJson === 'number' && typeof record.ok === 'boolean';
}

/**
 * Find the envelope object in CLI stdout. A profiled program prints its own
 * output before the JSON, so this scans backward from the last `}` and takes the
 * first `{`-prefix that parses AND self-identifies as an envelope — a stray `{`
 * in program output cannot be mistaken for it. Returns null when there is no
 * envelope (the legacy shapes), so the caller can fall back.
 */
export function parseEnvelope(stdout: string): JsonEnvelope | null {
  const end = stdout.lastIndexOf('}');
  if (end < 0) return null;
  const body = stdout.slice(0, end + 1);
  for (let open = body.lastIndexOf('{'); open >= 0; open = body.lastIndexOf('{', open - 1)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.slice(open));
    } catch {
      if (open === 0) break;
      continue;
    }
    if (looksLikeEnvelope(parsed)) return normalize(parsed);
    if (open === 0) break;
  }
  return null;
}

function normalize(raw: unknown): JsonEnvelope {
  const record = asRecord(raw);
  return {
    zornuxJson: num(record.zornuxJson, 1),
    ok: record.ok === true,
    command: String(record.command ?? ''),
    result: 'result' in record ? record.result : null,
    diagnostics: Array.isArray(record.diagnostics) ? record.diagnostics.map(normalizeDiagnostic) : [],
  };
}

function normalizeDiagnostic(raw: unknown): EnvelopeDiagnostic {
  const record = asRecord(raw);
  const range = asRecord(record.range);
  const start = asRecord(range.start);
  const rangeEnd = asRecord(range.end);
  return {
    code: String(record.code ?? ''),
    severity: String(record.severity ?? 'error').toLowerCase(),
    message: String(record.message ?? ''),
    file: typeof record.file === 'string' ? record.file : null,
    startLine: num(start.line),
    startColumn: num(start.col),
    endLine: num(rangeEnd.line, num(start.line)),
    endColumn: num(rangeEnd.col, num(start.col)),
    help: typeof record.help === 'string' ? record.help : null,
  };
}

/** The envelope's `result` as an object (for the object-payload commands). */
export function envelopeResultObject(envelope: JsonEnvelope): Record<string, unknown> | null {
  return envelope.result && typeof envelope.result === 'object' && !Array.isArray(envelope.result)
    ? (envelope.result as Record<string, unknown>)
    : null;
}

/** The envelope's `result` as an array (for `profile timeline`, whose result IS the array). */
export function envelopeResultArray(envelope: JsonEnvelope): unknown[] | null {
  return Array.isArray(envelope.result) ? envelope.result : null;
}
