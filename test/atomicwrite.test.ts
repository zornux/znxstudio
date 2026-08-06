import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from './harness';
import { atomicWriteFile } from '../src/main/util/atomicWrite';

/**
 * Atomic-write durability (Phase 20 reliability fix). The renderer's file writes
 * and settings persistence route through this, so a crash mid-write must never
 * corrupt the target.
 */
describe('atomicWriteFile', () => {
  test('writes the exact content to a fresh path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'znxstudio-atomic-'));
    try {
      const target = join(dir, 'settings.json');
      await atomicWriteFile(target, '{"a":1}\n');
      expect(readFileSync(target, 'utf8')).toBe('{"a":1}\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('overwrites an existing file in place (atomic replace)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'znxstudio-atomic-'));
    try {
      const target = join(dir, 'file.txt');
      await atomicWriteFile(target, 'old');
      await atomicWriteFile(target, 'new-and-longer');
      expect(readFileSync(target, 'utf8')).toBe('new-and-longer');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('leaves no temp files behind on success', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'znxstudio-atomic-'));
    try {
      const target = join(dir, 'x.json');
      await atomicWriteFile(target, 'a');
      await atomicWriteFile(target, 'b');
      // Only the target should remain — no orphaned *.tmp staging files.
      expect(readdirSync(dir)).toEqual(['x.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects and leaves no temp file when the target dir does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'znxstudio-atomic-'));
    try {
      const target = join(dir, 'missing-subdir', 'file.txt');
      let threw = false;
      try {
        await atomicWriteFile(target, 'data');
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
      expect(existsSync(join(dir, 'missing-subdir'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
