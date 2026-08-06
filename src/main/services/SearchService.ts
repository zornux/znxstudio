import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { atomicWriteFile } from '../util/atomicWrite';
import { buildSearchRegex, findMatches } from '../../shared/textSearch';
import { expandReplacement, replaceAll, replaceLine } from '../../shared/textReplace';
import { isSymbolScannable, scanSymbols } from '../../shared/symbolScan';
import type {
  SearchApplyRequest,
  SearchApplyResult,
  SearchReplacePreview,
  SearchReplaceRequest,
  SearchSymbolRequest,
  SearchSymbolResult,
  SearchTextRequest,
  SearchTextResult,
  SearchFileResult,
  SearchSymbolHit,
  ReplaceFileResult,
} from '../../shared/types';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'bin', 'obj', '.znxstudio', 'out', '.next', 'coverage']);
const TEXT_EXTENSIONS = new Set([
  'zx', 'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs', 'json', 'md', 'css', 'scss', 'html', 'txt',
  'yml', 'yaml', 'xml', 'zxcfg', 'toml', 'ini', 'sh', 'sql', 'zoijs',
]);
const TEXT_NAMES = new Set(['zornux.project', 'znxstudio.project.json', 'readme', 'license', '.gitignore']);

const MAX_FILES = 6000;
const MAX_FILE_BYTES = 1_000_000;
const DEFAULT_MAX_RESULTS = 2000;
const DEFAULT_MAX_SYMBOLS = 1000;

/** A file with a NUL byte in its first chunk is treated as binary. */
function looksBinary(content: string): boolean {
  const limit = Math.min(content.length, 4096);
  for (let i = 0; i < limit; i += 1) if (content.charCodeAt(i) === 0) return true;
  return false;
}

/**
 * Workspace-wide search (Phase 7A): grep-style text search and a lightweight
 * symbol scan, both over a filesystem walk that skips build/vendor dirs. Pure
 * matching lives in shared helpers; this owns the I/O. Never throws — a bad file
 * is skipped, a bad root yields an empty result.
 */
export class SearchService {
  async searchText(request: SearchTextRequest): Promise<SearchTextResult> {
    const regex = buildSearchRegex(request.query, request);
    const empty: SearchTextResult = { files: [], totalMatches: 0, filesScanned: 0, truncated: false };
    if (!regex) return empty;

    const cap = request.maxResults ?? DEFAULT_MAX_RESULTS;
    const files: SearchFileResult[] = [];
    let totalMatches = 0;
    let filesScanned = 0;
    let truncated = false;

    for await (const path of this.walk(request.root)) {
      if (!this.isTextFile(path)) continue;
      const content = await this.readText(path);
      if (content === null) continue;
      filesScanned += 1;

      const matches: SearchFileResult['matches'] = [];
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const ranges = findMatches(lines[i], regex);
        if (ranges.length === 0) continue;
        matches.push({ line: i, text: lines[i].length > 400 ? `${lines[i].slice(0, 400)}…` : lines[i], ranges });
        totalMatches += ranges.length;
        if (totalMatches >= cap) {
          truncated = true;
          break;
        }
      }
      if (matches.length) files.push({ file: path, matches });
      if (truncated) break;
    }

    return { files, totalMatches, filesScanned, truncated };
  }

  async searchSymbols(request: SearchSymbolRequest): Promise<SearchSymbolResult> {
    const needle = request.query.trim().toLowerCase();
    const cap = request.maxResults ?? DEFAULT_MAX_SYMBOLS;
    const symbols: SearchSymbolHit[] = [];
    let truncated = false;

    for await (const path of this.walk(request.root)) {
      const ext = extname(path).slice(1);
      if (!isSymbolScannable(ext)) continue;
      const content = await this.readText(path);
      if (content === null) continue;

      for (const symbol of scanSymbols(content, ext)) {
        if (needle && !symbol.name.toLowerCase().includes(needle)) continue;
        symbols.push({ name: symbol.name, kind: symbol.kind, file: path, line: symbol.line, col: symbol.col });
        if (symbols.length >= cap) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }

    return { symbols, truncated };
  }

  /** Preview a replace: like searchText, but each match carries its replaced line. */
  async previewReplace(request: SearchReplaceRequest): Promise<SearchReplacePreview> {
    const regex = buildSearchRegex(request.query, request);
    const empty: SearchReplacePreview = { files: [], totalMatches: 0, filesScanned: 0, truncated: false };
    if (!regex) return empty;
    const replacement = expandReplacement(request.replacement, request.isRegex ?? false);

    const cap = request.maxResults ?? DEFAULT_MAX_RESULTS;
    const files: ReplaceFileResult[] = [];
    let totalMatches = 0;
    let filesScanned = 0;
    let truncated = false;

    for await (const path of this.walk(request.root)) {
      if (!this.isTextFile(path)) continue;
      const content = await this.readText(path);
      if (content === null) continue;
      filesScanned += 1;

      const matches: ReplaceFileResult['matches'] = [];
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const ranges = findMatches(lines[i], regex);
        if (ranges.length === 0) continue;
        const clip = (s: string) => (s.length > 400 ? `${s.slice(0, 400)}…` : s);
        matches.push({ line: i, text: clip(lines[i]), newText: clip(replaceLine(lines[i], regex, replacement)), ranges });
        totalMatches += ranges.length;
        if (totalMatches >= cap) {
          truncated = true;
          break;
        }
      }
      if (matches.length) files.push({ file: path, matches });
      if (truncated) break;
    }

    return { files, totalMatches, filesScanned, truncated };
  }

  /**
   * Apply a replace by rewriting files on disk. When `files` is given only those
   * are touched (the renderer edits OPEN files through their editor models to
   * avoid clobbering unsaved changes, and passes the CLOSED ones here). Each file
   * is re-read fresh, so results are consistent with the current disk content.
   */
  async applyReplace(request: SearchApplyRequest): Promise<SearchApplyResult> {
    const regex = buildSearchRegex(request.query, request);
    if (!regex) return { filesChanged: 0, replacements: 0 };
    const replacement = expandReplacement(request.replacement, request.isRegex ?? false);
    const allow = request.files ? new Set(request.files) : null;

    let filesChanged = 0;
    let replacements = 0;

    for await (const path of this.walk(request.root)) {
      if (allow && !allow.has(path)) continue;
      if (!this.isTextFile(path)) continue;
      const content = await this.readText(path);
      if (content === null) continue;

      const { text, count } = replaceAll(content, regex, replacement);
      if (count > 0 && text !== content) {
        try {
          // Atomic write (temp+rename), matching the editor save path — a crash
          // mid Replace-All can't truncate a file.
          await atomicWriteFile(path, text);
          filesChanged += 1;
          replacements += count;
        } catch {
          /* skip unwritable files */
        }
      }
    }

    return { filesChanged, replacements };
  }

  /** Every text file under the root (for Quick Open). Capped by the walk limit. */
  async listFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    for await (const path of this.walk(root)) {
      if (this.isTextFile(path)) files.push(path);
    }
    return files;
  }

  /* ----- fs helpers ----- */

  private async *walk(root: string): AsyncGenerator<string> {
    let scanned = 0;
    const stack: string[] = [root];
    while (stack.length) {
      const dir = stack.pop()!;
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) stack.push(full);
        } else if (entry.isFile()) {
          scanned += 1;
          if (scanned > MAX_FILES) return;
          yield full;
        }
      }
    }
  }

  private isTextFile(path: string): boolean {
    const ext = extname(path).slice(1).toLowerCase();
    if (TEXT_EXTENSIONS.has(ext)) return true;
    const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
    return TEXT_NAMES.has(name);
  }

  private async readText(path: string): Promise<string | null> {
    try {
      const stat = await fs.stat(path);
      if (stat.size > MAX_FILE_BYTES) return null;
      const content = await fs.readFile(path, 'utf8');
      return looksBinary(content) ? null : content;
    } catch {
      return null;
    }
  }
}
