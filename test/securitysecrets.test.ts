import { describe, expect, test } from './harness';
import {
  buildSuppressionComment,
  indentOf,
  isRuleId,
  isSuppressed,
  parseSuppressions,
  unjustifiedSuppressions,
} from '../src/renderer/security/suppression';
import {
  isSecretFinding,
  needsRevocation,
  remediationSnippet,
  secretsOnly,
  secretsSummary,
  suggestedFieldName,
} from '../src/renderer/security/secrets';
import type { SecurityFinding } from '../src/renderer/security/findings';

function finding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    code: 'ZX3701',
    category: 'secrets',
    severity: 'Critical',
    confidence: 'High',
    message: 'A secret is written directly into the call.',
    explanation: "'api_key' carries key material, and it is set to a literal here.",
    suggestedFix: 'Read it from configuration instead.',
    documentationUrl: 'https://zornux.dev/security/rules#zx3701',
    file: 'app.zx',
    startLine: 2,
    startColumn: 18,
    endLine: 2,
    endColumn: 38,
    related: [],
    ...overrides,
  };
}

describe('isRuleId', () => {
  test('a rule id is ZX plus exactly four digits', () => {
    expect(isRuleId('ZX3701')).toBe(true);
    expect(isRuleId('ZX370')).toBe(false);
    expect(isRuleId('zx3701')).toBe(false);
    expect(isRuleId('ZXABCD')).toBe(false);
  });
});

describe('parseSuppressions', () => {
  test('a directive on its own line covers the next line holding code', () => {
    const [suppression] = parseSuppressions('import crypto\n# zornux:suppress ZX3701 fixture key\nshow crypto.hmac("s", "m")\n');
    expect(suppression.ruleId).toBe('ZX3701');
    expect(suppression.line).toBe(3);
    expect(suppression.directiveLine).toBe(2);
    expect(suppression.inline).toBe(false);
    expect(suppression.justification).toBe('fixture key');
  });

  test('a directive written after code covers its own line', () => {
    const [suppression] = parseSuppressions('import crypto\nshow crypto.hmac("s", "m") # zornux:suppress ZX3701 fixture\n');
    expect(suppression.line).toBe(2);
    expect(suppression.inline).toBe(true);
  });

  test('an own-line directive skips blank lines and comments to find the code', () => {
    const [suppression] = parseSuppressions('# zornux:suppress ZX3701 reason\n\n# a note\nshow 1\n');
    expect(suppression.line).toBe(4);
  });

  test('a directive with no justification is parsed but silences nothing', () => {
    const suppressions = parseSuppressions('# zornux:suppress ZX3701\nshow 1\n');
    expect(suppressions).toHaveLength(1);
    expect(isSuppressed(suppressions, 'ZX3701', 2)).toBe(false);
    expect(unjustifiedSuppressions(suppressions)).toHaveLength(1);
  });

  test('a comment that is not a directive is ignored', () => {
    expect(parseSuppressions('# just a comment\nshow 1\n')).toHaveLength(0);
  });

  test('a malformed rule id is ignored', () => {
    expect(parseSuppressions('# zornux:suppress NOPE reason\nshow 1\n')).toHaveLength(0);
  });

  test('a trailing directive with no code after it covers nothing', () => {
    expect(parseSuppressions('show 1\n# zornux:suppress ZX3701 reason\n')).toHaveLength(0);
  });
});

describe('isSuppressed', () => {
  const suppressions = parseSuppressions('# zornux:suppress ZX3701 first is a fixture\nshow crypto.hmac("a", "m")\nshow crypto.hmac("b", "m")\n');

  test('only the covered line is silenced', () => {
    expect(isSuppressed(suppressions, 'ZX3701', 2)).toBe(true);
    expect(isSuppressed(suppressions, 'ZX3701', 3)).toBe(false);
  });

  test('another rule on the same line is not silenced', () => {
    expect(isSuppressed(suppressions, 'ZX3707', 2)).toBe(false);
  });

  test('rule ids match case-insensitively, as the compiler compares them', () => {
    expect(isSuppressed(suppressions, 'zx3701', 2)).toBe(true);
  });
});

describe('buildSuppressionComment', () => {
  test('writes the directive the compiler parses back', () => {
    const comment = buildSuppressionComment('ZX3701', '  test fixture key  ');
    expect(comment).toBe('# zornux:suppress ZX3701 test fixture key');
    const [round] = parseSuppressions(`${comment}\nshow 1\n`);
    expect(round.ruleId).toBe('ZX3701');
    expect(round.justification).toBe('test fixture key');
  });

  test('indentation is preserved so the directive lines up with its code', () => {
    expect(buildSuppressionComment('ZX3702', 'reviewed', '    ')).toBe('    # zornux:suppress ZX3702 reviewed');
  });
});

describe('indentOf', () => {
  test('reads the leading whitespace of a 1-based line', () => {
    expect(indentOf('a\n    show 1\n', 2)).toBe('    ');
    expect(indentOf('show 1\n', 1)).toBe('');
    expect(indentOf('show 1\n', 99)).toBe('');
  });
});

describe('secrets', () => {
  test('the secret rules are ZX3701 and ZX3707, and nothing else', () => {
    expect(isSecretFinding(finding({ code: 'ZX3701' }))).toBe(true);
    expect(isSecretFinding(finding({ code: 'ZX3707' }))).toBe(true);
    expect(isSecretFinding(finding({ code: 'ZX3702' }))).toBe(false);
  });

  test('only a recognizable live credential demands revocation', () => {
    expect(needsRevocation(finding({ code: 'ZX3707' }))).toBe(true);
    expect(needsRevocation(finding({ code: 'ZX3701' }))).toBe(false);
  });

  test('secretsOnly filters a mixed finding list', () => {
    expect(secretsOnly([finding(), finding({ code: 'ZX3703', category: 'resource-leak' })])).toHaveLength(1);
  });

  test('the summary counts each kind and the files they live in', () => {
    const summary = secretsSummary([
      finding({ code: 'ZX3701', file: 'a.zx' }),
      finding({ code: 'ZX3707', file: 'a.zx' }),
      finding({ code: 'ZX3707', file: 'b.zx' }),
      finding({ code: 'ZX3702' }),
    ]);
    expect(summary).toEqual({ total: 3, hardcoded: 1, patterns: 2, needRevocation: 2, files: 2 });
  });
});

describe('suggestedFieldName', () => {
  test('takes the identifier the analyzer quotes in its explanation', () => {
    expect(suggestedFieldName(finding())).toBe('api_key');
  });

  test('falls back to the name the literal was bound to', () => {
    const pattern = finding({ code: 'ZX3707', explanation: 'The value has the exact shape of an AWS access key.' });
    expect(suggestedFieldName(pattern, 'create aws_key = "AKIA…"')).toBe('aws_key');
  });

  test('falls back to a generic name when nothing names it', () => {
    expect(suggestedFieldName(finding({ explanation: 'no identifier here' }))).toBe('secret_value');
  });

  test('a quoted phrase that is not an identifier is rejected', () => {
    expect(suggestedFieldName(finding({ explanation: "'db.open' opens a connection" }))).toBe('secret_value');
  });
});

describe('remediationSnippet', () => {
  test('declares a secret field with no default and reads it with reveal', () => {
    const snippet = remediationSnippet('api_key');
    expect(snippet).toContain('configuration AppConfig');
    expect(snippet).toContain('has api_key as secret');
    expect(snippet).toContain('reveal(settings.api_key)');
  });

  test('the field carries no literal default — that is the whole point', () => {
    expect(remediationSnippet('token').includes(' is ')).toBe(false);
  });
});
