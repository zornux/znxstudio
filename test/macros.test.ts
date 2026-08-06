import { describe, expect, test } from './harness';
import {
  MAX_STEP_DELAY_MS,
  MacroRecorder,
  UNRECORDABLE_COMMANDS,
  clampDelay,
  isRecordable,
  macroDurationMs,
  parseMacros,
  removeMacro,
  replayMacro,
  upsertMacro,
  type Macro,
} from '../src/renderer/layout/macros';
import {
  BUILT_IN_PROFILES,
  allProfiles,
  captureProfile,
  findProfile,
  matchesProfile,
  parseProfile,
  parseProfiles,
  removeProfile,
  upsertProfile,
} from '../src/renderer/layout/layoutProfiles';
import { DEFAULT_LAYOUT, LAYOUT_LIMITS, moveSideBar } from '../src/renderer/layout/layoutModel';
import { DEFAULT_PANEL_PREFERENCES } from '../src/renderer/layout/panels';
import { parseUserKeybindings } from '../src/renderer/keybindings/keybindings';

const noSleep = (): Promise<void> => Promise.resolve();

describe('isRecordable', () => {
  test('the recorder cannot record itself', () => {
    expect(isRecordable('znxstudio.macro.startRecording')).toBe(false);
    expect(isRecordable('znxstudio.macro.replay')).toBe(false);
  });

  test('outward-facing and destructive commands are refused', () => {
    expect(isRecordable('znxstudio.scm.commit')).toBe(false);
    expect(isRecordable('znxstudio.deploy.cloudDeployCmd')).toBe(false);
    expect(isRecordable('znxstudio.collab.host')).toBe(false);
  });

  test('ordinary editing commands are recordable', () => {
    expect(isRecordable('znxstudio.fold.all')).toBe(true);
    expect(isRecordable('znxstudio.snippet.insert')).toBe(true);
  });

  test('the refusal list is not empty, and every entry is a command id', () => {
    expect(UNRECORDABLE_COMMANDS.length).toBeGreaterThan(0);
    expect(UNRECORDABLE_COMMANDS.every((command) => command.startsWith('znxstudio.'))).toBe(true);
  });
});

describe('MacroRecorder', () => {
  test('records commands with the gaps between them', () => {
    const recorder = new MacroRecorder();
    recorder.start(1000);
    recorder.record('a', 1000);
    recorder.record('b', 1250);
    const macro = recorder.stop('demo');
    expect(macro?.steps).toEqual([
      { command: 'a', delayMs: 0 },
      { command: 'b', delayMs: 250 },
    ]);
  });

  test('the first step never carries the time spent before it', () => {
    const recorder = new MacroRecorder();
    recorder.start(0);
    recorder.record('a', 4000);
    expect(recorder.stop('demo')?.steps[0].delayMs).toBe(0);
  });

  test('a refused command is not captured, and is reported', () => {
    const recorder = new MacroRecorder();
    recorder.start(0);
    expect(recorder.record('znxstudio.scm.commit', 10)).toBe(false);
    expect(recorder.record('znxstudio.fold.all', 20)).toBe(true);
    expect(recorder.stepCount).toBe(1);
    expect(recorder.refusedCommands).toEqual(['znxstudio.scm.commit']);
  });

  test('recording nothing yields no macro, rather than an empty one', () => {
    const recorder = new MacroRecorder();
    recorder.start(0);
    expect(recorder.stop('demo')).toBeNull();
  });

  test('commands offered when not recording are ignored', () => {
    const recorder = new MacroRecorder();
    expect(recorder.record('a', 0)).toBe(false);
    expect(recorder.isRecording).toBe(false);
  });

  test('cancel discards everything', () => {
    const recorder = new MacroRecorder();
    recorder.start(0);
    recorder.record('a', 0);
    recorder.cancel();
    expect(recorder.isRecording).toBe(false);
    expect(recorder.stepCount).toBe(0);
  });

  test('starting again discards the previous take', () => {
    const recorder = new MacroRecorder();
    recorder.start(0);
    recorder.record('a', 0);
    recorder.start(0);
    expect(recorder.stepCount).toBe(0);
  });

  test('an unnamed macro still gets a name', () => {
    const recorder = new MacroRecorder();
    recorder.start(0);
    recorder.record('a', 0);
    expect(recorder.stop('   ')?.name).toBe('Untitled macro');
  });
});

describe('clampDelay', () => {
  test('a long pause is capped, so a replay cannot hang for minutes', () => {
    expect(clampDelay(60_000)).toBe(MAX_STEP_DELAY_MS);
  });
  test('negative and non-finite delays become zero', () => {
    expect(clampDelay(-5)).toBe(0);
    expect(clampDelay(NaN)).toBe(0);
  });
});

describe('replayMacro', () => {
  const macro: Macro = { name: 'demo', steps: [{ command: 'a', delayMs: 0 }, { command: 'b', delayMs: 10 }] };

  test('runs every step in order', async () => {
    const ran: string[] = [];
    const result = await replayMacro(macro, (command) => ran.push(command), noSleep);
    expect(result.ok).toBe(true);
    expect(result.executed).toBe(2);
    expect(ran).toEqual(['a', 'b']);
  });

  test('stops at the first failure and names the command', async () => {
    const ran: string[] = [];
    const result = await replayMacro(
      macro,
      (command) => {
        ran.push(command);
        if (command === 'a') throw new Error('boom');
      },
      noSleep,
    );
    expect(result.ok).toBe(false);
    expect(result.failedCommand).toBe('a');
    expect(result.error).toBe('boom');
    expect(result.executed).toBe(1);
    expect(ran).toEqual(['a']);
  });

  test('awaits an async command before the next one', async () => {
    const ran: string[] = [];
    await replayMacro(
      macro,
      async (command) => {
        await Promise.resolve();
        ran.push(command);
      },
      noSleep,
    );
    expect(ran).toEqual(['a', 'b']);
  });

  test('an empty macro replays successfully and does nothing', async () => {
    const result = await replayMacro({ name: 'empty', steps: [] }, () => undefined, noSleep);
    expect(result).toEqual({ ok: true, executed: 0 });
  });
});

describe('macro persistence', () => {
  test('reads well-formed macros', () => {
    const macros = parseMacros([{ name: 'a', steps: [{ command: 'znxstudio.fold.all', delayMs: 20 }] }]);
    expect(macros).toHaveLength(1);
    expect(macros[0].steps[0].command).toBe('znxstudio.fold.all');
  });

  test('a hand-edited settings file cannot smuggle in an unrecordable command', () => {
    const macros = parseMacros([{ name: 'evil', steps: [{ command: 'znxstudio.scm.commit', delayMs: 0 }] }]);
    expect(macros).toHaveLength(0);
  });

  test('a macro left with no valid steps is dropped entirely', () => {
    expect(parseMacros([{ name: 'a', steps: [{ command: '' }] }])).toHaveLength(0);
  });

  test('an unnamed macro is dropped', () => {
    expect(parseMacros([{ steps: [{ command: 'znxstudio.fold.all' }] }])).toHaveLength(0);
  });

  test('an out-of-range delay is clamped on the way in', () => {
    expect(parseMacros([{ name: 'a', steps: [{ command: 'znxstudio.fold.all', delayMs: 999_999 }] }])[0].steps[0].delayMs).toBe(MAX_STEP_DELAY_MS);
  });

  test('nonsense yields no macros', () => {
    expect(parseMacros(null)).toHaveLength(0);
    expect(parseMacros({ name: 'a' })).toHaveLength(0);
  });

  test('duration sums the delays, so the UI can say how long a replay takes', () => {
    expect(macroDurationMs({ name: 'a', steps: [{ command: 'x', delayMs: 0 }, { command: 'y', delayMs: 300 }] })).toBe(300);
  });

  test('upsert replaces by name and sorts; remove deletes', () => {
    let macros = upsertMacro([], { name: 'b', steps: [{ command: 'x', delayMs: 0 }] });
    macros = upsertMacro(macros, { name: 'a', steps: [{ command: 'y', delayMs: 0 }] });
    expect(macros.map((m) => m.name)).toEqual(['a', 'b']);

    macros = upsertMacro(macros, { name: 'a', steps: [{ command: 'z', delayMs: 0 }] });
    expect(macros).toHaveLength(2);
    expect(macros[0].steps[0].command).toBe('z');

    expect(removeMacro(macros, 'a').map((m) => m.name)).toEqual(['b']);
  });
});

/* ---------------------------------------------------------- profiles */

describe('layout profiles', () => {
  const configuration = { layout: DEFAULT_LAYOUT, panels: DEFAULT_PANEL_PREFERENCES, keybindings: [] };

  test('three profiles ship, and all are built-in', () => {
    expect(BUILT_IN_PROFILES.map((p) => p.name)).toEqual(['Default', 'Focus', 'Debugging']);
    expect(BUILT_IN_PROFILES.every((p) => p.builtIn)).toBe(true);
  });

  test('Focus really does hide everything', () => {
    const focus = findProfile(BUILT_IN_PROFILES, 'Focus')!;
    expect(focus.layout.sidebar.visible).toBe(false);
    expect(focus.layout.panel.visible).toBe(false);
    expect(focus.layout.statusBarVisible).toBe(false);
  });

  test('capture takes a snapshot of the live configuration', () => {
    const profile = captureProfile('Mine', {
      layout: moveSideBar(DEFAULT_LAYOUT, 'right'),
      panels: { order: ['debug'], hidden: [] },
      keybindings: parseUserKeybindings({ 'ctrl+p': 'znxstudio.quickOpen' }),
    });
    expect(profile.name).toBe('Mine');
    expect(profile.builtIn).toBe(false);
    expect(profile.layout.sidebar.side).toBe('right');
    expect(profile.keybindings).toEqual({ 'Ctrl+P': 'znxstudio.quickOpen' });
  });

  test('a stored profile is never built-in, whatever the file claims', () => {
    expect(parseProfile({ name: 'Sneaky', builtIn: true })?.builtIn).toBe(false);
  });

  test('a profile cannot take a built-in name', () => {
    expect(upsertProfile([], captureProfile('Focus', configuration))).toHaveLength(0);
    expect(parseProfiles([{ name: 'Default' }])).toHaveLength(0);
  });

  test('an unnamed profile is not a profile', () => {
    expect(parseProfile({ layout: DEFAULT_LAYOUT })).toBeNull();
    expect(parseProfiles('nope')).toHaveLength(0);
  });

  test('an out-of-range width inside a profile is clamped; a missing one takes the default', () => {
    expect(parseProfile({ name: 'x', layout: { sidebar: { width: -1 } } })?.layout.sidebar.width).toBe(LAYOUT_LIMITS.sidebarWidth.min);
    expect(parseProfile({ name: 'x', layout: {} })?.layout.sidebar.width).toBe(DEFAULT_LAYOUT.sidebar.width);
  });

  test('a malformed keybinding inside a profile is dropped', () => {
    expect(parseProfile({ name: 'x', keybindings: { 'Ctrl+': 'cmd' } })?.keybindings).toEqual({});
  });

  test('allProfiles lists the shipped ones first', () => {
    const stored = [captureProfile('Mine', configuration)];
    expect(allProfiles(stored).map((p) => p.name)).toEqual(['Default', 'Focus', 'Debugging', 'Mine']);
  });

  test('upsert replaces by name; remove deletes a stored profile', () => {
    let stored = upsertProfile([], captureProfile('Mine', configuration));
    stored = upsertProfile(stored, captureProfile('Mine', { ...configuration, layout: moveSideBar(DEFAULT_LAYOUT, 'right') }));
    expect(stored).toHaveLength(1);
    expect(stored[0].layout.sidebar.side).toBe('right');
    expect(removeProfile(stored, 'Mine')).toHaveLength(0);
  });

  test('matchesProfile detects an unmodified profile', () => {
    expect(matchesProfile(findProfile(BUILT_IN_PROFILES, 'Default')!, configuration)).toBe(true);
  });

  test('any change makes it not match, so the UI can say "modified"', () => {
    const defaultProfile = findProfile(BUILT_IN_PROFILES, 'Default')!;
    expect(matchesProfile(defaultProfile, { ...configuration, layout: moveSideBar(DEFAULT_LAYOUT, 'right') })).toBe(false);
    expect(matchesProfile(defaultProfile, { ...configuration, panels: { order: ['debug'], hidden: [] } })).toBe(false);
    expect(matchesProfile(defaultProfile, { ...configuration, keybindings: parseUserKeybindings({ 'Ctrl+P': 'x' }) })).toBe(false);
  });

  test('a differently-spelled but identical keybinding still matches', () => {
    const profile = captureProfile('Mine', { ...configuration, keybindings: parseUserKeybindings({ 'Ctrl+Shift+P': 'x' }) });
    expect(matchesProfile(profile, { ...configuration, keybindings: parseUserKeybindings({ 'shift+ctrl+p': 'x' }) })).toBe(true);
  });
});
