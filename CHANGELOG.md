# Changelog

All notable changes to **ZnxStudio** are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

ZnxStudio is an enterprise IDE platform built first-class for **Zornux** and
**Zoijs**. Update channels are derived from the version tag
(`stable` / `preview` / `nightly`); see [`docs/RELEASE.md`](docs/RELEASE.md).

## [Unreleased]

## [1.0.0-rc.1] - 2026-08-08

First release candidate for 1.0.0 — published for user testing ahead of GA.
Signed Windows installers via Azure Trusted Signing, GitHub-native auto-update
from the public repo, and the Phase 20J hardening below.

### Added — Phase 20J GA Hardening
Resolves the release-blocking findings from the Phase 20 audit
([`docs/PHASE20J-HARDENING.md`](docs/PHASE20J-HARDENING.md)). All backward-compatible.

- **Workspace Trust** — VS-Code-style trust decided by workspace location and
  enforced in the main process; a Restricted-Mode workspace cannot run tasks, the
  terminal, the debugger, package operations, or external tools. Trust dialog +
  persistent banner + commands.
- **Unsaved-changes protection** — Save / Don't Save / Cancel on every tab close,
  and a window/quit guard so a close or app quit never silently discards work.
  Autosave modes (off / after delay / on focus change / on window change). Session
  restore of open + pinned tabs; recent-workspaces list.
- **Production auto-update** — a real runtime update check against the JSON feed
  (offline/malformed feeds degrade gracefully), electron-updater used for the
  download/install when packaged, with a manual-download fallback; Check for
  Updates command, startup check by policy, and a release-notes dialog.
- **Accessibility baseline** — High Contrast Dark + Light themes and
  `forced-colors` support; UI zoom (Ctrl +/-/0); the command palette, quick-open
  and search-everywhere pickers are now screen-reader-operable (dialog + listbox
  roles, `aria-activedescendant`, focus trap/restore). Dark accent recolored to
  meet WCAG AA.
- **Internationalization foundation** (English only) — pluralization via
  `Intl.PluralRules`, locale-aware number/date/relative-time formatting, and an
  RTL/direction seam driving `document.dir`.

### Fixed (pre-milestone GA-prep)
- Atomic file/settings writes (no corruption on a crash mid-write).
- Child processes (PTY / LSP / DAP / tasks) are killed on quit — no orphans.
- Default keybindings use Cmd on macOS, Ctrl elsewhere.

### Release-gate (blocks the `1.0.0` tag; not a code change)
Needs certificates + macOS/Linux hardware — tracked in
[`docs/GA-1.0.md`](docs/GA-1.0.md): Windows/macOS signing + notarization, cross-OS
package builds, clean-machine acceptance, and a **signed** auto-update round-trip.

Run `npm run ga:check` to re-verify every gate that does **not** need certs.

## [1.0.0-rc.1] — 2026-07-10

First release candidate. Consolidates Phases 1–20 into a shippable 1.0. Every
gate below is re-verified against the **real app** (headless self-test) or the
full unit suite — see [`docs/RC-1.0.md`](docs/RC-1.0.md).

### Added

#### Workbench foundation & architecture (Phase 1, 17)
- Secure Electron shell: `contextIsolation`, no `nodeIntegration`, a typed
  `window.znxstudio` bridge, CSP-locked renderer, and hardened navigation /
  window-open handling.
- A **language-agnostic modular workbench** — every feature is an `IModule`
  activated against a shared `ModuleContext`; modules talk through a
  `ServiceRegistry` and `CommandRegistry`, never by importing each other. Third-
  party plugins load the same way as core modules.
- Docking, custom panels, multi-window management, a keybinding manager, a macro
  recorder, and saveable layout profiles.

#### Zornux language platform (Phases 2, 3, LSP, 4)
- Full language intelligence sourced from the **real `zornux lsp`** server
  (JSON-RPC/stdio): diagnostics, completion, hover, signature help,
  go-to-definition, references, rename, formatting, document symbols, folding,
  and semantic tokens. The hand-written TypeScript front-end is demoted to an
  offline fallback, eliminating language drift.
- Compiler integration via subprocess (`zornux check --json`): build pipeline,
  incremental compilation, live error reporting, project dependency graph, build
  cache, compiler diagnostics, and profiling.
- **Debugger** speaking standard DAP to `zornux dap` over stdio **and** TCP:
  breakpoints, call stack, variables, watch, expression evaluation, step
  in/over/out, exception surfacing, and remote debug.

#### Zoijs native development (Phase 6)
- First-class support for the no-build **Zoijs** framework (modeled as a JS
  flavor, not a separate language): component intelligence, template
  IntelliSense inside `` html`` `` markup, a static reactive-state inspector, a
  router designer, runtime DevTools, a live preview server, and a one-command
  full-stack runner that wires a Zornux backend to a Zoijs frontend same-origin.

#### Enterprise project system (Phase 5)
- Multi-root workspaces, a Solution Explorer, project references (over the real
  `zornux.project` manifest), a dependency manager and package/registry browser
  (over the real `zornux` CLI), environment-profile workspace profiles, a
  starter-template gallery (scaffolds via real `zornux init`), and guided
  multi-step wizards.

#### Editor productivity (Phase 7)
- Find in files/symbols, replace/refactor tools, multi-cursor, folding &
  breadcrumbs, bookmarks & navigation history, snippets, workspace tasks, code
  generation, and code metrics/complexity.

#### Database tools (Phase 8)
- Connections, schema explorer, SQL editor, migration designer, data browser,
  query profiler, and ORM support.

#### Testing (Phase 9)
- Test explorer, unit runner, integration runs, coverage, performance tests,
  mocking, and continuous test runs.

#### AI assistance — optional & vendor-neutral (Phase 10)
- Chat, completion, refactoring, review, docs, test generation, a debug
  assistant, and architecture help. **No AI vendor is ever required**; the AI
  layer is off by default and provider-agnostic.

#### Extensions (Phase 11)
- Extension SDK and API, a sandboxed runtime, a marketplace surface, an
  extension manager, and extension debugging.

#### Source control (Phase 12)
- Git integration, GitHub connectivity, pull requests, merge-conflict
  resolution, branch management, and a repository explorer.

#### Cloud & deploy (Phase 13)
- Deployment profiles, Docker, Kubernetes, cloud providers, CI/CD, and remote
  environments — gated behind a tool-execution allowlist.

#### Performance & profiling (Phase 14)
- CPU, memory, timeline, hotspot, and allocation profiling.

#### Security tooling (Phase 15)
- Secrets handling, a vulnerability scanner, dependency auditing, static
  security analysis, and a security dashboard.

#### Collaboration (Phase 16)
- Shared workspaces, live collaboration (OT-based), pair programming, team
  settings, and policies.

#### Docs & learning (Phase 18)
- A docs viewer, API reference generation, tutorials, a sample browser, and a
  learning center.

#### Diagnostics & telemetry (Phase 19)
- IDE diagnostics, crash recovery, performance telemetry, redacting logging, and
  a health dashboard.

#### Production hardening (Phase 20)
- **Accessibility (20A):** an automated accessible-name audit — 0 unnamed
  interactive controls, enforced as a permanent regression guard.
- **Internationalization (20B):** an i18n engine with a pseudo-locale that
  surfaces un-externalized strings; representative chrome externalized.
- **Security audit (20C):** hardened web preferences, navigation/window-open
  lockdown, verified at runtime (no Node globals leaked; bridge present).
- **Performance (20D):** the compiler probe moved off the startup critical path
  (~793 ms cold → ~355 ms), with a permanent `[perf] startup` measurement.
- **Stress testing (20E):** pure models and the editor tab model hold at
  2k–50k scale; 300 real DOM tabs render and restore.
- **Installer & auto-update (20F):** `electron-builder` packaging for Windows
  (nsis/portable), macOS (dmg/zip), and Linux (AppImage/deb/rpm) on x64+arm64;
  an update-channel/feed/checksum engine unit-tested against a mock feed.
- **Cross-platform validation (20G):** platform-parameterized core logic tested
  for win/mac/linux × x64/arm64; a 3-OS CI matrix plus a headless smoke launch.

### Changed
- Version bumped `0.1.0 → 1.0.0-rc.1`; the status bar reads `app.getVersion()`.

### Security
- Renderer isolation verified at runtime, not just by config: `window.open`
  denied in-app, external navigation restricted to `file://`, safe `http(s)`
  links routed to the OS browser only.

### Notes
- **Not release-certified.** Signing, notarization, real cross-OS package builds,
  clean-machine acceptance, and a signed auto-update round-trip are release-gate
  items that require certificates and macOS/Linux hardware. See
  [`docs/GA-1.0.md`](docs/GA-1.0.md) and [`docs/RELEASE.md`](docs/RELEASE.md).

[Unreleased]: https://example.com/znxstudio/compare/v1.0.0-rc.1...HEAD
[1.0.0-rc.1]: https://example.com/znxstudio/releases/tag/v1.0.0-rc.1
