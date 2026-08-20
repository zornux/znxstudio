import { describe, expect, test } from './harness';
import {
  compareZornuxVersion,
  parseProtocolVersion,
  parseZornuxVersion,
  protocolVerdict,
  versionAtLeast,
  type ProtocolName,
  type ProtocolSupport,
} from '../src/shared/toolchain/contracts';
import {
  checkProtocols,
  deriveInfo,
  enabledCapabilities,
  parseInfoEnvelope,
  resolveInfo,
  supports,
  toolchainCompatible,
  unavailableInfo,
  ZNXSTUDIO_PROTOCOL_SUPPORT,
} from '../src/shared/toolchain/negotiation';
import { ToolchainClient } from '../src/renderer/toolchain/ToolchainClient';
import { capabilityEnabled, capabilityStatus } from '../src/renderer/toolchain/capabilityGuard';
import { COMPATIBILITY_MATRIX, evaluateToolchain, isUsable } from '../src/shared/toolchain/compatibility';
import { PROTOCOL_ADAPTERS, ProtocolV1Adapter, selectAdapter } from '../src/shared/toolchain/adapters';
import { describePin, evaluatePin, resolveToolchainPath } from '../src/shared/toolchain/resolution';
import { BUILTIN_FEATURES, editorMode, offlineExplanation } from '../src/shared/toolchain/offline';
import { parseZornuxManifest } from '../src/renderer/solution/zornuxManifest';
import type { ZornuxInfo } from '../src/shared/toolchain/contracts';

/** A verbatim `zornux info --json` envelope (the contract this consumes). */
const INFO_ENVELOPE = `{
  "zornuxJson": 1, "ok": true, "command": "info",
  "result": {
    "productVersion": "1.0.0-rc.9",
    "protocols": { "cli": "1.2", "lsp": "1.1", "dap": "1.0", "projectManifest": "2" },
    "capabilities": {
      "semanticTokens": true, "securityDiagnostics": true, "heapSnapshots": true,
      "remoteDebug": false, "aBrandNewThing": true, "notABool": "yes"
    }
  },
  "diagnostics": []
}`;

describe('toolchain — version parsing', () => {
  test('parses release and rc builds', () => {
    expect(parseZornuxVersion('1.0.0-rc.9')).toEqual({ major: 1, minor: 0, patch: 0, pre: 9 });
    expect(parseZornuxVersion('2.3.1')).toEqual({ major: 2, minor: 3, patch: 1, pre: null });
    expect(parseZornuxVersion('v1.4.0')).toEqual({ major: 1, minor: 4, patch: 0, pre: null });
  });

  test('rejects non-versions', () => {
    expect(parseZornuxVersion('unknown')).toBeNull();
    expect(parseZornuxVersion('')).toBeNull();
  });

  test('a final release sorts after its own release candidates', () => {
    const rc = parseZornuxVersion('1.0.0-rc.9')!;
    const release = parseZornuxVersion('1.0.0')!;
    expect(compareZornuxVersion(rc, release)).toBeLessThan(0);
    expect(compareZornuxVersion(release, rc)).toBeGreaterThan(0);
  });

  test('release candidates order by number, and x.y.z dominates', () => {
    expect(compareZornuxVersion(parseZornuxVersion('1.0.0-rc.4')!, parseZornuxVersion('1.0.0-rc.9')!)).toBeLessThan(0);
    expect(compareZornuxVersion(parseZornuxVersion('1.1.0-rc.1')!, parseZornuxVersion('1.0.0')!)).toBeGreaterThan(0);
    expect(compareZornuxVersion(parseZornuxVersion('2.0.0')!, parseZornuxVersion('1.9.9')!)).toBeGreaterThan(0);
  });

  test('versionAtLeast handles rc thresholds and unparseable input', () => {
    expect(versionAtLeast('1.0.0-rc.9', '1.0.0-rc.4')).toBe(true);
    expect(versionAtLeast('1.0.0-rc.3', '1.0.0-rc.4')).toBe(false);
    expect(versionAtLeast('1.0.0', '1.0.0-rc.8')).toBe(true);
    expect(versionAtLeast('garbage', '1.0.0')).toBe(false);
  });
});

describe('toolchain — protocol compatibility', () => {
  test('parses major.minor, defaulting an absent minor to 0', () => {
    expect(parseProtocolVersion('1.2')).toEqual({ major: 1, minor: 2 });
    expect(parseProtocolVersion('2')).toEqual({ major: 2, minor: 0 });
    expect(parseProtocolVersion('nope')).toBeNull();
  });

  test('same major is compatible; a higher minor is still ok (additive)', () => {
    const support: ProtocolSupport = { major: 1, minMinor: 1 };
    expect(protocolVerdict(support, '1.1')).toBe('ok');
    expect(protocolVerdict(support, '1.4')).toBe('ok');
  });

  test('a toolchain minor below what ZnxStudio needs is "newer" (ZnxStudio ahead), not a hard break', () => {
    expect(protocolVerdict({ major: 1, minMinor: 2 }, '1.0')).toBe('newer');
  });

  test('a different major is unsupported; an unparseable version is unknown', () => {
    expect(protocolVerdict({ major: 1 }, '2.0')).toBe('unsupported');
    expect(protocolVerdict({ major: 2 }, '1.9')).toBe('unsupported');
    expect(protocolVerdict({ major: 1 }, 'x')).toBe('unknown');
  });
});

describe('toolchain — parseInfoEnvelope', () => {
  test('reads the authoritative info envelope', () => {
    const info = parseInfoEnvelope(INFO_ENVELOPE)!;
    expect(info.source).toBe('info');
    expect(info.productVersion).toBe('1.0.0-rc.9');
    expect(info.protocols.cli).toBe('1.2');
    expect(info.protocols.projectManifest).toBe('2');
    expect(supports(info, 'securityDiagnostics')).toBe(true);
    expect(supports(info, 'remoteDebug')).toBe(false);
  });

  test('preserves capability keys ZnxStudio has never heard of', () => {
    const info = parseInfoEnvelope(INFO_ENVELOPE)!;
    expect(supports(info, 'aBrandNewThing')).toBe(true);
  });

  test('ignores non-boolean capability values rather than throwing', () => {
    const info = parseInfoEnvelope(INFO_ENVELOPE)!;
    expect(info.capabilities.notABool).toBeFalsy();
    expect('notABool' in info.capabilities).toBe(false);
  });

  test('a non-info / ok:false / non-envelope output yields null (caller derives)', () => {
    expect(parseInfoEnvelope('command not found')).toBeNull();
    expect(parseInfoEnvelope('{ "zornuxJson":1, "ok":false, "command":"info", "result":null, "diagnostics":[] }')).toBeNull();
    expect(parseInfoEnvelope('{ "productVersion": "1.0.0" }')).toBeNull();
  });

  test('a missing protocol field defaults to the 1.0 baseline', () => {
    const info = parseInfoEnvelope(
      '{ "zornuxJson":1,"ok":true,"command":"info","result":{"productVersion":"1.0.0","protocols":{"cli":"1.3"}},"diagnostics":[] }',
    )!;
    expect(info.protocols.cli).toBe('1.3');
    expect(info.protocols.lsp).toBe('1.0');
    expect(info.protocols.dap).toBe('1.0');
  });
});

describe('toolchain — deriveInfo (fallback for binaries without `info`)', () => {
  test('rc.9 derives every version-gated capability on', () => {
    const info = deriveInfo('1.0.0-rc.9');
    expect(info.source).toBe('derived');
    expect(supports(info, 'jsonEnvelope')).toBe(true);
    expect(supports(info, 'advisoryAudit')).toBe(true);
    expect(supports(info, 'allocationStacks')).toBe(true);
    expect(supports(info, 'gcStats')).toBe(true);
    expect(supports(info, 'securityDiagnostics')).toBe(true);
  });

  test('rc.3 predates the rc.4 opt-ins and the rc.8 envelope', () => {
    const info = deriveInfo('1.0.0-rc.3');
    expect(supports(info, 'allocationStacks')).toBe(false);
    expect(supports(info, 'gcStats')).toBe(false);
    expect(supports(info, 'jsonEnvelope')).toBe(false);
    // ...but the base capabilities are still on.
    expect(supports(info, 'cpuProfiling')).toBe(true);
    expect(supports(info, 'testing')).toBe(true);
  });

  test('an unknown/absent version derives only the safe base floor', () => {
    const info = deriveInfo(null);
    expect(supports(info, 'semanticTokens')).toBe(true);
    expect(supports(info, 'jsonEnvelope')).toBe(false);
    expect(supports(info, 'allocationStacks')).toBe(false);
  });

  test('1.5.0 derives named arguments and postgres provider', () => {
    const info = deriveInfo('1.5.0');
    expect(supports(info, 'namedArguments')).toBe(true);
    expect(supports(info, 'postgresProvider')).toBe(true);
    expect(supports(info, 'importAliases')).toBe(true);
    expect(supports(info, 'regexSupport')).toBe(true);
    expect(supports(info, 'mobileCodegen')).toBe(false);
  });

  test('1.8.0 derives all new capabilities including query capture and mobile', () => {
    const info = deriveInfo('1.8.0');
    expect(supports(info, 'namedArguments')).toBe(true);
    expect(supports(info, 'postgresProvider')).toBe(true);
    expect(supports(info, 'importAliases')).toBe(true);
    expect(supports(info, 'regexSupport')).toBe(true);
    expect(supports(info, 'mobileCodegen')).toBe(true);
    expect(supports(info, 'queryCapture')).toBe(true);
  });

  test('1.3.0 predates all 1.4+ capabilities', () => {
    const info = deriveInfo('1.3.0');
    expect(supports(info, 'namedArguments')).toBe(false);
    expect(supports(info, 'postgresProvider')).toBe(false);
    expect(supports(info, 'importAliases')).toBe(false);
    expect(supports(info, 'regexSupport')).toBe(false);
    expect(supports(info, 'mobileCodegen')).toBe(false);
    expect(supports(info, 'queryCapture')).toBe(false);
  });
});

describe('toolchain — resolveInfo', () => {
  test('prefers the authoritative info envelope when present', () => {
    const info = resolveInfo(INFO_ENVELOPE, '1.0.0-rc.9');
    expect(info.source).toBe('info');
    expect(info.protocols.cli).toBe('1.2');
  });

  test('derives from --version when info is absent (the rc.9-today path)', () => {
    const info = resolveInfo('command not recognized', '1.0.0-rc.9');
    expect(info.source).toBe('derived');
    expect(supports(info, 'jsonEnvelope')).toBe(true);
  });

  test('reports unavailable when the toolchain could not be reached at all', () => {
    const info = resolveInfo(null, null);
    expect(info.source).toBe('unavailable');
    expect(enabledCapabilities(info)).toHaveLength(0);
  });
});

describe('toolchain — protocol gating end to end', () => {
  const support: Record<ProtocolName, ProtocolSupport> = {
    cli: { major: 1 },
    lsp: { major: 1 },
    dap: { major: 1 },
    projectManifest: { major: 1 },
  };

  test('a same-major toolchain is compatible', () => {
    const info = deriveInfo('1.0.0-rc.9');
    const checks = checkProtocols(info, support);
    expect(checks.every((c) => c.verdict === 'ok')).toBe(true);
    expect(toolchainCompatible(checks)).toBe(true);
  });

  test('a toolchain on a newer protocol major is flagged unsupported', () => {
    const info = parseInfoEnvelope(INFO_ENVELOPE)!; // projectManifest "2"
    const checks = checkProtocols(info, support);
    const manifest = checks.find((c) => c.name === 'projectManifest')!;
    expect(manifest.verdict).toBe('unsupported');
    expect(toolchainCompatible(checks)).toBe(false);
  });

  test('an unavailable toolchain supports nothing', () => {
    expect(supports(unavailableInfo(), 'testing')).toBe(false);
  });
});

/* ---- the verbatim `zornux capabilities --json` from the real rc.9 binary ---- */
const REAL_RC9_CAPABILITIES = `{
  "zornuxJson": 1, "ok": true, "command": "capabilities",
  "result": {
    "productVersion": "1.0.0-rc.9",
    "protocols": { "cli": "1.0", "lsp": "1.0", "dap": "1.0", "projectManifest": "1.0" },
    "capabilities": {
      "semanticTokens": true, "securityDiagnostics": true, "advisoryAudit": true,
      "cpuProfiling": true, "heapSnapshots": true, "allocationTracking": true,
      "allocationStacks": true, "profileTimestamps": true, "gcStats": true, "timeline": true,
      "remoteDebug": true, "exceptionBreakpoints": true, "docGeneration": true,
      "packageManagement": true, "testing": true, "database": true, "deployment": true,
      "jsonEnvelope": true, "formatting": true, "disassemble": true
    }
  },
  "diagnostics": []
}`;

describe('toolchain — real rc.9 capabilities capture (contract fixture)', () => {
  test('the authoritative envelope parses and is fully compatible', () => {
    const info = parseInfoEnvelope(REAL_RC9_CAPABILITIES)!;
    expect(info.source).toBe('info');
    expect(info.productVersion).toBe('1.0.0-rc.9');
    expect(info.protocols).toEqual({ cli: '1.0', lsp: '1.0', dap: '1.0', projectManifest: '1.0' });
    expect(supports(info, 'securityDiagnostics')).toBe(true);
    expect(supports(info, 'jsonEnvelope')).toBe(true);
    expect(supports(info, 'remoteDebug')).toBe(true);
    expect(enabledCapabilities(info)).toHaveLength(20);
    expect(toolchainCompatible(checkProtocols(info, ZNXSTUDIO_PROTOCOL_SUPPORT))).toBe(true);
  });

  test('the derive-fallback for the same version agrees on the gated capabilities', () => {
    // Today's binary has no `capabilities` command, so ZnxStudio derives from --version.
    const derived = deriveInfo('1.0.0-rc.9');
    const real = parseInfoEnvelope(REAL_RC9_CAPABILITIES)!;
    for (const key of ['jsonEnvelope', 'advisoryAudit', 'allocationStacks', 'gcStats', 'securityDiagnostics']) {
      expect(supports(derived, key)).toBe(supports(real, key));
    }
  });
});

describe('toolchain — ToolchainClient facade', () => {
  function fakeInfo(overrides: Partial<ZornuxInfo> = {}): ZornuxInfo {
    return { ...parseInfoEnvelope(REAL_RC9_CAPABILITIES)!, ...overrides };
  }

  test('caches the probe and only re-fetches on refresh', async () => {
    let calls = 0;
    const client = new ToolchainClient(async () => {
      calls += 1;
      return fakeInfo();
    });
    await client.info();
    await client.info();
    expect(calls).toBe(1);
    await client.info(true);
    expect(calls).toBe(2);
  });

  test('supports() delegates to the negotiated capabilities', async () => {
    const client = new ToolchainClient(async () => fakeInfo());
    expect(await client.supports('heapSnapshots')).toBe(true);
    expect(await client.supports('nonexistentThing')).toBe(false);
  });

  test('a failed probe degrades to unavailable, never throws', async () => {
    const client = new ToolchainClient(async () => {
      throw new Error('bridge missing');
    });
    const info = await client.info();
    expect(info.source).toBe('unavailable');
    expect(await client.supports('testing')).toBe(false);
    expect(await client.compatible()).toBe(true); // unavailable ⇒ baseline protocols ⇒ no major mismatch
  });
});

describe('toolchain — capability guard (IL-C gating)', () => {
  test('a present capability is enabled with no reason', () => {
    const info = deriveInfo('1.0.0-rc.9');
    expect(capabilityStatus(info, 'gcStats', 'GC stats')).toEqual({ enabled: true, reason: null });
  });

  test('an absent capability on a real toolchain names the version and the capability', () => {
    const info = deriveInfo('1.0.0-rc.3'); // predates gcStats
    const status = capabilityStatus(info, 'gcStats', 'GC stats');
    expect(status.enabled).toBe(false);
    expect(status.reason).toContain('1.0.0-rc.3');
    expect(status.reason).toContain('gcStats');
  });

  test('an unavailable toolchain says no toolchain was found', () => {
    const status = capabilityStatus(unavailableInfo(), 'cpuProfiling', 'CPU profiling');
    expect(status.enabled).toBe(false);
    expect(status.reason).toContain('no Zornux toolchain');
  });

  test('capabilityEnabled gates a bare flag; null info reads as supported (pre-gating behavior)', () => {
    expect(capabilityEnabled(deriveInfo('1.0.0-rc.9'), 'allocationStacks')).toBe(true);
    expect(capabilityEnabled(deriveInfo('1.0.0-rc.3'), 'allocationStacks')).toBe(false);
    expect(capabilityEnabled(null, 'allocationStacks')).toBe(true);
    expect(capabilityEnabled(undefined, 'gcStats')).toBe(true);
  });
});

describe('toolchain — compatibility evaluation (IL-E)', () => {
  test('a same-major toolchain (real rc.9) is fully compatible', () => {
    const compat = evaluateToolchain(parseInfoEnvelope(REAL_RC9_CAPABILITIES)!);
    expect(compat.status).toBe('ok');
    expect(compat.incompatible).toEqual([]);
    expect(isUsable(compat.status)).toBe(true);
    expect(compat.summary).toContain('fully compatible');
  });

  test('a toolchain on a different protocol major is unsupported and names the surface', () => {
    // projectManifest "2" — a breaking major gap.
    const info: ZornuxInfo = {
      ...parseInfoEnvelope(REAL_RC9_CAPABILITIES)!,
      protocols: { cli: '1.0', lsp: '1.0', dap: '1.0', projectManifest: '2.0' },
    };
    const compat = evaluateToolchain(info);
    expect(compat.status).toBe('unsupported');
    expect(compat.incompatible).toEqual(['projectManifest']);
    expect(compat.summary).toContain('projectManifest');
    expect(isUsable(compat.status)).toBe(false);
  });

  test('an unavailable toolchain reports unavailable, not unsupported', () => {
    const compat = evaluateToolchain(unavailableInfo());
    expect(compat.status).toBe('unavailable');
    expect(compat.summary).toContain('No Zornux toolchain');
  });

  test('the compatibility matrix declares the current generation', () => {
    expect(COMPATIBILITY_MATRIX[0]).toEqual({ znxstudio: '1.0', cli: '1.x', lsp: '1.x', dap: '1.x', projectManifest: '1.x' });
  });
});

describe('toolchain — protocol adapters (IL-E)', () => {
  test('selects the V1 adapter for a generation-1 CLI protocol', () => {
    const adapter = selectAdapter(parseInfoEnvelope(REAL_RC9_CAPABILITIES)!);
    expect(adapter).toBe(ProtocolV1Adapter);
    expect(adapter?.cliMajor).toBe(1);
  });

  test('an unknown CLI protocol major has no shipped adapter (→ unsupported)', () => {
    const info: ZornuxInfo = {
      ...parseInfoEnvelope(REAL_RC9_CAPABILITIES)!,
      protocols: { cli: '2.0', lsp: '1.0', dap: '1.0', projectManifest: '1.0' },
    };
    expect(selectAdapter(info)).toBeNull();
    expect(PROTOCOL_ADAPTERS).toHaveLength(1);
  });
});

describe('toolchain — multi-toolchain resolution (IL-F)', () => {
  test('path precedence is workspace → system → bundled', () => {
    expect(resolveToolchainPath({ workspace: 'C:/ws/zornux.exe', system: 'C:/sys/zornux.exe' }).source).toBe('workspace');
    expect(resolveToolchainPath({ workspace: '  ', system: 'C:/sys/zornux.exe' }).source).toBe('system');
    expect(resolveToolchainPath({ system: null, bundled: 'C:/bundled/zornux.exe' }).source).toBe('bundled');
    expect(resolveToolchainPath({}).source).toBe('none');
  });

  test('candidates are reported in order for a picker', () => {
    const resolution = resolveToolchainPath({ workspace: 'C:/ws/z.exe', system: 'C:/sys/z.exe' });
    expect(resolution.path).toBe('C:/ws/z.exe');
    expect(resolution.candidates.map((c) => c.source)).toEqual(['workspace', 'system', 'bundled']);
  });

  test('a version pin is a MINIMUM: newer satisfies, older is a mismatch', () => {
    expect(evaluatePin('1.0.0-rc.4', '1.0.0-rc.9')).toBe('satisfied');
    expect(evaluatePin('1.0.0-rc.9', '1.0.0-rc.4')).toBe('older');
    expect(evaluatePin('1.0.0-rc.4', null)).toBe('unknown');
    expect(evaluatePin(null, '1.0.0-rc.9')).toBe('none');
  });

  test('describePin only speaks up on a real mismatch, and never implies auto-switching', () => {
    expect(describePin(null, '1.0.0-rc.9')).toBeNull();
    expect(describePin('1.0.0-rc.4', '1.0.0-rc.9')).toBeNull(); // satisfied
    const older = describePin('1.0.0-rc.9', '1.0.0-rc.4')!;
    expect(older).toContain("won't switch");
    expect(describePin('1.0.0', null)).toContain('no toolchain version could be read');
  });

  test('the manifest parser reads an optional toolchain pin', () => {
    expect(parseZornuxManifest('name = demo\nversion = 1.0.0\ntoolchain = 1.0.0-rc.9\n').toolchain).toBe('1.0.0-rc.9');
    expect(parseZornuxManifest('name = demo\nversion = 1.0.0\n').toolchain).toBeNull();
  });
});

describe('toolchain — offline / incompatible mode (IL-G)', () => {
  test('a usable toolchain drives full mode; a missing/incompatible one drops to basic', () => {
    expect(editorMode('ok')).toBe('full');
    expect(editorMode('degraded')).toBe('full');
    expect(editorMode('unsupported')).toBe('basic');
    expect(editorMode('unavailable')).toBe('basic');
  });

  test('full mode has no explanation; basic mode explains why and reassures basic editing stays', () => {
    expect(offlineExplanation('ok', '1.0.0-rc.9')).toBeNull();
    expect(offlineExplanation('degraded', '1.0.0-rc.9')).toBeNull();

    const noToolchain = offlineExplanation('unavailable', null)!;
    expect(noToolchain).toContain('no Zornux toolchain was found');
    expect(noToolchain).toContain(BUILTIN_FEATURES[1]); // syntax highlighting stays

    const incompatible = offlineExplanation('unsupported', '2.0.0')!;
    expect(incompatible).toContain('unsupported protocol');
    expect(incompatible).toContain('2.0.0');
    expect(incompatible).toContain('bracket matching');
  });
});
