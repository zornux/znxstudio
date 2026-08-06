# ZnxStudio Release & Packaging (Phase 20F / 20G)

Operator guide for building, signing, updating, and certifying a ZnxStudio release.
Everything here is **implementation-complete and locally/CI-verifiable**, but a
build is **not release-certified** until the signed, clean-machine evidence in
[Release gating](#release-gating) exists.

## Artifacts

`npm run package` (or the `Release` CI workflow) produces, per OS × arch:

| OS | Targets | Notes |
| --- | --- | --- |
| Windows x64/arm64 | `nsis` installer, `portable` | Silent install: `ZnxStudio-Setup.exe /S` |
| macOS x64/arm64 | `dmg`, `zip` | `zip` is required by the updater |
| Linux x64/arm64 | `AppImage`, `deb`, `rpm` | — |

Every run also emits `SHA512SUMS.txt` and electron-updater's `latest*.yml` feed
metadata. Config: [`electron-builder.yml`](../electron-builder.yml).

## Update channels

Channels are derived from the version tag by `channelForVersion`
([`src/shared/update.ts`](../src/shared/update.ts)):

| Version | Channel | Audience |
| --- | --- | --- |
| `1.2.0` | `stable` | everyone |
| `1.2.0-rc.1`, `-beta.1` | `preview` | opt-in testers (+ stable) |
| `1.2.0-nightly.N` | `nightly` | bleeding edge (+ preview + stable) |

A subscriber receives the newest build across the channels they accept
(`eligibleChannels`). The client checks a feed, compares versions
(`checkForUpdate`), verifies the download against the feed `sha512`
(`verifyChecksum`), and — on a malformed/unreachable feed — degrades to
"no update" (never an error). All of this is unit-tested against a mock feed in
[`test/update.test.ts`](../test/update.test.ts).

## Signing (conditional — never blocks a dev build)

Signing reads credentials from **CI secrets**; unsigned local builds still work.

- **Windows** — `CSC_LINK`, `CSC_KEY_PASSWORD` (Authenticode). Add a timestamp
  server for long-lived signatures.
- **macOS** — `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` +
  Developer ID Application cert; hardened runtime + `build/entitlements.mac.plist`
  + notarization + stapling (macOS runner only).
- **Linux** — app signing is not required; `.deb`/`.rpm`/repo signing via GPG
  secrets when publishing a repository.

## Enterprise deployment

- **Silent install**: NSIS `/S`; the `portable` artifact needs no installer.
- **Update controls**: pin a channel or disable auto-update via managed settings
  (`workbench.updateChannel` / `update.mode`), suitable for SCCM/Intune policy.

## CI

- [`ci.yml`](../.github/workflows/ci.yml) — `windows/macos/ubuntu-latest`:
  `npm ci → typecheck → test → build`, plus a headless (xvfb) **smoke launch**
  that asserts the app boots (`[perf] startup` line).
- [`release.yml`](../.github/workflows/release.yml) — same matrix, then
  `electron-builder` package with conditional signing, checksums, and artifact
  upload.

## Verified on this workstation (Windows)

- Update-channel selection, update-check vs a mock feed, checksum validation, and
  graceful handling of malformed/absent feeds — `test/update.test.ts` ✅
- Cross-platform pure logic (paths, exe discovery, shell, PATH, line endings,
  case sensitivity, target matrix) for win/mac/linux — `test/platform.test.ts` ✅
- Release-manifest generation — `test/update.test.ts` ✅

## Release gating

`implementation complete` ≠ `release certified`. Certify only when:

| Area | Status |
| --- | --- |
| Packaging configuration | ✅ Verified (config + unit tests) |
| Windows unsigned package | ⏳ CI verification required |
| Auto-update logic | ✅ Verified with mock feed |
| Windows production signing | ⛔ Pending certificate |
| macOS package build | ⏳ CI (macOS runner) required |
| macOS signing / notarization | ⛔ Pending Apple credentials |
| Linux package build | ⏳ CI (ubuntu runner) required |
| Physical-OS usability testing | ⛔ Pending device validation |

Do not ship until: a **signed** Windows installer installs+launches on a clean
machine; **signed+notarized** macOS packages run on Intel **and** Apple Silicon;
Linux packages install+launch on supported distros; auto-update is exercised from
an older **signed** release to a newer one; and failed-update rollback is tested.
