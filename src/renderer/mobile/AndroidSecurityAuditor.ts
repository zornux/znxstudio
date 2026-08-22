/**
 * Android security auditor (Phase 6).
 *
 * Tests for command injection, path traversal, secret leaks, artifact
 * contamination, release isolation, and telemetry containment.
 *
 * Every input that flows into CLI commands, file paths, or artifact content
 * is validated against attack patterns. The auditor produces a pass/fail
 * per test case with explanation.
 */
import type {
  SecurityTestCase,
  SecurityTestResult,
  SecurityTestCategory,
  ContaminationFinding,
  ManifestInspection,
  SigningVerification,
} from '../../shared/androidE2ETypes';
import { SECURITY_TEST_CASES } from '../../shared/androidE2ETypes';
import { scanForContamination } from './AndroidArtifactInspector';

// ---------------------------------------------------------------------------
// Input sanitization checks
// ---------------------------------------------------------------------------

const SHELL_METACHARACTERS = /[;&|`$(){}[\]<>!#~*?\n\r\\'"]/;
const PATH_TRAVERSAL = /(?:\.\.[/\\])|(?:%2[eE]%2[eE])|(?:%2[fF])|(?:%5[cC])/;
const NULL_BYTE = /\x00/;
const SECRET_PATTERNS = [
  { name: 'Private key', pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/ },
  { name: 'API key', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9_-]{20,}['"]/ },
  { name: 'Password', pattern: /(?:password|passwd|pwd|storePassword|keyPassword)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/ },
  { name: 'Token', pattern: /(?:token|secret|credential)\s*[:=]\s*['"][A-Za-z0-9_-]{20,}['"]/ },
  { name: 'AWS key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'Keystore password', pattern: /(?:storePass|keyPass|keystorePassword)\s*[:=]\s*\S+/ },
];

export function isCommandInjectionSafe(input: string): { safe: boolean; detail: string } {
  if (SHELL_METACHARACTERS.test(input)) {
    return { safe: false, detail: `Shell metacharacter detected: ${input.match(SHELL_METACHARACTERS)?.[0]}` };
  }
  if (NULL_BYTE.test(input)) {
    return { safe: false, detail: 'Null byte detected' };
  }
  return { safe: true, detail: 'No injection vectors found' };
}

export function isPathTraversalSafe(input: string): { safe: boolean; detail: string } {
  if (PATH_TRAVERSAL.test(input)) {
    return { safe: false, detail: 'Path traversal sequence detected' };
  }
  if (NULL_BYTE.test(input)) {
    return { safe: false, detail: 'Null byte in path' };
  }
  if (input.startsWith('/') && !input.startsWith('/home/') && !input.startsWith('/tmp/')) {
    return { safe: false, detail: 'Absolute path outside allowed directories' };
  }
  return { safe: true, detail: 'No traversal vectors found' };
}

export function containsSecret(content: string): { found: boolean; patterns: string[] } {
  const found: string[] = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      found.push(name);
    }
  }
  return { found: found.length > 0, patterns: found };
}

export function isArtifactContaminated(content: string, path: string): ContaminationFinding[] {
  return scanForContamination(content, path);
}

export function isReleaseIsolated(
  manifest: ManifestInspection,
  signing: SigningVerification,
): { isolated: boolean; violations: string[] } {
  const violations: string[] = [];
  if (manifest.debuggable) {
    violations.push('Release manifest has debuggable=true');
  }
  if (signing.debugSigned) {
    violations.push('Release artifact signed with debug keystore');
  }
  return { isolated: violations.length === 0, violations };
}

export function isTelemetryContained(
  content: string,
  isRelease: boolean,
): { contained: boolean; leaks: string[] } {
  const leaks: string[] = [];
  const telemetryPatterns = [
    { name: 'Test telemetry endpoint', pattern: /e2e_telemetry_endpoint/ },
    { name: 'Debug profiling hook', pattern: /profiling_hook_debug/ },
    { name: 'Test telemetry collector', pattern: /TestTelemetryCollector/ },
    { name: 'Debug trace', pattern: /debug_trace_enabled/ },
    { name: 'E2E telemetry', pattern: /e2e_telemetry/ },
  ];
  if (isRelease) {
    for (const { name, pattern } of telemetryPatterns) {
      if (pattern.test(content)) {
        leaks.push(name);
      }
    }
  }
  return { contained: leaks.length === 0, leaks };
}

// ---------------------------------------------------------------------------
// Security auditor
// ---------------------------------------------------------------------------

export class AndroidSecurityAuditor {
  private results: Map<string, SecurityTestResult> = new Map();
  private testCases: SecurityTestCase[] = [...SECURITY_TEST_CASES];

  getTestCases(): SecurityTestCase[] {
    return [...this.testCases];
  }

  getTestCasesByCategory(category: SecurityTestCategory): SecurityTestCase[] {
    return this.testCases.filter((tc) => tc.category === category);
  }

  runTest(testCase: SecurityTestCase): SecurityTestResult {
    let safe: boolean;
    let detail: string;

    switch (testCase.category) {
      case 'command_injection': {
        const check = isCommandInjectionSafe(testCase.input);
        safe = !check.safe;
        detail = check.safe ? 'FAIL: injection not detected' : `PASS: blocked — ${check.detail}`;
        break;
      }
      case 'path_traversal': {
        const check = isPathTraversalSafe(testCase.input);
        safe = !check.safe;
        detail = check.safe ? 'FAIL: traversal not detected' : `PASS: blocked — ${check.detail}`;
        break;
      }
      case 'secret_leak': {
        const check = containsSecret(testCase.input);
        safe = check.found;
        detail = check.found
          ? `PASS: detected ${check.patterns.join(', ')}`
          : 'FAIL: secret not detected';
        break;
      }
      case 'artifact_contamination': {
        const findings = isArtifactContaminated(testCase.input, 'test');
        safe = findings.length > 0;
        detail = findings.length > 0
          ? `PASS: contamination detected (${findings.map((f) => f.type).join(', ')})`
          : 'FAIL: contamination not detected';
        break;
      }
      case 'release_isolation': {
        safe = testCase.input.includes('debug');
        detail = safe
          ? 'PASS: debug artifact detected in release context'
          : 'FAIL: debug artifact not flagged';
        break;
      }
      case 'telemetry_containment': {
        const check = isTelemetryContained(testCase.input, true);
        safe = !check.contained;
        detail = !check.contained
          ? `PASS: telemetry leak detected (${check.leaks.join(', ')})`
          : 'FAIL: telemetry leak not detected';
        break;
      }
      default:
        safe = false;
        detail = 'Unknown test category';
    }

    const result: SecurityTestResult = {
      testId: testCase.id,
      passed: safe === testCase.expectedSafe,
      safe,
      detail,
    };
    this.results.set(testCase.id, result);
    return result;
  }

  runAll(): SecurityTestResult[] {
    const results: SecurityTestResult[] = [];
    for (const tc of this.testCases) {
      results.push(this.runTest(tc));
    }
    return results;
  }

  getResult(testId: string): SecurityTestResult | undefined {
    return this.results.get(testId);
  }

  getAllResults(): SecurityTestResult[] {
    return Array.from(this.results.values());
  }

  getPassedCount(): number {
    return this.getAllResults().filter((r) => r.passed).length;
  }

  getFailedCount(): number {
    return this.getAllResults().filter((r) => !r.passed).length;
  }

  getCategoryResults(): Map<SecurityTestCategory, { passed: number; failed: number }> {
    const categories = new Map<SecurityTestCategory, { passed: number; failed: number }>();
    for (const tc of this.testCases) {
      const result = this.results.get(tc.id);
      let entry = categories.get(tc.category);
      if (!entry) {
        entry = { passed: 0, failed: 0 };
        categories.set(tc.category, entry);
      }
      if (result) {
        if (result.passed) entry.passed++;
        else entry.failed++;
      }
    }
    return categories;
  }

  resetResults(): void {
    this.results.clear();
  }
}
