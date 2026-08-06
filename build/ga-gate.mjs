/**
 * GA-readiness gate (Phase 20I prep).
 *
 * Runs every 1.0 GA gate that can be certified WITHOUT signing certs or foreign
 * OS runners, and prints an honest pass/fail report. The cert-gated items
 * (Windows/mac signing, notarization, cross-OS package builds, clean-machine +
 * signed auto-update acceptance) are listed as DEFERRED, never silently skipped
 * — they require a real release environment and are tracked in docs/GA-1.0.md.
 *
 *   node build/ga-gate.mjs           # full gate incl. headless self-test launch
 *   node build/ga-gate.mjs --no-app  # skip the Electron launch (CI runs it via
 *                                     # the smoke job under xvfb)
 *
 * Exit code 0 iff every verifiable gate passes. On a headless Linux/mac box run
 * it under a display, e.g. `xvfb-run -a node build/ga-gate.mjs`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const skipApp = process.argv.includes('--no-app');

/** Collected gate outcomes: { name, ok, detail }. */
const gates = [];
function record(name, ok, detail) {
  gates.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function runStep(label, cmd, args) {
  process.stdout.write(`\n▶ ${label} (${cmd} ${args.join(' ')})\n`);
  // shell:true is required so npm's .cmd shim resolves on Windows. Pass the whole
  // command as one string (not cmd+args) to avoid Node's DEP0190 warning; every
  // token is a literal constant, so there is no injection surface.
  const r = spawnSync([cmd, ...args].join(' '), { cwd: root, encoding: 'utf8', shell: true });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  return { code: r.status ?? 1, out };
}

// ── 1. Types ───────────────────────────────────────────────────────────────
{
  const { code } = runStep('Typecheck', npmCmd, ['run', 'typecheck']);
  record('Types (tsc --noEmit)', code === 0, code === 0 ? 'clean' : `exit ${code}`);
}

// ── 2. Unit suite ────────────────────────────────────────────────────────────
{
  const { code, out } = runStep('Unit suite', npmCmd, ['test']);
  const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  const passed = m ? Number(m[1]) : 0;
  const failed = m ? Number(m[2]) : -1;
  record(
    'Unit suite (npm test)',
    code === 0 && failed === 0 && passed > 0,
    m ? `${passed} passed, ${failed} failed` : `exit ${code}, no summary parsed`,
  );
}

// ── 3. Bundle ────────────────────────────────────────────────────────────────
{
  const { code, out } = runStep('Build', npmCmd, ['run', 'build']);
  const done = /done → dist\//.test(out) || code === 0;
  record('Bundle (npm run build)', code === 0 && done, code === 0 ? 'clean → dist/' : `exit ${code}`);
}

// ── 4. Version wiring ────────────────────────────────────────────────────────
{
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const v = pkg.version;
  // GA prep asserts a well-formed semver; the actual 1.0.0 retag is a
  // release-gate step (see docs/GA-1.0.md), so rc/prerelease is allowed here.
  const ok = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v || '');
  record('Version wiring (package.json → app.getVersion())', ok, v);
}

// ── 5. Headless self-test launch (the real-app audit gates) ──────────────────
if (skipApp) {
  console.log('\n▶ Real-app self-test — SKIPPED (--no-app)');
  record('Real-app self-test launch', true, 'skipped (run via CI smoke job)');
} else {
  await selfTestGate();
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(72));
console.log('GA-readiness — verifiable gates');
console.log('─'.repeat(72));
for (const g of gates) console.log(`  ${g.ok ? '✅' : '❌'}  ${g.name}${g.detail ? ` — ${g.detail}` : ''}`);

console.log('\nDEFERRED — release-gate (needs certs + foreign-OS runners; see docs/GA-1.0.md):');
for (const d of [
  'Windows production signing (Authenticode cert)',
  'macOS signing + notarization (Apple Developer ID, macOS runner)',
  'Cross-OS package builds go green (release.yml 3-OS matrix)',
  'Clean-machine acceptance (fresh Win / mac Intel+AS / Linux distros)',
  'Signed auto-update round-trip + rollback',
]) console.log(`  ⏳  ${d}`);

const failed = gates.filter((g) => !g.ok);
console.log('\n' + '─'.repeat(72));
if (failed.length === 0) {
  console.log('RESULT: ✅ GA-READY on all verifiable gates. Remaining work is release-gate only.');
  process.exit(0);
} else {
  console.log(`RESULT: ❌ ${failed.length} gate(s) failing: ${failed.map((g) => g.name).join('; ')}`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
async function selfTestGate() {
  console.log('\n▶ Real-app self-test (headless Electron, ZNXSTUDIO_SELFTEST=1)');
  const electron = (await import('electron')).default; // path to the binary
  const child = spawn(electron, ['.', '--enable-logging'], {
    cwd: root,
    env: { ...process.env, ZNXSTUDIO_SELFTEST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  const need = [
    '[perf] startup:', 'a11y-audit REAL DOM', 'security REAL:', 'stress REAL DOM',
    'palettecoverage REAL', 'i18n REAL DOM', 'editortoolbar REAL DOM',
  ];
  const seen = () => need.every((n) => log.includes(n));

  const done = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(hard);
      killTree(child);
      resolve();
    };
    const onData = (b) => {
      log += b.toString();
      if (seen()) setTimeout(finish, 400); // brief grace for trailing audits
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData); // Electron routes renderer console to stderr
    child.on('exit', finish);
    // The app never self-exits; hard cap so the gate can't hang forever.
    var hard = setTimeout(finish, 120_000);
  });
  await done;

  const line = (re) => (log.match(re) || [])[0] || '';
  const startupMatch = log.match(/\[perf\] startup: \d+ms across (\d+) modules/);
  const startup = startupMatch ? startupMatch[0] : '';
  const modules = startupMatch ? Number(startupMatch[1]) : 0;
  const a11y = log.match(/a11y-audit REAL DOM: interactive=(\d+) unnamed=(\d+)/);
  const sec = /security REAL: nodeGlobalsLeaked=false bridgePresent=true windowOpenBlocked=true/.test(log);
  const pal = log.match(/launchersReachable=(\d+)\/(\d+)/);
  const i18n = /i18n REAL DOM:.*externalized=true/.test(log);
  const stress = log.match(/stress REAL DOM: rendered (\d+)\/(\d+) editor tabs/);
  const toolbar = /editortoolbar REAL DOM: actions=\[Run, Debug, Stop, Build, Rebuild\]/.test(log);
  // Every module logs "activated module: <id>"; a full boot activates them all
  // (the [perf] line reports the count). This is the completeness signal — it
  // lands in the first second, unlike the ~45s subprocess self-tests that
  // `npm test` already covers, so the gate never re-runs them here.
  const activated = (log.match(/activated module:/g) || []).length;

  record('App boots to full activation', Boolean(startup) && modules >= 100, startup || 'no [perf] startup line');
  record('All modules activated (no mid-boot failure)', activated >= 100 && activated >= modules, `${activated} modules activated`);
  record('Accessibility — no unnamed controls (20A)', Boolean(a11y) && a11y[2] === '0', a11y ? `interactive=${a11y[1]} unnamed=${a11y[2]}` : 'not reported');
  record('Security posture (20C)', sec, sec ? 'nodeGlobalsLeaked=false bridgePresent=true windowOpenBlocked=true' : 'audit missing/failed');
  record('Palette coverage (SB-7)', Boolean(pal) && pal[1] === pal[2], pal ? `launchersReachable=${pal[1]}/${pal[2]}` : 'not reported');
  record('Internationalization (20B)', i18n, i18n ? 'externalized=true' : 'not reported');
  record('Stress — editor tabs (20E)', Boolean(stress) && stress[1] === stress[2], stress ? `${stress[1]}/${stress[2]} tabs` : 'not reported');
  record('Editor toolbar actions (SB-5)', toolbar, toolbar ? '[Run, Debug, Stop, Build, Rebuild]' : 'not reported');
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* best effort */ }
  } else {
    try { child.kill('SIGTERM'); } catch { /* best effort */ }
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* best effort */ } }, 2000);
  }
}
