/**
 * On-disk persistence for installed marketplace extensions, under
 * ~/.znxstudio/extensions/<publisher>/<extension>/<version>/. Every path segment is
 * derived from a validated identifier (never a filename from the artifact), and writes
 * are atomic. Reads are defensive: a malformed/incompatible record is quarantined
 * (skipped) rather than allowed to crash startup.
 */
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFile } from '../util/atomicWrite';
import type { ValidatedExtension } from '../../shared/extensions/registry';

const ROOT = join(homedir(), '.znxstudio', 'extensions');
const SEG_RE = /^[a-z0-9][a-z0-9-]*$/;
const VER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Metadata recorded alongside each installed extension (install.json). */
export interface InstallRecord {
  source: string; // marketplace base host
  publisher: string;
  slug: string;
  version: string;
  sha256: string;
  manifestHash: string;
  extensionHash?: string;
  installedAt: string;
  enabled: boolean;
}

export interface InstalledExtension {
  record: InstallRecord;
  extension: ValidatedExtension;
}

function seg(value: string): string {
  if (!SEG_RE.test(value)) throw new Error(`Unsafe path segment: ${value}`);
  return value;
}
function ver(value: string): string {
  if (!VER_RE.test(value)) throw new Error(`Unsafe version segment: ${value}`);
  return value;
}

export class InstalledExtensionsStore {
  private dirFor(publisher: string, slug: string, version: string): string {
    return join(ROOT, seg(publisher), seg(slug), ver(version));
  }

  /** Atomically persist a validated extension + its metadata. */
  async save(entry: InstalledExtension): Promise<void> {
    const { record, extension } = entry;
    const dir = this.dirFor(record.publisher, record.slug, record.version);
    await fs.mkdir(dir, { recursive: true });
    try {
      await atomicWriteFile(join(dir, 'extension.json'), `${JSON.stringify(extension, null, 2)}\n`);
      await atomicWriteFile(join(dir, 'install.json'), `${JSON.stringify(record, null, 2)}\n`);
    } catch (error) {
      // Roll back a partial write so a half-installed extension never persists.
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** Update the enabled flag for an installed version. */
  async setEnabled(publisher: string, slug: string, version: string, enabled: boolean): Promise<void> {
    const dir = this.dirFor(publisher, slug, version);
    const file = join(dir, 'install.json');
    const record = JSON.parse(await fs.readFile(file, 'utf8')) as InstallRecord;
    record.enabled = enabled;
    await atomicWriteFile(file, `${JSON.stringify(record, null, 2)}\n`);
  }

  /** Remove an installed version (and prune now-empty publisher/extension dirs). */
  async remove(publisher: string, slug: string, version: string): Promise<void> {
    const dir = this.dirFor(publisher, slug, version);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    await fs.rmdir(join(ROOT, seg(publisher), seg(slug))).catch(() => undefined);
    await fs.rmdir(join(ROOT, seg(publisher))).catch(() => undefined);
  }

  /** List every installed extension, skipping (quarantining) any malformed record. */
  async list(): Promise<InstalledExtension[]> {
    const out: InstalledExtension[] = [];
    const publishers = await safeReaddir(ROOT);
    for (const publisher of publishers) {
      const slugs = await safeReaddir(join(ROOT, publisher));
      for (const slug of slugs) {
        const versions = await safeReaddir(join(ROOT, publisher, slug));
        for (const version of versions) {
          const entry = await this.readOne(join(ROOT, publisher, slug, version));
          if (entry) out.push(entry);
        }
      }
    }
    return out;
  }

  private async readOne(dir: string): Promise<InstalledExtension | null> {
    try {
      const record = JSON.parse(await fs.readFile(join(dir, 'install.json'), 'utf8')) as InstallRecord;
      const extension = JSON.parse(await fs.readFile(join(dir, 'extension.json'), 'utf8')) as ValidatedExtension;
      if (!record?.publisher || !record?.slug || !record?.version) return null;
      if (!extension?.id || !extension?.contributions) return null;
      return { record, extension };
    } catch {
      return null; // quarantine: never let a bad record crash startup
    }
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
