# ZnxStudio 1.0.0 — GA Gate (Phase 20I)

This is the **General Availability** gate for `1.0.0`. It succeeds
[`RC-1.0.md`](RC-1.0.md): the RC proved the product is feature-complete and
sound; GA additionally requires the **release-gate** evidence that can only be
produced in a real release environment (signing certificates + macOS/Linux
runners).

The GA line is split deliberately:

- **Verifiable gates** — everything provable on any developer machine or in CI
  without certs. These are automated by `npm run ga:check` and must stay green.
- **Release-gate items** — signing, notarization, cross-OS packaging on real
  runners, clean-machine acceptance, and a signed auto-update round-trip. These
  are the only things standing between this build and the `1.0.0` tag.

## One-command readiness check

```bash
npm run ga:check
```

`build/ga-gate.mjs` runs typecheck, the full unit suite, the bundle, a
version-wiring check, and a **headless real-app self-test launch**, then parses
the audit lines and prints a pass/fail report. It exits non-zero if any
verifiable gate regresses. On a headless Linux/macOS box, run it under a display:
`xvfb-run -a npm run ga:check`. In the 3-OS CI matrix the app launch is handled
by the dedicated smoke job, so CI can call `node build/ga-gate.mjs --no-app`.

## Verifiable gates (automated — must be green for GA)

| Gate | How it is proven | Expected |
| --- | --- | --- |
| Types | `tsc --noEmit` | clean |
| Unit suite | `npm test` | **2162 passed, 0 failed** |
| Bundle | `npm run build` | clean → `dist/` |
| Version wiring | `package.json` → `app.getVersion()` | well-formed semver |
| Full activation | real-app `[perf] startup` line | all modules activate |
| Accessibility (20A) | `a11y-audit REAL DOM` | `unnamed=0` |
| Security posture (20C) | `security REAL` | `nodeGlobalsLeaked=false bridgePresent=true windowOpenBlocked=true` |
| Internationalization (20B) | `i18n REAL DOM` | `externalized=true` |
| Palette coverage (SB-7) | `palettecoverage REAL` | `launchersReachable=N/N` |
| Stress (20E) | `stress REAL DOM` | `300/300` tabs render + restore |
| Editor actions (SB-5) | `editortoolbar REAL DOM` | `[Run, Debug, Stop, Build, Rebuild]` |

Cross-platform pure logic (20G) and the update/channel/checksum engine (20F) are
covered inside the unit suite (`test/platform.test.ts`, `test/update.test.ts`).

## Code-side release-blockers — CLOSED (Phase 20J)

The Phase 20 audit's release-blocking **code** defects are resolved and verified;
see [`PHASE20J-HARDENING.md`](PHASE20J-HARDENING.md).

| Blocker | Resolution |
| --- | --- |
| Untrusted-workspace RCE via task runner | Workspace Trust, main-enforced on all 5 execution IPCs |
| Silent unsaved-work loss on close/quit | Save/Don't-Save/Cancel prompt + window/quit guard |
| Auto-update never ran at runtime | GitHub channel feeds + packaged electron-updater wired |
| Accessibility gaps | Dialog/listbox ARIA on pickers, high-contrast themes, UI zoom |
| i18n engine gaps | Pluralization, locale-aware formatting, RTL seam |

Non-blocking recommendations (FS confinement, `safeStorage` for keys, settings
migration seam, full string externalization) are listed in the hardening report.

## Release-gate items (block the `1.0.0` tag — need a real environment)

These are **not** code changes and cannot be closed on this workstation. Each
maps to config that is already implementation-complete
([`electron-builder.yml`](../electron-builder.yml),
[`.github/workflows/release.yml`](../.github/workflows/release.yml)); what is
missing is the credentials and hardware to execute and certify it.

| # | Item | Needs | Status |
| --- | --- | --- | --- |
| 1 | Windows production signing | Azure Trusted Signing credentials in CI | ⛔ pending credentials |
| 2 | macOS signing + notarization | Apple Developer ID + macOS runner | ⛔ pending credentials |
| 3 | Cross-OS package builds | `release.yml` 3-OS matrix goes green | ⏳ CI run required |
| 4 | Clean-machine acceptance | fresh Windows / mac Intel+AS / Linux distros | ⛔ pending devices |
| 5 | Signed auto-update round-trip | update old→new **signed** pair + rollback | ⛔ pending signed builds |

## RC → GA (Phase 20I) checklist

1. Soak `1.0.0-rc.1`; triage any regressions. Keep `npm run ga:check` green.
2. Close release-gate items **1–5** above with CI + clean-machine evidence.
3. Bump `package.json` to `1.0.0` (drops the prerelease tag;
   `channelForVersion('1.0.0') → stable`). This is the only source change and
   flows to `app.getVersion()` automatically.
4. Update [`CHANGELOG.md`](../CHANGELOG.md): promote the `[Unreleased]` section
   to a dated `[1.0.0]` entry.
5. Tag `v1.0.0`; the `release.yml` workflow packages, signs, checksums, and
   uploads artifacts across the matrix.
6. Confirm the workflow classified the final SemVer release as stable; test the
   rc → GA auto-update on a **signed** pair, then verify rollback.

> Per project policy, tagging and pushing are performed by the maintainer — this
> repository's tooling prepares and verifies the release but does not cut it.
