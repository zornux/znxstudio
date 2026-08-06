import { createServer, connect, type Server, type Socket } from 'node:net';

/**
 * The collaboration transport (Phase 16A).
 *
 * There is no ZnxStudio cloud. A session is served by the HOST'S OWN IDE over a
 * plain TCP socket: the host binds a port, guests connect straight to it, and
 * the host process is the authority. Nothing is relayed and nothing leaves the
 * machine unless the host deliberately binds a non-loopback address — which
 * `host()` reports back so the UI can say so.
 *
 * The wire format is newline-delimited JSON. Every frame is one object; a frame
 * larger than `MAX_FRAME_BYTES` closes the connection rather than growing a
 * buffer without bound.
 *
 * Authentication is a single shared token, checked on the first frame. Traffic
 * is NOT encrypted: this is a loopback/trusted-LAN tool, exactly like the
 * debug adapter's TCP mode, and the UI says as much.
 */

const MAX_FRAME_BYTES = 1_000_000;
const HANDSHAKE_TIMEOUT_MS = 5_000;

export interface CollabHostOptions {
  token: string;
  /** Defaults to loopback. Pass `0.0.0.0` to expose the session on the LAN. */
  host?: string;
  /** 0 asks the OS for a free port, which `host()` then reports. */
  port?: number;
}

export interface CollabHostResult {
  ok: boolean;
  host?: string;
  port?: number;
  loopbackOnly?: boolean;
  error?: string;
}

export interface CollabJoinOptions {
  host: string;
  port: number;
  token: string;
  name: string;
}

export interface CollabJoinResult {
  ok: boolean;
  error?: string;
}

/** A frame delivered to the renderer, tagged with the peer it came from. */
export interface CollabMessage {
  peerId: string;
  payload: unknown;
}

export interface CollabEvents {
  onMessage(message: CollabMessage): void;
  onPeerJoined(peerId: string, name: string): void;
  onPeerLeft(peerId: string): void;
  onClosed(reason: string): void;
}

interface Peer {
  id: string;
  socket: Socket;
  name: string;
  authenticated: boolean;
  buffer: string;
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export class CollabService {
  private server: Server | null = null;
  private client: Socket | null = null;
  private clientBuffer = '';
  private token = '';
  private readonly peers = new Map<string, Peer>();
  private nextPeerId = 1;

  constructor(private readonly events: CollabEvents) {}

  isHosting(): boolean {
    return this.server !== null;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  /** Bind a port and accept guests. Never throws; failures come back as `ok: false`. */
  async host(options: CollabHostOptions): Promise<CollabHostResult> {
    if (this.server) return { ok: false, error: 'already hosting a session' };
    if (!options.token) return { ok: false, error: 'a session token is required' };

    const address = options.host ?? '127.0.0.1';
    this.token = options.token;

    return new Promise<CollabHostResult>((resolve) => {
      const server = createServer((socket) => this.acceptPeer(socket));
      server.once('error', (error: Error) => {
        this.server = null;
        resolve({ ok: false, error: error.message });
      });
      server.listen(options.port ?? 0, address, () => {
        this.server = server;
        const bound = server.address();
        if (bound === null || typeof bound === 'string') {
          resolve({ ok: false, error: 'the socket did not report a bound address' });
          return;
        }
        resolve({ ok: true, host: address, port: bound.port, loopbackOnly: isLoopback(address) });
      });
    });
  }

  private acceptPeer(socket: Socket): void {
    const id = `peer-${this.nextPeerId++}`;
    const peer: Peer = { id, socket, name: id, authenticated: false, buffer: '' };
    this.peers.set(id, peer);

    // A peer that never authenticates must not hold a socket open forever.
    const timer = setTimeout(() => {
      if (!peer.authenticated) this.dropPeer(peer, 'handshake timed out');
    }, HANDSHAKE_TIMEOUT_MS);

    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.readFrames(peer, chunk));
    socket.on('error', () => this.dropPeer(peer, 'socket error'));
    socket.on('close', () => {
      clearTimeout(timer);
      if (this.peers.delete(id) && peer.authenticated) this.events.onPeerLeft(id);
    });
  }

  private readFrames(peer: Peer, chunk: string): void {
    peer.buffer += chunk;
    if (peer.buffer.length > MAX_FRAME_BYTES) {
      this.dropPeer(peer, 'frame too large');
      return;
    }
    let newline = peer.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = peer.buffer.slice(0, newline);
      peer.buffer = peer.buffer.slice(newline + 1);
      this.handleFrame(peer, line);
      newline = peer.buffer.indexOf('\n');
    }
  }

  private handleFrame(peer: Peer, line: string): void {
    if (!line.trim()) return;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.dropPeer(peer, 'malformed frame');
      return;
    }

    if (!peer.authenticated) {
      // The first frame must be the handshake, and must carry the right token.
      if (frame.type !== 'hello' || typeof frame.token !== 'string' || !this.tokenMatches(frame.token)) {
        this.send(peer.socket, { type: 'denied', reason: 'invalid token' });
        this.dropPeer(peer, 'invalid token');
        return;
      }
      peer.authenticated = true;
      peer.name = typeof frame.name === 'string' ? frame.name : peer.id;
      this.send(peer.socket, { type: 'welcome', peerId: peer.id });
      this.events.onPeerJoined(peer.id, peer.name);
      return;
    }

    this.events.onMessage({ peerId: peer.id, payload: frame });
  }

  private tokenMatches(provided: string): boolean {
    if (provided.length !== this.token.length) return false;
    let difference = 0;
    for (let i = 0; i < provided.length; i += 1) difference |= provided.charCodeAt(i) ^ this.token.charCodeAt(i);
    return difference === 0;
  }

  private dropPeer(peer: Peer, reason: string): void {
    if (!this.peers.has(peer.id)) return;
    this.peers.delete(peer.id);
    peer.socket.destroy();
    if (peer.authenticated) this.events.onPeerLeft(peer.id);
    else this.events.onClosed(`peer rejected: ${reason}`);
  }

  /** Connect to a session someone else is hosting. */
  async join(options: CollabJoinOptions): Promise<CollabJoinResult> {
    if (this.client) return { ok: false, error: 'already connected to a session' };

    return new Promise<CollabJoinResult>((resolve) => {
      let settled = false;
      const socket = connect({ host: options.host, port: options.port }, () => {
        this.client = socket;
        this.send(socket, { type: 'hello', token: options.token, name: options.name });
      });
      socket.setEncoding('utf8');

      socket.on('data', (chunk: string) => {
        this.clientBuffer += chunk;
        if (this.clientBuffer.length > MAX_FRAME_BYTES) {
          socket.destroy();
          return;
        }
        let newline = this.clientBuffer.indexOf('\n');
        while (newline >= 0) {
          const line = this.clientBuffer.slice(0, newline);
          this.clientBuffer = this.clientBuffer.slice(newline + 1);
          newline = this.clientBuffer.indexOf('\n');
          if (!line.trim()) continue;

          let frame: Record<string, unknown>;
          try {
            frame = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (!settled && frame.type === 'welcome') {
            settled = true;
            resolve({ ok: true });
          } else if (!settled && frame.type === 'denied') {
            settled = true;
            resolve({ ok: false, error: String(frame.reason ?? 'denied') });
          }
          this.events.onMessage({ peerId: 'host', payload: frame });
        }
      });

      socket.on('error', (error: Error) => {
        this.client = null;
        if (!settled) {
          settled = true;
          resolve({ ok: false, error: error.message });
        } else {
          this.events.onClosed(error.message);
        }
      });
      socket.on('close', () => {
        this.client = null;
        this.clientBuffer = '';
        if (settled) this.events.onClosed('the session ended');
      });
    });
  }

  /** Broadcast to every authenticated guest (host), or to the host (guest). */
  broadcast(payload: unknown): void {
    if (this.client) this.send(this.client, payload);
    for (const peer of this.peers.values()) {
      if (peer.authenticated) this.send(peer.socket, payload);
    }
  }

  /** Send to one guest by peer id. */
  sendTo(peerId: string, payload: unknown): void {
    const peer = this.peers.get(peerId);
    if (peer?.authenticated) this.send(peer.socket, payload);
  }

  private send(socket: Socket, payload: unknown): void {
    if (socket.destroyed) return;
    socket.write(`${JSON.stringify(payload)}\n`);
  }

  /** Tear everything down. Safe to call when nothing is running. */
  leave(): void {
    for (const peer of this.peers.values()) peer.socket.destroy();
    this.peers.clear();
    this.client?.destroy();
    this.client = null;
    this.clientBuffer = '';
    this.server?.close();
    this.server = null;
    this.token = '';
  }
}
