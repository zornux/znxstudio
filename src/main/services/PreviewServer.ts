import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { injectPreviewHtml } from '../../shared/zoijsPreview';
import type { PreviewProxy, PreviewStartResult } from '../../shared/types';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

/**
 * A tiny static file server for Live Preview (Phase 6G). Serves a workspace
 * folder over http (no-build Zoijs needs http + ESM + import maps, which file://
 * cannot do), with correct MIME types for ESM. When serving HTML it injects the
 * DevTools bridge (6F) so the DevTools panel goes live. Loopback-only; path
 * traversal is blocked; a single server at a time. Never throws to the renderer.
 */
export class PreviewServer {
  private server: Server | null = null;
  private root: string | null = null;
  private url: string | null = null;
  private proxy: PreviewProxy | null = null;
  private generation = 0;

  async start(rootDir: string, proxy?: PreviewProxy): Promise<PreviewStartResult> {
    await this.stop();
    const generation = ++this.generation;

    let root = resolve(rootDir);
    try {
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) return { ok: false, error: `${root} is not a directory.` };
      root = await fs.realpath(root);
    } catch {
      return { ok: false, error: `Folder not found: ${root}` };
    }
    const requestProxy = proxy ?? null;

    return new Promise<PreviewStartResult>((resolvePromise) => {
      const server = createServer((req, res) => void this.handle(root, requestProxy, req, res));
      server.once('error', (error) => resolvePromise({ ok: false, error: (error as Error).message }));
      server.listen(0, '127.0.0.1', () => {
        if (generation !== this.generation) {
          server.close();
          resolvePromise({ ok: false, error: 'Preview start was superseded by a newer request.' });
          return;
        }
        const port = (server.address() as AddressInfo).port;
        this.server = server;
        this.root = root;
        this.url = `http://127.0.0.1:${port}/`;
        this.proxy = requestProxy;
        resolvePromise({ ok: true, url: this.url, root });
      });
    });
  }

  async stop(): Promise<void> {
    this.generation += 1;
    const server = this.server;
    this.server = null;
    this.root = null;
    this.url = null;
    this.proxy = null;
    if (server) await new Promise<void>((r) => server.close(() => r()));
  }

  private async handle(root: string, proxy: PreviewProxy | null, req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    const rawUrl = req.url ?? '/';

    // Route matching-prefix requests to the backend (full-stack dev proxy, 6H).
    if (proxy && this.matchesProxy(rawUrl, proxy.prefix)) {
      this.forward(req, res, proxy, rawUrl);
      return;
    }

    // Decode + strip query/hash, resolve within root (block path traversal).
    let pathname = '/';
    try {
      pathname = decodeURIComponent(new URL(rawUrl, 'http://127.0.0.1').pathname);
    } catch {
      pathname = '/';
    }
    let target = normalize(join(root, pathname));
    if (target !== root && !target.startsWith(root + sep)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    try {
      let stat = await fs.stat(target).catch(() => null);
      if (stat?.isDirectory()) {
        target = join(target, 'index.html');
        stat = await fs.stat(target).catch(() => null);
      }
      if (!stat?.isFile()) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      // Lexical checks alone do not contain symlinks. Resolve the final file and
      // reject links that leave the preview root before reading any content.
      const realTarget = await fs.realpath(target);
      if (realTarget !== root && !realTarget.startsWith(root + sep)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }
      target = realTarget;

      const ext = extname(target).toLowerCase();
      res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
      if (ext === '.html') {
        const html = await fs.readFile(target, 'utf8');
        res.statusCode = 200;
        res.end(injectPreviewHtml(html));
      } else {
        res.statusCode = 200;
        res.end(await fs.readFile(target));
      }
    } catch (error) {
      res.statusCode = 500;
      res.end(`Preview error: ${(error as Error).message}`);
    }
  }

  private matchesProxy(rawUrl: string, prefix: string): boolean {
    const path = rawUrl.split('?')[0];
    return path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
  }

  /** Forward a request to the backend, preserving method/headers/body (streamed). */
  private forward(req: IncomingMessage, res: ServerResponse, proxy: PreviewProxy, rawUrl: string): void {
    let target: URL;
    try {
      target = new URL(proxy.target);
    } catch {
      res.statusCode = 502;
      res.end('Invalid proxy target');
      return;
    }
    // Strip the prefix; keep the remainder + query. "/api/x?y" with prefix "/api" → "/x?y".
    const rest = rawUrl.slice(proxy.prefix.length) || '/';
    const upstreamPath = (target.pathname === '/' ? '' : target.pathname.replace(/\/$/, '')) + (rest.startsWith('/') ? rest : `/${rest}`);

    const proxied = httpRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: upstreamPath,
        headers: { ...req.headers, host: target.host },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxied.on('error', (error) => {
      res.statusCode = 502;
      res.end(`Proxy error: ${(error as Error).message}`);
    });
    req.pipe(proxied);
  }
}
