import { describe, expect, test } from './harness';
import type { DeploymentContext } from '../src/renderer/core/Contracts';
import { CI_PROVIDERS, describeCiProvider, generateCiWorkflow } from '../src/renderer/deploy/cicd';

const CTX: DeploymentContext = {
  projectName: 'demo',
  root: 'C:/p',
  entry: 'main.zx',
  environment: 'production',
  registry: 'ghcr.io/acme',
  port: 8080,
  envVars: {},
};

describe('CI providers', () => {
  test('github and gitlab with correct filenames', () => {
    expect(CI_PROVIDERS.map((p) => p.id)).toEqual(['github', 'gitlab']);
    expect(describeCiProvider('github').filename).toBe('.github/workflows/ci.yml');
    expect(describeCiProvider('gitlab').filename).toBe('.gitlab-ci.yml');
  });
});

describe('generateCiWorkflow — GitHub', () => {
  test('installs zornux, builds, and tests', () => {
    const wf = generateCiWorkflow('github', CTX);
    expect(wf.filename).toBe('.github/workflows/ci.yml');
    expect(wf.content).toContain('actions/checkout@v4');
    expect(wf.content).toContain('zornux build');
    expect(wf.content).toContain('zornux test');
  });
  test('adds a docker build job when a registry is set', () => {
    expect(generateCiWorkflow('github', CTX).content).toContain('docker build -t ghcr.io/acme/demo:latest');
    expect(generateCiWorkflow('github', { ...CTX, registry: '' }).content.includes('docker build')).toBe(false);
  });
});

describe('generateCiWorkflow — GitLab', () => {
  test('has build/test stages and installs the toolchain', () => {
    const wf = generateCiWorkflow('gitlab', CTX);
    expect(wf.filename).toBe('.gitlab-ci.yml');
    expect(wf.content).toContain('stages:');
    expect(wf.content).toContain('install.sh');
    expect(wf.content).toContain('zornux test');
  });
});
