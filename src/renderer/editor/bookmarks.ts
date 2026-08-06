/**
 * Pure bookmark model (Phase 7E). Tracks marked lines per document uri, with
 * navigation and (de)serialization for persistence. No DOM / no Monaco — the
 * BookmarksModule renders glyphs and a panel from what this returns.
 */
export interface Bookmark {
  uri: string;
  line: number;
}

export class BookmarkModel {
  private readonly byUri = new Map<string, Set<number>>();

  /** Toggle a 0-based line; returns true if it is now bookmarked. */
  toggle(uri: string, line: number): boolean {
    let set = this.byUri.get(uri);
    if (!set) {
      set = new Set<number>();
      this.byUri.set(uri, set);
    }
    if (set.has(line)) {
      set.delete(line);
      if (set.size === 0) this.byUri.delete(uri);
      return false;
    }
    set.add(line);
    return true;
  }

  has(uri: string, line: number): boolean {
    return this.byUri.get(uri)?.has(line) ?? false;
  }

  /** The bookmarked lines in `uri`, ascending. */
  lines(uri: string): number[] {
    return [...(this.byUri.get(uri) ?? [])].sort((a, b) => a - b);
  }

  /** Every bookmark across all files, sorted by uri then line. */
  all(): Bookmark[] {
    const result: Bookmark[] = [];
    for (const uri of [...this.byUri.keys()].sort()) {
      for (const line of this.lines(uri)) result.push({ uri, line });
    }
    return result;
  }

  count(): number {
    let total = 0;
    for (const set of this.byUri.values()) total += set.size;
    return total;
  }

  clear(): void {
    this.byUri.clear();
  }

  /** The next bookmark after `line` in `uri`, wrapping to the first; null if none. */
  nextInFile(uri: string, line: number): number | null {
    const lines = this.lines(uri);
    if (lines.length === 0) return null;
    return lines.find((l) => l > line) ?? lines[0];
  }

  /** The previous bookmark before `line` in `uri`, wrapping to the last; null if none. */
  prevInFile(uri: string, line: number): number | null {
    const lines = this.lines(uri);
    if (lines.length === 0) return null;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i] < line) return lines[i];
    }
    return lines[lines.length - 1];
  }

  /** Snapshot as `{ uri: [lines…] }` for persistence. */
  serialize(): Record<string, number[]> {
    const data: Record<string, number[]> = {};
    for (const uri of this.byUri.keys()) data[uri] = this.lines(uri);
    return data;
  }

  /** Replace the model from a persisted snapshot. */
  load(data: Record<string, number[]>): void {
    this.byUri.clear();
    for (const [uri, lines] of Object.entries(data ?? {})) {
      const clean = lines.filter((l) => Number.isInteger(l) && l >= 0);
      if (clean.length) this.byUri.set(uri, new Set(clean));
    }
  }
}
