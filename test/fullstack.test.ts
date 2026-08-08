import { describe, expect, test } from './harness';
import {
  backendUsesServe,
  buildProxy,
  isFullStackWorkspace,
  parseServeLine,
  resolveFullStack,
} from '../src/renderer/preview/fullstack';
import type { WorkspaceInfo } from '../src/shared/types';

function workspace(overrides: Partial<WorkspaceInfo>): WorkspaceInfo {
  return {
    root: 'C:\\proj',
    isZnxStudioProject: true,
    project: null,
    detectedType: 'generic',
    diagnostics: [],
    ...overrides,
  };
}

describe('isFullStackWorkspace', () => {
  test('true for a fullstack detected type', () => {
    expect(isFullStackWorkspace(workspace({ detectedType: 'zornux-zoijs-fullstack' }))).toBeTruthy();
  });

  test('true when targets include both zornux and zoijs', () => {
    const info = workspace({
      detectedType: 'generic',
      project: { name: 'x', type: '', version: '1', scripts: undefined, languageTargets: ['zornux'], frameworkTargets: ['zoijs'], extensionRequirements: undefined, workspace: undefined },
    });
    expect(isFullStackWorkspace(info)).toBeTruthy();
  });

  test('false for a frontend-only workspace', () => {
    expect(isFullStackWorkspace(workspace({ detectedType: 'zoijs-frontend' }))).toBeFalsy();
    expect(isFullStackWorkspace(null)).toBeFalsy();
  });
});

describe('resolveFullStack', () => {
  test('backend is src/main.zx; frontend is web/ when it has an index', () => {
    // Subpaths use forward slashes so the layout is correct on every OS (Windows accepts /).
    const layout = resolveFullStack('/home/u/proj', true);
    expect(layout.backendEntry).toBe('/home/u/proj/src/main.zx');
    expect(layout.frontendDir).toBe('/home/u/proj/web');
    // A Windows-style root keeps its drive but still joins subpaths with /.
    expect(resolveFullStack('C:\\proj', true).backendEntry).toBe('C:\\proj/src/main.zx');
  });

  test('frontend falls back to the root without a web index', () => {
    expect(resolveFullStack('/home/u/proj/', false).frontendDir).toBe('/home/u/proj');
  });
});

describe('backendUsesServe', () => {
  test('detects a published service', () => {
    expect(backendUsesServe('service X\nend\npublish X on port 8080')).toBeTruthy();
    expect(backendUsesServe('show "hello"')).toBeFalsy();
  });
});

describe('parseServeLine (real zornux serve output)', () => {
  test('extracts the endpoint from either announce line', () => {
    expect(parseServeLine('Zornux serving on http://localhost:8080/').url).toBe('http://localhost:8080/');
    expect(parseServeLine('Listening on http://localhost:8080/').url).toBe('http://localhost:8080/');
  });

  test('parses a service + port line', () => {
    expect(parseServeLine('Service Greeter on port 8080').service).toEqual({ name: 'Greeter', port: 8080 });
  });

  test('parses an indented route line', () => {
    expect(parseServeLine('  GET    /greeting').route).toEqual({ method: 'GET', path: '/greeting' });
  });

  test('a plain line yields nothing', () => {
    expect(parseServeLine('Press Ctrl+C to stop.')).toEqual({});
  });
});

describe('buildProxy', () => {
  test('strips the trailing slash and defaults the prefix to /api', () => {
    expect(buildProxy('http://localhost:8080/')).toEqual({ prefix: '/api', target: 'http://localhost:8080' });
    expect(buildProxy('http://localhost:8080', '/backend')).toEqual({ prefix: '/backend', target: 'http://localhost:8080' });
  });
});
