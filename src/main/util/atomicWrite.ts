import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { promises as fs } from 'node:fs';

/**
 * Crash-safe file write: stage the content in a sibling temp file, fsync it, then
 * atomically rename it over the target. A crash mid-write leaves either the old
 * file intact or the temp file orphaned — never a half-written target. The temp
 * lives in the SAME directory as the target so the rename stays on one volume
 * (a cross-volume rename is a copy, and therefore not atomic).
 *
 * `fs.rename` is atomic-replace on POSIX and, via libuv's MOVEFILE_REPLACE_EXISTING,
 * on Windows too, so this is safe cross-platform.
 */
let seq = 0;

export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${seq++}.tmp`;
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tmp, 'w');
    await handle.writeFile(content, 'utf8');
    await handle.sync(); // durability: the bytes hit disk before the rename
  } finally {
    await handle?.close();
  }
  try {
    await fs.rename(tmp, filePath);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Synchronous counterpart of {@link atomicWriteFile}, for the few writes that must
 * complete during shutdown/crash paths (before-quit, the uncaughtException handler)
 * where the event loop won't drain an async write. Same temp → fsync → atomic-rename
 * guarantee, so a crash mid-write can never leave a half-written/corrupt target.
 */
export function atomicWriteFileSync(filePath: string, content: string): void {
  const tmp = `${filePath}.${process.pid}.${seq++}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(tmp, 'w');
    writeSync(fd, content, null, 'utf8');
    fsyncSync(fd); // durability: bytes hit disk before the rename
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  try {
    renameSync(tmp, filePath);
  } catch (error) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best-effort temp cleanup */
    }
    throw error;
  }
}
