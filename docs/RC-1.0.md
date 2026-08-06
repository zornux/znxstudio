# ZnxStudio 1.0.0-rc.1 — Release Candidate Gate (Phase 20H)

Cut from `main` at version **1.0.0-rc.1**. This RC consolidates Phases 1–20; the
gates below are the ones re-verified for the candidate, each against the **real
app** (headless self-test) or the full unit suite — not by inspection.

## Verified for this RC

| Gate | Evidence | Result |
| --- | --- | --- |
| Full unit suite | `npm test` | **1525 passed, 0 failed** |
| Types | `npm run typecheck` | clean |
| Bundle | `npm run build` | clean |
| Boots on the real workbench | headless self-test | 507 `[selftest]` lines, no errors |
| Version wired end-to-end | status bar reads `app.getVersion()` | **ZnxStudio 1.0.0-rc.1** |
| Accessibility (20A) | `a11y-audit REAL DOM` | `interactive=241 unnamed=0` |
| Internationalization (20B) | `i18n REAL DOM` | `externalized=true` (pseudo-locale live) |
| Security posture (20C) | `security REAL` | `nodeGlobalsLeaked=false bridgePresent=true windowOpenBlocked=true` |
| Startup perf (20D) | `[perf] startup` (clean) | ~354 ms (compiler probe off the critical path) |
| Stress (20E) | `stress REAL DOM` | 300 tabs rendered + restored; pure models hold at 2k–50k scale |
| Palette coverage (SB-7) | `palettecoverage REAL` | `panelShowCommands=52 launchersReachable=15/15` |
| Editor actions (SB-5) | `editortoolbar REAL DOM` | `[Run, Debug, Stop, Build, Rebuild]` |
| Packaging config (20F) | `test/update.test.ts` + `electron-builder.yml` | update logic + config verified |
| Cross-platform logic (20G) | `test/platform.test.ts` | win/mac/linux × x64/arm64 covered |

## Outstanding before **1.0.0 GA** (release-gate — needs real environment)

These are NOT blockers for the RC label, but MUST close before GA. See
[`RELEASE.md`](RELEASE.md#release-gating).

- ⛔ **Windows production signing** — Authenticode cert in CI.
- ⛔ **macOS signing + notarization** — Apple Developer ID; run on a macOS runner.
- ⏳ **Cross-OS package builds** — the 3-OS `release.yml` matrix must go green.
- ⛔ **Clean-machine acceptance** — signed installer installs + launches on a
  fresh Windows box; macOS on Intel + Apple Silicon; Linux on supported distros.
- ⛔ **Signed auto-update round-trip** — update from an older signed release to a
  newer one; verify rollback / failed-update recovery.

## RC → GA (Phase 20I) checklist

> The authoritative GA gate — including the automated `npm run ga:check`
> readiness command — now lives in [`GA-1.0.md`](GA-1.0.md). The summary below
> remains for context.


1. Soak `1.0.0-rc.1`; triage any regressions.
2. Close every ⛔/⏳ row above with CI + clean-machine evidence.
3. Retag `1.0.0`; `channelForVersion('1.0.0') → stable`.
4. Publish the `stable` update feed; confirm rc → ga auto-update on a signed pair.
