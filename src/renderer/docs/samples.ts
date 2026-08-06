/**
 * Sample browser model (Phase 18D).
 *
 * The samples are the Zornux compiler's OWN `examples/` tree — 90-odd real `.zx`
 * programs that its test suite runs. ZnxStudio does not ship a parallel set of
 * hand-written snippets, because a second copy would drift from the language.
 *
 * That tree lives inside the compiler repository, which ZnxStudio treats as
 * READ-ONLY. Samples are run in place (running reads, it never writes) but
 * "Open" copies the program into a scratch folder first, so editing a sample
 * can never dirty the compiler's working tree.
 *
 * `examples/invalid/` holds programs that are MEANT to fail — they exist to pin
 * the compiler's diagnostics. Presenting them as broken samples would be a lie
 * about the language, so they carry `expectFailure` and the UI says so.
 */

export interface Sample {
  /** Path relative to the examples root, forward-slashed. */
  path: string;
  /** File name without `.zx`, underscores turned into spaces. */
  title: string;
  /** Top-level folder, or `Basics` for a program at the root. */
  category: string;
  /** True for `examples/invalid/**` — these are expected NOT to compile. */
  expectFailure: boolean;
}

export const ROOT_CATEGORY = 'Basics';
export const INVALID_DIRECTORY = 'invalid';

/**
 * Candidate `examples/` folders for a resolved compiler executable, most likely
 * first. A dev build sits at `<repo>/src/Zornux.Cli/bin/<config>/<tfm>/zornux.exe`,
 * so the repository root — and its `examples/` — is a few levels up. A packaged
 * install has no examples beside it, and the caller falls back to a setting.
 *
 * Pure: it proposes paths, it does not check whether they exist.
 */
export function exampleRootCandidates(compilerPath: string): string[] {
  const segments = compilerPath.replace(/\\/g, '/').split('/');
  segments.pop(); // the executable itself
  const candidates: string[] = [];
  // Climb far enough to clear bin/<config>/<tfm>/ and src/Zornux.Cli/.
  for (let depth = 0; depth < 6 && segments.length; depth += 1) {
    candidates.push([...segments, 'examples'].join('/'));
    segments.pop();
  }
  return candidates;
}

/** Build the sample list from every `.zx` path under an examples root. */
export function collectSamples(root: string, files: string[]): Sample[] {
  const prefix = `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
  const samples: Sample[] = [];
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');
    if (!normalized.toLowerCase().endsWith('.zx')) continue;
    if (!normalized.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const relative = normalized.slice(prefix.length);
    if (!relative) continue;
    const segments = relative.split('/');
    const category = segments.length > 1 ? segments[0] : ROOT_CATEGORY;
    samples.push({
      path: relative,
      title: sampleTitle(relative),
      category,
      expectFailure: segments[0] === INVALID_DIRECTORY,
    });
  }
  return sortSamples(samples);
}

export function sampleTitle(path: string): string {
  const name = (path.split('/').pop() ?? path).replace(/\.zx$/i, '');
  return name.replace(/[_-]+/g, ' ');
}

/** Basics first (they are the introduction), then categories alphabetically. */
export function sortSamples(samples: Sample[]): Sample[] {
  const rank = (sample: Sample): number => (sample.category === ROOT_CATEGORY ? 0 : 1);
  return [...samples].sort(
    (a, b) => rank(a) - rank(b) || a.category.localeCompare(b.category) || a.path.localeCompare(b.path),
  );
}

export function sampleCategories(samples: Sample[]): string[] {
  const seen: string[] = [];
  for (const sample of sortSamples(samples)) {
    if (!seen.includes(sample.category)) seen.push(sample.category);
  }
  return seen;
}

/** Case-insensitive match on title, path and category. An empty query matches all. */
export function filterSamples(samples: Sample[], query: string): Sample[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return samples;
  return samples.filter((sample) =>
    [sample.title, sample.path, sample.category].some((field) => field.toLowerCase().includes(needle)),
  );
}

/** The scratch copy's path for a sample. Flattened so nested names stay unique. */
export function scratchCopyPath(scratchRoot: string, sample: Sample): string {
  const flattened = sample.path.replace(/\//g, '-');
  return `${scratchRoot.replace(/[\\/]+$/, '')}\\${flattened}`;
}

export interface SampleRun {
  code: number | null;
  output: string;
  /** True when the program behaved as the sample intends. */
  asExpected: boolean;
}

/**
 * Judge a run. For a normal sample, success is exit 0. For `examples/invalid/**`
 * the compiler is SUPPOSED to reject the program, so a non-zero exit is the
 * expected result and a clean exit would be the surprise.
 */
export function judgeRun(sample: Sample, code: number | null, output: string): SampleRun {
  const succeeded = code === 0;
  return { code, output, asExpected: sample.expectFailure ? !succeeded : succeeded };
}

/** `run` uses the tree-walking interpreter; `vm-run` uses the bytecode VM. */
export type SampleEngine = 'interpreter' | 'vm';

export function buildRunArgs(file: string, engine: SampleEngine): string[] {
  return [engine === 'vm' ? 'vm-run' : 'run', file];
}
