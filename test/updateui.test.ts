import { describe, expect, test } from './harness';
import { shouldCheckAfterConnectivity, updateActionForPhase } from '../src/renderer/update/updateActions';

describe('update UI action policy', () => {
  test('maps available and downloaded releases to different explicit actions', () => {
    expect(updateActionForPhase('update-available')).toBe('download');
    expect(updateActionForPhase('downloaded')).toBe('install');
  });

  test('never offers an action while checking or downloading', () => {
    expect(updateActionForPhase('checking')).toBeNull();
    expect(updateActionForPhase('downloading')).toBeNull();
    expect(updateActionForPhase('up-to-date')).toBeNull();
  });

  test('failed and unavailable checks offer a safe retry', () => {
    expect(updateActionForPhase('error')).toBe('check');
    expect(updateActionForPhase('no-feed')).toBe('check');
  });

  test('rechecks after connectivity recovery without event storms', () => {
    expect(shouldCheckAfterConnectivity({ mode: 'auto', online: true, focused: true, elapsedMs: 300_000 })).toBe(true);
    expect(shouldCheckAfterConnectivity({ mode: 'off', online: true, focused: true, elapsedMs: 300_000 })).toBe(false);
    expect(shouldCheckAfterConnectivity({ mode: 'auto', online: false, focused: true, elapsedMs: 300_000 })).toBe(false);
    expect(shouldCheckAfterConnectivity({ mode: 'auto', online: true, focused: true, elapsedMs: 299_999 })).toBe(false);
  });
});
