import { describe, expect, test } from './harness';
import { interpretPackageOutput } from '../src/shared/packageProtocol';

describe('interpretPackageOutput', () => {
  test('exit 0 is success with the stdout message', () => {
    const result = interpretPackageOutput(0, 'Added MathTools 1.2.0\n', '');
    expect(result.success).toBeTruthy();
    expect(result.message).toBe('Added MathTools 1.2.0');
    expect(result.diagnostics).toHaveLength(0);
  });

  test('exit 0 under --json (no output) is still success', () => {
    const result = interpretPackageOutput(0, '', '');
    expect(result.success).toBeTruthy();
    expect(result.message).toBe('');
  });

  test('parses the --json failure diagnostics array (camelCase)', () => {
    const json = JSON.stringify([
      { code: 'ZP2001', message: "Package 'Nope' was not found.", help: 'check the name' },
      { code: 'ZP2002', message: 'Registry store is not configured.' },
    ]);
    const result = interpretPackageOutput(1, json, '');
    expect(result.success).toBeFalsy();
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0].code).toBe('ZP2001');
    expect(result.diagnostics[0].help).toBe('check the name');
    expect(result.diagnostics[1].help).toBeFalsy();
  });

  test('tolerates PascalCase diagnostic keys', () => {
    const result = interpretPackageOutput(1, JSON.stringify([{ Code: 'ZP1', Message: 'boom' }]), '');
    expect(result.diagnostics[0].code).toBe('ZP1');
    expect(result.diagnostics[0].message).toBe('boom');
  });

  test('falls back to stderr when a failure is not JSON', () => {
    const result = interpretPackageOutput(3, 'not json', 'something broke');
    expect(result.success).toBeFalsy();
    expect(result.diagnostics).toHaveLength(0);
    expect(result.message).toBe('something broke');
  });

  test('failure with no output still yields a message', () => {
    const result = interpretPackageOutput(1, '', '');
    expect(result.success).toBeFalsy();
    expect(result.message).toContain('exit 1');
  });
});
