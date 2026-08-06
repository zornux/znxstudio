import { describe, expect, test } from './harness';
import type { DeploymentContext } from '../src/renderer/core/Contracts';
import { generateManifests, k8sName, parseKubectlGet } from '../src/renderer/deploy/kubernetes';

const CTX: DeploymentContext = {
  projectName: 'Demo App',
  root: 'C:/p',
  entry: 'main.zx',
  environment: 'production',
  registry: 'ghcr.io/acme',
  port: 8080,
  envVars: { LEVEL: 'high' },
};

describe('k8sName', () => {
  test('produces a DNS-1123-safe name', () => {
    expect(k8sName(CTX)).toBe('demo-app');
    expect(k8sName({ ...CTX, projectName: 'My_Cool.App!' })).toBe('my-cool-app');
  });
});

describe('generateManifests', () => {
  test('renders a Deployment and a Service', () => {
    const yaml = generateManifests(CTX);
    expect(yaml).toContain('kind: Deployment');
    expect(yaml).toContain('kind: Service');
    expect(yaml).toContain('---'); // multi-doc separator
    expect(yaml).toContain('name: demo-app');
    expect(yaml).toContain('image: ghcr.io/acme/demo-app:latest');
    expect(yaml).toContain('containerPort: 8080');
    expect(yaml).toContain('targetPort: 8080');
  });
  test('2 replicas in production, 1 otherwise, and env vars render', () => {
    expect(generateManifests(CTX)).toContain('replicas: 2');
    expect(generateManifests({ ...CTX, environment: 'staging' })).toContain('replicas: 1');
    const yaml = generateManifests(CTX);
    expect(yaml).toContain('- name: LEVEL');
    expect(yaml).toContain('value: "high"');
  });
  test('no env block when there are no env vars', () => {
    expect(generateManifests({ ...CTX, envVars: {} }).includes('- name: LEVEL')).toBe(false);
  });
});

describe('parseKubectlGet', () => {
  test('parses the pod table and skips the header', () => {
    const pods = parseKubectlGet('NAME       READY   STATUS    RESTARTS   AGE\nweb-1      1/1     Running   0          5m\nweb-2      0/1     Pending   0          3s');
    expect(pods).toHaveLength(2);
    expect(pods[0]).toEqual({ name: 'web-1', ready: '1/1', status: 'Running', restarts: '0', age: '5m' });
    expect(pods[1].status).toBe('Pending');
  });
});
