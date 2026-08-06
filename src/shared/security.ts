/**
 * Security posture (Phase 20C) — the pure, shared model.
 *
 * One place that declares ZnxStudio's hardening requirements and the small pure
 * decisions that enforce them (which web preferences are safe, what navigation /
 * window-open is allowed, whether an external URL may be handed to the OS
 * browser). The main process applies these; tests assert against the SAME
 * constants the app actually uses, so the audit can't drift from reality.
 */

/** http(s) only — never file:, javascript:, data:, etc. handed to the OS browser. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** The renderer's locked-down web preferences (minus the env-specific preload path). */
export interface HardenedWebPreferences {
  contextIsolation: boolean;
  nodeIntegration: boolean;
  sandbox: boolean;
  webSecurity: boolean;
  spellcheck: boolean;
}

export const HARDENED_WEB_PREFERENCES: HardenedWebPreferences = {
  contextIsolation: true, // renderer & preload run in separate worlds
  nodeIntegration: false, // no require()/process in the renderer
  sandbox: true, // OS-level renderer sandbox; the preload uses only ipcRenderer/contextBridge
  webSecurity: true, // explicit — same-origin + CSP enforced, never disabled
  spellcheck: false,
};

export interface SecurityFinding {
  id: string;
  message: string;
}

/** Fail the audit if a required hardening switch is wrong. */
export function auditWindowPreferences(prefs: Partial<HardenedWebPreferences>): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  if (prefs.contextIsolation !== true) {
    findings.push({ id: 'contextIsolation', message: 'contextIsolation must be true' });
  }
  if (prefs.nodeIntegration !== false) {
    findings.push({ id: 'nodeIntegration', message: 'nodeIntegration must be false' });
  }
  if (prefs.sandbox !== true) {
    findings.push({ id: 'sandbox', message: 'sandbox must be true' });
  }
  if (prefs.webSecurity === false) {
    findings.push({ id: 'webSecurity', message: 'webSecurity must not be disabled' });
  }
  return findings;
}

/** Only the app's own file:// pages may load in the main window. */
export function isAllowedNavigation(url: string): boolean {
  return url.startsWith('file://');
}

/**
 * Decide what a `window.open` / `target=_blank` should do: NEVER open a new
 * in-app window; a safe http(s) URL is handed to the OS browser instead.
 */
export function windowOpenDecision(url: string): { action: 'deny'; externalUrl: string | null } {
  return { action: 'deny', externalUrl: isSafeExternalUrl(url) ? url : null };
}

export interface SecurityPostureItem {
  id: string;
  requirement: string;
  rationale: string;
}

/** The auditable checklist — the posture 20C reviewed and enforces. */
export const SECURITY_CHECKLIST: SecurityPostureItem[] = [
  { id: 'contextIsolation', requirement: 'contextIsolation: true', rationale: 'Renderer cannot reach preload/Node internals directly.' },
  { id: 'nodeIntegration', requirement: 'nodeIntegration: false', rationale: 'No require()/process in the renderer — a script injection cannot touch the OS.' },
  { id: 'sandbox', requirement: 'sandbox: true', rationale: 'OS-level renderer sandbox — defense in depth beyond contextIsolation.' },
  { id: 'webSecurity', requirement: 'webSecurity: true', rationale: 'Same-origin policy + CSP stay enforced.' },
  { id: 'csp', requirement: "CSP default-src 'self'; script-src 'self'", rationale: 'No remote or inline scripts; blocks XSS payload execution.' },
  { id: 'navigation', requirement: 'will-navigate blocked except file://', rationale: 'Renderer cannot be navigated to a remote origin that would run in-app.' },
  { id: 'windowOpen', requirement: 'window.open denied; safe URLs → OS browser', rationale: 'No unmanaged in-app windows; external links leave the app.' },
  { id: 'externalUrls', requirement: 'openExternal restricted to http(s)', rationale: 'file:/javascript:/data: URLs never handed to the shell.' },
  { id: 'toolAllowlist', requirement: 'subprocess exec restricted to an allowlist', rationale: 'Only vetted CLIs (docker/kubectl/…) can be spawned.' },
];
