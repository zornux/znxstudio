import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FileNode } from '../../shared/types';
import { atomicWriteFile } from '../util/atomicWrite';

/**
 * Thin, safe wrapper over the filesystem. Returns directory listings sorted
 * directories-first, and reads/writes UTF-8 text. Directory reads are shallow;
 * the explorer expands lazily.
 */
export class FileSystemService {
  async readDirectory(dirPath: string): Promise<FileNode[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nodes: FileNode[] = entries
      .filter((entry) => !entry.name.startsWith('.') || entry.name === '.gitignore')
      .map((entry) => ({
        name: entry.name,
        path: join(dirPath, entry.name),
        type: entry.isDirectory() ? 'directory' : 'file',
      }));

    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf8');
  }

  /** Whether `dirPath` still exists as a directory. Never throws. */
  async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /** Whether a path exists at all (file or directory). Never throws. */
  async pathExists(p: string): Promise<boolean> {
    try {
      await fs.stat(p);
      return true;
    } catch {
      return false;
    }
  }

  /** Create a directory (and any missing parents). */
  async createDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  /** Rename/move a file or directory. */
  async rename(from: string, to: string): Promise<void> {
    await fs.rename(from, to);
  }

  /** Delete a file or directory (recursively). */
  async delete(target: string): Promise<void> {
    await fs.rm(target, { recursive: true, force: true });
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(dirname(filePath), { recursive: true });
    // Atomic write so a crash mid-save can't truncate/corrupt the user's file.
    await atomicWriteFile(filePath, content);
  }
}
