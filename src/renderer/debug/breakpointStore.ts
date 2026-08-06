import type { DebugSourceBreakpoints, DebugSourceVerified } from '../../shared/types';

export interface StoredBreakpoint {
  /** 0-based line. */
  line: number;
  condition?: string;
  /** Adapter verdict — true until a session says otherwise. */
  verified: boolean;
}

/**
 * The breakpoint model — pure and Monaco-free (uri-keyed, 0-based lines), so it
 * is unit-testable. Per file the breakpoints are kept sorted by line, so the DAP
 * `setBreakpoints` request order matches the response order and verified verdicts
 * zip back by index.
 */
export class BreakpointStore {
  private readonly files = new Map<string, StoredBreakpoint[]>();

  /** Toggle a breakpoint; returns true if one was added, false if removed. */
  toggle(uri: string, line: number): boolean {
    const list = this.files.get(uri) ?? [];
    const index = list.findIndex((bp) => bp.line === line);
    if (index >= 0) {
      list.splice(index, 1);
    } else {
      list.push({ line, verified: true });
      list.sort((a, b) => a.line - b.line);
    }
    if (list.length) this.files.set(uri, list);
    else this.files.delete(uri);
    return index < 0;
  }

  setCondition(uri: string, line: number, condition: string | undefined): void {
    const bp = this.files.get(uri)?.find((b) => b.line === line);
    if (bp) bp.condition = condition && condition.trim() ? condition.trim() : undefined;
  }

  forUri(uri: string): StoredBreakpoint[] {
    return this.files.get(uri) ?? [];
  }

  uris(): string[] {
    return [...this.files.keys()];
  }

  /** All breakpoints as DAP source requests (1-based lines), via a uri→path map. */
  launchList(toPath: (uri: string) => string): DebugSourceBreakpoints[] {
    return [...this.files.entries()].map(([uri, list]) => ({
      path: toPath(uri),
      lines: list.map((bp) => ({ line: bp.line + 1, condition: bp.condition })),
    }));
  }

  /** Apply the adapter's verified verdicts (index-parallel to the sorted lines). */
  applyVerified(toUri: (path: string) => string, results: DebugSourceVerified[]): void {
    for (const result of results) {
      const list = this.files.get(toUri(result.path));
      if (!list) continue;
      result.breakpoints.forEach((verdict, i) => {
        if (list[i]) list[i].verified = verdict.verified;
      });
    }
  }

  /** Reset every breakpoint to "verified" (e.g. when no session is running). */
  resetVerified(): void {
    for (const list of this.files.values()) for (const bp of list) bp.verified = true;
  }
}
