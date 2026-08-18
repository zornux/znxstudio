/**
 * The New Project wizard's pure model (Phase 5H): its state, step definitions +
 * validators, and the plan builder that turns collected answers into concrete
 * service calls. Composes the earlier phases — a 5G template scaffold, optional
 * 5D dependencies, and a 5F environment profile — with no DOM here.
 */
import type { ScaffoldRequest } from '../../shared/types';
import { findTemplate, renderTemplate } from '../../shared/templates';
import { ENVIRONMENT_PROFILES, type EnvironmentProfile } from '../../shared/environmentProfiles';
import type { WizardStep } from './wizardModel';

export interface NewProjectState {
  templateId: string | null;
  name: string;
  location: string | null;
  /** Dependency specs (`name` or `name@version`) to add after scaffolding. */
  dependencies: string[];
  profile: EnvironmentProfile;
}

export function initialNewProjectState(): NewProjectState {
  return { templateId: null, name: '', location: null, dependencies: [], profile: 'development' };
}

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;

/** Validate a project name; returns an error string or null. */
export function validateProjectName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a project name.';
  if (!NAME_PATTERN.test(trimmed)) {
    return "Use letters, digits, '.', '-', or '_', starting with a letter.";
  }
  return null;
}

/** Parse a dependency spec into name + optional version; returns an error string when malformed. */
export function parseDependencySpec(spec: string): { name: string; version?: string } | string {
  const trimmed = spec.trim();
  if (!trimmed) return 'A dependency cannot be empty.';
  const at = trimmed.indexOf('@');
  if (at < 0) return { name: trimmed };
  const name = trimmed.slice(0, at);
  const version = trimmed.slice(at + 1);
  if (!name) return 'A dependency needs a name before "@".';
  if (!version) return 'A dependency version cannot be empty (drop the "@" to take the latest).';
  return { name, version };
}

export function newProjectSteps(): WizardStep<NewProjectState>[] {
  return [
    {
      id: 'template',
      title: 'Choose a template',
      validate: (state) =>
        state.templateId && findTemplate(state.templateId) ? null : 'Select a template to continue.',
    },
    {
      id: 'details',
      title: 'Name & location',
      validate: (state) => validateProjectName(state.name) ?? (state.location ? null : 'Choose a location folder.'),
    },
    {
      id: 'dependencies',
      title: 'Dependencies (optional)',
      validate: (state) => {
        for (const spec of state.dependencies) {
          const parsed = parseDependencySpec(spec);
          if (typeof parsed === 'string') return parsed;
        }
        return null;
      },
    },
    {
      id: 'profile',
      title: 'Environment profile',
      validate: (state) => (ENVIRONMENT_PROFILES.includes(state.profile) ? null : 'Pick a valid profile.'),
    },
    { id: 'review', title: 'Review & create' },
  ];
}

export interface NewProjectPlan {
  /** Scaffold request (the module fills in compilerPath). */
  scaffold: Omit<ScaffoldRequest, 'compilerPath'>;
  /** Whether the template requires the real `zornux init` (and thus the compiler). */
  requiresCompiler: boolean;
  dependencies: string[];
  profile: EnvironmentProfile;
}

/**
 * Turn collected wizard answers into a concrete plan. Throws only on an invalid
 * state that the step validators should already have caught (defensive).
 */
export function buildNewProjectPlan(state: NewProjectState): NewProjectPlan {
  const template = state.templateId ? findTemplate(state.templateId) : undefined;
  if (!template) throw new Error('No template selected.');
  if (!state.location) throw new Error('No location selected.');
  const name = state.name.trim();
  const rendered = renderTemplate(template, name);
  const dependencies = state.dependencies.map((spec) => spec.trim()).filter(Boolean);
  // Adding dependencies also needs the compiler (5D), so require it if either applies.
  const requiresCompiler = rendered.runZornuxInit || dependencies.length > 0;
  return {
    scaffold: { name, location: state.location, runZornuxInit: rendered.runZornuxInit, vendorZoijsDir: rendered.vendorZoijsDir, files: rendered.files },
    requiresCompiler,
    dependencies,
    profile: state.profile,
  };
}
