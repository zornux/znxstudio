import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from './harness';
import { confineToRoots } from '../src/main/util/pathBoundary';
import { isSelfTest, setPackaged } from '../src/main/util/selftest';

describe('fs IPC path confinement (pathBoundary)', () => {
  const root = resolve(tmpdir(), 'znx-fs-boundary', 'project');
  const roots = [root];

  test('allows a path inside a workspace root', () => {
    const p = join(root, 'src', 'main.zx');
    expect(confineToRoots(p, roots)).toBe(p);
  });

  test('allows the root itself', () => {
    expect(confineToRoots(root, roots)).toBe(root);
  });

  test('denies a path outside every root', () => {
    const outside = resolve(tmpdir(), 'znx-fs-boundary', 'elsewhere', 'secret.txt');
    expect(confineToRoots(outside, roots)).toBeNull();
  });

  test('denies a traversal escape', () => {
    expect(confineToRoots(join(root, '..', '..', 'id_rsa'), roots)).toBeNull();
  });

  test('denies a sibling that only shares the root string prefix', () => {
    // `${root}-evil` starts with the root text but is NOT a child of root.
    expect(confineToRoots(`${root}-evil`, roots)).toBeNull();
  });

  test('rejects empty / NUL-byte / non-string input', () => {
    expect(confineToRoots('', roots)).toBeNull();
    expect(confineToRoots(join(root, 'a\0b'), roots)).toBeNull();
    expect(confineToRoots(undefined as unknown as string, roots)).toBeNull();
  });

  test('allows any path when no workspace is open (empty roots)', () => {
    const anywhere = resolve(tmpdir(), 'anything.txt');
    expect(confineToRoots(anywhere, [])).toBe(anywhere);
  });
});

describe('self-test flag is dev-only', () => {
  test('honored when unpackaged, ignored in a packaged binary', () => {
    const prev = process.env.ZNXSTUDIO_SELFTEST;
    try {
      process.env.ZNXSTUDIO_SELFTEST = '1';
      setPackaged(false);
      expect(isSelfTest()).toBe(true); // dev/CI
      setPackaged(true);
      expect(isSelfTest()).toBe(false); // shipped binary — flag inert
      setPackaged(false);
      process.env.ZNXSTUDIO_SELFTEST = '0';
      expect(isSelfTest()).toBe(false); // flag not set
    } finally {
      setPackaged(false);
      if (prev === undefined) delete process.env.ZNXSTUDIO_SELFTEST;
      else process.env.ZNXSTUDIO_SELFTEST = prev;
    }
  });
});
