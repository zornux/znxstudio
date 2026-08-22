import type {
  CompilerBuildRequest,
  CompilerBuildResult,
  CompilerCacheStats,
  CompilerCheckProjectRequest,
  CompilerCheckRequest,
  CompilerCheckResult,
  CompilerInfo,
} from '../../shared/types';
import type { CompilerProfile } from '../../shared/compilerProfiler';
import type { CompilerService } from '../core/Contracts';

const UNAVAILABLE_CHECK: CompilerCheckResult = {
  available: false,
  ran: false,
  outcome: 'unavailable',
  exitCode: null,
  diagnostics: [],
  durationMs: 0,
  cached: false,
};

const UNAVAILABLE: CompilerInfo = { available: false, path: null, version: null, source: 'none' };

/**
 * Renderer-side handle to the main-process CompilerService, reached through the
 * typed `window.znxstudio.compiler` bridge. It caches the (relatively expensive)
 * availability probe and never throws — a missing bridge or failed IPC yields an
 * "unavailable" result so the IDE keeps working with the fast front-end alone.
 *
 * Registered under `ServiceKeys.Compiler` so later Phase 3 modules (build
 * pipeline, dependency graph, …) share one entry point to the compiler.
 */
export class CompilerClient implements CompilerService {
  private cachedInfo: CompilerInfo | null = null;

  async info(refreshOrOverride?: boolean | string | null): Promise<CompilerInfo> {
    const refresh = refreshOrOverride === true;
    const override = typeof refreshOrOverride === 'string' ? refreshOrOverride : undefined;
    if (!refresh && !override && this.cachedInfo) return this.cachedInfo;
    try {
      this.cachedInfo = await window.znxstudio.compiler.info(override);
    } catch {
      this.cachedInfo = UNAVAILABLE;
    }
    return this.cachedInfo;
  }

  async check(request: CompilerCheckRequest): Promise<CompilerCheckResult> {
    try {
      return await window.znxstudio.compiler.check(request);
    } catch (error) {
      return { ...UNAVAILABLE_CHECK, error: (error as Error).message };
    }
  }

  async checkProject(request: CompilerCheckProjectRequest): Promise<CompilerCheckResult> {
    try {
      return await window.znxstudio.compiler.checkProject(request);
    } catch (error) {
      return { ...UNAVAILABLE_CHECK, error: (error as Error).message };
    }
  }

  cacheStats(): Promise<CompilerCacheStats> {
    return window.znxstudio.compiler.cacheStats();
  }
  cacheClear(): Promise<CompilerCacheStats> {
    return window.znxstudio.compiler.cacheClear();
  }
  cacheConfig(enabled: boolean): Promise<CompilerCacheStats> {
    return window.znxstudio.compiler.cacheConfig(enabled);
  }
  profile(): Promise<CompilerProfile> {
    return window.znxstudio.compiler.profile();
  }
  profileReset(): Promise<CompilerProfile> {
    return window.znxstudio.compiler.profileReset();
  }
  async format(source: string, cwd?: string): Promise<string | null> {
    try {
      return await window.znxstudio.compiler.format({ source, cwd });
    } catch {
      return null;
    }
  }

  async build(request: CompilerBuildRequest): Promise<CompilerBuildResult> {
    try {
      return await window.znxstudio.compiler.build(request);
    } catch (error) {
      return {
        available: false,
        ran: false,
        ok: false,
        outcome: 'unavailable',
        exitCode: null,
        diagnostics: [],
        artifact: null,
        durationMs: 0,
        cached: false,
        error: (error as Error).message,
      };
    }
  }
}
