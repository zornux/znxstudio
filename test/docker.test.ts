import { describe, expect, test } from './harness';
import type { DeploymentContext } from '../src/renderer/core/Contracts';
import {
  generateDockerfile,
  generateDockerignore,
  imageTag,
  parseDockerImages,
  parseDockerPs,
} from '../src/renderer/deploy/docker';

const CTX: DeploymentContext = {
  projectName: 'demo',
  root: 'C:/p',
  entry: 'main.zx',
  environment: 'production',
  registry: 'ghcr.io/acme',
  port: 9000,
  envVars: { API_KEY: 'secret', LEVEL: 'high' },
};

describe('generateDockerfile', () => {
  test('is a multi-stage build that compiles and runs with zornux', () => {
    const df = generateDockerfile(CTX);
    expect(df).toContain('AS build');
    expect(df).toContain('AS runtime');
    expect(df).toContain('RUN zornux build');
    expect(df).toContain('EXPOSE 9000');
    expect(df).toContain('CMD ["zornux", "run", "main.zx"]');
  });
  test('emits ENV lines for each env var', () => {
    const df = generateDockerfile(CTX);
    expect(df).toContain('ENV API_KEY="secret"');
    expect(df).toContain('ENV LEVEL="high"');
    expect(df).toContain('ZORNUX_ENV=production');
  });
  test('no ENV block when there are no env vars', () => {
    const df = generateDockerfile({ ...CTX, envVars: {} });
    expect(df.includes('ENV API_KEY')).toBe(false);
  });
});

describe('imageTag', () => {
  test('prefixes the registry and uses latest for production', () => {
    expect(imageTag(CTX)).toBe('ghcr.io/acme/demo:latest');
    expect(imageTag({ ...CTX, environment: 'staging' })).toBe('ghcr.io/acme/demo:staging');
    expect(imageTag({ ...CTX, registry: '' })).toBe('demo:latest');
  });
});

describe('generateDockerignore', () => {
  test('ignores git, build output, and secrets', () => {
    const di = generateDockerignore();
    expect(di).toContain('.git');
    expect(di).toContain('dist');
    expect(di).toContain('.env');
    expect(di).toContain('*.zxbc');
  });
});

describe('docker output parsing', () => {
  test('parseDockerPs reads tab-separated rows', () => {
    const rows = parseDockerPs('abc\tdemo:latest\tUp 3 minutes\tweb\n\ndef\tredis\tUp 1 hour\tcache');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: 'abc', image: 'demo:latest', status: 'Up 3 minutes', name: 'web' });
  });
  test('parseDockerImages reads repo/tag/id/size', () => {
    const rows = parseDockerImages('ghcr.io/acme/demo\tlatest\tsha1\t120MB');
    expect(rows[0]).toEqual({ repository: 'ghcr.io/acme/demo', tag: 'latest', id: 'sha1', size: '120MB' });
  });
});
