import { describe, expect, test } from './harness';
import {
  activationMatches,
  isEngineCompatible,
  parseExtensionManifest,
  SDK_VERSION,
} from '../src/shared/extensions/manifest';

const VALID = {
  name: 'Hello World',
  publisher: 'acme',
  version: '1.2.3',
  engines: { znxstudio: '^1.0.0' },
  activationEvents: ['onStartup', 'onCommand:acme.hello-world.say'],
  permissions: ['commands', 'statusBar'],
  contributes: { commands: [{ command: 'acme.hello-world.say', title: 'Say Hello' }] },
};

describe('parseExtensionManifest', () => {
  test('accepts a valid manifest and derives the id', () => {
    const result = parseExtensionManifest(VALID);
    expect(result.ok).toBe(true);
    expect(result.manifest!.id).toBe('acme.hello-world');
    expect(result.manifest!.contributes.commands).toHaveLength(1);
  });
  test('requires name, publisher, and a semver version', () => {
    const result = parseExtensionManifest({ name: '', publisher: '', version: 'x', engines: { znxstudio: '*' } });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(2);
  });
  test('rejects a command not namespaced under the id', () => {
    const result = parseExtensionManifest({ ...VALID, contributes: { commands: [{ command: 'other.cmd', title: 'X' }] } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('namespaced'))).toBe(true);
  });
  test('rejects an unknown permission', () => {
    const result = parseExtensionManifest({ ...VALID, permissions: ['commands', 'root'] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('permission'))).toBe(true);
  });
  test('rejects a malformed activation event', () => {
    const result = parseExtensionManifest({ ...VALID, activationEvents: ['whenever'] });
    expect(result.ok).toBe(false);
  });
  test('requires engines.znxstudio', () => {
    const result = parseExtensionManifest({ name: 'A', publisher: 'b', version: '1.0.0' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('engines.znxstudio'))).toBe(true);
  });
});

describe('isEngineCompatible', () => {
  test('caret matches same major and >= base', () => {
    expect(isEngineCompatible('^1.0.0', '1.4.2')).toBe(true);
    expect(isEngineCompatible('^1.5.0', '1.4.2')).toBe(false);
    expect(isEngineCompatible('^2.0.0', '1.9.9')).toBe(false);
  });
  test('wildcard and empty always match', () => {
    expect(isEngineCompatible('*', '1.0.0')).toBe(true);
    expect(isEngineCompatible('', '1.0.0')).toBe(true);
  });
  test('>= and exact', () => {
    expect(isEngineCompatible('>=1.0.0', '1.0.0')).toBe(true);
    expect(isEngineCompatible('>=1.1.0', '1.0.0')).toBe(false);
    expect(isEngineCompatible('1.0.0', '1.0.0')).toBe(true);
    expect(isEngineCompatible('1.0.0', '1.0.1')).toBe(false);
  });
  test('the built-in sample targets the current SDK', () => {
    expect(isEngineCompatible('^1.0.0', SDK_VERSION)).toBe(true);
  });
});

describe('activationMatches', () => {
  test('matches exact events and the wildcard', () => {
    expect(activationMatches(['onStartup'], 'onStartup')).toBe(true);
    expect(activationMatches(['onCommand:x'], 'onStartup')).toBe(false);
    expect(activationMatches(['*'], 'onStartup')).toBe(true);
  });
});
