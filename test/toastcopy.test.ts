import { describe, expect, test } from './harness';
import { normalizeToastMessage } from '../src/renderer/core/toastCopy';

describe('toastCopy — terminal punctuation convention', () => {
  test('appends a period to an unpunctuated message', () => {
    expect(normalizeToastMessage('Left the session')).toBe('Left the session.');
    expect(normalizeToastMessage('Review failed: connection refused')).toBe('Review failed: connection refused.');
  });

  test('leaves existing sentence punctuation untouched', () => {
    expect(normalizeToastMessage('Analysis copied.')).toBe('Analysis copied.');
    expect(normalizeToastMessage('Are you sure?')).toBe('Are you sure?');
    expect(normalizeToastMessage('Done!')).toBe('Done!');
    expect(normalizeToastMessage('Loading…')).toBe('Loading…');
  });

  test('a trailing label colon is left as a label (not punctuated)', () => {
    expect(normalizeToastMessage('Building:')).toBe('Building:');
  });

  test('trims surrounding whitespace before deciding', () => {
    expect(normalizeToastMessage('  Saved  ')).toBe('Saved.');
    expect(normalizeToastMessage('  Saved.  ')).toBe('Saved.');
    expect(normalizeToastMessage('')).toBe('');
    expect(normalizeToastMessage('   ')).toBe('');
  });

  test('punctuates after a closing quote or paren', () => {
    expect(normalizeToastMessage('Created project "demo"')).toBe('Created project "demo".');
    expect(normalizeToastMessage('Ready (2 files)')).toBe('Ready (2 files).');
  });
});
