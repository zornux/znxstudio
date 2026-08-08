import { describe, expect, test } from './harness';
import { FsRollbackController, noopRollbackController, type RollbackIo } from '../src/main/services/rollback';

const ARTIFACT = '/install/ZnxStudio.AppImage';

/** An in-memory filesystem that models existence, the record file, and copies. */
function harness(artifactPath: string | null = ARTIFACT) {
  const exists = new Set<string>(artifactPath ? [artifactPath] : []);
  const files = new Map<string, string>();
  const relaunched: string[] = [];
  let chmods = 0;
  const io: RollbackIo = {
    existsSync: (p) => exists.has(p),
    readFileSync: (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error('ENOENT ' + p);
      return v;
    },
    writeFileSync: (p, d) => { files.set(p, d); exists.add(p); },
    copyFileSync: (s, d) => {
      if (!exists.has(s)) throw new Error('ENOENT ' + s);
      exists.add(d);
      files.set(d, files.get(s) ?? `<binary:${s}>`);
    },
    renameSync: (s, d) => {
      if (!exists.has(s)) throw new Error('ENOENT ' + s);
      exists.add(d);
      files.set(d, files.get(s) ?? `<binary:${s}>`);
      exists.delete(s);
      files.delete(s);
    },
    mkdirSync: (p) => exists.add(p),
    rmSync: (p) => { exists.delete(p); files.delete(p); },
    chmod: () => { chmods += 1; },
  };
  const controller = new FsRollbackController({
    stateDir: '/state',
    artifactPath,
    platform: 'linux',
    io,
    relaunch: (execPath) => relaunched.push(execPath),
    now: () => '2026-01-01T00:00:00.000Z',
  });
  return { controller, io, exists, relaunched, chmods: () => chmods };
}

describe('FsRollbackController', () => {
  test('prepare snapshots the artifact and records the rollback point', () => {
    const { controller, io } = harness();
    expect(controller.prepare('1.0.0-rc.1', '1.0.0-rc.2')).toBe(true);
    const record = controller.available('1.0.0-rc.2');
    expect(record?.previousVersion).toBe('1.0.0-rc.1');
    expect(record?.updatedToVersion).toBe('1.0.0-rc.2');
    expect(record?.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(io.existsSync(record!.backupPath)).toBe(true);
  });

  test('a point is valid only while the version it was made for runs', () => {
    const { controller } = harness();
    controller.prepare('1.0.0-rc.1', '1.0.0-rc.2');
    // Running the OLD version means the update never took → invalid, and discarded.
    expect(controller.available('1.0.0-rc.1')).toBe(null);
    expect(controller.available('1.0.0-rc.2')).toBe(null);
  });

  test('perform restores the snapshot, relaunches, and clears the point', () => {
    const { controller, io, relaunched, chmods } = harness();
    controller.prepare('1.0.0-rc.1', '1.0.0-rc.2');
    const backup = controller.available('1.0.0-rc.2')!.backupPath;
    expect(controller.perform('1.0.0-rc.2')).toBe(true);
    expect(relaunched).toEqual([ARTIFACT]);
    expect(chmods()).toBe(1);
    // Consumed: both the record and the snapshot are gone.
    expect(io.existsSync(backup)).toBe(false);
    expect(controller.available('1.0.0-rc.2')).toBe(null);
  });

  test('perform is a no-op when nothing was prepared', () => {
    const { controller, relaunched } = harness();
    expect(controller.perform('1.0.0-rc.2')).toBe(false);
    expect(relaunched.length).toBe(0);
  });

  test('preparing again keeps only the most recent snapshot', () => {
    const { controller, io } = harness();
    controller.prepare('1.0.0-rc.1', '1.0.0-rc.2');
    const first = controller.available('1.0.0-rc.2')!.backupPath;
    controller.prepare('1.0.0-rc.2', '1.0.0-rc.3');
    expect(io.existsSync(first)).toBe(false);
    expect(controller.available('1.0.0-rc.3')?.previousVersion).toBe('1.0.0-rc.2');
  });

  test('an unsupported install form (no artifact) never offers rollback', () => {
    const { controller } = harness(null);
    expect(controller.prepare('1.0.0', '1.1.0')).toBe(false);
    expect(controller.available('1.1.0')).toBe(null);
  });
});

describe('noopRollbackController', () => {
  test('does nothing and never offers a rollback', () => {
    expect(noopRollbackController.prepare('a', 'b')).toBe(false);
    expect(noopRollbackController.available('b')).toBe(null);
    expect(noopRollbackController.perform('b')).toBe(false);
    noopRollbackController.clear();
  });
});
