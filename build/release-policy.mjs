import { readFileSync } from 'node:fs';

export function releasePolicy(version, refType, refName) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`package.json contains an invalid release version: ${version}`);
  }
  const publish = refType === 'tag';
  if (publish && refName !== `v${version}`) {
    throw new Error(`tag ${refName} does not match package version v${version}`);
  }
  const prerelease = version.includes('-');
  const prereleaseId = version.split('-', 2)[1]?.split('.', 1)[0]?.toLowerCase();
  const updateChannel = prereleaseId === 'nightly' ? 'nightly' : prerelease ? 'rc' : 'latest';
  return { publish, prerelease, releaseType: prerelease ? 'prerelease' : 'release', updateChannel };
}

if (process.argv[1]?.endsWith('release-policy.mjs')) {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const policy = releasePolicy(pkg.version, process.argv[2] ?? '', process.argv[3] ?? '');
    process.stdout.write(`publish=${policy.publish}\nrelease_type=${policy.releaseType}\nprerelease=${policy.prerelease}\nupdate_channel=${policy.updateChannel}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
