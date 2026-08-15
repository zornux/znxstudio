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

Tagged runs emit signed/checksummed manifests and electron-updater's
channel-specific `*.yml` feed metadata. Config: [`electron-builder.yml`](../electron-builder.yml).

## Update channels

Channels are derived from the version tag by `channelForVersion`
([`src/shared/update.ts`](../src/shared/update.ts)):

| Version | Channel | Audience |
| --- | --- | --- |
| `1.2.0` | `stable` | everyone |
| `1.2.0-rc.1`, `-beta.1` | `preview` (`rc` feed) | opt-in testers |
| `1.2.0-nightly.N` | `nightly` feed | bleeding edge |

A subscriber receives the newest GitHub release from its isolated feed
(`latest`, `rc`, or `nightly`), so Preview can never accidentally consume a
Nightly build. The
packaged client delegates metadata, SHA-512, platform-signature validation, and
installation to `electron-updater`; an unreachable feed degrades safely to an
unavailable status. Pure channel/feed helpers are covered in
[`test/update.test.ts`](../test/update.test.ts), while runtime lifecycle and
concurrency are covered in [`test/updateservice.test.ts`](../test/updateservice.test.ts).

## Signing

Unsigned local and manually dispatched builds remain available for development.
A tagged production release fails closed if any required signing credential is
missing.

- **Windows** — Azure Trusted Signing via `AZURE_*` and `TRUSTED_SIGNING_*`
  secrets, using the pinned `sign` tool and [`build/win-sign.js`](../build/win-sign.js).
- **macOS** — `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` +
  Developer ID Application cert; hardened runtime + `build/entitlements.mac.plist`
  + notarization + stapling (macOS runner only).
- **Linux** — `GPG_PRIVATE_KEY`, `GPG_PASSPHRASE`, and optional `GPG_KEY_ID`
  sign the SHA-256 manifest shipped beside AppImage/deb/rpm artifacts.

## Enterprise deployment

- **Silent install**: NSIS `/S`; the `portable` artifact needs no installer.
- **Update controls**: pin a channel or disable auto-update via managed settings
  (`update.channel` / `update.mode`), suitable for SCCM/Intune policy.

## CI

- [`ci.yml`](../.github/workflows/ci.yml) — `windows/macos/ubuntu-latest`:
  `npm ci → typecheck → test → build`, plus a headless (xvfb) **smoke launch**
  that asserts the app boots (`[perf] startup` line).
- [`release.yml`](../.github/workflows/release.yml) — validates tag/package
  equality, runs the complete gate, stages per-architecture runtimes, requires
signing for tags, derives stable/prerelease classification, and packages all
  three operating systems. Set repository variable `ZORNUX_REF` to the exact
  40-character commit from `zornux/zornux` that the release must bundle.

  The pin is what the IDE's language behavior comes from: diagnostics,
  completion, hover, the outline, and formatting are the bundled `zornux lsp`,
  not a ZnxStudio reimplementation. A language fix therefore reaches users only
  when this pin moves — so when a Zornux release changes what the editor
  reports, move `ZORNUX_REF` in the same release that claims the change.

Published releases are assembled as drafts and made visible only after every
platform succeeds. Rerunning a failed draft clears stale assets; rerunning an
already-published tag is rejected to prevent partial live replacement.

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
| Windows production package | ⏳ Signed CI verification required |
| Auto-update logic | ✅ Verified with mock feed |
| Windows production signing | ⛔ Pending Trusted Signing credentials |
| macOS package build | ⏳ CI (macOS runner) required |
| macOS signing / notarization | ⛔ Pending Apple credentials |
| Linux package build | ⏳ CI (ubuntu runner) required |
| Physical-OS usability testing | ⛔ Pending device validation |

Do not ship until: a **signed** Windows installer installs+launches on a clean
machine; **signed+notarized** macOS packages run on Intel **and** Apple Silicon;
Linux packages install+launch on supported distros; auto-update is exercised from
an older **signed** release to a newer one; and failed-update rollback is tested.
