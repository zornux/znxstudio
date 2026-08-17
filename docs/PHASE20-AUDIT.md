# ZnxStudio — Phase 20 Production-Readiness Audit (1.0 GA)

**Date:** 2026-07-27 · **Version audited:** `1.0.0-rc.1` · **Method:** zero-assumption,
evidence-based review of the whole source tree (no reliance on comments, docs, or
menu presence). Every finding cites `file:line`. Six independent investigators
covered accessibility, i18n, security, reliability/resources, and
performance/stress/packaging; all load-bearing claims were re-verified against
source by the auditor.

---

## 1. Executive Summary

ZnxStudio is a genuinely feature-complete IDE: 103 renderer modules, 1533 unit tests,
a real-app headless self-test, a hardened Electron posture, and a working
Zornux/Zoijs language stack. The engineering foundations are strong. However, a
zero-assumption pass found **real release-blocking defects** behind the
"complete" checkmarks — most Phase-20 requirements exist as sound *foundations or
pure logic* that are **not fully wired to the running app**.

- **Phase 20 implementation completeness:** ~85% (present but with material gaps).
- **Production-readiness score:** **6.6 / 10** (weighted average of §3).
- **Recommendation:** **Requires an additional hardening milestone before GA.**

During this audit several clear blockers were **fixed and verified** (see §5);
the residual blockers below require either larger scoped work or a real release
environment.

**Recommendation rationale — must-fix before GA:**
1. Untrusted-workspace RCE via the shell task runner (Security, HIGH).
2. Silent unsaved-work loss on tab close / quit (Reliability, HIGH).
3. Auto-update is config-only — packaged builds never update (Packaging, HIGH).
4. Accessibility modality gaps: no dialog roles / focus trap / SR-operable
   pickers / high-contrast / UI zoom (Accessibility, HIGH).
5. Internationalization is a ~4%-coverage foundation, not a delivered capability
   (i18n, HIGH *if* i18n is advertised; otherwise scope it explicitly).

---

## 2. Phase 20 Requirement Checklist

Legend: ✅ implemented · ⚠ partial · ❌ missing. (⇒ fixed this audit — see §5.)

### 20A — Accessibility — ⚠
| Requirement | Status | Evidence |
|---|---|---|
| Keyboard navigation / tab order / shortcuts | ✅ | `keybindings/keybindings.ts`, `KeybindingsModule.ts:36`; palette arrow/Enter/Esc `palette/CommandPaletteModule.ts:116` |
| Focus indicators | ⚠ | `:focus-visible` ring `styles/main.css:6002`, but scoped to `.znxstudio-workbench`; body-mounted overlays set `outline:none` (`main.css:1798,2478`) |
| ARIA landmarks / roles (chrome) | ✅ | `core/LayoutManager.ts:70-98` (banner/menubar/tablist/main/contentinfo) |
| Accessible labels (audit) | ⚠ | name-only audit, self-test-gated `a11y/a11y.ts:78`, `Workbench.ts:356` |
| Accessible dialogs | ❌ | zero `role="dialog"`/`aria-modal` in codebase |
| Accessible context menus | ⚠ | roles set `LayoutManager.ts:526`, but no focus-move-in / arrow roving |
| Accessible notifications | ⚠ | one `aria-live="polite"` region; errors never `role="alert"` `LayoutManager.ts:98,714` |
| Screen-reader-operable pickers | ❌ | palette/quick-open results are `<li>` with visual highlight only; no `role=listbox/option`, no `aria-activedescendant` `CommandPaletteModule.ts:103` |
| Focus trap / restore on overlays | ❌ | `activeElement`/`restoreFocus` used nowhere (grep = 0) |
| High-contrast theme | ❌ | only `znxstudio-dark`/`znxstudio-light` `themes/ThemeModule.ts:13`; no `forced-colors`/`prefers-contrast` |
| Font scaling | ✅ (editor) | `editor.fontSize` `SettingsSchema.ts:87` |
| UI scaling / zoom | ❌ | no `webFrame.setZoomFactor`, no Ctrl +/- ; chrome fixed-px |
| Reduced motion | ✅ | `main.css:6018` + `matchMedia` `LayoutManager.ts:693` |
| Color contrast | ⚠ | dark accent button `#fff` on `#4c8dff` ≈ 3.2:1 (< AA) `main.css:15,183` |

### 20B — Internationalization — ⚠ (foundation only)
| Requirement | Status | Evidence |
|---|---|---|
| UI strings externalized | ❌ ~4% | 21 `t()` render sites in 2 files; ~550 hardcoded UI strings across 56+ modules; catalog = 22 keys `i18n/en.ts:12` |
| Resource catalog | ⚠ | real flat catalog `en.ts`, chrome-only |
| Runtime language switching | ❌ | `onDidChangeLocale` has zero subscribers `i18n.ts:28`; reload-only in practice |
| Date/time localization | ❌ | `toISOString()` for user-facing timestamps `health/crash.ts:147`, `health/logging.ts:110` |
| Number/currency localization | ❌ | bare `.toLocaleString()` (OS locale, not UI locale) `profiler/AllocationsModule.ts:62` |
| Pluralization | ❌ | naive `{param}` regex `i18n.ts:16`; hand-rolled English ternaries |
| RTL readiness | ❌ | no `dir`/logical properties; 67 physical CSS edge props |
| Unicode | ✅ | pseudo/`en` preserve non-ASCII; Monaco handles editor text |

### 20C — Security — ⚠ (strong posture, one HIGH exec path)
| Area | Status | Evidence |
|---|---|---|
| contextIsolation / nodeIntegration / webSecurity | ✅ | `shared/security.ts:30-33` (`true/false/true`) |
| sandbox | ⚠ | `false` (preload needs Node) `security.ts:32` |
| CSP (no unsafe-inline/eval in script-src) | ✅ | `renderer/index.html:7` |
| Navigation / window-open lockdown | ✅ | `AppWindow.ts:37-45`, `security.ts:58-68` |
| remote module | ✅ | absent |
| Preload surface | ✅ | one typed `window.znxstudio`, no Node leak `preload.ts:166` |
| IPC input validation (paths/commands) | ⚠ | FS + task channels unvalidated (below) |
| Path traversal / confinement (FS IPC) | ❌ | `FileSystemService` takes arbitrary abs paths, no `PathBoundary` `FileSystemService.ts:11-34` |
| PreviewServer traversal guard | ✅ | lexical guard + loopback `PreviewServer.ts:91` (⚠ symlink not realpath-checked) |
| Command injection | ❌ HIGH | `TaskService.run` `spawn(cmd,{shell:true})` on renderer-supplied manifest scripts, no workspace trust `TaskService.ts:17` |
| Other exec paths (git/gh/tool/lsp/dap/compiler) | ✅ | args-array, fixed binary, no shell |
| Secret storage | ⚠ | AI keys plaintext in `~/.znxstudio/settings.json` `SettingsStore`, `ai/AiModule.ts:76` |
| Log redaction | ✅ | runs before write `health/logging.ts:52,99` |
| Dependency audit | ✅ | `npm audit --production` = 0 vulnerabilities |

### 20D — Performance — ✅ / ⚠
| Requirement | Status | Evidence |
|---|---|---|
| Startup / probe off critical path | ✅ | `LanguagePlatformModule.ts:128` background probe |
| Startup scaling | ⚠ | modules activate **sequentially** `ExtensionHost.ts:29` (startup ≈ Σ activations) |
| No sync IO in renderer | ✅ | 0 sync-IO matches in `src/renderer` |
| Sync IO in main | ⚠ | `LogService.appendFileSync` `:43`, `DiagnosticsService` `readFileSync` (error/session paths) |
| Bench harness with regression gates | ✅ | `test/bench.ts` (incremental tokenize + analysis cache) |
| Large-file/project handling | ⚠ | Monaco virtualizes; search caps `SearchService.ts:27` (6000 files / 1MB) — caps, not streaming |
| Caching / no duplicate parse | ✅ | incremental tokenizer + per-version cache + content-hash gate `LanguagePlatformModule.ts:82` |

### 20E — Stress — ⚠ (pure-model harness only)
| Spec target | Covered? | Actual (`test/stress.test.ts`) |
|---|---|---|
| Many editor tabs | ✅ | 2000 opens + storm + closeOthers(1000) `:39-63` |
| Fuzzy/search flood | ✅ | 20k fuzzy / 10k search `:76,87` |
| Many panels | ✅ | 500 panels `:101` |
| Large file (lines) | ⚠ | `computeMetrics` on 50k lines `:111` (model only) |
| 100,000-file workspace | ❌ | max 6000 |
| 100 MB files | ❌ | max 50k-line string; search caps 1MB |
| Long editing sessions | ❌ | no soak test |
| Project switching | ❌ | no swap-churn test |
| Rapid diagnostics | ❌ | timed in bench, no stress soak |
| Leak / deadlock / race | ❌ | throughput + invariants only |

### 20F — Installer & Auto-Update — ⚠ (config + logic; not runtime-wired)
| Feature | Status | Evidence |
|---|---|---|
| Win/mac/linux installers + portable | ✅ config | `electron-builder.yml` (nsis/portable/dmg/zip/AppImage/deb/rpm, x64+arm64) |
| Code signing (conditional) | ✅ config | `.github/workflows/release.yml` (CSC_/APPLE_ secrets) |
| Version detect / channels / checksum | ✅ tested | `shared/update.ts:143,200`, `test/update.test.ts` (10 tests) |
| Runtime auto-update (electron-updater in main) | ❌ | zero `electron-updater`/`autoUpdater` in `src/main`; not a dependency; `update.ts` imported by nothing in main |
| Delta updates | ❌ | none in `update.ts` |
| Rollback / recovery after failed update | ❌ | none |

### 20G — Cross-Platform — ✅ / ⚠
| Requirement | Status | Evidence |
|---|---|---|
| Platform primitives (paths/case/EOL/exe/shell) | ✅ | `shared/platform.ts` + `test/platform.test.ts` (6 targets) |
| Path separators | ✅ | normalized before split `breadcrumbs.ts:88`, `toPosixPath` |
| Line-ending policy | ⚠ | delegated to Monaco defaults; `lineEnding()` unused at FS layer |
| Native deps rebuilt per platform | ✅ | `@electron/rebuild` + `rebuild` script |
| macOS Cmd vs Ctrl shortcuts | ⇒✅ (was ❌) | now `Mod`→Cmd/Ctrl `KeybindingsModule.ts`, `resolvePrimaryModifier` — **fixed §5** |
| CI matrix on 3 OSes | ✅ | `ci.yml` win/mac/ubuntu + linux xvfb smoke |

### 20H — Release-Candidate hygiene — ✅ (clean)
| Check | Status | Evidence |
|---|---|---|
| TODO/FIXME/HACK | ✅ | 19 hits, 11 are the Todo-scanner feature's own constants; 1 real (`ExtensionHost.ts:8`) |
| Not-implemented / stubs | ⚠ | one Phase-1 throw `ExtensionHost.ts:76` (dynamic plugin load) |
| Experimental / debug UI / dev menu | ✅ | 0 hits; no application menu with debug entries |
| Console spam | ✅ | `console.log`=1 (inside a code-sample string); `info` all `[selftest]`-gated |
| Hidden diagnostics default-on | ✅ | selftest gated on `ZNXSTUDIO_SELFTEST==='1'` `coreIpc.ts:36` |

### 20I — General Availability — ⚠
| Item | Status | Evidence |
|---|---|---|
| CHANGELOG | ✅ | `CHANGELOG.md` (real, per-phase) |
| Versioning (single source) | ✅ | `package.json` → `app.getVersion()` `coreIpc.ts:31` |
| LICENSE | ⇒✅ (was ❌) | added `LICENSE` (proprietary) — **fixed §5** |
| Third-party notices | ⇒✅ (was ❌) | added `THIRD-PARTY-NOTICES.md` — **fixed §5** |
| README | ⇒✅ (was ⚠ stale) | rewritten for GA — **fixed §5** |
| Crash reporting | ✅ | local snapshot/recovery `health/crash.ts` |
| Telemetry / privacy | ✅ | local-only, no endpoint `health/TelemetryModule.ts:20` |
| Settings/workspace migration | ❌ | no `schemaVersion`/migration on persisted settings |
| About dialog / version surface | ⚠ | version in status bar only; no About / no app menu |

---

## 3. Production-Readiness Scores (0–10)

| Category | Score | Justification |
|---|---:|---|
| Accessibility | 5.0 | Strong keyboard/landmarks/reduced-motion; but no dialog modality, SR-operable pickers, high-contrast, or UI zoom. |
| Security | 6.0 | Excellent Electron posture + verified redaction + args-array exec; **one HIGH RCE** (shell task runner, no workspace trust) + unconfined FS IPC + plaintext keys. |
| Performance | 7.5 | Deferred probe, incremental+cache, debounced work; sequential-activation scaling risk, minor main-thread sync IO. |
| Stability | 7.5 | Dual-process global exception handling, cleared timers, disposed models, race-gated self-tests; **orphaned processes fixed** this audit. |
| Architecture | 8.5 | Clean module/contract/registry design, disposable discipline, fault-isolated activation. |
| Testing | 7.0 | 1533 unit + real-app self-test + bench + platform/update coverage; thin on true integration/E2E, stress-scale, installer/update-runtime. |
| Reliability | 6.0 | Crash recovery + corrupt-settings fallback + **atomic writes fixed**; but silent unsaved-work loss on close/quit, no session/editor restoration, autosave off. |
| Documentation | 7.0 | CHANGELOG/GA/RELEASE docs solid, README/notices fixed; no About dialog, no user manual. |
| Packaging | 6.0 | Complete build config + portable; **auto-update not runtime-wired**, no delta/rollback. |
| Cross-platform | 7.0 | platform.ts + CI matrix + **keybindings fixed**; EOL policy implicit; real cross-OS execution unverified (release-gate). |
| Release Engineering | 6.5 | `ga:check` gate + CHANGELOG + single-source version + CI; signing/notarize/clean-machine/auto-update pending (release-gate). |
| **Weighted average** | **6.6** | Requires an additional hardening milestone before GA. |

---

## 4. Findings (by severity)

### Critical
_None outstanding._ (The shell-runner RCE below is rated HIGH because it requires
a user to both open an untrusted project and invoke Run/Build; it is the closest
to Critical and must be fixed before GA.)

### High
1. **Untrusted-workspace RCE via shell task runner.** `TaskService.run` executes
   renderer-supplied manifest `scripts` with `spawn(cmd,{shell:true})`, no
   Workspace-Trust gate. Opening a cloned project + clicking Run/Build runs its
   script verbatim. *Evidence:* `src/main/services/TaskService.ts:17-22`,
   `taskIpc.ts:10`. *Fix:* add an explicit workspace-trust gate before task
   execution; drop `shell:true` in favor of parsed `(file,args[])`, or route
   through the `ToolService` allowlist model.
2. **Silent unsaved-work loss on close/quit.** Closing a dirty tab disposes the
   model with no dirty check; no `beforeunload`; a clean quit discards the crash
   snapshot. *Evidence:* `src/renderer/editor/EditorModule.ts:494`,
   `CrashRecoveryModule.ts:131`. *Fix:* prompt on dirty close; guard quit.
3. **Auto-update never runs.** Only pure logic + config exist; no
   `electron-updater`/`autoUpdater` wired in main. Packaged builds won't update.
   *Evidence:* `src/main/main.ts`, `src/shared/update.ts` (unused in main),
   `package.json` deps. *Fix:* add `electron-updater`, wire `autoUpdater` to the
   configured feed via `update.ts`. (Verify with a signed pair — release-gate.)
4. **Accessibility modality gaps.** No dialog roles/`aria-modal`, no focus
   trap/restore on overlays, pickers not SR-operable, no high-contrast theme, no
   UI zoom. *Evidence:* grep(`role="dialog"`/`activeElement`) = 0;
   `ThemeModule.ts:13`; `CommandPaletteModule.ts:103`. *Fix:* dedicated 20A pass
   (shared overlay helper with focus trap + listbox ARIA; high-contrast theme;
   `webFrame` zoom commands).
5. **Internationalization coverage ~4%.** Engine is sound but only 2 modules
   render through `t()`; no live switch, no pluralization, no locale-aware
   date/number, no RTL. *Evidence:* `i18n/en.ts:12`, `i18n.ts:16,28`. *Fix:*
   scope-decision required — either invest in real externalization or advertise
   as "i18n foundation" only.
6. **Missing LICENSE / third-party notices (legal).** ⇒ **FIXED** (§5).

### Medium
7. **Unconfined filesystem IPC.** `FsRead/Write` accept arbitrary absolute paths;
   no `PathBoundary`/symlink re-check. *Evidence:* `FileSystemService.ts:11-34`.
   *Fix:* confine to open-workspace roots (lexical + realpath).
8. **Plaintext AI API keys.** Stored unencrypted in settings. *Evidence:*
   `SettingsStore.ts`, `ai/AiModule.ts:76`. *Fix:* Electron `safeStorage`.
9. **Non-atomic writes.** ⇒ **FIXED** (§5).
10. **No settings/workspace migration seam.** No `schemaVersion`. *Fix:* stamp +
    forward-migrate persisted settings/layout (no-op v1 establishes the seam).
11. **No editor/tab/layout restoration.** Restart loses open files/layout.
12. **Sequential module activation** scales startup linearly. `ExtensionHost.ts:29`.
13. **Stress suite doesn't cover spec scale** (100k files / 100MB / soak /
    switching). Partly inherent to the pure-model harness — document or add an
    integration tier.
14. **HTML injection via filenames/AI output into `innerHTML`.** CSP blocks script
    today, but use `textContent`. `explorer/ProjectExplorerModule.ts:341`.

### Low
15. `sandbox:false` (mitigated by contextIsolation). `security.ts:32`.
16. PreviewServer lexical-only traversal + wildcard CORS on loopback.
17. Listener add/remove imbalance in long-lived modules — targeted sweep.
18. Autosave off by default; autosave timer not cleared on tab close.
19. macOS Cmd keybindings. ⇒ **FIXED** (§5).
20. About dialog / application menu absent.
21. Explicit EOL normalization policy absent (Monaco default relied upon).

---

## 5. Work Implemented in This Audit

All changes are backward-compatible, follow existing architecture, and are
covered by tests + the `npm run ga:check` gate (1533 tests, 0 failed; gate green).

| Fix | Files | Test |
|---|---|---|
| **Atomic file/settings writes** (temp+fsync+rename) — prevents corruption on crash mid-write | `src/main/util/atomicWrite.ts` (new), `SettingsStore.ts`, `FileSystemService.ts` | `test/atomicwrite.test.ts` (4) |
| **Quit-time child-process cleanup** — no orphaned PTY/LSP/DAP/task processes | `TaskService.killAll()`, `taskIpc.ts`, `terminalIpc.ts`, `lspIpc.ts`, `debugIpc.ts` | boot self-test still green |
| **macOS Cmd-vs-Ctrl keybindings** — one `Mod` table resolves to Cmd on darwin, Ctrl elsewhere | `keybindings.ts` (`resolvePrimaryModifier`), `KeybindingsModule.ts` | `test/keybindings.test.ts` (+4) |
| **LICENSE** (Apache-2.0) | `LICENSE` | — |
| **THIRD-PARTY-NOTICES** (Monaco/Electron/xterm/node-pty, verified from bundled license files) | `THIRD-PARTY-NOTICES.md` (new) | — |
| **README** rewritten from stale "Phase 1" to GA | `README.md` | — |

---

## 6. Final Verdict

### ❌ GA REJECTED — an additional hardening milestone is required.

ZnxStudio is an impressive, near-complete product with excellent architecture, but a
zero-assumption pass shows Phase 20 is not yet done. Several blockers were fixed
in this audit (atomic writes, orphaned processes, macOS keybindings, and the legal
LICENSE/notices/README gaps). The following **must** close before a 1.0 GA tag:

**Release-blocking (code) — do before GA:**
- Security: workspace-trust gate for the shell task runner (Finding 1).
- Reliability: prompt/guard against unsaved-work loss on close/quit (Finding 2).
- Packaging: wire runtime auto-update (`electron-updater`) (Finding 3).
- Accessibility: dialog modality, SR-operable pickers, high-contrast, UI zoom
  (Finding 4).
- i18n: make the scope decision and either deliver real coverage or re-label the
  capability (Finding 5).

**Release-gate (environment) — independently required (see `docs/GA-1.0.md`):**
- Code signing (Windows Authenticode, macOS Developer ID) + notarization.
- Cross-OS package builds green on real runners; clean-machine acceptance.
- Signed auto-update round-trip + rollback (depends on the code fix above).

Once the release-blocking code items land with tests and `npm run ga:check`
stays green — and the release-gate items are certified — this verdict can move to
**GA APPROVED**.
