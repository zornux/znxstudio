/**
 * Whether the headless self-test harness is active.
 *
 * `ZNXSTUDIO_SELFTEST` opens the Workspace Trust gate and disables the unsaved-changes
 * close guard so the automated GA self-test can spawn subprocesses and exit unattended.
 * Those are security/safety controls, so the flag is honored ONLY in an UNPACKAGED
 * (dev/CI) build — a shipped, packaged binary ignores it and can never have a control
 * disabled by the env var.
 *
 * The packaged state is INJECTED once at main-process startup (`setPackaged`) rather
 * than read from electron here, so this module stays importable in a plain-Node
 * unit-test context (where `require('electron')` throws). Untouched in tests, `packaged`
 * stays false — but tests never set ZNXSTUDIO_SELFTEST, so `isSelfTest()` is false there.
 */
let packaged = false;

/** Called once from the main entry with `app.isPackaged`. */
export function setPackaged(value: boolean): void {
  packaged = value;
}

export function isSelfTest(): boolean {
  return process.env.ZNXSTUDIO_SELFTEST === '1' && !packaged;
}
