import { describe, expect, test } from './harness';
import {
  classifyStatus,
  CONTEXTUAL_STATUS_IDS,
  HIDDEN_STATUS_IDS,
} from '../src/renderer/statusbar/statusPolicy';

describe('status-bar policy (SB-1)', () => {
  test('feature launchers are hidden', () => {
    for (const id of ['editor.orm', 'editor.ai', 'run.action', 'build.action', 'database.count', 'editor.coverage', 'editor.tests', 'profiler']) {
      expect(classifyStatus(id).level).toBe('hidden');
    }
    expect(HIDDEN_STATUS_IDS.length).toBeGreaterThan(10);
  });

  test('live indicators are contextual and pinned to the right', () => {
    // Build, debug, tasks + the progress-only security/profiler indicators (SB-2).
    for (const id of ['runbuild.status', 'debug', 'tasks.status', 'editor.security', 'editor.perf']) {
      const entry = classifyStatus(id);
      expect(entry.level).toBe('contextual');
      expect(entry.side).toBe('right');
    }
    expect(CONTEXTUAL_STATUS_IDS.includes('zoijs.active')).toBe(true);
  });

  test('essential project/runtime items default to always', () => {
    for (const id of ['app', 'workspace.project', 'editor.activeFile', 'compiler', 'languages', 'profiles.active', 'editor.cursors', 'diagnostics', 'terminal']) {
      expect(classifyStatus(id).level).toBe('always');
    }
  });

  test('unknown / extension ids default to always so third-party segments survive', () => {
    expect(classifyStatus('ext.myPublisher.myExtension').level).toBe('always');
    expect(classifyStatus('something.brand.new').level).toBe('always');
  });

  test('hidden and contextual sets do not overlap', () => {
    const overlap = HIDDEN_STATUS_IDS.filter((id) => CONTEXTUAL_STATUS_IDS.includes(id));
    expect(overlap).toEqual([]);
  });
});
