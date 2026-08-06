/**
 * The learning pack format (Phase 18E).
 *
 * A pack is CONTENT ON DISK, not code: `learning.json` plus a folder of Markdown
 * lesson bodies. It ships beside the IDE (default: the "ZnxStudio learning center"
 * folder) and a team can point ZnxStudio at its own. Because the pack is untrusted
 * input, `parseLearningPack` never throws and never trusts a path: it reports
 * problems and drops the entries it cannot use, so one bad lesson cannot take
 * the whole curriculum down.
 *
 * Exercises are graded by the REAL compiler (see `verify.ts`) — a pack cannot
 * declare its own answer key and be believed.
 */

import { parseVerification, type Verification } from './verify';

export const PACK_MANIFEST = 'learning.json';
export const PACK_FORMAT_VERSION = 1;

/** A tutorial step: prose, optional starting code, optional real verification. */
export interface TutorialStep {
  title: string;
  /** Markdown, inline in the manifest — steps are short by design. */
  body: string;
  code?: string;
  verify?: Verification;
}

export interface Tutorial {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  steps: TutorialStep[];
}

export interface Exercise {
  id: string;
  prompt: string;
  starter: string;
  verify: Verification;
  hint?: string;
  solution?: string;
}

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  /** Markdown body, relative to the pack root. Confined: never absolute, never `..`. */
  body: string;
  minutes: number;
  exercises: Exercise[];
}

export type TrackItem = { kind: 'tutorial' | 'lesson'; id: string };

export interface Track {
  id: string;
  title: string;
  description: string;
  items: TrackItem[];
}

export interface LearningPack {
  name: string;
  version: string;
  formatVersion: number;
  tracks: Track[];
  tutorials: Tutorial[];
  lessons: Lesson[];
}

export interface PackProblem {
  where: string;
  message: string;
}

export interface ParsedPack {
  pack: LearningPack;
  problems: PackProblem[];
}

export const EMPTY_PACK: LearningPack = {
  name: 'Learning Center',
  version: '0.0.0',
  formatVersion: PACK_FORMAT_VERSION,
  tracks: [],
  tutorials: [],
  lessons: [],
};

/* ----------------------------------------------------------------- parsing */

const ID = /^[a-z0-9][a-z0-9-]*$/;

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * A body path must stay inside the pack. Absolute paths, drive letters, `..`
 * segments and backslashes are all refused rather than normalised — a pack has
 * no reason to write any of them, so their presence is a reason for suspicion,
 * not something to quietly clean up.
 */
export function isSafeBodyPath(path: string): boolean {
  if (!path || path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[a-z]:/i.test(path)) return false;
  if (path.includes('\\')) return false;
  return path.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

export function parseLearningPack(text: string): ParsedPack {
  const problems: PackProblem[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { pack: EMPTY_PACK, problems: [{ where: PACK_MANIFEST, message: `Not valid JSON: ${(error as Error).message}` }] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { pack: EMPTY_PACK, problems: [{ where: PACK_MANIFEST, message: 'The manifest must be a JSON object.' }] };
  }

  const manifest = raw as Record<string, unknown>;
  const formatVersion = asNumber(manifest.formatVersion, 0);
  if (formatVersion !== PACK_FORMAT_VERSION) {
    problems.push({
      where: PACK_MANIFEST,
      message: `Unsupported formatVersion ${formatVersion || '(missing)'} — this ZnxStudio reads version ${PACK_FORMAT_VERSION}.`,
    });
    return { pack: EMPTY_PACK, problems };
  }

  const tutorials = parseList(manifest.tutorials, 'tutorials', problems, parseTutorial);
  const lessons = parseList(manifest.lessons, 'lessons', problems, parseLesson);
  const tracks = parseList(manifest.tracks, 'tracks', problems, parseTrack);

  // A track that points at content this pack does not define would render as a
  // dead entry. Drop the item and say so.
  const tutorialIds = new Set(tutorials.map((t) => t.id));
  const lessonIds = new Set(lessons.map((l) => l.id));
  const resolvedTracks = tracks.map((track) => ({
    ...track,
    items: track.items.filter((item) => {
      const known = item.kind === 'tutorial' ? tutorialIds.has(item.id) : lessonIds.has(item.id);
      if (!known) problems.push({ where: `tracks/${track.id}`, message: `Unknown ${item.kind} "${item.id}" — dropped.` });
      return known;
    }),
  }));

  return {
    pack: {
      name: asString(manifest.name, 'Learning Center'),
      version: asString(manifest.version, '0.0.0'),
      formatVersion,
      tracks: resolvedTracks,
      tutorials,
      lessons,
    },
    problems,
  };
}

function parseList<T>(
  value: unknown,
  where: string,
  problems: PackProblem[],
  parse: (entry: Record<string, unknown>, where: string, problems: PackProblem[]) => T | null,
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    problems.push({ where, message: 'Expected an array.' });
    return [];
  }
  const parsed: T[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push({ where: `${where}[${index}]`, message: 'Expected an object.' });
      return;
    }
    const record = entry as Record<string, unknown>;
    const id = asString(record.id);
    if (!ID.test(id)) {
      problems.push({ where: `${where}[${index}]`, message: `Invalid id ${JSON.stringify(id)} — use lowercase letters, digits and hyphens.` });
      return;
    }
    if (seen.has(id)) {
      problems.push({ where: `${where}/${id}`, message: 'Duplicate id — dropped.' });
      return;
    }
    const result = parse(record, `${where}/${id}`, problems);
    if (result) {
      seen.add(id);
      parsed.push(result);
    }
  });
  return parsed;
}

function parseTutorial(record: Record<string, unknown>, where: string, problems: PackProblem[]): Tutorial | null {
  const steps: TutorialStep[] = [];
  const rawSteps = Array.isArray(record.steps) ? record.steps : [];
  rawSteps.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      problems.push({ where: `${where}/steps[${index}]`, message: 'Expected an object.' });
      return;
    }
    const step = entry as Record<string, unknown>;
    const title = asString(step.title);
    if (!title) {
      problems.push({ where: `${where}/steps[${index}]`, message: 'A step needs a title.' });
      return;
    }
    const verification = step.verify === undefined ? undefined : parseVerification(step.verify);
    if (step.verify !== undefined && !verification) {
      problems.push({ where: `${where}/steps[${index}]`, message: 'Malformed "verify" block — the step will not be checked.' });
    }
    steps.push({
      title,
      body: asString(step.body),
      ...(typeof step.code === 'string' ? { code: step.code } : {}),
      ...(verification ? { verify: verification } : {}),
    });
  });

  if (!steps.length) {
    problems.push({ where, message: 'A tutorial needs at least one step — dropped.' });
    return null;
  }
  return {
    id: asString(record.id),
    title: asString(record.title, asString(record.id)),
    summary: asString(record.summary),
    minutes: Math.max(1, asNumber(record.minutes, 5)),
    steps,
  };
}

function parseLesson(record: Record<string, unknown>, where: string, problems: PackProblem[]): Lesson | null {
  const body = asString(record.body);
  if (!isSafeBodyPath(body)) {
    problems.push({ where, message: `Body path ${JSON.stringify(body)} must be a relative path inside the pack — dropped.` });
    return null;
  }

  const exercises: Exercise[] = [];
  const rawExercises = Array.isArray(record.exercises) ? record.exercises : [];
  rawExercises.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      problems.push({ where: `${where}/exercises[${index}]`, message: 'Expected an object.' });
      return;
    }
    const exercise = entry as Record<string, unknown>;
    const id = asString(exercise.id);
    if (!ID.test(id)) {
      problems.push({ where: `${where}/exercises[${index}]`, message: 'Invalid exercise id — dropped.' });
      return;
    }
    const verification = parseVerification(exercise.verify);
    if (!verification) {
      // An exercise with no working verification cannot be graded, and an
      // ungradable exercise that says "Correct!" would be worse than none.
      problems.push({ where: `${where}/exercises/${id}`, message: 'Missing or malformed "verify" block — dropped.' });
      return;
    }
    exercises.push({
      id,
      prompt: asString(exercise.prompt),
      starter: asString(exercise.starter),
      verify: verification,
      ...(typeof exercise.hint === 'string' ? { hint: exercise.hint } : {}),
      ...(typeof exercise.solution === 'string' ? { solution: exercise.solution } : {}),
    });
  });

  return {
    id: asString(record.id),
    title: asString(record.title, asString(record.id)),
    summary: asString(record.summary),
    body,
    minutes: Math.max(1, asNumber(record.minutes, 10)),
    exercises,
  };
}

function parseTrack(record: Record<string, unknown>, where: string, problems: PackProblem[]): Track | null {
  const items: TrackItem[] = [];
  const rawItems = Array.isArray(record.items) ? record.items : [];
  rawItems.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      problems.push({ where: `${where}/items[${index}]`, message: 'Expected an object.' });
      return;
    }
    const item = entry as Record<string, unknown>;
    const kind = item.kind === 'tutorial' || item.kind === 'lesson' ? item.kind : null;
    const id = asString(item.id);
    if (!kind || !ID.test(id)) {
      problems.push({ where: `${where}/items[${index}]`, message: 'Each item needs kind "tutorial" or "lesson" and an id.' });
      return;
    }
    items.push({ kind, id });
  });

  if (!items.length) {
    problems.push({ where, message: 'A track needs at least one item — dropped.' });
    return null;
  }
  return {
    id: asString(record.id),
    title: asString(record.title, asString(record.id)),
    description: asString(record.description),
    items,
  };
}

/* ---------------------------------------------------------------- progress */

export interface LearningProgress {
  completedTutorials: string[];
  completedLessons: string[];
  /** `<lessonId>/<exerciseId>` for every exercise the real compiler accepted. */
  passedExercises: string[];
}

export const EMPTY_PROGRESS: LearningProgress = { completedTutorials: [], completedLessons: [], passedExercises: [] };

/** An exercise attempt, once the real CLI has ruled on it. */
export interface ExerciseAttempt {
  lessonId: string;
  exerciseId: string;
  passed: boolean;
  explanation: string;
  actual: string[];
  expected: string[];
}

export function exerciseKey(lessonId: string, exerciseId: string): string {
  return `${lessonId}/${exerciseId}`;
}

/** Untrusted stored progress: keep only the strings, drop everything else. */
export function parseProgress(value: unknown): LearningProgress {
  if (!value || typeof value !== 'object') return EMPTY_PROGRESS;
  const raw = value as Record<string, unknown>;
  const list = (key: string): string[] =>
    Array.isArray(raw[key]) ? (raw[key] as unknown[]).filter((entry): entry is string => typeof entry === 'string') : [];
  return {
    completedTutorials: list('completedTutorials'),
    completedLessons: list('completedLessons'),
    passedExercises: list('passedExercises'),
  };
}

export function isItemComplete(item: TrackItem, progress: LearningProgress): boolean {
  return item.kind === 'tutorial'
    ? progress.completedTutorials.includes(item.id)
    : progress.completedLessons.includes(item.id);
}

/**
 * A lesson is complete when EVERY one of its exercises has passed against the
 * real compiler. A lesson with no exercises is complete once it is marked read.
 */
export function lessonComplete(lesson: Lesson, progress: LearningProgress): boolean {
  if (!lesson.exercises.length) return progress.completedLessons.includes(lesson.id);
  return lesson.exercises.every((exercise) => progress.passedExercises.includes(exerciseKey(lesson.id, exercise.id)));
}

export interface TrackStatus {
  done: number;
  total: number;
  percent: number;
}

export function trackStatus(track: Track, progress: LearningProgress): TrackStatus {
  const done = track.items.filter((item) => isItemComplete(item, progress)).length;
  const total = track.items.length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/**
 * Items unlock in order: you may open the next unfinished item and everything
 * before it, but not skip ahead. The first item is always unlocked.
 */
export function isUnlocked(track: Track, index: number, progress: LearningProgress): boolean {
  if (index <= 0) return true;
  return track.items.slice(0, index).every((item) => isItemComplete(item, progress));
}

export function nextItem(track: Track, progress: LearningProgress): TrackItem | null {
  return track.items.find((item) => !isItemComplete(item, progress)) ?? null;
}

/** Total estimated minutes still to do on a track. */
export function remainingMinutes(track: Track, pack: LearningPack, progress: LearningProgress): number {
  return track.items
    .filter((item) => !isItemComplete(item, progress))
    .reduce((total, item) => {
      const entry =
        item.kind === 'tutorial'
          ? pack.tutorials.find((t) => t.id === item.id)
          : pack.lessons.find((l) => l.id === item.id);
      return total + (entry?.minutes ?? 0);
    }, 0);
}

export function packSummary(pack: LearningPack, progress: LearningProgress): string {
  const items = pack.tracks.reduce((total, track) => total + track.items.length, 0);
  const done = pack.tracks.reduce((total, track) => total + trackStatus(track, progress).done, 0);
  return `${pack.name} ${pack.version} · ${pack.tracks.length} track(s) · ${done}/${items} complete`;
}
