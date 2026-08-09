/**
 * Cross-platform fixtures for the headless self-tests (ZNXSTUDIO_SELFTEST=1).
 *
 * The self-tests used to read Zornux example programs from a hardcoded absolute
 * path that only existed on one developer's machine, so they failed on Linux/macOS
 * CI. These helpers replace that:
 *   - `examplePath(...)` resolves a program under the real examples root (from the
 *     main process); it returns '' when the root is unavailable so a self-test can
 *     skip cleanly instead of failing on a path that doesn't resolve.
 *   - `tempZx(...)` writes a throwaway program into the OS temp dir for tests that
 *     only need *some* openable .zx, so they run on any platform with no checkout.
 */

let rootPromise: Promise<string> | null = null;
let tempPromise: Promise<string> | null = null;
let docsPromise: Promise<string> | null = null;

/** The resolved Zornux examples root, or '' when unavailable. Cached. */
export function examplesRoot(): Promise<string> {
  if (!rootPromise) {
    rootPromise = window.znxstudio.app
      .getInfo()
      .then((info) => info.examplesDir ?? '')
      .catch(() => '');
  }
  return rootPromise;
}

/** Join `segments` onto `base` using the base's own separator (`\` on Windows, `/` elsewhere). */
export function joinNative(base: string, ...segments: string[]): string {
  if (!base) return '';
  const sep = base.includes('\\') ? '\\' : '/';
  return [base.replace(/[\\/]+$/, ''), ...segments].join(sep);
}

/** Absolute path to an example program (segments under the examples root), or '' when unavailable. */
export async function examplePath(...segments: string[]): Promise<string> {
  const root = await examplesRoot();
  return root ? joinNative(root, ...segments) : '';
}

/** The resolved Zoijs docs project root, or '' when unavailable. Cached. */
export function zoijsDocsRoot(): Promise<string> {
  if (!docsPromise) {
    docsPromise = window.znxstudio.app
      .getInfo()
      .then((info) => info.zoijsDocsDir ?? '')
      .catch(() => '');
  }
  return docsPromise;
}

/** Absolute path to a file under the Zoijs docs root (segments), or '' when unavailable. */
export async function zoijsDocsPath(...segments: string[]): Promise<string> {
  const root = await zoijsDocsRoot();
  return root ? joinNative(root, ...segments) : '';
}

/** The parent directory of `dir` using its own separator, or '' when empty. */
export function parentOf(dir: string): string {
  if (!dir) return '';
  const sep = dir.includes('\\') ? '\\' : '/';
  const trimmed = dir.replace(/[\\/]+$/, '');
  const idx = trimmed.lastIndexOf(sep);
  return idx > 0 ? trimmed.slice(0, idx) : trimmed;
}

/**
 * The examples' PARENT (the project/toolchain root that holds `examples/`), with
 * optional segments joined on. Used by self-tests that need a workspace root, not
 * an individual program. '' when the examples root is unavailable.
 */
export async function examplesParent(...segments: string[]): Promise<string> {
  const parent = parentOf(await examplesRoot());
  return parent ? joinNative(parent, ...segments) : '';
}

function tempDir(): Promise<string> {
  if (!tempPromise) {
    tempPromise = window.znxstudio.app
      .getInfo()
      .then((info) => info.tempDir ?? '')
      .catch(() => '');
  }
  return tempPromise;
}

/**
 * A cross-platform path inside the OS temp dir (the file is NOT created — for
 * self-tests that write it themselves via the compiler/fs). Replaces hardcoded
 * `C:\Users\…\Temp\…` paths. '' when the temp dir can't be resolved.
 */
export async function tempPath(name: string): Promise<string> {
  const dir = await tempDir();
  return dir ? joinNative(dir, name) : '';
}

/**
 * Write `content` to a uniquely-named `.zx` file in the OS temp dir and return its
 * absolute path (or '' on failure). During a self-test no workspace is open, so the
 * write is unconfined and lands in a repo-safe scratch location.
 */
export async function tempZx(name: string, content: string): Promise<string> {
  const dir = await tempDir();
  if (!dir) return '';
  const path = joinNative(dir, `znxstudio-selftest-${name}`);
  try {
    await window.znxstudio.fs.writeFile(path, content);
    return path;
  } catch {
    return '';
  }
}
