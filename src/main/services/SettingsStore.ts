import { safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFile } from '../util/atomicWrite';

const CONFIG_DIR = join(homedir(), '.znxstudio');
const CONFIG_FILE = join(CONFIG_DIR, 'settings.json');

/**
 * Settings keys whose values are secrets and must never sit in plaintext on disk.
 * Their values are encrypted at rest with the OS keychain (Electron safeStorage)
 * and transparently decrypted on read, so the renderer only ever sees plaintext.
 */
const SECRET_KEYS = ['ai.apiKey'];
const ENC_PREFIX = 'enc:v1:';

function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false; // e.g. not called from the main process / no OS keyring
  }
}

/** Encrypt a secret value for storage; falls back to plaintext if OS encryption is unavailable. */
function encryptSecret(value: unknown): unknown {
  if (typeof value !== 'string' || value === '' || value.startsWith(ENC_PREFIX)) return value;
  if (!encryptionAvailable()) return value; // no worse than the previous behaviour
  try {
    return ENC_PREFIX + safeStorage.encryptString(value).toString('base64');
  } catch {
    return value;
  }
}

/** Decrypt a stored secret; plaintext (pre-encryption / fallback) passes through unchanged. */
function decryptSecret(value: unknown): unknown {
  if (typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) return value;
  if (!encryptionAvailable()) return ''; // can't decrypt here — present empty, never the ciphertext
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'));
  } catch {
    return '';
  }
}

/**
 * File-backed settings persistence at ~/.znxstudio/settings.json. The renderer
 * owns the schema/defaults; this store reads and writes the raw JSON and, for the
 * few SECRET_KEYS, encrypts their values at rest via the OS keychain.
 */
export class SettingsStore {
  filePath(): string {
    return CONFIG_FILE;
  }

  async read(): Promise<Record<string, unknown>> {
    try {
      const raw = await fs.readFile(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      const out = parsed as Record<string, unknown>;
      for (const key of SECRET_KEYS) {
        if (key in out) out[key] = decryptSecret(out[key]);
      }
      return out;
    } catch {
      return {};
    }
  }

  async write(settings: Record<string, unknown>): Promise<void> {
    const out: Record<string, unknown> = { ...settings };
    for (const key of SECRET_KEYS) {
      if (key in out) out[key] = encryptSecret(out[key]);
    }
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    // Atomic write: a crash mid-save must never corrupt settings.json (a corrupt
    // config would otherwise reset every preference on next boot).
    await atomicWriteFile(CONFIG_FILE, `${JSON.stringify(out, null, 2)}\n`);
  }
}
