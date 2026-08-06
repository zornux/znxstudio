/**
 * Pure full-stack orchestration helpers (Phase 6H). A Zornux + Zoijs full-stack
 * app pairs a Zornux backend (`zornux serve` a program that declares
 * `publish <Service> on port <N>`) with a no-build Zoijs frontend. These helpers
 * detect the layout, decide serve-vs-run, parse the backend's startup output for
 * its endpoint/routes, and build the dev proxy that lets the frontend call the
 * backend same-origin. No DOM.
 */
import type { PreviewProxy, WorkspaceInfo } from '../../shared/types';

export interface FullStackLayout {
  backendEntry: string;
  frontendDir: string;
}

export function isFullStackWorkspace(info: WorkspaceInfo | null): boolean {
  if (!info) return false;
  if (info.detectedType === 'zornux-zoijs-fullstack') return true;
  const langs = (info.project?.languageTargets ?? []).map((l) => l.toLowerCase());
  const frameworks = (info.project?.frameworkTargets ?? []).map((f) => f.toLowerCase());
  return langs.includes('zornux') && frameworks.includes('zoijs');
}

/** Backend = `<root>/src/main.zx`; frontend = `<root>/web` when it has an index.html, else `<root>`. */
export function resolveFullStack(root: string, webHasIndex: boolean): FullStackLayout {
  const base = root.replace(/[\\/]+$/, '');
  return {
    backendEntry: `${base}\\src\\main.zx`,
    frontendDir: webHasIndex ? `${base}\\web` : base,
  };
}

/** A backend program is a web service (use `serve`) when it publishes a service on a port. */
export function backendUsesServe(source: string): boolean {
  return /\bpublish\b[^\n]*\bon\s+port\b/.test(source);
}

export interface ServeLine {
  url?: string;
  service?: { name: string; port: number };
  route?: { method: string; path: string };
}

/**
 * Parse one line of `zornux serve` startup output. Real output:
 *   Zornux serving on http://localhost:8080/
 *   Service Greeter on port 8080
 *     GET    /greeting
 *   Listening on http://localhost:8080/
 */
export function parseServeLine(line: string): ServeLine {
  const endpoint = /(?:Listening on|Zornux serving on)\s+(\S+)/.exec(line);
  if (endpoint) return { url: endpoint[1] };
  const service = /^\s*Service\s+(\S+)\s+on\s+port\s+(\d+)/.exec(line);
  if (service) return { service: { name: service[1], port: Number(service[2]) } };
  const route = /^\s+([A-Z]+)\s+(\/\S*)/.exec(line);
  if (route) return { route: { method: route[1], path: route[2] } };
  return {};
}

/** Build the dev proxy: requests to `prefix` on the preview server go to the backend. */
export function buildProxy(backendUrl: string, prefix = '/api'): PreviewProxy {
  return { prefix, target: backendUrl.replace(/\/+$/, '') };
}
