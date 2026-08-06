import { ServiceKeys, type LearningService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { VerificationRunner } from './runner';
import { parseMarkdown, renderMarkdown } from './markdown';
import type { Tutorial } from './learning';
import { canAdvance, canGoBack, resumeStep, stepSlot, tutorialComplete, tutorialStatus } from './tutorials';
import type { VerificationResult } from './verify';

/**
 * Tutorials (Phase 18C). A guided walk through a Zornux idea, where the code is
 * run by the REAL compiler at the moments the tutorial claims to check it.
 *
 * The rule that keeps this honest: a step carrying a `verify` block will not let
 * you past until the compiler has actually accepted your program. Steps without
 * one are prose and advance freely — grading prose would be theatre. The footer
 * always says which kind of step you are on.
 */
export class TutorialsModule implements IModule {
  readonly id = 'znxstudio.docs.tutorials';
  readonly displayName = 'Tutorials';

  private moduleContext!: ModuleContext;
  private learning: LearningService | undefined;
  private runner!: VerificationRunner;
  private view!: HTMLElement;

  private tutorial: Tutorial | null = null;
  private index = 0;
  private code = '';
  private readonly passed = new Set<number>();
  private result: VerificationResult | null = null;
  private running = false;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.learning = context.services.tryGet<LearningService>(ServiceKeys.Learning);
    this.runner = new VerificationRunner(context);

    this.view = document.createElement('div');
    this.view.className = 'znxstudio-tutorial';
    context.layout.addPanelView({ id: 'tutorial', title: 'Tutorial', element: this.view });

    context.commands.register(CommandIds.TutorialOpen, (id) => this.open(String(id)), 'Tutorial: Open');
    context.commands.register(CommandIds.TutorialNext, () => this.next(), 'Tutorial: Next Step');
    context.commands.register(CommandIds.TutorialPrevious, () => this.previous(), 'Tutorial: Previous Step');
    context.commands.register(CommandIds.TutorialVerify, () => void this.verify(), 'Tutorial: Verify Step');

    this.render();
    void selfTestCoordinator.run('tutorials', () => this.maybeSelfTest());
  }

  /* ----- navigation ----- */

  private open(id: string): void {
    const tutorial = this.learning?.tutorial(id) ?? null;
    if (!tutorial) {
      this.moduleContext.layout.showToast(`No tutorial "${id}".`, 'error');
      return;
    }
    this.tutorial = tutorial;
    this.passed.clear();
    this.index = 0;
    this.result = null;
    this.loadStep();
    this.moduleContext.layout.showPanelView('tutorial');
  }

  private loadStep(): void {
    this.code = this.tutorial?.steps[this.index]?.code ?? '';
    this.result = null;
    this.render();
  }

  private next(): void {
    if (!this.tutorial || !canAdvance(this.tutorial, this.index, this.passed)) return;
    this.index += 1;
    this.loadStep();
    this.finishIfComplete();
  }

  private previous(): void {
    if (!canGoBack(this.index)) return;
    this.index -= 1;
    this.loadStep();
  }

  private finishIfComplete(): void {
    if (!this.tutorial || !tutorialComplete(this.tutorial, this.index, this.passed)) return;
    this.learning?.markTutorialComplete(this.tutorial.id);
    this.moduleContext.layout.showToast(`Tutorial complete: ${this.tutorial.title}`, 'info');
    this.render();
  }

  /* ----- verification against the real compiler ----- */

  private async verify(): Promise<void> {
    const tutorial = this.tutorial;
    const step = tutorial?.steps[this.index];
    if (!tutorial || !step?.verify || this.running) return;

    this.running = true;
    this.render();

    const result = await this.runner.run(stepSlot(tutorial.id, this.index), this.code, step.verify);
    this.running = false;
    this.result = result;
    if (result?.passed) this.passed.add(this.index);
    this.render();

    // Passing the LAST step is what finishes a tutorial; there is no step to
    // advance to, so completion has to be checked here as well as in `next`.
    if (result?.passed) this.finishIfComplete();
  }

  /* ----- UI ----- */

  private render(): void {
    if (!this.view) return;
    this.view.replaceChildren();

    if (!this.tutorial) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-tutorial-empty';
      empty.textContent = 'Pick a tutorial from the Learn sidebar.';
      this.view.appendChild(empty);
      return;
    }

    const step = this.tutorial.steps[this.index];
    const status = tutorialStatus(this.tutorial, this.index, this.passed);

    const header = document.createElement('div');
    header.className = 'znxstudio-tutorial-header';
    header.textContent = `${this.tutorial.title} — step ${status.step} of ${status.steps}: ${step.title}`;
    this.view.appendChild(header);

    const bar = document.createElement('div');
    bar.className = 'znxstudio-learning-bar';
    const fill = document.createElement('div');
    fill.className = 'znxstudio-learning-bar-fill';
    fill.style.width = `${status.percent}%`;
    bar.appendChild(fill);
    this.view.appendChild(bar);

    const body = document.createElement('div');
    body.className = 'znxstudio-md znxstudio-tutorial-body';
    body.appendChild(renderMarkdown(parseMarkdown(step.body)));
    this.view.appendChild(body);

    if (step.code !== undefined) {
      const editor = document.createElement('textarea');
      editor.className = 'znxstudio-tutorial-editor';
      editor.spellcheck = false;
      editor.rows = Math.max(5, this.code.split('\n').length + 1);
      editor.value = this.code;
      editor.addEventListener('input', () => {
        this.code = editor.value;
      });
      this.view.appendChild(editor);
    }

    const actions = document.createElement('div');
    actions.className = 'znxstudio-tutorial-actions';

    const back = document.createElement('button');
    back.className = 'znxstudio-btn-small';
    back.textContent = '← Back';
    back.disabled = !canGoBack(this.index);
    back.addEventListener('click', () => this.previous());
    actions.appendChild(back);

    if (step.verify) {
      const verify = document.createElement('button');
      verify.className = 'znxstudio-btn-small';
      verify.textContent = this.running ? 'Checking…' : '✓ Verify';
      verify.disabled = this.running;
      verify.title =
        step.verify.kind === 'check'
          ? 'Compile your program with the real `zornux check`.'
          : `Run your program with the real \`zornux ${step.verify.engine === 'vm' ? 'vm-run' : 'run'}\`.`;
      verify.addEventListener('click', () => void this.verify());
      actions.appendChild(verify);
    }

    const next = document.createElement('button');
    next.className = 'znxstudio-btn-small';
    next.textContent = 'Next →';
    next.disabled = !canAdvance(this.tutorial, this.index, this.passed);
    if (step.verify && !this.passed.has(this.index)) next.title = 'Verify this step before moving on.';
    next.addEventListener('click', () => this.next());
    actions.appendChild(next);
    this.view.appendChild(actions);

    const footer = document.createElement('div');
    footer.className = 'znxstudio-tutorial-footer';
    footer.textContent = step.verify
      ? `This step is checked by the real compiler (${status.verified}/${status.verifiable} verified).`
      : 'This step is prose — nothing to check. Read on.';
    this.view.appendChild(footer);

    if (this.result) {
      const verdict = document.createElement('div');
      verdict.className = `znxstudio-tutorial-verdict ${this.result.passed ? 'is-ok' : 'is-bad'}`;
      verdict.textContent = this.result.explanation;
      this.view.appendChild(verdict);

      if (!this.result.passed && this.result.actual.length) {
        const output = document.createElement('pre');
        output.className = 'znxstudio-tutorial-output';
        output.textContent = this.result.actual.join('\n');
        this.view.appendChild(output);
      }
    }

    if (tutorialComplete(this.tutorial, this.index, this.passed)) {
      const done = document.createElement('div');
      done.className = 'znxstudio-tutorial-verdict is-ok';
      done.textContent = 'Tutorial complete — every checked step passed on the real compiler.';
      this.view.appendChild(done);
    }
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
      const tutorial = this.learning?.tutorial('hello');
      if (!tutorial) {
        log('tutorial REAL: pack has no "hello" tutorial — skipped');
        return;
      }
      this.open('hello');
      log(`tutorial REAL open: "${tutorial.title}" steps=${tutorial.steps.length} step1 verifiable=${Boolean(tutorial.steps[0].verify)}`);

      // Step 1 is prose: it advances with nothing to check.
      this.next();
      log(`tutorial REAL prose step advanced: now step ${this.index + 1} (a prose step never blocks)`);

      // Step 2 is verifiable: it must NOT advance until the compiler agrees.
      const blocked = !canAdvance(this.tutorial!, this.index, this.passed);
      log(`tutorial REAL gate: step ${this.index + 1} blocked before verifying = ${blocked} (expect true)`);

      this.code = 'show "Wrong output"\n';
      await this.verify();
      log(`tutorial REAL wrong: passed=${this.result?.passed} — ${this.result?.explanation}`);

      this.code = tutorial.steps[this.index].code ?? '';
      await this.verify();
      log(`tutorial REAL correct (interpreter): passed=${this.result?.passed} actual=${JSON.stringify(this.result?.actual)}`);

      this.next();
      this.code = tutorial.steps[this.index].code ?? '';
      await this.verify();
      log(
        `tutorial REAL step 3 on the bytecode VM: passed=${this.result?.passed} actual=${JSON.stringify(this.result?.actual)} ` +
          '(the same program, the other engine)',
      );

      log(
        `tutorial REAL complete: ${tutorialComplete(this.tutorial!, this.index, this.passed)} ` +
          `recorded=${this.learning?.progress().completedTutorials.includes('hello')}`,
      );

      // A `check` step passes on compilation alone, whatever it prints.
      const first = this.learning?.tutorial('first-task');
      const checkStep = first?.steps.findIndex((step) => step.verify?.kind === 'check') ?? -1;
      if (first && checkStep >= 0) {
        this.open('first-task');
        this.index = checkStep;
        this.code = first.steps[checkStep].code ?? '';
        await this.verify();
        log(`tutorial REAL check step: passed=${this.result?.passed} (zornux check — compiles, never runs)`);
        this.code = 'function broken with n\n    give back n * 2\n';
        await this.verify();
        log(`tutorial REAL check step broken: passed=${this.result?.passed} — ${this.result?.explanation}`);
      }
    } catch (error) {
      log(`tutorial REAL failed: ${(error as Error).message}`);
    }
  }
}
