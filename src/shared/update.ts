/**
 * Auto-update model (Phase 20F) — pure, dependency-free.
 *
 * The decision logic for update channels, feed parsing, "is there a newer build",
 * and checksum verification lives here so it can be exhaustively unit-tested
 * against a local/mock feed on any OS. The main process wires this to the actual
 * downloader (electron-updater) in the packaged app; this file makes no network
 * or filesystem calls and never throws on bad input — a malformed or unreachable
 * feed degrades to "no update available".
 */

export type UpdateChannel = 'stable' | 'preview' | 'nightly';

/** Ordered from most to least stable; the index is the "risk tolerance". */
export const UPDATE_CHANNELS: UpdateChannel[] = ['stable', 'preview', 'nightly'];

export function isUpdateChannel(value: unknown): value is UpdateChannel {
  return typeof value === 'string' && UPDATE_CHANNELS.includes(value as UpdateChannel);
}

/** electron-updater feed names used by the GitHub provider. */
export function providerChannel(channel: UpdateChannel): 'latest' | 'rc' | 'nightly' {
  if (channel === 'preview') return 'rc';
  return channel === 'nightly' ? 'nightly' : 'latest';
}

/** Channels a subscriber to `channel` will accept, most-stable first. */
export function eligibleChannels(channel: UpdateChannel): UpdateChannel[] {
  const cutoff = UPDATE_CHANNELS.indexOf(channel);
  return cutoff < 0 ? ['stable'] : UPDATE_CHANNELS.slice(0, cutoff + 1);
}

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** e.g. `rc.2`, `nightly.20260101`; absent for a final release. */
  prerelease: string | null;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseSemVer(value: string): SemVer | null {
  const match = SEMVER_RE.exec((value ?? '').trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function comparePrerelease(a: string | null, b: string | null): number {
  if (a === b) return 0;
  // A final release outranks any prerelease of the same x.y.z.
  if (a === null) return 1;
  if (b === null) return -1;
  const as = a.split('.');
  const bs = b.split('.');
  for (let i = 0; i < Math.max(as.length, bs.length); i += 1) {
    const x = as[i];
    const y = bs[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = Number(x);
    const yn = Number(y);
    const bothNumeric = !Number.isNaN(xn) && !Number.isNaN(yn);
    if (bothNumeric) return xn < yn ? -1 : 1;
    return x < y ? -1 : 1; // lexical for identifiers
  }
  return 0;
}

/** -1 if a < b, 0 if equal, 1 if a > b. Unparseable versions sort lowest. */
export function compareSemVer(a: string, b: string): number {
  const pa = parseSemVer(a);
  const pb = parseSemVer(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

export interface UpdateRelease {
  channel: UpdateChannel;
  version: string;
  url: string;
  sha512: string;
  size?: number;
  notes?: string;
}

/**
 * Parse a mock/real update feed into per-channel releases. Tolerant: unknown
 * channels, releases missing version/url/sha512, and non-object input are all
 * dropped rather than throwing.
 */
export function parseUpdateFeed(raw: unknown): Partial<Record<UpdateChannel, UpdateRelease>> {
  const out: Partial<Record<UpdateChannel, UpdateRelease>> = {};
  if (!raw || typeof raw !== 'object') return out;
  const channels = (raw as { channels?: unknown }).channels;
  if (!channels || typeof channels !== 'object') return out;

  for (const channel of UPDATE_CHANNELS) {
    const entry = (channels as Record<string, unknown>)[channel];
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const version = typeof record.version === 'string' ? record.version : null;
    const url = typeof record.url === 'string' ? record.url : null;
    const sha512 = typeof record.sha512 === 'string' ? record.sha512 : null;
    if (!version || !url || !sha512 || !parseSemVer(version)) continue; // incomplete → skip
    out[channel] = {
      channel,
      version,
      url,
      sha512,
      size: typeof record.size === 'number' ? record.size : undefined,
      notes: typeof record.notes === 'string' ? record.notes : undefined,
    };
  }
  return out;
}

/** The newest release across the channels a subscriber accepts, or null. */
export function bestRelease(
  feed: Partial<Record<UpdateChannel, UpdateRelease>>,
  channel: UpdateChannel,
): UpdateRelease | null {
  let best: UpdateRelease | null = null;
  for (const eligible of eligibleChannels(channel)) {
    const release = feed[eligible];
    if (release && (!best || compareSemVer(release.version, best.version) > 0)) best = release;
  }
  return best;
}

export interface UpdateCheck {
  available: boolean;
  release: UpdateRelease | null;
  /** The parsed reason, for logging / the update UI. */
  reason: 'up-to-date' | 'update-available' | 'no-feed';
}

/**
 * Decide whether a newer build exists for the subscriber's channel. A missing /
 * malformed feed yields `no-feed` (never an error), so the app just stays put.
 */
export function checkForUpdate(
  currentVersion: string,
  feed: Partial<Record<UpdateChannel, UpdateRelease>>,
  channel: UpdateChannel,
): UpdateCheck {
  const release = bestRelease(feed, channel);
  if (!release) return { available: false, release: null, reason: 'no-feed' };
  const available = compareSemVer(release.version, currentVersion) > 0;
  return { available, release, reason: available ? 'update-available' : 'up-to-date' };
}

/** Which channel a version publishes to, derived from its prerelease tag. */
export function channelForVersion(version: string): UpdateChannel {
  const parsed = parseSemVer(version);
  const tag = parsed?.prerelease?.toLowerCase() ?? '';
  if (tag.startsWith('nightly')) return 'nightly';
  if (tag.startsWith('rc') || tag.startsWith('beta') || tag.startsWith('alpha') || tag.startsWith('preview')) {
    return 'preview';
  }
  return 'stable';
}

export interface ReleaseArtifact {
  name: string;
  sha512: string;
  size: number;
}

export interface ReleaseManifest {
  product: string;
  version: string;
  channel: UpdateChannel;
  releaseDate: string;
  files: ReleaseArtifact[];
}

/**
 * Build the release manifest a publish step writes next to the artifacts. Pure —
 * a CI script computes the sha512/size and passes them in; `releaseDate` is
 * injected (never read from the clock here, so it stays deterministic/testable).
 */
export function buildReleaseManifest(options: {
  product: string;
  version: string;
  releaseDate: string;
  artifacts: ReleaseArtifact[];
}): ReleaseManifest {
  return {
    product: options.product,
    version: options.version,
    channel: channelForVersion(options.version),
    releaseDate: options.releaseDate,
    files: [...options.artifacts].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Runtime update lifecycle (Phase 20J WI3). */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'downloading'
  | 'downloaded'
  | 'no-feed'
  | 'error';

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  channel: UpdateChannel;
  release: UpdateRelease | null;
  /** Download progress 0–100 while phase is 'downloading'. */
  percent?: number;
  error?: string;
  /** True when a real in-app install is possible (electron-updater present). */
  canInstall: boolean;
  /** True when a previous version was snapshotted and can be restored. */
  canRollback: boolean;
  /** The version a rollback would restore, or null when none is available. */
  rollbackVersion: string | null;
}

/** Constant-time-ish equality is unnecessary here; a checksum is not a secret. */
export function verifyChecksum(expectedSha512: string, actualSha512: string): boolean {
  return (
    typeof expectedSha512 === 'string' &&
    typeof actualSha512 === 'string' &&
    expectedSha512.trim().toLowerCase() === actualSha512.trim().toLowerCase() &&
    expectedSha512.trim().length > 0
  );
}
