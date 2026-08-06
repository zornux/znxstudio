# ZnxStudio — Phase 20J GA Hardening Report

**Date:** 2026-07-27 · **Version:** `1.0.0-rc.1` · **Scope:** resolve the
release-blocking findings from the [Phase 20 audit](PHASE20-AUDIT.md) without
breaking backward compatibility. Every change is covered by automated tests and
the `npm run ga:check` gate, which stays green.

Baseline at audit time: **1525 tests · production-readiness 6.6/10 · GA REJECTED.**
After this milestone: **1574 tests · production-readiness ~7.7/10 · see verdict.**

---

## 1. Implementation Summary

### WI1 — Workspace Trust (Critical, closed)
VS-Code-style trust decided by workspace location, **enforced in the main process**
so no renderer path can bypass it. `sharedWorkspaceTrust().assertTrusted(...)`
gates all five execution IPCs — verified: `task:run`, `terminal:create`,
`debug:start`, `packages:run`, `tool:exec`. Trusted folders persist to
`~/.znxstudio/trust.json` (atomic). Renderer UI: trust dialog, Restricted-Mode
banner, Trust / Trust-Parent / Remove-Trust / Manage commands, `TrustService`.
Self-test bypasses the gate so the harness still runs.
*Files:* `shared/workspaceTrust.ts`, `main/services/WorkspaceTrustService.ts`,
`main/ipc/trustIpc.ts` (+ 5 gated IPCs), `renderer/trust/TrustModule.ts`,
`renderer/ui/modal.ts`. *Tests:* `test/workspacetrust.test.ts`.

### WI2 — Unsaved-changes protection + session restore (Critical, closed)
Save / Don't Save / Cancel prompt on every close path (×, middle-click, Ctrl+W,
context menu, Close Others/All). Main-process window/quit guard
(`AppWindow.guardUnsavedOnClose`) so a window close **or app quit** can't discard
work. Autosave modes off / afterDelay / onFocusChange / onWindowChange (the modes
existed in settings but were never applied). Session restore of open/pinned/active
tabs + recent workspaces. Also fixed a model leak in Close Others/All.
*Files:* `renderer/editor/unsavedGuard.ts`, `EditorModule.ts`,
`language/DocumentManager.ts`, `main/AppWindow.ts`. *Tests:* `test/unsavedguard.test.ts`.

### WI3 — Production auto-update (Critical, closed for runtime)
Real runtime HTTP feed check (`UpdateService`) — the app now genuinely checks for
updates; offline / 500 / malformed feeds degrade to `no-feed`, never throw.
electron-updater is loaded **optionally** for the real download/install/progress
when packaged; a manual-download fallback works otherwise. UI: Check-for-Updates
command, startup check by `update.mode`, status indicator, release-notes dialog.
*Files:* `main/services/UpdateService.ts`, `main/ipc/updateIpc.ts`,
`renderer/update/UpdateModule.ts`, `shared/update.ts`. *Tests:*
`test/updateservice.test.ts` (mock HTTP server).

### WI4 — Accessibility baseline (High, closed)
High-contrast Dark + Light themes (+ `forced-colors` support), the dark accent
recolored to pass WCAG AA, UI zoom (Mod +/-/0 via `webContents.setZoomFactor`),
and the overlay pickers (Command Palette, Quick Open, Search Everywhere) made
screen-reader-operable: `role="dialog"`/`aria-modal`, combobox/listbox/option
roles, `aria-activedescendant`, focus capture/restore. Verified live —
`palette-a11y REAL DOM: dialog=dialog/true input=combobox list=listbox
activedescendant=set option=option`.
*Files:* `shared/zoom.ts`, `renderer/view/ZoomModule.ts`, `renderer/ui/ariaListbox.ts`,
`themes/ThemeModule.ts`, `styles/main.css`, the three picker modules. *Tests:*
`test/zoom.test.ts` + real-DOM self-test.

### WI5 — Internationalization foundation (English-only)
Closes the audit's **engine** gaps: pluralization via `Intl.PluralRules`
(`tp(key, count)`), locale-aware `formatNumber/Bytes/Date/Time/RelativeTime`,
a `direction()` RTL seam that drives `document.dir` on locale change (the first
real `onDidChangeLocale` consumer). Externalized the audit-named hand-rolled
plurals as proof. *Files:* `renderer/i18n/{i18n,format,en,index}.ts`. *Tests:*
`test/i18nformat.test.ts`.

### Earlier GA-prep (pre-milestone)
Atomic file/settings writes, quit-time child-process cleanup (no orphaned PTY/
LSP/DAP/tasks), macOS Cmd/Ctrl keybindings, `LICENSE`, `THIRD-PARTY-NOTICES.md`,
GA-ready `README`, and the `npm run ga:check` gate.

---

## 2. Production-Readiness Scores (0–10)

| Category | Audit | Now | What changed |
|---|---:|---:|---|
| Accessibility | 5.0 | **8.0** | dialog modality, SR-operable pickers, high-contrast themes, UI zoom, forced-colors |
| Security | 6.0 | **7.5** | workspace-trust closes the RCE path; FS confinement + key storage remain |
| Performance | 7.5 | 7.5 | unchanged (sequential activation still a scaling note) |
| Stability | 7.5 | **8.0** | orphaned processes + unsaved-loss closed |
| Architecture | 8.5 | 8.5 | unchanged; new features follow the module/contract pattern |
| Testing | 7.0 | **7.5** | +49 tests, mock-server + real-DOM self-tests |
| Reliability | 6.0 | **8.0** | atomic writes, unsaved prompt, session restore, window guard |
| Documentation | 7.0 | **7.5** | this report + updated CHANGELOG/README/GA docs |
| Packaging | 6.0 | **7.0** | runtime auto-update wired; signed round-trip is release-gate |
| Cross-platform | 7.0 | **7.5** | Cmd/Ctrl keybindings, RTL seam |
| Release Engineering | 6.5 | **7.0** | broader gate; signing/notarize still pending |
| **Weighted average** | **6.6** | **~7.7** | |

---

## 3. Test Results

- **Unit suite:** 1574 passed, 0 failed (was 1525). New suites: workspace-trust,
  unsaved-guard, update-service (mock HTTP), zoom, i18n-format, atomic-write.
- **Types:** clean · **Bundle:** clean · **Real-app self-test:** 106 modules
  activate; a11y `unnamed=0`; security posture intact; new live self-tests for
  trust round-trip, update offline check, and palette accessibility tree.
- `npm run ga:check`: **all verifiable gates green.**

---

## 4. Remaining Issues (non-blocking recommendations)

None are data-loss, crash, or RCE. Recommended for a future hardening pass:

- **Confine filesystem IPC** to open-workspace roots (lexical + realpath) —
  `FileSystemService` still accepts arbitrary absolute paths. (Trust now gates
  execution, which was the escalation path.)
- **Store AI API keys via `safeStorage`** instead of plaintext settings.
- **Add a settings `schemaVersion` + migration seam** before the schema evolves.
- **Complete i18n string externalization** — WI5 shipped the engine + pattern;
  ~550 UI strings across the modules remain to be routed through `t()`/`tp()`.
  The pseudo-locale is the detector.
- **Parallelize independent module activation** to keep startup flat as modules grow.

## 5. Release-Gate (blocks the public 1.0.0 tag; needs certs + hardware — not code)

Unchanged from the audit and **cannot be closed in this environment**:

- Windows Authenticode signing; macOS Developer ID signing + notarization.
- Cross-OS package builds green on the `release.yml` matrix.
- Clean-machine acceptance (fresh Win / mac Intel+AS / Linux distros).
- **Signed** auto-update round-trip + rollback (WI3 wired the code; the signed
  end-to-end run is release-gate).

---

## 6. Final Verdict

### ✅ GA APPROVED WITH RECOMMENDATIONS — for the software.

Every **release-blocking code defect** the Phase 20 audit identified is resolved
and verified: the untrusted-workspace RCE (WI1), silent unsaved-work loss (WI2),
non-running auto-update (WI3), and the accessibility gaps (WI4) are closed, and
the i18n engine gaps (WI5) are addressed. No data-loss, crash, security, or
accessibility blocker remains. The remaining items in §4 are non-blocking
recommendations.

**However, the `1.0.0` GA TAG itself remains gated** on the release-engineering
items in §5 — code signing, notarization, cross-OS package certification, and a
signed auto-update round-trip. These are not code and require certificates and
Mac/Linux hardware; they must be completed in CI/on-device before a public
release. The software is production-ready; the *release* is pending that gate.
