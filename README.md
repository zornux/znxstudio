# ZnxStudio

An enterprise-grade IDE platform built first-class for **Zornux** and **Zoijs**,
extensible to other languages through modules and plugins.

ZnxStudio is a desktop IDE (Electron + TypeScript + Monaco) whose entire feature set
— language intelligence, compiler and debugger integration, project system,
database and testing tools, source control, deployment, profiling, security
tooling, and more — is delivered as modules on a language-agnostic workbench
shell. See [`CHANGELOG.md`](CHANGELOG.md) for the full feature list.

> **Status:** `1.0.0` — general availability. Windows signed via Azure Trusted
> Signing; Linux packages via CI. Run `npm run ga:check` for the full GA-readiness
> gate. See [`docs/GA-1.0.md`](docs/GA-1.0.md) for the release checklist.

## Highlights

- **Zornux language platform** — diagnostics, completion, hover, go-to-def,
  references, rename, formatting, and semantic tokens sourced from the real
  `zornux lsp` server; compiler integration and a standard-DAP debugger.
- **Zoijs native development** — component and template intelligence, a reactive
  inspector, router designer, DevTools, live preview, and a full-stack runner.
- **Enterprise project system** — multi-root workspaces, solution explorer,
  project references, dependency/package management, profiles, templates, wizards.
- **Full IDE surface** — editor productivity, database tools, testing, optional
  vendor-neutral AI, extensions, Git/GitHub, cloud/deploy, profiling, security,
  collaboration, docs, and diagnostics/telemetry.
- **Production hardening** — Workspace Trust (execution gated on trusting a
  workspace), unsaved-changes protection with session restore, runtime
  auto-update, an accessibility baseline (high-contrast themes, UI zoom,
  screen-reader-operable pickers), an i18n foundation, a hardened Electron
  security posture, and stress-tested core models. See
  [`docs/PHASE20J-HARDENING.md`](docs/PHASE20J-HARDENING.md).

## Stack

- **Electron** — desktop shell
- **TypeScript** — application language
- **Monaco Editor** — code editing engine
- **esbuild** — build pipeline

## Getting started

```bash
npm install      # install dependencies
npm run build    # bundle main + preload + renderer + Monaco workers into dist/
npm start        # build, then launch the app
```

During development:

```bash
npm run watch      # rebuild on change (run `npx electron .` in another terminal)
npm run typecheck  # type-check without emitting
npm test           # run the unit suite
npm run ga:check   # full GA-readiness gate (types + tests + build + real-app audit)
```

## Architecture

The renderer is a **modular workbench**. The shell owns three registries and an
extension host; every feature is an `IModule` activated against a shared
`ModuleContext`.

```
src/
├── main/                 # Electron main process (lifecycle + privileged IPC)
│   ├── main.ts           # app lifecycle
│   ├── AppWindow.ts      # hardened BrowserWindow
│   ├── ipc/              # privileged IPC endpoints (one registrar per domain)
│   └── services/         # FileSystemService, ProjectService, TaskService, …
├── preload/              # context bridge -> window.znxstudio
├── shared/               # cross-process types + IPC channel names
└── renderer/
    ├── core/             # Workbench, LayoutManager, ServiceRegistry, contracts
    ├── commands/         # CommandRegistry + CommandIds
    ├── extensions/       # ExtensionHost (module + plugin loader)
    ├── editor/           # Monaco integration
    ├── language/         # Zornux language service + LSP client
    ├── zoijs/            # Zoijs framework intelligence
    └── …                 # one directory per feature module
```

### Design principles

- **Shell is language-agnostic.** No Zornux/Zoijs logic lives in the shell; they
  register as modules via the `ExtensionHost`.
- **Talk through contracts, not imports.** Modules publish services under keys
  (`ServiceRegistry`) and dispatch through named commands (`CommandRegistry`).
- **Secure by default.** The renderer has no Node access; everything privileged
  goes through the typed `window.znxstudio` bridge and explicit IPC handlers, under
  a locked-down CSP with navigation and window-open restrictions.

## Documentation

- [`CHANGELOG.md`](CHANGELOG.md) — full release history and feature list.
- [`docs/GA-1.0.md`](docs/GA-1.0.md) — the GA gate and `npm run ga:check`.
- [`docs/RELEASE.md`](docs/RELEASE.md) — packaging, signing, update channels.
- [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) — bundled component licenses.

## License

Apache-2.0 — see [`LICENSE`](LICENSE).
