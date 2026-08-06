/**
 * Shared workspace sessions (Phase 16A) — the pure model.
 *
 * HONEST SCOPE. ZnxStudio has no cloud service, and inventing one would mean
 * shipping a fake. A session is therefore a real TCP session that the HOST'S OWN
 * IDE serves: the host binds a socket (loopback by default, or a LAN address on
 * request), guests connect to it directly, and the host is the authority. There
 * is no relay, no account, and nothing leaves the machine unless the host
 * explicitly binds a non-loopback address.
 *
 * The invite therefore carries everything a guest needs and nothing it does not:
 * an address, a port, and a token the host generated for this session.
 */

export type ParticipantRole = 'host' | 'guest';

export interface Participant {
  id: string;
  name: string;
  role: ParticipantRole;
  /** Guests may be admitted read-only; a host never is. */
  readOnly: boolean;
  /** Stable per-participant colour for cursors and the roster. */
  color: string;
  /** The file this participant is looking at, when known. */
  activeFile?: string;
}

export interface SessionInfo {
  sessionId: string;
  host: string;
  port: number;
  /** The shared workspace root on the HOST's machine. */
  root: string;
  token: string;
  participants: Participant[];
  /** False while only loopback is bound — nothing is reachable from the network. */
  loopbackOnly: boolean;
}

/**
 * The cursor palette. Chosen so adjacent participants never share a colour and
 * every one of them is legible on both the light and dark themes.
 */
export const PARTICIPANT_COLORS = ['#e06c75', '#61afef', '#98c379', '#d19a66', '#c678dd', '#56b6c2'] as const;

export function colorForIndex(index: number): string {
  return PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length];
}

/** True when an address is a loopback address, so nothing is exposed to the network. */
export function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/* --------------------------------------------------------------- invites */

export interface Invite {
  host: string;
  port: number;
  token: string;
}

/**
 * `znxstudio://join?host=…&port=…&token=…`. A plain URL so it can be pasted into a
 * chat window; it grants access, so it is a secret in exactly the way a
 * meeting link is.
 */
export function encodeInvite(invite: Invite): string {
  const params = new URLSearchParams({ host: invite.host, port: String(invite.port), token: invite.token });
  return `znxstudio://join?${params.toString()}`;
}

/** Parse an invite. Returns null for anything that is not a well-formed one. */
export function decodeInvite(text: string): Invite | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith('znxstudio://join?')) return null;

  const params = new URLSearchParams(trimmed.slice(trimmed.indexOf('?') + 1));
  const host = params.get('host');
  const port = Number(params.get('port'));
  const token = params.get('token');
  if (!host || !token) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port, token };
}

/**
 * A token for one session. Uses the platform CSPRNG — a session token guards
 * write access to a workspace, so `Math.random` would not do.
 */
export function generateToken(bytes = 16): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return [...buffer].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Constant-time-ish comparison, so a wrong token leaks no timing signal. */
export function tokenMatches(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i += 1) difference |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return difference === 0;
}

/* ---------------------------------------------------------- participants */

export function addParticipant(session: SessionInfo, participant: Omit<Participant, 'color'>): SessionInfo {
  if (session.participants.some((p) => p.id === participant.id)) return session;
  const color = colorForIndex(session.participants.length);
  return { ...session, participants: [...session.participants, { ...participant, color }] };
}

export function removeParticipant(session: SessionInfo, id: string): SessionInfo {
  return { ...session, participants: session.participants.filter((p) => p.id !== id) };
}

export function updateParticipant(session: SessionInfo, id: string, patch: Partial<Participant>): SessionInfo {
  return {
    ...session,
    participants: session.participants.map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)),
  };
}

/** Only the host, and guests not admitted read-only, may write. */
export function canEdit(session: SessionInfo, participantId: string): boolean {
  const participant = session.participants.find((p) => p.id === participantId);
  return participant ? !participant.readOnly : false;
}

export function host(session: SessionInfo): Participant | undefined {
  return session.participants.find((p) => p.role === 'host');
}

/** One line describing the session's exposure, for the UI to show without spin. */
export function exposureSummary(session: SessionInfo): string {
  return session.loopbackOnly
    ? `Loopback only (${session.host}:${session.port}) — reachable from this machine only.`
    : `Bound to ${session.host}:${session.port} — reachable by anyone who can route to this machine and holds the token.`;
}
