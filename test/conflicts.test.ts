import { describe, expect, test } from './harness';
import {
  conflictBlocks,
  countConflicts,
  hasConflictMarkers,
  resolveConflicts,
} from '../src/renderer/scm/conflicts';

const CONFLICT = [
  'top',
  '<<<<<<< HEAD',
  'ours line',
  '=======',
  'their line',
  '>>>>>>> feature',
  'bottom',
].join('\n');

const DIFF3 = [
  '<<<<<<< HEAD',
  'ours',
  '||||||| base',
  'original',
  '=======',
  'theirs',
  '>>>>>>> other',
].join('\n');

describe('conflict detection', () => {
  test('hasConflictMarkers + countConflicts', () => {
    expect(hasConflictMarkers(CONFLICT)).toBe(true);
    expect(hasConflictMarkers('no markers')).toBe(false);
    expect(countConflicts(CONFLICT)).toBe(1);
  });
  test('conflictBlocks extracts sides and labels', () => {
    const [block] = conflictBlocks(CONFLICT);
    expect(block.ourLabel).toBe('HEAD');
    expect(block.theirLabel).toBe('feature');
    expect(block.ours).toBe('ours line');
    expect(block.theirs).toBe('their line');
  });
  test('diff3 base section is captured', () => {
    const [block] = conflictBlocks(DIFF3);
    expect(block.base).toBe('original');
    expect(block.ours).toBe('ours');
    expect(block.theirs).toBe('theirs');
  });
});

describe('resolveConflicts', () => {
  test('ours keeps our side and surrounding text', () => {
    expect(resolveConflicts(CONFLICT, 'ours')).toBe('top\nours line\nbottom');
  });
  test('theirs keeps their side', () => {
    expect(resolveConflicts(CONFLICT, 'theirs')).toBe('top\ntheir line\nbottom');
  });
  test('both keeps ours then theirs', () => {
    expect(resolveConflicts(CONFLICT, 'both')).toBe('top\nours line\ntheir line\nbottom');
  });
  test('resolves diff3 and discards the base', () => {
    expect(resolveConflicts(DIFF3, 'theirs')).toBe('theirs');
  });
  test('leaves conflict-free text untouched', () => {
    expect(resolveConflicts('a\nb\nc', 'ours')).toBe('a\nb\nc');
  });
  test('resolves multiple blocks with the same choice', () => {
    const two = ['<<<<<<< a', 'o1', '=======', 't1', '>>>>>>> b', 'mid', '<<<<<<< a', 'o2', '=======', 't2', '>>>>>>> b'].join('\n');
    expect(resolveConflicts(two, 'ours')).toBe('o1\nmid\no2');
  });
});
