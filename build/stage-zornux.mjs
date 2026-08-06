// Publish a self-contained `zornux` binary into build/zornux/<rid>/ so
// electron-builder can bundle the toolchain with the IDE (extraResources).
//
// Usage:  node build/stage-zornux.mjs [rid...]        (default: host RID)
// Env:    ZORNUX_REPO   path to the xojin repo (default: C:\Studio Apps\xojin)
//
// The publish flags mirror xojin's release workflow (.github/workflows/release.yml)
// so the bundled runtime matches what ships standalone: self-contained, single
// file, compressed, native libs self-extracting, invariant globalization.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const buildDir = dirname(fileURLToPath(import.meta.url));
const stageRoot = join(buildDir, 'zornux');

const repo = process.env.ZORNUX_REPO || join('C:\\', 'Studio Apps', 'xojin');
const csproj = join(repo, 'src', 'Zornux.Cli', 'Zornux.Cli.csproj');

function hostRid() {
  const os = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'osx' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${os}-${arch}`;
}

const rids = process.argv.slice(2).length ? process.argv.slice(2) : [hostRid()];

if (!existsSync(csproj)) {
  console.error(`Zornux CLI project not found: ${csproj}\nSet ZORNUX_REPO to the xojin repo path.`);
  process.exit(1);
}

for (const rid of rids) {
  const exe = rid.startsWith('win-') ? 'zornux.exe' : 'zornux';
  const out = join(stageRoot, `.publish-${rid}`);
  console.log(`\n▶ Publishing zornux for ${rid} …`);
  const result = spawnSync(
    'dotnet',
    [
      'publish', csproj,
      '-c', 'Release',
      '-r', rid,
      '--self-contained', 'true',
      '-p:PublishSingleFile=true',
      '-p:EnableCompressionInSingleFile=true',
      '-p:IncludeNativeLibrariesForSelfExtract=true',
      '-p:InvariantGlobalization=true',
      '-o', out,
    ],
    // No shell: paths contain spaces ("C:\Studio Apps\…"); a shell would split
    // them. `dotnet` is a real executable, found on PATH without a shell.
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    console.error(`dotnet publish failed for ${rid} (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
  const src = join(out, exe);
  if (!existsSync(src)) {
    console.error(`Expected published binary not found: ${src}`);
    process.exit(1);
  }
  const destDir = join(stageRoot, rid);
  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, join(destDir, exe));
  rmSync(out, { recursive: true, force: true });
  console.log(`✓ Staged ${rid}/${exe}`);
}

console.log(`\nDone. Bundled runtime staged under build/zornux/. Run 'npm run package' to ship it.`);
