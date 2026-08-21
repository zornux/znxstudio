import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type {
  CompilerBuildRequest,
  CompilerBuildResult,
  CompilerCheckProjectRequest,
  CompilerCheckRequest,
  CompilerCheckResult,
  CompilerInfo,
  CompilerLocationSource,
} from '../../shared/types';
import { interpretExitCode, outcomeRan, parseCheckStdout } from '../../shared/compilerProtocol';
import type { ZornuxInfo } from '../../shared/toolchain/contracts';
import { resolveInfo, unavailableInfo } from '../../shared/toolchain/negotiation';
import { fastHash } from '../../shared/hash';
import { CompileCacheStore } from './CompileCacheStore';
import { CompilerProfiler, type CompilerProfile } from '../../shared/compilerProfiler';
import type { CompilerCacheStats } from '../../shared/types';
import { ZORNUX_EXE, zornuxCandidates } from '../util/zornuxRuntime';

interface Located {
  path: string;
  source: CompilerLocationSource;
}

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const VERSION_TIMEOUT_MS = 8_000;
const CHECK_TIMEOUT_MS = 30_000;
const FORMAT_TIMEOUT_MS = 15_000;
const CACHE_LIMIT = 128;

/**
 * Bridges the IDE to the real Zornux compiler CLI. It locates the `zornux`
 * executable, reports its version, and runs single-file `check` invocations,
 * translating the JSON output into structured diagnostics. Everything degrades
 * gracefully: if the compiler (or the .NET runtime) is absent, callers get an
 * `available: false` result instead of an exception.
 *
 * This is the main-process half of the Language Platform's compiler boundary —
 * the renderer stays Node-free and reaches it only through IPC.
 */
export class CompilerService {
  private located: Located | null | undefined;
  private readonly infoCache = new Map<string, CompilerInfo>();
  /** Negotiated toolchain info (product/protocol versions + capabilities), per resolved path. */
  private readonly toolchainCache = new Map<string, ZornuxInfo>();
  /**
   * Incremental compile cache: content-addressed compiler results keyed by
   * (command, compiler path, working dir, content hash). Identical inputs skip
   * the subprocess entirely. Session-scoped, LRU-bounded (on-disk persistence is
   * Phase 3F). Only successful runs are cached — transient failures are not.
   */
  private readonly resultCache = new Map<string, CompilerCheckResult | CompilerBuildResult>();
  /** L2: persistent, on-disk cache that survives restarts (Phase 3F). */
  private readonly diskCache = new CompileCacheStore();
  private cacheEnabled = true;
  /** Performance profile across all operations (Phase 3H). */
  private readonly profiler = new CompilerProfiler();

  /** Report availability + version of the compiler (cached per resolved path). */
  async info(override?: string | null): Promise<CompilerInfo> {
    const located = this.locate(override);
    const cached = this.infoCache.get(located.path);
    if (cached) return cached;

    let info: CompilerInfo;
    try {
      const { code, stdout } = await this.exec(located.path, ['--version'], undefined, VERSION_TIMEOUT_MS);
      const match = /zornux\s+([0-9][\w.-]*)/i.exec(stdout);
      info =
        code === 0
          ? { available: true, path: located.path, version: match ? match[1] : null, source: located.source }
          : { available: false, path: located.path, version: null, source: located.source };
    } catch {
      info = { available: false, path: located.path, version: null, source: located.source };
    }

    this.infoCache.set(located.path, info);
    return info;
  }

  /**
   * Negotiate the toolchain's product/protocol versions + capabilities. Probes
   * `zornux capabilities --json` (authoritative); if the binary predates that
   * command, or it isn't a valid info envelope, falls back to deriving the
   * capability set from the version. Never throws — an unreachable compiler
   * yields an `unavailable` info so callers can degrade. Cached per path.
   */
  async capabilities(override?: string | null): Promise<ZornuxInfo> {
    const located = this.locate(override);
    const cached = this.toolchainCache.get(located.path);
    if (cached) return cached;

    const identity = await this.info(override);
    if (!identity.available) {
      const info = unavailableInfo();
      this.toolchainCache.set(located.path, info);
      return info;
    }

    let capStdout: string | null = null;
    try {
      const { code, stdout } = await this.exec(located.path, ['capabilities', '--json'], undefined, VERSION_TIMEOUT_MS);
      // Only trust a clean run's stdout; a non-zero exit means the command isn't
      // there (older binary), so we let `resolveInfo` derive from the version.
      if (code === 0) capStdout = stdout;
    } catch {
      capStdout = null; // spawn failed — derive from the version we already have.
    }

    const info = resolveInfo(capStdout, identity.version);
    this.toolchainCache.set(located.path, info);
    return info;
  }

  /** Check a single document; resolves to a structured result, never throws. */
  async check(request: CompilerCheckRequest): Promise<CompilerCheckResult> {
    const start = process.hrtime.bigint();
    const located = this.locate(request.compilerPath);
    const elapsed = (): number => Number(process.hrtime.bigint() - start) / 1e6;

    const version = await this.versionTag(request.compilerPath);
    const key = this.cacheKey('check', located.path, version, this.cacheCwd(request), request.source);
    const hit = this.cacheGet(key) as CompilerCheckResult | undefined;
    if (hit) {
      this.profiler.record('check', elapsed(), true, request.path);
      return { ...hit, cached: true, durationMs: elapsed() };
    }
    const disk = await this.diskCache.get<CompilerCheckResult>(key);
    if (disk) {
      this.cacheSet(key, disk); // promote to L1
      this.profiler.record('check', elapsed(), true, request.path);
      return { ...disk, cached: true, durationMs: elapsed() };
    }

    let tempDir: string | null = null;
    try {
      // Clean, on-disk files are checked in place (full import fidelity). Dirty
      // or untitled buffers are written to a temp copy so unsaved edits count.
      let target: string;
      if (request.path && !request.isDirty && existsSync(request.path)) {
        target = request.path;
      } else {
        tempDir = await fs.mkdtemp(join(tmpdir(), 'znxstudio-zx-'));
        target = join(tempDir, request.path ? basename(request.path) : 'buffer.zx');
        await fs.writeFile(target, request.source, 'utf8');
      }

      const cwd = request.workspaceRoot ?? dirname(request.path ?? target);
      const { code, stdout, stderr } = await this.exec(
        located.path,
        ['check', target, '--json', '--no-color'],
        cwd,
        CHECK_TIMEOUT_MS,
      );

      const outcome = interpretExitCode(code);
      const ran = outcomeRan(outcome);
      const result: CompilerCheckResult = {
        available: true,
        ran,
        outcome,
        exitCode: code,
        diagnostics: ran ? this.rebase(parseCheckStdout(stdout), target, request.path) : [],
        durationMs: elapsed(),
        cached: false,
        error: ran ? undefined : stderr.trim() || stdout.trim() || undefined,
      };
      if (ran) {
        this.cacheSet(key, result);
        void this.diskCache.set(key, result);
      }
      this.profiler.record('check', result.durationMs, false, request.path);
      return result;
    } catch (error) {
      // Spawn failed (ENOENT / no .NET / etc.) — treat the compiler as absent.
      this.located = undefined; // force re-resolution next time
      return {
        available: false,
        ran: false,
        outcome: 'unavailable',
        exitCode: null,
        diagnostics: [],
        durationMs: elapsed(),
        cached: false,
        error: (error as Error).message,
      };
    } finally {
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  }

  /**
   * Module-aware whole-project check over a source directory: `zornux check
   * <dir> --json` links every .zx and reports cross-file/import diagnostics
   * (ZX13xx). Never throws. Not content-cached here (the renderer gates it by a
   * project content hash from the dependency graph).
   */
  async checkProject(request: CompilerCheckProjectRequest): Promise<CompilerCheckResult> {
    const start = process.hrtime.bigint();
    const located = this.locate(request.compilerPath);
    const elapsed = (): number => Number(process.hrtime.bigint() - start) / 1e6;
    const cwd = request.workspaceRoot ?? request.sourceDir;

    try {
      const { code, stdout, stderr } = await this.exec(
        located.path,
        ['check', request.sourceDir, '--json', '--no-color'],
        cwd,
        CHECK_TIMEOUT_MS,
      );
      const outcome = interpretExitCode(code);
      const ran = outcomeRan(outcome);
      const durationMs = elapsed();
      this.profiler.record('checkProject', durationMs, false, request.sourceDir);
      return {
        available: true,
        ran,
        outcome,
        exitCode: code,
        diagnostics: ran ? parseCheckStdout(stdout) : [],
        durationMs,
        cached: false,
        error: ran ? undefined : stderr.trim() || stdout.trim() || undefined,
      };
    } catch (error) {
      this.located = undefined;
      return {
        available: false,
        ran: false,
        outcome: 'unavailable',
        exitCode: null,
        diagnostics: [],
        durationMs: elapsed(),
        cached: false,
        error: (error as Error).message,
      };
    }
  }

  /* ----- profiling (Phase 3H) ----- */
  profile(): CompilerProfile {
    return this.profiler.snapshot();
  }

  resetProfile(): CompilerProfile {
    this.profiler.reset();
    return this.profiler.snapshot();
  }

  /** Compile a single entry file to a `.zxbc` artifact; never throws. */
  async build(request: CompilerBuildRequest): Promise<CompilerBuildResult> {
    const start = process.hrtime.bigint();
    const located = this.locate(request.compilerPath);
    const elapsed = (): number => Number(process.hrtime.bigint() - start) / 1e6;
    const cwd = request.workspaceRoot ?? dirname(request.path);

    // Content-address by the entry file's bytes. A cache hit only stands if its
    // artifact is still on disk (someone may have cleaned it).
    let key: string | null = null;
    try {
      const version = await this.versionTag(request.compilerPath);
      const source = await fs.readFile(request.path, 'utf8');
      key = this.cacheKey('build', located.path, version, cwd, source);
      const hit = this.cacheGet(key) as CompilerBuildResult | undefined;
      if (hit && this.artifactOk(hit)) {
        this.profiler.record('build', elapsed(), true, request.path);
        return { ...hit, cached: true, durationMs: elapsed() };
      }
      const disk = await this.diskCache.get<CompilerBuildResult>(key);
      if (disk && this.artifactOk(disk)) {
        this.cacheSet(key, disk); // promote to L1
        this.profiler.record('build', elapsed(), true, request.path);
        return { ...disk, cached: true, durationMs: elapsed() };
      }
    } catch {
      key = null; // unreadable entry — skip caching, let the build report it
    }

    try {
      const { code, stdout, stderr } = await this.exec(
        located.path,
        ['build', request.path, '--json', '--no-color'],
        cwd,
        CHECK_TIMEOUT_MS,
      );
      const outcome = interpretExitCode(code);
      const ran = outcomeRan(outcome);
      const ok = outcome === 'ok';

      // `build` emits the artifact next to the source as <name>.zxbc.
      let artifact: string | null = null;
      if (ok) {
        const candidate = request.path.replace(/\.zx$/i, '.zxbc');
        if (candidate !== request.path && existsSync(candidate)) artifact = candidate;
      }

      const result: CompilerBuildResult = {
        available: true,
        ran,
        ok,
        outcome,
        exitCode: code,
        diagnostics: ran ? parseCheckStdout(stdout) : [],
        artifact,
        durationMs: elapsed(),
        cached: false,
        error: ran ? undefined : stderr.trim() || stdout.trim() || undefined,
      };
      if (ran && key) {
        this.cacheSet(key, result);
        void this.diskCache.set(key, result);
      }
      this.profiler.record('build', result.durationMs, false, request.path);
      return result;
    } catch (error) {
      this.located = undefined; // force re-resolution next time
      return {
        available: false,
        ran: false,
        ok: false,
        outcome: 'unavailable',
        exitCode: null,
        diagnostics: [],
        artifact: null,
        durationMs: elapsed(),
        cached: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * When a temp copy was checked, the CLI reports the temp path as `file`.
   * Rewrite it back to the caller's real path so downstream consumers see a
   * stable identity. (Line/column are already correct — the buffer is verbatim.)
   */
  private rebase(
    diagnostics: ReturnType<typeof parseCheckStdout>,
    target: string,
    realPath: string | null,
  ): ReturnType<typeof parseCheckStdout> {
    if (!realPath || realPath === target) return diagnostics;
    return diagnostics.map((d) => ({ ...d, file: realPath }));
  }

  /* ----- incremental cache ----- */
  private cacheKey(command: string, compilerPath: string, version: string, cwd: string, source: string): string {
    return `${command}|${compilerPath}|${version}|${cwd}|${fastHash(source)}`;
  }

  /** Compiler version string for cache keying — a new compiler invalidates entries. */
  private async versionTag(compilerPath?: string | null): Promise<string> {
    return (await this.info(compilerPath)).version ?? 'unknown';
  }

  /* ----- cache management (Phase 3F) ----- */
  setCacheEnabled(enabled: boolean): Promise<CompilerCacheStats> {
    this.cacheEnabled = enabled;
    this.diskCache.setEnabled(enabled);
    return this.cacheStats();
  }

  async cacheStats(): Promise<CompilerCacheStats> {
    const disk = await this.diskCache.stats();
    return { enabled: this.cacheEnabled, entries: disk.entries, bytes: disk.bytes };
  }

  async clearCache(): Promise<CompilerCacheStats> {
    this.resultCache.clear();
    const before = await this.diskCache.clear();
    return { enabled: this.cacheEnabled, entries: before.entries, bytes: before.bytes };
  }

  /** Working dir used for the cache key (mirrors the spawn cwd's import context). */
  private cacheCwd(request: CompilerCheckRequest): string {
    return request.workspaceRoot ?? (request.path ? dirname(request.path) : '');
  }

  /** A cached build stands only if its artifact still exists on disk. */
  private artifactOk(result: CompilerBuildResult): boolean {
    return !result.artifact || existsSync(result.artifact);
  }

  private cacheGet(key: string): CompilerCheckResult | CompilerBuildResult | undefined {
    const hit = this.resultCache.get(key);
    if (hit) {
      // LRU touch.
      this.resultCache.delete(key);
      this.resultCache.set(key, hit);
    }
    return hit;
  }

  private cacheSet(key: string, result: CompilerCheckResult | CompilerBuildResult): void {
    this.resultCache.set(key, result);
    if (this.resultCache.size > CACHE_LIMIT) {
      const oldest = this.resultCache.keys().next().value;
      if (oldest !== undefined) this.resultCache.delete(oldest);
    }
  }

  /** Resolve the compiler executable. An override is honored but never cached. */
  /**
   * Reformat Zornux source with the authoritative `zornux format` command. The
   * CLI formats a file, so the buffer is written to a private temp dir, formatted
   * to stdout, and the dir removed. Returns null when the compiler is unavailable
   * or the command fails, so the caller can fall back to the in-IDE formatter.
   */
  async format(source: string, cwd?: string): Promise<string | null> {
    const located = this.locate();
    let dir: string | null = null;
    try {
      dir = await fs.mkdtemp(join(tmpdir(), 'znx-fmt-'));
      const temp = join(dir, 'buffer.zx');
      await fs.writeFile(temp, source, 'utf8');
      const { code, stdout } = await this.exec(located.path, ['format', temp], cwd, FORMAT_TIMEOUT_MS);
      return code === 0 ? stdout : null;
    } catch {
      return null;
    } finally {
      if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private locate(override?: string | null): Located {
    // An explicit override that exists is honored immediately and NOT cached, so
    // switching the compiler path per request works. Everything else resolves
    // once (bundled runtime → dev build → PATH) and is cached for the session.
    if (override && override.trim() && existsSync(override)) {
      return { path: override, source: 'env' };
    }
    if (this.located) return this.located;

    for (const candidate of zornuxCandidates()) {
      if (existsSync(candidate.path)) {
        this.located = candidate;
        return candidate;
      }
    }

    // Last resort: rely on PATH resolution. info()/check() confirm it works.
    this.located = { path: ZORNUX_EXE, source: 'path' };
    return this.located;
  }

  /** Spawn a CLI subprocess, collect stdio, and enforce a timeout. */
  private exec(command: string, args: string[], cwd: string | undefined, timeoutMs: number): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve, reject) => {
      const child = spawn(command, args, { cwd, windowsHide: true });
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error(`Zornux CLI timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  }
}
