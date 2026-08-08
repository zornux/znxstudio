import { describe, expect, test } from './harness';
import { claimOverlay, dismissActiveOverlay } from '../src/renderer/ui/overlayCoordinator';

describe('overlay coordinator', () => {
  test('a new owner dismisses the previous owner exactly once', () => {
    let firstDismissals = 0;
    const releaseFirst = claimOverlay({}, () => { firstDismissals += 1; });
    const releaseSecond = claimOverlay({}, () => undefined);
    expect(firstDismissals).toBe(1);
    releaseFirst();
    releaseSecond();
  });

  test('releasing an old claim cannot clear the current owner', () => {
    let currentDismissals = 0;
    const releaseOld = claimOverlay({}, () => undefined);
    claimOverlay({}, () => { currentDismissals += 1; });
    releaseOld();
    dismissActiveOverlay();
    expect(currentDismissals).toBe(1);
  });
});
