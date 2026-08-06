import { describe, expect, test } from './harness';
import { Wizard, type WizardStep } from '../src/renderer/wizards/wizardModel';
import {
  buildNewProjectPlan,
  initialNewProjectState,
  newProjectSteps,
  parseDependencySpec,
  validateProjectName,
  type NewProjectState,
} from '../src/renderer/wizards/newProjectWizard';

interface Counter {
  value: number;
}

function counterSteps(): WizardStep<Counter>[] {
  return [
    { id: 'a', title: 'A', validate: (s) => (s.value >= 1 ? null : 'need >= 1') },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C', validate: (s) => (s.value >= 3 ? null : 'need >= 3') },
  ];
}

describe('Wizard engine', () => {
  test('starts on the first step and blocks advancing when invalid', () => {
    const w = new Wizard(counterSteps(), { value: 0 });
    expect(w.isFirst()).toBeTruthy();
    expect(w.stepNumber()).toBe(1);
    expect(w.canAdvance()).toBeFalsy();
    expect(w.next()).toBeFalsy();
    expect(w.stepNumber()).toBe(1);
  });

  test('advances once the current step validates', () => {
    const w = new Wizard(counterSteps(), { value: 0 });
    w.update({ value: 2 });
    expect(w.canAdvance()).toBeTruthy();
    expect(w.next()).toBeTruthy();
    expect(w.stepNumber()).toBe(2);
    expect(w.back()).toBeTruthy();
    expect(w.isFirst()).toBeTruthy();
  });

  test('canFinish only on a valid last step', () => {
    const w = new Wizard(counterSteps(), { value: 2 });
    w.next(); // -> B
    w.next(); // -> C
    expect(w.isLast()).toBeTruthy();
    expect(w.canFinish()).toBeFalsy(); // value 2 < 3
    w.update({ value: 3 });
    expect(w.canFinish()).toBeTruthy();
  });

  test('back on the first step is a no-op', () => {
    const w = new Wizard(counterSteps(), { value: 5 });
    expect(w.back()).toBeFalsy();
  });
});

describe('New Project wizard model', () => {
  test('validateProjectName enforces a sane identifier', () => {
    expect(validateProjectName('')).toContain('Enter');
    expect(validateProjectName('9lives')).toContain('starting with a letter');
    expect(validateProjectName('my-app_1.0')).toBeNull();
  });

  test('parseDependencySpec splits name and version, and rejects malformed input', () => {
    expect(parseDependencySpec('MathTools')).toEqual({ name: 'MathTools' });
    expect(parseDependencySpec('MathTools@1.2.0')).toEqual({ name: 'MathTools', version: '1.2.0' });
    expect(typeof parseDependencySpec('')).toBe('string');
    expect(typeof parseDependencySpec('MathTools@')).toBe('string');
  });

  test('step validators gate each stage of the flow', () => {
    const steps = newProjectSteps();
    const state: NewProjectState = initialNewProjectState();
    // Template step invalid until a real template id is set.
    expect(steps[0].validate?.(state)).toContain('Select a template');
    state.templateId = 'zornux-cli';
    expect(steps[0].validate?.(state)).toBeNull();
    // Details step needs a valid name AND a location.
    expect(steps[1].validate?.(state)).toContain('Enter a project name');
    state.name = 'demo';
    expect(steps[1].validate?.(state)).toContain('location');
    state.location = 'C:/tmp';
    expect(steps[1].validate?.(state)).toBeNull();
    // A malformed dependency blocks the deps step.
    state.dependencies = ['bad@'];
    expect(steps[2].validate?.(state)).toBeTruthy();
    state.dependencies = ['MathTools@1.0.0'];
    expect(steps[2].validate?.(state)).toBeNull();
  });

  test('buildNewProjectPlan composes scaffold + deps + profile', () => {
    const state: NewProjectState = {
      templateId: 'zornux-cli',
      name: 'demo',
      location: 'C:/tmp',
      dependencies: ['MathTools@1.0.0', '  '],
      profile: 'production',
    };
    const plan = buildNewProjectPlan(state);
    expect(plan.scaffold.name).toBe('demo');
    expect(plan.scaffold.location).toBe('C:/tmp');
    expect(plan.scaffold.runZornuxInit).toBeTruthy();
    expect(plan.requiresCompiler).toBeTruthy();
    expect(plan.dependencies).toHaveLength(1); // blank filtered out
    expect(plan.dependencies[0]).toBe('MathTools@1.0.0');
    expect(plan.profile).toBe('production');
  });

  test('a files-only template with no deps needs no compiler', () => {
    const plan = buildNewProjectPlan({
      templateId: 'zoijs-frontend',
      name: 'web',
      location: 'C:/tmp',
      dependencies: [],
      profile: 'development',
    });
    expect(plan.scaffold.runZornuxInit).toBeFalsy();
    expect(plan.requiresCompiler).toBeFalsy();
  });
});
