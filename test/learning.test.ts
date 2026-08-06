import { describe, expect, test } from './harness';
import {
  firstDifference,
  judge,
  outputLines,
  outputMatches,
  parseVerification,
  verificationArgs,
} from '../src/renderer/docs/verify';
import {
  EMPTY_PROGRESS,
  exerciseKey,
  isSafeBodyPath,
  isUnlocked,
  lessonComplete,
  nextItem,
  packSummary,
  parseLearningPack,
  parseProgress,
  remainingMinutes,
  trackStatus,
  type LearningProgress,
  type Lesson,
  type Track,
} from '../src/renderer/docs/learning';
import {
  canAdvance,
  canGoBack,
  resumeStep,
  stepSlot,
  tutorialComplete,
  tutorialStatus,
  verifiableSteps,
} from '../src/renderer/docs/tutorials';

/* ------------------------------------------------------------ verification */

describe('exercise verification — output comparison', () => {
  test('trailing blank lines are insignificant, interior ones are not', () => {
    expect(outputLines('a\nb\n\n\n')).toEqual(['a', 'b']);
    expect(outputLines('a\n\nb')).toEqual(['a', '', 'b']);
  });

  test('CRLF is normalised', () => {
    expect(outputLines('a\r\nb\r\n')).toEqual(['a', 'b']);
  });

  test('matching ignores trailing whitespace only', () => {
    expect(outputMatches(['pass'], ['pass'])).toBe(true);
    expect(outputMatches(['pass  '], ['pass'])).toBe(true);
    expect(outputMatches([' pass'], ['pass'])).toBe(false);
    expect(outputMatches(['a'], ['a', 'b'])).toBe(false);
  });

  test('firstDifference points at the offending line', () => {
    expect(firstDifference(['a', 'b'], ['a', 'c'])).toBe(1);
    expect(firstDifference(['a'], ['a'])).toBe(-1);
    expect(firstDifference(['a', 'b'], ['a'])).toBe(1);
  });
});

describe('exercise verification — verdicts', () => {
  test('a run exercise passes only on exact output', () => {
    const result = judge({ kind: 'run', expectedOutput: ['Hello, Alice!'] }, 0, 'Hello, Alice!\n');
    expect(result.passed).toBe(true);
    expect(result.explanation).toBe('Exactly right.');
  });

  test('a program that compiles but prints the wrong thing has not solved it', () => {
    const result = judge({ kind: 'run', expectedOutput: ['Hello, Alice!'] }, 0, 'Hello, Bob!\n');
    expect(result.passed).toBe(false);
    expect(result.explanation).toContain('expected "Hello, Alice!" but got "Hello, Bob!"');
  });

  test('a crash is reported as a crash, not as a wrong answer', () => {
    const result = judge({ kind: 'run', expectedOutput: ['60'] }, 1, 'ZX0301: division by zero');
    expect(result.passed).toBe(false);
    expect(result.explanation).toContain('exit code 1');
  });

  test('stopping early names the missing line', () => {
    const result = judge({ kind: 'run', expectedOutput: ['pass', 'fail'] }, 0, 'pass\n');
    expect(result.explanation).toContain('stopped early');
    expect(result.explanation).toContain('"fail"');
  });

  test('an extra line is reported as extra', () => {
    const result = judge({ kind: 'run', expectedOutput: ['pass'] }, 0, 'pass\nfail\n');
    expect(result.explanation).toContain('extra line');
  });

  test('a check exercise passes on exit 0 whatever it printed', () => {
    const result = judge({ kind: 'check' }, 0, 'e.zx: no problems found.');
    expect(result.passed).toBe(true);
    expect(result.expected).toEqual([]);
  });

  test('a check exercise fails when the program does not compile', () => {
    expect(judge({ kind: 'check' }, 1, 'ZX0102: expected end').passed).toBe(false);
  });

  test('argv follows the verification kind and engine', () => {
    expect(verificationArgs({ kind: 'check' }, 'a.zx')).toEqual(['check', 'a.zx']);
    expect(verificationArgs({ kind: 'run', expectedOutput: [] }, 'a.zx')).toEqual(['run', 'a.zx']);
    expect(verificationArgs({ kind: 'run', expectedOutput: [], engine: 'vm' }, 'a.zx')).toEqual(['vm-run', 'a.zx']);
  });
});

describe('exercise verification — parsing an untrusted verify block', () => {
  test('accepts the two kinds', () => {
    expect(parseVerification({ kind: 'check' })).toEqual({ kind: 'check' });
    expect(parseVerification({ kind: 'run', expectedOutput: ['a'] })).toEqual({ kind: 'run', expectedOutput: ['a'] });
  });

  test('an unknown kind or a non-string line is refused', () => {
    expect(parseVerification({ kind: 'grade-generously' })).toBeNull();
    expect(parseVerification({ kind: 'run', expectedOutput: [1] })).toBeNull();
    expect(parseVerification({ kind: 'run' })).toBeNull();
    expect(parseVerification(null)).toBeNull();
  });

  test('an unknown engine falls back to the default rather than being trusted', () => {
    expect(parseVerification({ kind: 'run', expectedOutput: [], engine: 'quantum' })).toEqual({
      kind: 'run',
      expectedOutput: [],
    });
  });
});

/* -------------------------------------------------------------- pack parse */

const PACK = JSON.stringify({
  formatVersion: 1,
  name: 'Test Pack',
  version: '1.0.0',
  tracks: [
    { id: 'foundations', title: 'Foundations', description: 'Start here.', items: [
      { kind: 'tutorial', id: 'hello' },
      { kind: 'lesson', id: 'values' },
    ] },
  ],
  tutorials: [
    { id: 'hello', title: 'Hello', summary: 's', minutes: 5, steps: [
      { title: 'Read', body: 'prose' },
      { title: 'Run', body: 'b', code: 'show "hi"', verify: { kind: 'run', expectedOutput: ['hi'] } },
    ] },
  ],
  lessons: [
    { id: 'values', title: 'Values', summary: 's', body: 'lessons/values.md', minutes: 10, exercises: [
      { id: 'greeting', prompt: 'p', starter: '', verify: { kind: 'run', expectedOutput: ['Hello!'] } },
    ] },
  ],
});

describe('learning pack — parsing', () => {
  test('reads a well-formed pack', () => {
    const { pack, problems } = parseLearningPack(PACK);
    expect(problems).toEqual([]);
    expect(pack.name).toBe('Test Pack');
    expect(pack.tracks).toHaveLength(1);
    expect(pack.tutorials[0].steps).toHaveLength(2);
    expect(pack.lessons[0].exercises).toHaveLength(1);
  });

  test('invalid JSON yields an empty pack and a reason', () => {
    const { pack, problems } = parseLearningPack('{ not json');
    expect(pack.tracks).toEqual([]);
    expect(problems[0].message).toContain('Not valid JSON');
  });

  test('an unsupported formatVersion refuses the whole pack', () => {
    const { pack, problems } = parseLearningPack(JSON.stringify({ formatVersion: 99, tracks: [] }));
    expect(pack.tracks).toEqual([]);
    expect(problems[0].message).toContain('Unsupported formatVersion 99');
  });

  test('an exercise with no usable verify block is DROPPED, never shown ungradable', () => {
    const raw = JSON.parse(PACK);
    raw.lessons[0].exercises.push({ id: 'bogus', prompt: 'p', starter: '', verify: { kind: 'trust-me' } });
    const { pack, problems } = parseLearningPack(JSON.stringify(raw));
    expect(pack.lessons[0].exercises).toHaveLength(1);
    expect(problems.some((p) => p.where === 'lessons/values/exercises/bogus')).toBe(true);
  });

  test('a lesson body outside the pack is refused', () => {
    expect(isSafeBodyPath('lessons/values.md')).toBe(true);
    expect(isSafeBodyPath('../../../etc/passwd')).toBe(false);
    expect(isSafeBodyPath('/etc/passwd')).toBe(false);
    expect(isSafeBodyPath('C:\\secret.md')).toBe(false);
    expect(isSafeBodyPath('lessons\\values.md')).toBe(false);
    expect(isSafeBodyPath('')).toBe(false);
  });

  test('a lesson with an escaping body path is dropped with a reason', () => {
    const raw = JSON.parse(PACK);
    raw.lessons[0].body = '../../../etc/passwd';
    const { pack, problems } = parseLearningPack(JSON.stringify(raw));
    expect(pack.lessons).toEqual([]);
    expect(problems.some((p) => p.message.includes('must be a relative path'))).toBe(true);
  });

  test('a track item pointing at content that does not exist is dropped', () => {
    const raw = JSON.parse(PACK);
    raw.tracks[0].items.push({ kind: 'lesson', id: 'ghost' });
    const { pack, problems } = parseLearningPack(JSON.stringify(raw));
    expect(pack.tracks[0].items).toHaveLength(2);
    expect(problems.some((p) => p.message.includes('Unknown lesson "ghost"'))).toBe(true);
  });

  test('duplicate ids and bad ids are dropped', () => {
    const raw = JSON.parse(PACK);
    raw.lessons.push({ ...JSON.parse(PACK).lessons[0] });
    raw.lessons.push({ id: 'Not An Id', body: 'a.md' });
    const { pack, problems } = parseLearningPack(JSON.stringify(raw));
    expect(pack.lessons).toHaveLength(1);
    expect(problems).toHaveLength(2);
  });

  test('a tutorial with no steps is dropped', () => {
    const raw = JSON.parse(PACK);
    raw.tutorials[0].steps = [];
    const { pack } = parseLearningPack(JSON.stringify(raw));
    expect(pack.tutorials).toEqual([]);
  });
});

/* ---------------------------------------------------------------- progress */

const track: Track = {
  id: 't',
  title: 'T',
  description: 'd',
  items: [
    { kind: 'tutorial', id: 'hello' },
    { kind: 'lesson', id: 'values' },
    { kind: 'lesson', id: 'classes' },
  ],
};

const values: Lesson = {
  id: 'values',
  title: 'Values',
  summary: '',
  body: 'lessons/values.md',
  minutes: 10,
  exercises: [
    { id: 'a', prompt: '', starter: '', verify: { kind: 'check' } },
    { id: 'b', prompt: '', starter: '', verify: { kind: 'check' } },
  ],
};

describe('learning progress', () => {
  test('untrusted stored progress keeps only strings', () => {
    const progress = parseProgress({ completedLessons: ['a', 7, null], passedExercises: 'nope' });
    expect(progress.completedLessons).toEqual(['a']);
    expect(progress.passedExercises).toEqual([]);
  });

  test('a lesson completes only when EVERY exercise has passed', () => {
    const partial: LearningProgress = { ...EMPTY_PROGRESS, passedExercises: [exerciseKey('values', 'a')] };
    expect(lessonComplete(values, partial)).toBe(false);
    const full: LearningProgress = {
      ...EMPTY_PROGRESS,
      passedExercises: [exerciseKey('values', 'a'), exerciseKey('values', 'b')],
    };
    expect(lessonComplete(values, full)).toBe(true);
  });

  test('a lesson with no exercises completes when marked read', () => {
    const prose: Lesson = { ...values, id: 'prose', exercises: [] };
    expect(lessonComplete(prose, EMPTY_PROGRESS)).toBe(false);
    expect(lessonComplete(prose, { ...EMPTY_PROGRESS, completedLessons: ['prose'] })).toBe(true);
  });

  test('items unlock strictly in order; the first is always open', () => {
    expect(isUnlocked(track, 0, EMPTY_PROGRESS)).toBe(true);
    expect(isUnlocked(track, 1, EMPTY_PROGRESS)).toBe(false);
    const done: LearningProgress = { ...EMPTY_PROGRESS, completedTutorials: ['hello'] };
    expect(isUnlocked(track, 1, done)).toBe(true);
    expect(isUnlocked(track, 2, done)).toBe(false);
  });

  test('track status counts only completed items', () => {
    const done: LearningProgress = { ...EMPTY_PROGRESS, completedTutorials: ['hello'] };
    expect(trackStatus(track, done)).toEqual({ done: 1, total: 3, percent: 33 });
  });

  test('nextItem is the first unfinished item, null when done', () => {
    expect(nextItem(track, EMPTY_PROGRESS)).toEqual({ kind: 'tutorial', id: 'hello' });
    const all: LearningProgress = {
      completedTutorials: ['hello'],
      completedLessons: ['values', 'classes'],
      passedExercises: [],
    };
    expect(nextItem(track, all)).toBeNull();
  });

  test('remaining minutes sum only what is left', () => {
    const pack = {
      name: 'p',
      version: '1',
      formatVersion: 1,
      tracks: [track],
      tutorials: [{ id: 'hello', title: 'h', summary: '', minutes: 5, steps: [{ title: 't', body: 'b' }] }],
      lessons: [values, { ...values, id: 'classes', minutes: 15 }],
    };
    expect(remainingMinutes(track, pack, EMPTY_PROGRESS)).toBe(30);
    expect(remainingMinutes(track, pack, { ...EMPTY_PROGRESS, completedTutorials: ['hello'] })).toBe(25);
    expect(packSummary(pack, EMPTY_PROGRESS)).toContain('0/3 complete');
  });
});

/* --------------------------------------------------------------- tutorials */

const tutorial = {
  id: 'hello',
  title: 'Hello',
  summary: '',
  minutes: 5,
  steps: [
    { title: 'Prose', body: 'read me' },
    { title: 'Run', body: 'b', code: 'show "hi"', verify: { kind: 'run' as const, expectedOutput: ['hi'] } },
    { title: 'VM', body: 'b', code: 'show "hi"', verify: { kind: 'run' as const, expectedOutput: ['hi'], engine: 'vm' as const } },
  ],
};

describe('tutorial progression', () => {
  test('only the steps with a verify block are verifiable', () => {
    expect(verifiableSteps(tutorial)).toEqual([1, 2]);
  });

  test('a prose step advances freely', () => {
    expect(canAdvance(tutorial, 0, new Set())).toBe(true);
  });

  test('a verifiable step BLOCKS until the real compiler has accepted it', () => {
    expect(canAdvance(tutorial, 1, new Set())).toBe(false);
    expect(canAdvance(tutorial, 1, new Set([1]))).toBe(true);
  });

  test('you cannot advance past the last step', () => {
    expect(canAdvance(tutorial, 2, new Set([1, 2]))).toBe(false);
  });

  test('going back is always allowed', () => {
    expect(canGoBack(0)).toBe(false);
    expect(canGoBack(1)).toBe(true);
  });

  test('completion needs the last step AND every verifiable step passed', () => {
    expect(tutorialComplete(tutorial, 2, new Set([1]))).toBe(false);
    expect(tutorialComplete(tutorial, 1, new Set([1, 2]))).toBe(false);
    expect(tutorialComplete(tutorial, 2, new Set([1, 2]))).toBe(true);
  });

  test('a prose-only tutorial completes on arrival at its last step', () => {
    const prose = { ...tutorial, steps: [{ title: 'a', body: 'a' }, { title: 'b', body: 'b' }] };
    expect(tutorialComplete(prose, 1, new Set())).toBe(true);
  });

  test('resume lands on the first unverified step', () => {
    expect(resumeStep(tutorial, new Set())).toBe(1);
    expect(resumeStep(tutorial, new Set([1]))).toBe(2);
    expect(resumeStep(tutorial, new Set([1, 2]))).toBe(2);
  });

  test('status reports verified against verifiable, not against all steps', () => {
    expect(tutorialStatus(tutorial, 1, new Set([1]))).toEqual({ step: 2, steps: 3, verified: 1, verifiable: 2, percent: 67 });
  });

  test('scratch slots are stable per step', () => {
    expect(stepSlot('hello', 0)).toBe('tutorial-hello-step-1');
  });
});
