import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from './harness';
import { parseEnvelope } from '../src/shared/cli/envelope';
import { parseCheckStdout } from '../src/shared/compilerProtocol';
import { parseInfoEnvelope } from '../src/shared/toolchain/negotiation';
import { parseScanResult } from '../src/renderer/security/findings';
import { parseDocResult } from '../src/renderer/docs/apiReference';
import { parseProfileReport, parseTimelineEvents } from '../src/renderer/profiler/profile';
import { parseTestResult } from '../src/renderer/testing/testModel';
import { evaluateToolchain } from '../src/shared/toolchain/compatibility';
import type { ZornuxInfo } from '../src/shared/toolchain/contracts';

/**
 * Cross-repo contract check (Integration Layer, IL-H). Zornux publishes a
 * `contracts/` tree of canonical `--json` captures; this runs ZnxStudio's REAL
 * readers against them, so a shape change in the compiler is caught here rather
 * than in the field. Point it at another version's fixtures via ZORNUX_CONTRACTS
 * (min / stable / prerelease) to run the matrix in CI.
 *
 * When the tree is absent (a machine without the Zornux repo), the suite skips
 * with a note instead of failing — the check is meaningful only where fixtures
 * exist.
 */
const CONTRACTS = process.env.ZORNUX_CONTRACTS || join('C:\\', 'Studio Apps', 'xojin', 'contracts');
const CLI = join(CONTRACTS, 'cli');
const available = existsSync(CLI);

function read(name: string): string {
  return readFileSync(join(CLI, name), 'utf8');
}

describe('contract fixtures — ZnxStudio readers vs Zornux contracts/ (IL-H)', () => {
  if (!available) {
    test('skipped — no contracts/ tree found (set ZORNUX_CONTRACTS)', () => {
      console.info(`[contract] fixtures not found at ${CLI} — skipping cross-repo contract check.`);
      expect(available).toBe(false);
    });
    return;
  }

  test('the manifest declares protocols this ZnxStudio supports', () => {
    const manifest = JSON.parse(readFileSync(join(CONTRACTS, 'manifest.json'), 'utf8')) as {
      protocols: Record<string, string>;
      generatedFrom?: string;
    };
    const info: ZornuxInfo = {
      productVersion: manifest.generatedFrom ?? null,
      protocols: {
        cli: manifest.protocols.cli,
        lsp: manifest.protocols.lsp,
        dap: manifest.protocols.dap,
        projectManifest: manifest.protocols.projectManifest,
      },
      capabilities: {},
      source: 'info',
    };
    expect(evaluateToolchain(info).status).toBe('ok');
  });

  test('every cli fixture is a valid `--json` envelope', () => {
    for (const file of readdirSync(CLI).filter((f) => f.endsWith('.json'))) {
      const envelope = parseEnvelope(read(file));
      expect(envelope).toBeTruthy();
      expect(typeof envelope!.ok).toBe('boolean');
    }
  });

  test('capabilities.json negotiates to authoritative info', () => {
    const info = parseInfoEnvelope(read('capabilities.json'))!;
    expect(info.source).toBe('info');
    expect(info.productVersion).toBeTruthy();
    expect(Object.keys(info.capabilities).length).toBeGreaterThan(0);
  });

  test('check fixtures parse into diagnostics (broken) and none (clean)', () => {
    expect(parseCheckStdout(read('check.json')).length).toBeGreaterThan(0);
    expect(parseCheckStdout(read('check-clean.json'))).toHaveLength(0);
  });

  test('check-security.json parses as analyzed', () => {
    const result = parseScanResult(read('check-security.json'), 'contract.zx');
    expect(result.analyzed).toBe(true);
  });

  test('doc.json parses as a successful doc summary', () => {
    const result = parseDocResult(read('doc.json'));
    expect(result.ok).toBe(true);
  });

  test('test.json parses into a run result', () => {
    const result = parseTestResult(read('test.json'));
    expect(result).toBeTruthy();
    expect(Array.isArray(result!.tests)).toBe(true);
  });

  test('profile fixtures parse into a report and a trace', () => {
    expect(parseProfileReport(read('profile-run.json'))!.engine).toBeTruthy();
    expect(parseProfileReport(read('profile-heap.json'))!.engine).toBeTruthy();
    expect(Array.isArray(parseTimelineEvents(read('profile-timeline.json')))).toBe(true);
  });
});
