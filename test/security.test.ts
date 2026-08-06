import { describe, expect, test } from './harness';
import {
  auditWindowPreferences,
  HARDENED_WEB_PREFERENCES,
  isAllowedNavigation,
  isSafeExternalUrl,
  SECURITY_CHECKLIST,
  windowOpenDecision,
} from '../src/shared/security';

describe('security posture (20C)', () => {
  test('the ACTUAL hardened web preferences pass the audit', () => {
    // The app uses HARDENED_WEB_PREFERENCES verbatim, so this asserts reality.
    expect(auditWindowPreferences(HARDENED_WEB_PREFERENCES)).toEqual([]);
    expect(HARDENED_WEB_PREFERENCES.contextIsolation).toBe(true);
    expect(HARDENED_WEB_PREFERENCES.nodeIntegration).toBe(false);
    expect(HARDENED_WEB_PREFERENCES.sandbox).toBe(true);
    expect(HARDENED_WEB_PREFERENCES.webSecurity).toBe(true);
  });

  test('the audit flags every insecure switch', () => {
    const findings = auditWindowPreferences({ contextIsolation: false, nodeIntegration: true, sandbox: false, webSecurity: false });
    expect(findings.map((f) => f.id).sort()).toEqual(['contextIsolation', 'nodeIntegration', 'sandbox', 'webSecurity']);
  });

  test('external URLs are restricted to http(s)', () => {
    expect(isSafeExternalUrl('https://znxstudio.dev')).toBe(true);
    expect(isSafeExternalUrl('http://localhost:3000')).toBe(true);
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
  });

  test('navigation is allowed only to the app’s own file:// page', () => {
    expect(isAllowedNavigation('file:///C:/app/renderer/index.html')).toBe(true);
    expect(isAllowedNavigation('https://evil.example')).toBe(false);
    expect(isAllowedNavigation('http://127.0.0.1:5500')).toBe(false);
  });

  test('window.open is always denied; a safe URL is routed to the OS browser', () => {
    const external = windowOpenDecision('https://znxstudio.dev');
    expect(external.action).toBe('deny');
    expect(external.externalUrl).toBe('https://znxstudio.dev');

    const unsafe = windowOpenDecision('file:///etc/passwd');
    expect(unsafe.action).toBe('deny');
    expect(unsafe.externalUrl).toBeNull();
  });

  test('the posture checklist covers the core hardening items', () => {
    const ids = SECURITY_CHECKLIST.map((item) => item.id);
    for (const id of ['contextIsolation', 'nodeIntegration', 'webSecurity', 'csp', 'navigation', 'windowOpen', 'externalUrls', 'toolAllowlist']) {
      expect(ids.includes(id)).toBe(true);
    }
  });
});
