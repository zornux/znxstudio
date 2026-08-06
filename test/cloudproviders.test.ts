import { describe, expect, test } from './harness';
import type { DeploymentContext } from '../src/renderer/core/Contracts';
import {
  buildDeployCommand,
  CLOUD_PROVIDERS,
  describeCloudProvider,
  formatDeployCommand,
  generateProviderConfig,
} from '../src/renderer/deploy/cloudProviders';

const CTX: DeploymentContext = {
  projectName: 'Demo App',
  root: 'C:/p',
  entry: 'main.zx',
  environment: 'production',
  registry: 'ghcr.io/acme',
  port: 8080,
  envVars: {},
};

describe('provider registry', () => {
  test('includes none + real clouds + custom', () => {
    const ids = CLOUD_PROVIDERS.map((p) => p.id);
    expect(ids).toContain('none');
    expect(ids).toContain('fly');
    expect(ids).toContain('gcp');
    expect(ids).toContain('custom');
    expect(describeCloudProvider('fly').cli).toBe('flyctl');
  });
});

describe('generateProviderConfig', () => {
  test('fly.toml uses the app name and port', () => {
    const config = generateProviderConfig('fly', CTX)!;
    expect(config.filename).toBe('fly.toml');
    expect(config.content).toContain('app = "demo-app"');
    expect(config.content).toContain('internal_port = 8080');
  });
  test('render.yaml is a docker web service', () => {
    expect(generateProviderConfig('render', CTX)!.content).toContain('runtime: docker');
  });
  test('railway.json is valid JSON with a Dockerfile builder', () => {
    const parsed = JSON.parse(generateProviderConfig('railway', CTX)!.content);
    expect(parsed.build.builder).toBe('DOCKERFILE');
    expect(parsed.deploy.startCommand).toBe('zornux run main.zx');
  });
  test('aws apprunner.yaml sets the port', () => {
    expect(generateProviderConfig('aws', CTX)!.content).toContain('port: 8080');
  });
  test('providers without a config file return null', () => {
    expect(generateProviderConfig('gcp', CTX)).toBeNull();
    expect(generateProviderConfig('none', CTX)).toBeNull();
  });
});

describe('buildDeployCommand', () => {
  test('gcp deploys to Cloud Run with the image', () => {
    const cmd = buildDeployCommand('gcp', CTX)!;
    expect(cmd.tool).toBe('gcloud');
    expect(formatDeployCommand(cmd)).toContain('run deploy demo-app --image ghcr.io/acme/demo-app:latest --port 8080');
  });
  test('azure and fly and railway have commands; render/none do not', () => {
    expect(buildDeployCommand('azure', CTX)!.tool).toBe('az');
    expect(buildDeployCommand('fly', CTX)!.tool).toBe('flyctl');
    expect(buildDeployCommand('railway', CTX)!.tool).toBe('railway');
    expect(buildDeployCommand('render', CTX)).toBeNull();
    expect(buildDeployCommand('none', CTX)).toBeNull();
  });
});
