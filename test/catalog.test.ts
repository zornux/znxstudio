import { describe, expect, test } from './harness';
import {
  categoryOf,
  describeSource,
  formatProvenance,
  isZornuxCode,
} from '../src/renderer/language/diagnosticCatalog';

describe('diagnostic catalog: categories', () => {
  test('maps codes to their subsystem range', () => {
    expect(categoryOf('ZX0002')).toBe('Lexer');
    expect(categoryOf('ZX0103')).toBe('Parser');
    expect(categoryOf('ZX0700')).toBe('Runtime');
    expect(categoryOf('ZX0900')).toBe('OOP');
    expect(categoryOf('ZX1300')).toBe('Module');
    expect(categoryOf('ZX1400')).toBe('Package');
    expect(categoryOf('ZX3600')).toBe('Deployment');
    expect(categoryOf('ZX4000')).toBe('Semantic Analysis');
    expect(categoryOf('ZX5000')).toBe('Mobile');
    expect(categoryOf('ZX5100')).toBe('Mobile IR');
    expect(categoryOf('ZX5200')).toBe('Android Tooling');
    expect(categoryOf('ZX5300')).toBe('Mobile Capabilities');
    expect(categoryOf('ZX5400')).toBe('Mobile Styling');
    expect(categoryOf('ZX5500')).toBe('Mobile Profiling');
    expect(categoryOf('ZX5700')).toBe('Android Release');
    expect(categoryOf('ZX6100')).toBe('Web Architecture');
  });

  test('returns null for unknown / non-ZX codes', () => {
    expect(categoryOf('ZX9999')).toBeNull();
    expect(categoryOf('no-manifest')).toBeNull();
    expect(categoryOf(undefined)).toBeNull();
  });

  test('recognizes stable ZX codes', () => {
    expect(isZornuxCode('ZX0103')).toBeTruthy();
    expect(isZornuxCode('no-manifest')).toBeFalsy();
    expect(isZornuxCode(undefined)).toBeFalsy();
  });
});

describe('diagnostic catalog: provenance', () => {
  test('labels engine sources by layer', () => {
    expect(describeSource('zornux-compiler')).toBe('Compiler');
    expect(describeSource('zornux-build')).toBe('Build');
    expect(describeSource('zornux-project')).toBe('Project');
    expect(describeSource('zornux')).toBe('Analyzer');
    expect(describeSource('mystery')).toBe('mystery');
    expect(describeSource(undefined)).toBe('');
  });

  test('combines layer + category', () => {
    expect(formatProvenance('zornux-compiler', 'ZX0103')).toBe('Compiler · Parser');
    expect(formatProvenance('zornux-project', 'ZX1300')).toBe('Project · Module');
    expect(formatProvenance('zornux-build', undefined)).toBe('Build');
    expect(formatProvenance(undefined, 'ZX0700')).toBe('Runtime');
    expect(formatProvenance(undefined, undefined)).toBe('');
  });
});
