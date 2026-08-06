import { describe, expect, test } from './harness';
import {
  COMPILER_DIAGNOSTIC_SOURCE,
  LIVE_SECURITY_CAVEAT,
  SECURITY_DIAGNOSTIC_SOURCE,
  buildConfigurationChange,
  buildZornuxSettings,
  isSecurityDiagnostic,
  partitionDiagnostics,
  securityRuleIds,
  splitSecurityMessage,
} from '../src/renderer/language/lsp/lspSecurity';
import type { LspRawDiagnostic } from '../src/shared/types';

function diagnostic(overrides: Partial<LspRawDiagnostic> = {}): LspRawDiagnostic {
  return {
    range: { start: { line: 1, character: 17 }, end: { line: 1, character: 37 } },
    severity: 1,
    code: 'ZX3701',
    source: SECURITY_DIAGNOSTIC_SOURCE,
    message: 'A secret is written directly into the call.\nRead it from configuration instead.',
    ...overrides,
  };
}

describe('buildZornuxSettings', () => {
  test('security is the setting the server reads, and it is explicit either way', () => {
    expect(buildZornuxSettings(true)).toEqual({ security: true });
    expect(buildZornuxSettings(false)).toEqual({ security: false });
  });

  test('maxProblems is included only when it is a positive number', () => {
    expect(buildZornuxSettings(true, 50)).toEqual({ security: true, maxProblems: 50 });
    expect(buildZornuxSettings(true, 0)).toEqual({ security: true });
  });
});

describe('buildConfigurationChange', () => {
  test('nests under settings.zornux, where OnDidChangeConfiguration looks', () => {
    expect(buildConfigurationChange({ security: true })).toEqual({ settings: { zornux: { security: true } } });
  });
});

describe('isSecurityDiagnostic', () => {
  test('the server stamps zornux-security on a finding and zornux on a diagnostic', () => {
    expect(SECURITY_DIAGNOSTIC_SOURCE).toBe('zornux-security');
    expect(COMPILER_DIAGNOSTIC_SOURCE).toBe('zornux');
    expect(isSecurityDiagnostic(diagnostic())).toBe(true);
    expect(isSecurityDiagnostic(diagnostic({ source: COMPILER_DIAGNOSTIC_SOURCE }))).toBe(false);
  });

  test('a diagnostic with no source is not a security finding', () => {
    expect(isSecurityDiagnostic(diagnostic({ source: undefined }))).toBe(false);
  });
});

describe('partitionDiagnostics', () => {
  test('splits one published batch into its two buckets', () => {
    const { compiler, security } = partitionDiagnostics([
      diagnostic({ source: COMPILER_DIAGNOSTIC_SOURCE, code: 'ZX0111' }),
      diagnostic(),
      diagnostic({ code: 'ZX3707' }),
    ]);
    expect(compiler).toHaveLength(1);
    expect(compiler[0].code).toBe('ZX0111');
    expect(security).toHaveLength(2);
  });

  test('a batch with no findings still yields an empty security bucket, so it can be cleared', () => {
    const { compiler, security } = partitionDiagnostics([diagnostic({ source: COMPILER_DIAGNOSTIC_SOURCE })]);
    expect(compiler).toHaveLength(1);
    expect(security).toHaveLength(0);
  });

  test('an empty batch splits into two empty buckets', () => {
    expect(partitionDiagnostics([])).toEqual({ compiler: [], security: [] });
  });
});

describe('securityRuleIds', () => {
  test('the rule id rides in code, exactly as it does on a CLI finding', () => {
    expect(securityRuleIds([diagnostic({ code: 'ZX3707' }), diagnostic(), diagnostic()])).toEqual(['ZX3701', 'ZX3707']);
  });

  test('compiler diagnostics contribute no rule ids', () => {
    expect(securityRuleIds([diagnostic({ source: COMPILER_DIAGNOSTIC_SOURCE, code: 'ZX0111' })])).toHaveLength(0);
  });
});

describe('splitSecurityMessage', () => {
  test('the suggested fix follows the message after a newline', () => {
    expect(splitSecurityMessage(diagnostic().message)).toEqual({
      message: 'A secret is written directly into the call.',
      suggestedFix: 'Read it from configuration instead.',
    });
  });

  test('a message with no fix reports none rather than an empty string', () => {
    expect(splitSecurityMessage('just a message')).toEqual({ message: 'just a message', suggestedFix: null });
  });

  test('a trailing newline does not become a blank fix', () => {
    expect(splitSecurityMessage('message\n   ').suggestedFix).toBeNull();
  });
});

describe('LIVE_SECURITY_CAVEAT', () => {
  test('names both ways the live findings differ from the build', () => {
    expect(LIVE_SECURITY_CAVEAT).toContain('authored severity');
    expect(LIVE_SECURITY_CAVEAT).toContain('dependency advisories');
    expect(LIVE_SECURITY_CAVEAT).toContain('Security scan');
  });
});
