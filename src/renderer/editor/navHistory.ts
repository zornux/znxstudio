/**
 * Pure navigation history (Phase 7E). A back/forward stack of visited locations,
 * VS Code style: pushing a new location truncates any forward entries, dedupes
 * the current line, and caps the size. No DOM / no Monaco.
 */
export interface NavLocation {
  uri: string;
  line: number;
  character: number;
}

/**
 * Whether moving from `from` to `to` is a "jump" worth recording — a different
 * file, or a same-file move of at least `threshold` lines. Small cursor nudges
 * (typing, arrow keys) are not recorded.
 */
export function isSignificantJump(
  from: NavLocation | null,
  to: NavLocation,
  threshold = 10,
): boolean {
  if (!from) return true;
  if (from.uri !== to.uri) return true;
  return Math.abs(from.line - to.line) >= threshold;
}

export class NavHistory {
  private entries: NavLocation[] = [];
  private index = -1;

  constructor(private readonly max = 50) {}

  /** Record a location. Truncates forward history, dedupes same line, caps size. */
  push(location: NavLocation): void {
    const current = this.entries[this.index];
    if (current && current.uri === location.uri && current.line === location.line) {
      this.entries[this.index] = location; // same line — just refine the column
      return;
    }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(location);
    if (this.entries.length > this.max) this.entries.shift();
    this.index = this.entries.length - 1;
  }

  canBack(): boolean {
    return this.index > 0;
  }
  canForward(): boolean {
    return this.index < this.entries.length - 1;
  }

  /** Step back and return the now-current location, or null at the start. */
  back(): NavLocation | null {
    if (!this.canBack()) return null;
    this.index -= 1;
    return this.entries[this.index];
  }

  /** Step forward and return the now-current location, or null at the end. */
  forward(): NavLocation | null {
    if (!this.canForward()) return null;
    this.index += 1;
    return this.entries[this.index];
  }

  current(): NavLocation | null {
    return this.entries[this.index] ?? null;
  }

  size(): number {
    return this.entries.length;
  }
}
