# Bundled Zornux runtime

`npm run stage:zornux [rid...]` publishes a self-contained `zornux` binary into
`build/zornux/<rid>/` (e.g. `win-x64/zornux.exe`). electron-builder ships this
tree to `<resources>/zornux/` so installing ZnxStudio installs the Zornux
toolchain — offline and version-matched to the IDE.

The staged binaries are git-ignored; only this placeholder keeps the directory
present so `npm run package` succeeds even before anything is staged (in which
case binary resolution falls through to a `PATH` lookup at runtime).

Resolution order lives in `src/main/util/zornuxRuntime.ts`.
