/**
 * Merge-conflict parsing + resolution (Phase 12D). Pure handling of git conflict
 * markers (`<<<<<<<` / `|||||||` base / `=======` / `>>>>>>>`): count them,
 * extract the "ours"/"theirs" sides for display, and rebuild the file taking one
 * side (or both). Kept pure so the marker walking is unit-tested; the module
 * writes the result back to the working tree and stages it.
 */

export type ConflictChoice = 'ours' | 'theirs' | 'both';

export interface ConflictBlock {
  ourLabel: string;
  theirLabel: string;
  ours: string;
  theirs: string;
  base?: string;
}

const OURS = '<<<<<<<';
const BASE = '|||||||';
const SEP = '=======';
const THEIRS = '>>>>>>>';

export function hasConflictMarkers(text: string): boolean {
  return text.includes(`${OURS} `) && text.includes(`${THEIRS} `);
}

/** Extract each conflict block (for display / counting). */
export function conflictBlocks(text: string): ConflictBlock[] {
  const lines = text.split('\n');
  const blocks: ConflictBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith(OURS)) {
      const ourLabel = lines[i].slice(OURS.length).trim();
      i++;
      const ours: string[] = [];
      while (i < lines.length && !lines[i].startsWith(SEP) && !lines[i].startsWith(BASE)) ours.push(lines[i++]);
      let base: string[] | undefined;
      if (i < lines.length && lines[i].startsWith(BASE)) {
        i++;
        base = [];
        while (i < lines.length && !lines[i].startsWith(SEP)) base.push(lines[i++]);
      }
      if (i < lines.length && lines[i].startsWith(SEP)) i++;
      const theirs: string[] = [];
      while (i < lines.length && !lines[i].startsWith(THEIRS)) theirs.push(lines[i++]);
      const theirLabel = i < lines.length ? lines[i].slice(THEIRS.length).trim() : '';
      if (i < lines.length) i++;
      blocks.push({
        ourLabel,
        theirLabel,
        ours: ours.join('\n'),
        theirs: theirs.join('\n'),
        base: base ? base.join('\n') : undefined,
      });
    } else {
      i++;
    }
  }
  return blocks;
}

export function countConflicts(text: string): number {
  return conflictBlocks(text).length;
}

/** Rebuild the file resolving EVERY conflict block with the same choice. */
export function resolveConflicts(text: string, choice: ConflictChoice): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith(OURS)) {
      i++;
      const ours: string[] = [];
      while (i < lines.length && !lines[i].startsWith(SEP) && !lines[i].startsWith(BASE)) ours.push(lines[i++]);
      if (i < lines.length && lines[i].startsWith(BASE)) {
        i++;
        while (i < lines.length && !lines[i].startsWith(SEP)) i++; // discard base
      }
      if (i < lines.length && lines[i].startsWith(SEP)) i++;
      const theirs: string[] = [];
      while (i < lines.length && !lines[i].startsWith(THEIRS)) theirs.push(lines[i++]);
      if (i < lines.length && lines[i].startsWith(THEIRS)) i++;
      if (choice === 'ours') out.push(...ours);
      else if (choice === 'theirs') out.push(...theirs);
      else out.push(...ours, ...theirs);
    } else {
      out.push(lines[i++]);
    }
  }
  return out.join('\n');
}
