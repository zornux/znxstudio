import {
  ServiceKeys,
  type DocsService,
  type LearningService,
  type SettingsService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { joinPath } from '../explorer/paths';
import { VerificationRunner } from './runner';
import {
  EMPTY_PACK,
  EMPTY_PROGRESS,
  PACK_MANIFEST,
  exerciseKey,
  isUnlocked,
  lessonComplete,
  nextItem,
  packSummary,
  parseLearningPack,
  parseProgress,
  remainingMinutes,
  trackStatus,
  type Exercise,
  type ExerciseAttempt,
  type LearningPack,
  type LearningProgress,
  type Lesson,
  type PackProblem,
  type Track,
  type Tutorial,
} from './learning';

/**
 * The learning pack folder. There is no cross-platform bundled default (the old
 * value was one developer's Windows path), so it defaults to empty and the user
 * points `docs.learning.path` at a pack folder — the center degrades gracefully
 * with a clear prompt until then.
 */
export const DEFAULT_PACK_PATH = '';
export const PACK_PATH_SETTING = 'docs.learning.path';
export const PROGRESS_SETTING = 'docs.learning.progress';

/**
 * Learning center (Phase 18E). The hub: it loads the curriculum, tracks what the
 * learner has finished, and grades exercises on the REAL Zornux compiler.
 *
 * The curriculum is CONTENT ON DISK, not code — a `learning.json` manifest plus
 * Markdown lesson bodies. A team can point `docs.learning.path` at its own pack.
 * Because a pack is untrusted input, a malformed lesson is dropped with a
 * reported reason rather than taking the curriculum down, and an exercise whose
 * `verify` block will not parse is dropped outright: an exercise that cannot be
 * graded must never be able to say "Correct!".
 *
 * Progress is earned, not asserted. A lesson counts as complete only when every
 * one of its exercises has passed against the compiler.
 */
export class LearningCenterModule implements IModule, LearningService {
  readonly id = 'znxstudio.docs.learning';
  readonly displayName = 'Learning Center';

  private moduleContext!: ModuleContext;
  private settings: SettingsService | undefined;
  private docs: DocsService | undefined;
  private runner!: VerificationRunner;
  private view!: HTMLElement;
  private exercisesView!: HTMLElement;

  /** The lesson whose exercises the panel is showing. */
  private activeLesson: string | null = null;
  /** In-progress code per exercise, so switching panels does not lose an answer. */
  private readonly drafts = new Map<string, string>();
  private readonly attempts = new Map<string, ExerciseAttempt>();
  private packRoot: string | null = null;
  private loaded: LearningPack = EMPTY_PACK;
  private packProblems: PackProblem[] = [];
  private learnerProgress: LearningProgress = EMPTY_PROGRESS;
  private readonly changeEmitter = new Emitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  async activate(context: ModuleContext): Promise<void> {
    this.moduleContext = context;
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    this.docs = context.services.tryGet<DocsService>(ServiceKeys.Docs);
    this.runner = new VerificationRunner(context);
    context.services.register(ServiceKeys.Learning, this);

    this.view = document.createElement('div');
    this.view.className = 'znxstudio-learning';
    this.exercisesView = document.createElement('div');
    this.exercisesView.className = 'znxstudio-exercises';
    context.layout.addActivityItem({ id: 'learning', label: 'Learn', icon: 'L', onSelect: () => this.reveal() });
    context.layout.addPanelView({ id: 'exercises', title: 'Exercises', element: this.exercisesView });
    context.commands.register(CommandIds.LearningShow, () => this.reveal(), 'Learn: Show Learning Center');
    context.commands.register(CommandIds.LearningReload, () => this.reload(), 'Learn: Reload Curriculum');
    context.commands.register(CommandIds.LearningResetProgress, () => this.resetProgress(), 'Learn: Reset Progress');

    this.learnerProgress = parseProgress(this.settings?.get<unknown>(PROGRESS_SETTING, EMPTY_PROGRESS));
    await this.reload();
    void selfTestCoordinator.run('learning', () => this.maybeSelfTest());
  }

  /* ----- LearningService ----- */

  pack(): LearningPack {
    return this.loaded;
  }

  problems(): PackProblem[] {
    return this.packProblems;
  }

  progress(): LearningProgress {
    return this.learnerProgress;
  }

  root(): string | null {
    return this.packRoot;
  }

  lesson(id: string): Lesson | null {
    return this.loaded.lessons.find((entry) => entry.id === id) ?? null;
  }

  tutorial(id: string): Tutorial | null {
    return this.loaded.tutorials.find((entry) => entry.id === id) ?? null;
  }

  async reload(): Promise<void> {
    const root = this.settings?.get<string>(PACK_PATH_SETTING, DEFAULT_PACK_PATH) ?? DEFAULT_PACK_PATH;
    let text: string;
    try {
      if (!root) throw new Error('no learning pack path configured');
      text = await window.znxstudio.fs.readFile(joinPath(root, PACK_MANIFEST));
    } catch {
      this.packRoot = null;
      this.loaded = EMPTY_PACK;
      this.packProblems = [{ where: root, message: `No ${PACK_MANIFEST} found. Set "${PACK_PATH_SETTING}" to a learning pack folder.` }];
      this.render();
      this.changeEmitter.fire();
      return;
    }

    const { pack, problems } = parseLearningPack(text);
    this.packRoot = root;
    this.loaded = pack;
    this.packProblems = problems;
    this.render();
    this.changeEmitter.fire();
  }

  /**
   * Grade one exercise on the real compiler. A pass is recorded; a failure is
   * not, and the explanation says what the program actually printed.
   */
  async runExercise(lessonId: string, exerciseId: string, code: string): Promise<ExerciseAttempt | null> {
    const lesson = this.lesson(lessonId);
    const exercise = lesson?.exercises.find((entry) => entry.id === exerciseId);
    if (!lesson || !exercise) return null;

    const result = await this.runner.run(`lesson-${lessonId}-${exerciseId}`, code, exercise.verify);
    if (!result) return null;

    if (result.passed) this.recordExercisePass(lesson, exercise);
    this.render();
    this.changeEmitter.fire();
    return {
      lessonId,
      exerciseId,
      passed: result.passed,
      explanation: result.explanation,
      actual: result.actual,
      expected: result.expected,
    };
  }

  markTutorialComplete(id: string): void {
    if (!this.tutorial(id) || this.learnerProgress.completedTutorials.includes(id)) return;
    this.save({ ...this.learnerProgress, completedTutorials: [...this.learnerProgress.completedTutorials, id] });
  }

  /** Only meaningful for a lesson with no exercises; the rest are earned. */
  markLessonRead(id: string): void {
    const lesson = this.lesson(id);
    if (!lesson || lesson.exercises.length || this.learnerProgress.completedLessons.includes(id)) return;
    this.save({ ...this.learnerProgress, completedLessons: [...this.learnerProgress.completedLessons, id] });
  }

  /* ----- progress ----- */

  private recordExercisePass(lesson: Lesson, exercise: Exercise): void {
    const key = exerciseKey(lesson.id, exercise.id);
    if (this.learnerProgress.passedExercises.includes(key)) return;

    const next: LearningProgress = {
      ...this.learnerProgress,
      passedExercises: [...this.learnerProgress.passedExercises, key],
    };
    // The lesson becomes complete the moment its LAST exercise passes.
    if (lessonComplete(lesson, next) && !next.completedLessons.includes(lesson.id)) {
      next.completedLessons = [...next.completedLessons, lesson.id];
    }
    this.save(next);
  }

  private save(next: LearningProgress): void {
    this.learnerProgress = next;
    this.settings?.set(PROGRESS_SETTING, next);
  }

  private resetProgress(): void {
    this.save({ completedTutorials: [], completedLessons: [], passedExercises: [] });
    this.render();
    this.changeEmitter.fire();
    this.moduleContext.layout.showToast('Learning progress reset.', 'info');
  }

  /* ----- UI ----- */

  private reveal(): void {
    this.render();
    this.moduleContext.layout.setSideBar('Learn', this.view);
    this.moduleContext.layout.focusSideBar();
  }

  /** Read the lesson in the docs viewer; work its exercises in the panel below. */
  private async openLesson(lesson: Lesson): Promise<void> {
    if (!this.docs || !this.packRoot) return;
    await this.docs.openFile({ label: this.loaded.name, root: this.packRoot }, lesson.body);
    this.activeLesson = lesson.id;
    this.attempts.clear();
    this.renderExercises();
    if (lesson.exercises.length) this.moduleContext.layout.showPanelView('exercises');
    else this.markLessonRead(lesson.id);
  }

  /* ----- exercises panel ----- */

  private renderExercises(): void {
    if (!this.exercisesView) return;
    this.exercisesView.replaceChildren();
    const lesson = this.activeLesson ? this.lesson(this.activeLesson) : null;

    if (!lesson) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-learning-empty';
      empty.textContent = 'Open a lesson from the Learn sidebar to work its exercises.';
      this.exercisesView.appendChild(empty);
      return;
    }

    const heading = document.createElement('div');
    heading.className = 'znxstudio-learning-track';
    heading.textContent = `${lesson.title} — ${lesson.exercises.length} exercise(s)`;
    this.exercisesView.appendChild(heading);

    for (const exercise of lesson.exercises) {
      this.exercisesView.appendChild(this.renderExercise(lesson, exercise));
    }
  }

  private renderExercise(lesson: Lesson, exercise: Exercise): HTMLElement {
    const passed = this.learnerProgress.passedExercises.includes(exerciseKey(lesson.id, exercise.id));
    const attempt = this.attempts.get(exercise.id) ?? null;

    const card = document.createElement('div');
    card.className = `znxstudio-exercise${passed ? ' is-passed' : ''}`;

    const prompt = document.createElement('div');
    prompt.className = 'znxstudio-exercise-prompt';
    prompt.textContent = `${passed ? '✓ ' : ''}${exercise.prompt}`;
    card.appendChild(prompt);

    const editor = document.createElement('textarea');
    editor.className = 'znxstudio-exercise-editor';
    editor.spellcheck = false;
    editor.rows = Math.max(6, exercise.starter.split('\n').length + 2);
    editor.value = this.drafts.get(exercise.id) ?? exercise.starter;
    editor.addEventListener('input', () => this.drafts.set(exercise.id, editor.value));
    card.appendChild(editor);

    const actions = document.createElement('div');
    actions.className = 'znxstudio-exercise-actions';

    const verify = document.createElement('button');
    verify.className = 'znxstudio-btn-small';
    verify.textContent = '✓ Verify';
    verify.title = 'Run your program on the real Zornux compiler.';
    verify.addEventListener('click', () => {
      verify.disabled = true;
      verify.textContent = 'Checking…';
      void this.runExercise(lesson.id, exercise.id, editor.value).then((result) => {
        if (result) this.attempts.set(exercise.id, result);
        this.renderExercises();
      });
    });
    actions.appendChild(verify);

    if (exercise.hint) {
      const hint = document.createElement('button');
      hint.className = 'znxstudio-btn-small';
      hint.textContent = 'Hint';
      hint.addEventListener('click', () => this.moduleContext.layout.showToast(exercise.hint!, 'info'));
      actions.appendChild(hint);
    }

    if (exercise.solution) {
      const solution = document.createElement('button');
      solution.className = 'znxstudio-btn-small';
      solution.textContent = 'Show solution';
      solution.addEventListener('click', () => {
        this.drafts.set(exercise.id, exercise.solution!);
        this.renderExercises();
      });
      actions.appendChild(solution);
    }
    card.appendChild(actions);

    if (attempt) {
      const verdict = document.createElement('div');
      verdict.className = `znxstudio-exercise-verdict ${attempt.passed ? 'is-ok' : 'is-bad'}`;
      verdict.textContent = attempt.explanation;
      card.appendChild(verdict);

      if (!attempt.passed && attempt.actual.length) {
        const output = document.createElement('pre');
        output.className = 'znxstudio-exercise-output';
        output.textContent = attempt.actual.join('\n');
        card.appendChild(output);
      }
    }
    return card;
  }

  private openTutorial(tutorial: Tutorial): void {
    this.moduleContext.commands.executeFromUi(CommandIds.TutorialOpen, undefined, tutorial.id);
  }

  private render(): void {
    if (!this.view) return;
    this.view.replaceChildren();
    // The exercise panel shows the same pass ticks; keep the two in step.
    this.renderExercises();

    const header = document.createElement('div');
    header.className = 'znxstudio-learning-header';
    header.textContent = 'Learn';
    this.view.appendChild(header);

    if (!this.packRoot || !this.loaded.tracks.length) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-learning-empty';
      empty.textContent = this.packProblems[0]?.message ?? 'This learning pack defines no tracks.';
      this.view.appendChild(empty);
      this.renderProblems();
      return;
    }

    const summary = document.createElement('div');
    summary.className = 'znxstudio-learning-summary';
    summary.textContent = packSummary(this.loaded, this.learnerProgress);
    this.view.appendChild(summary);

    for (const track of this.loaded.tracks) this.renderTrack(track);
    this.renderProblems();
  }

  private renderTrack(track: Track): void {
    const status = trackStatus(track, this.learnerProgress);

    const heading = document.createElement('div');
    heading.className = 'znxstudio-learning-track';
    heading.textContent = `${track.title} — ${status.done}/${status.total}`;
    this.view.appendChild(heading);

    const bar = document.createElement('div');
    bar.className = 'znxstudio-learning-bar';
    const fill = document.createElement('div');
    fill.className = 'znxstudio-learning-bar-fill';
    fill.style.width = `${status.percent}%`;
    bar.appendChild(fill);
    this.view.appendChild(bar);

    const description = document.createElement('div');
    description.className = 'znxstudio-learning-desc';
    const left = remainingMinutes(track, this.loaded, this.learnerProgress);
    description.textContent = left ? `${track.description} (~${left} min left)` : `${track.description} — finished 🎉`;
    this.view.appendChild(description);

    const upNext = nextItem(track, this.learnerProgress);
    const list = document.createElement('ul');
    list.className = 'znxstudio-learning-items';

    track.items.forEach((item, index) => {
      const entry =
        item.kind === 'tutorial' ? this.tutorial(item.id) : this.lesson(item.id);
      if (!entry) return;

      const done =
        item.kind === 'tutorial'
          ? this.learnerProgress.completedTutorials.includes(item.id)
          : lessonComplete(entry as Lesson, this.learnerProgress);
      const unlocked = isUnlocked(track, index, this.learnerProgress);

      const row = document.createElement('li');
      const button = document.createElement('button');
      button.className = `znxstudio-learning-item${done ? ' is-done' : ''}${upNext?.id === item.id ? ' is-next' : ''}`;
      const icon = done ? '✓' : item.kind === 'tutorial' ? '▶' : '□';
      button.textContent = `${icon} ${entry.title} · ${entry.minutes} min`;
      button.disabled = !unlocked;
      if (!unlocked) button.title = 'Finish the item before this one first.';
      button.addEventListener('click', () => {
        if (item.kind === 'tutorial') this.openTutorial(entry as Tutorial);
        else void this.openLesson(entry as Lesson);
      });
      row.appendChild(button);
      list.appendChild(row);
    });
    this.view.appendChild(list);
  }

  /**
   * Say what the pack got wrong. A dropped lesson that vanishes silently looks
   * like a lesson that was never written.
   */
  private renderProblems(): void {
    if (!this.packProblems.length) return;
    const heading = document.createElement('div');
    heading.className = 'znxstudio-learning-track';
    heading.textContent = `Pack problems (${this.packProblems.length})`;
    this.view.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'znxstudio-learning-problems';
    for (const problem of this.packProblems) {
      const item = document.createElement('li');
      item.textContent = `${problem.where}: ${problem.message}`;
      list.appendChild(item);
    }
    this.view.appendChild(list);
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      const info = await window.znxstudio.app.getInfo();
      enabled = info.selftest === true;
    } catch {
      return;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    try {
      await this.reload();
      log(
        `learning REAL pack: root=${this.packRoot} tracks=${this.loaded.tracks.length} ` +
          `tutorials=${this.loaded.tutorials.length} lessons=${this.loaded.lessons.length} problems=${this.packProblems.length}`,
      );
      if (!this.loaded.lessons.length) return;

      const values = this.lesson('values');
      const greeting = values?.exercises.find((exercise) => exercise.id === 'greeting');
      if (!values || !greeting) {
        log('learning REAL: values/greeting missing — skipped');
        return;
      }

      // A wrong answer must FAIL, and say why.
      const wrong = await this.runExercise('values', 'greeting', 'create name as "Alice"\nshow "Hello, Bob!"\n');
      log(`learning REAL wrong answer: passed=${wrong?.passed} — ${wrong?.explanation}`);

      // The pack's own solution must PASS on the real compiler.
      const right = await this.runExercise('values', 'greeting', greeting.solution ?? '');
      log(`learning REAL pack solution: passed=${right?.passed} — ${right?.explanation}`);

      const total = values.exercises.find((exercise) => exercise.id === 'total');
      const second = await this.runExercise('values', 'total', total?.solution ?? '');
      log(`learning REAL second solution: passed=${second?.passed} actual=${JSON.stringify(second?.actual)}`);

      const done = this.learnerProgress.completedLessons.includes('values');
      log(`learning REAL lesson completion: values complete=${done} (both exercises passed on the real compiler)`);

      const locked = isUnlocked(this.loaded.tracks[0], 3, this.learnerProgress);
      log(`learning REAL gating: 4th foundations item unlocked=${locked} (expect false — earlier items unfinished)`);

      // Every pack solution must actually satisfy its own exercise.
      for (const lesson of this.loaded.lessons) {
        for (const exercise of lesson.exercises) {
          if (!exercise.solution) continue;
          const attempt = await this.runExercise(lesson.id, exercise.id, exercise.solution);
          log(`learning REAL solution ${lesson.id}/${exercise.id}: passed=${attempt?.passed}`);
        }
      }

      this.resetProgress();
      log(`learning REAL reset: passed=${this.learnerProgress.passedExercises.length} (expect 0)`);
    } catch (error) {
      log(`learning REAL failed: ${(error as Error).message}`);
    }
  }
}
