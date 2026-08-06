// Custom Windows signing hook for electron-builder — Azure Trusted Signing.
//
// electron-builder invokes this for every Windows artifact it produces (the app
// .exe plus each NSIS/portable installer). Because signing happens INSIDE the
// build, the blockmap and latest.yml hashes are computed from the *signed*
// bytes, so electron-updater stays consistent (a common pitfall of post-build
// signing).
//
// Signing is CONDITIONAL: if the Trusted Signing env vars are absent (local dev,
// forks, dry-runs) this is a no-op and the build still succeeds — producing an
// UNSIGNED artifact. Never treat such a build as production-trusted.
//
// Required env (set from CI secrets):
//   AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET  — service principal
//        (consumed by DefaultAzureCredential inside the `sign` tool)
//   TRUSTED_SIGNING_ENDPOINT   e.g. https://eus.codesigning.azure.net
//   TRUSTED_SIGNING_ACCOUNT    the Trusted Signing account name
//   TRUSTED_SIGNING_PROFILE    the certificate profile name
//
// Toolchain: Microsoft's `sign` CLI (https://github.com/dotnet/sign),
//   installed in CI via `dotnet tool install --global sign`.

'use strict';

const { spawnSync } = require('node:child_process');

const REQUIRED = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'TRUSTED_SIGNING_ENDPOINT',
  'TRUSTED_SIGNING_ACCOUNT',
  'TRUSTED_SIGNING_PROFILE',
];

module.exports = async function sign(configuration) {
  const filePath = configuration.path;

  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.warn(
      `[win-sign] Trusted Signing not configured (missing: ${missing.join(', ')}). ` +
        `Skipping signature for ${filePath} — UNSIGNED build.`,
    );
    return;
  }

  // `sign` is a .NET global tool; on Windows the shim resolves to sign.exe on PATH.
  const exe = process.platform === 'win32' ? 'sign.exe' : 'sign';
  const args = [
    'code',
    'trusted-signing',
    filePath,
    '--trusted-signing-endpoint',
    process.env.TRUSTED_SIGNING_ENDPOINT,
    '--trusted-signing-account',
    process.env.TRUSTED_SIGNING_ACCOUNT,
    '--trusted-signing-certificate-profile',
    process.env.TRUSTED_SIGNING_PROFILE,
    '--file-digest',
    'SHA256',
    '--timestamp-url',
    'http://timestamp.acs.microsoft.com',
    '--timestamp-digest',
    'SHA256',
    '--verbosity',
    'information',
  ];

  console.log(`[win-sign] Trusted Signing → ${filePath}`);
  const result = spawnSync(exe, args, { stdio: 'inherit' });

  if (result.error) {
    throw new Error(`[win-sign] failed to launch '${exe}': ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`[win-sign] signing failed for ${filePath} (exit ${result.status}).`);
  }
};
