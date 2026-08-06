import type { WorkspaceInfo, WorkspaceType } from '../../shared/types';

/**
 * Pure mapping from a detected workspace to the language ids it needs. This is
 * the single place that encodes "which languages does this project use" — the
 * registry and platform stay generic. Extensions can broaden the mapping later
 * by contributing their own languages; nothing here hardcodes their logic.
 */
const LANGUAGES_BY_TYPE: Record<WorkspaceType, string[]> = {
  'zornux-api': ['zornux'],
  'zoijs-frontend': ['javascript', 'typescript', 'css', 'html'],
  'zornux-zoijs-fullstack': ['zornux', 'javascript', 'typescript', 'css', 'html'],
  generic: [],
};

const FRAMEWORK_LANGUAGES: Record<string, string[]> = {
  zoijs: ['javascript', 'typescript', 'css', 'html'],
};

export function requiredLanguagesFor(info: WorkspaceInfo | null): string[] {
  // Plain Text is always available as the universal fallback language.
  const required = new Set<string>(['plaintext']);
  if (!info) return [...required];

  for (const id of LANGUAGES_BY_TYPE[info.detectedType]) required.add(id);
  for (const lang of info.project?.languageTargets ?? []) required.add(lang.toLowerCase());
  for (const framework of info.project?.frameworkTargets ?? []) {
    for (const id of FRAMEWORK_LANGUAGES[framework.toLowerCase()] ?? []) required.add(id);
  }
  return [...required];
}
