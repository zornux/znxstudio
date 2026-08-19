# Changelog

All notable changes to **ZnxStudio** are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

ZnxStudio is an enterprise IDE platform built first-class for **Zornux** and
**Zoijs**. Update channels are derived from the version tag
(`stable` / `preview` / `nightly`); see [`docs/RELEASE.md`](docs/RELEASE.md).

## [Unreleased]

## [1.0.0] - 2026-08-19

General availability release. Comprehensive security audit and reliability sweep
across the entire codebase — 30+ fixes since rc.3.

### Added — Android Visual Designer

- **Visual Designer** for Android mobile apps — a drag-and-drop WYSIWYG design
  surface backed by the Zornux mobile code generator.
- **Mobile styling system** (5 phases) — style properties, themes, states,
  motion/animation, and responsive layout.
- **Android SDK auto-download** — the IDE downloads and manages the Android SDK
  toolchain on first use.

### Security — IPC Hardening

- Added trust gates on `DebugRequest`, `ExtensionsUninstall`,
  `ExtensionsSetEnabled`, `ConfigQuery`, `CollabSend`, `CollabSendTo`, and
  `LspRequest` IPC handlers — closing trust-revocation bypass vectors.
- Added path confinement via `confineToRoots` on `ConfigQuery` file/cwd params.
- Added runtime subcommand validation (`show`|`validate`) on `ConfigQuery`.
- Stripped renderer-supplied `compilerPath` from config IPC — prevents arbitrary
  binary execution.
- Fixed `pathBoundary.ts` symlink escape on new-file writes: ancestor walk now
  resolves via `realpathSync` instead of trusting lexical-only checks.
- Fixed Windows case-insensitive path confinement in `agentExec.ts` — `normalizePath`
  now lowercases on `win32`, closing a workspace escape via case mismatch.
- Fixed `ProjectService.scaffoldProject` template path traversal — post-join
  resolve check prevents `../` escape.
- Fixed command injection in `RunBuildModule` — unquoted `--profile` argument now
  shell-quoted.
- Added `isDestroyed()` guard in collab `broadcastToRenderer` — prevents crash
  when window closes during a collaboration session.
- Added `peerId` type validation in collab IPC.

### Security — Agent Execution

- Fixed `AgentExecService` workspace escape via absolute command paths — added
  `isAbsolute` and `..` checks plus post-resolve containment verification.
- Fixed `killTree` on Windows — now uses `taskkill /T /F` instead of POSIX-only
  `process.kill(-pid)`.
- Added `detached: !isWin` to agent `spawn()` so process group kill works on
  Unix.

### Fixed — Process Management

- `TaskService` now spawns with `detached: true` on Unix and kills the process
  group via `process.kill(-pid)`, preventing orphaned child processes.
- `CollabService.join()` Promise leak — connection close before handshake now
  resolves instead of leaking.
- `AppWindow` unresponsive handler — no longer unconditionally destroys the
  window on any unresponsive event (caused data loss during heavy operations);
  now only force-closes if a close is actually pending.
- `AppWindow.loadFile` error swallowing — `.catch()` with `dialog.showErrorBox`
  replaces silent `void` ignore.

### Fixed — Cross-platform Paths

- Replaced hardcoded path separators with `joinPath` across 10+ modules:
  `TemplatesModule`, `ProfilesModule`, `RunBuildModule`, `DebugModule`,
  `DeploymentModule`, `FullStackModule`, `PreviewModule`, and
  `DependencyGraphModule` — fixes broken self-tests and mixed-separator paths
  on Linux/macOS.

### Fixed — Event Listener Leaks

- Fixed 10+ event listener leaks across renderer modules:
  `RunBuildModule`, `TasksModule`, `TodoModule`, `DebugModule`,
  `BreakpointModule` — all subscriptions now tracked via `context.subscriptions`
  with proper `Disposable` wrappers.

### Fixed — Miscellaneous

- Added missing `select` keyword to the Zornux keyword list (present in the
  compiler but missing from IDE syntax highlighting).
- Fixed dead `MobileDeviceSelect` IPC handler — was validating device ID but
  never calling any service method; now calls `mobile.selectDevice(id)`.
- Fixed `LspNotify` and `TaskKill` crash risk — `ipcMain.on` handlers now
  wrapped in try/catch (unhandled exceptions hit `uncaughtException` and
  crashed the IDE).
- Fixed `CpuProfilerModule` crash on empty flame graph — `Math.max` on empty
  array produced `-Infinity` height.
- Fixed vacuous test assertion in `parser.test.ts`.
- Corrected stale GitHub release URL in `UpdateService` (`zornux/znxstudio` →
  `jay-m2/ZnxStudio`).
- Duplicate `[1.0.0-rc.1]` CHANGELOG sections consolidated.

### Changed — Build & CI

- Production builds now minified with source maps stripped (dev builds retain
  source maps for debugging).
- CI smoke test hardened — Electron exit code now checked via `set -o pipefail`;
  a crash after startup log no longer masks as green.

### Tests

- 2255 tests, 0 failures, clean TypeScript.

## [1.0.0-rc.2] - 2026-08-17

Second release candidate. Adds Android mobile developer tooling, a true dark
theme system, and a secure AI assistant infrastructure — all since rc.1.

### Added — Android Mobile (Phases 5–6)

- **Developer experience** — device discovery via ADB, emulator management,
  file watching with debounced change detection, incremental generation backed
  by SHA-256 content hashing, source maps from generated Kotlin back to Zornux
  source, Gradle/runtime error translation, persistent development run sessions
  with hot reload, and full ZnxStudio IDE integration (device selector, run/stop,
  logs panel, doctor sidebar).
- **Debugging & testing infrastructure** — Android debug bridge, mobile debug
  sessions, breakpoints/stepping/variables/scopes, CLI `mobile debug android`,
  mobile test model with host-side tests and test doubles, Android UI tests,
  and a reliability/stress suite.
- **Session lifecycle hardening** — security audit and session state machine
  certification.

### Added — Theme System

- **True dark theme** with 54 semantic color tokens, 7 theme variants (Light,
  Dark, High Contrast Dark, High Contrast Light, Solarized Dark, Solarized
  Light, System), and startup flash prevention.
- Monaco editor syntax colors driven by the semantic token system.
- Appearance settings group for theme selection.
- Scrollbar, spacing, and visual polish pass.

### Added — AI Assistant Infrastructure

- **Fix with AI** — select a compiler diagnostic and AI proposes a concrete
  fix as a reviewable diff; the compiler remains authoritative.
- **Inline AI** — 6 context-menu actions (Explain, Refactor, Optimize,
  Document, Add Tests, Find Bugs) with diff preview and accept/reject.
- **Agent mode** — multi-step plan → edit → command → check → iterate loop
  with explicit user approval at every side-effect boundary.
- **Shared context store** — project files, open editors, diagnostics, and
  workspace state are shared across all AI features via `ServiceKeys.AiContext`.
- **Workspace Trust gating** — AI features are disabled in untrusted workspaces.

### Added — Agent Execution Security

- Three-tier command classification: `allowed` (auto-approved read-only),
  `needs_approval` (user must consent), `blocked` (rejected outright).
- Defense-in-depth: renderer classifies + shows approval UI, main process
  independently re-classifies and enforces.
- Shell interpreter blocking (sh/bash/zsh/cmd/powershell/pwsh and 4 more).
- Shell metacharacter detection (`; | & $ \``) rejects injection operators.
- Executable extension stripping (`.exe`, `.bat`, `.cmd`, `.com`, `.ps1`, `.sh`)
  before blocklist lookup.
- Workspace confinement with `realpathSync` resolution in the main process.
- Secret filtering on environment variables, command output, and AI context.
- Expanded sensitive file detection (+12 patterns: `.htpasswd`, `.docker/`,
  `kubeconfig`, `.aws/credentials`, `.pgpass`, shell histories,
  `terraform.tfstate`, `.gnupg/`, `token.json`).
- AWS access key (`AKIA*`) redaction in command output.

### Changed — CI & Release

- CI: added `permissions: contents: read`, `timeout-minutes` on all jobs, and
  Node version pinning via `.nvmrc`.
- Release: unified checksum algorithm to SHA-256 across Windows and Linux.
- Release: added `timeout-minutes` on all packaging and finalize jobs.

### Fixed

- Agent `cancel()` now correctly reports `cancelled: true` on the result.
- Command resolution uses the confined workspace cwd, not the main process cwd.
- `truncateOutput` handles `maxBytes <= 0` without crashing.
- `git checkout .` pattern match is now case-insensitive.
- FixAssistModule checks for stale source before applying a fix.

### Tests

- 2162 tests, 0 failures, clean TypeScript.
- 59 adversarial regression tests for agent execution security.

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

## [1.0.0-rc.0] - 2026-07-10

Pre-hardening release candidate. Consolidates Phases 1–20 into a shippable 1.0. Every
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

[Unreleased]: https://github.com/jay-m2/ZnxStudio/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/jay-m2/ZnxStudio/compare/v1.0.0-rc.2...v1.0.0
[1.0.0-rc.2]: https://github.com/jay-m2/ZnxStudio/compare/v1.0.0-rc.1...v1.0.0-rc.2
[1.0.0-rc.1]: https://github.com/jay-m2/ZnxStudio/compare/v1.0.0-rc.0...v1.0.0-rc.1
[1.0.0-rc.0]: https://github.com/jay-m2/ZnxStudio/releases/tag/v1.0.0-rc.0
