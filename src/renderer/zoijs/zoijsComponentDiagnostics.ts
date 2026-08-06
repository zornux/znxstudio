/**
 * Pure component-level Zoijs diagnostics (Phase 6B). Non-duplicative with
 * Monaco's TS worker: it flags only the Zoijs *convention* that TS cannot know —
 * a component (a function returning `html`…``) should be named in PascalCase so
 * it reads as a component at its call sites in markup.
 */
import type { Diagnostic } from '../language/api';
import { scanZoijsComponents } from './zoijsComponents';

export function analyzeZoijsComponents(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const component of scanZoijsComponents(text)) {
    const first = component.name.charAt(0);
    if (first && first === first.toLowerCase() && /[a-z]/i.test(first)) {
      diagnostics.push({
        range: {
          start: { line: component.nameLine, character: component.nameChar },
          end: { line: component.nameLine, character: component.nameChar + component.name.length },
        },
        severity: 'info',
        source: 'zoijs',
        code: 'ZOIJS-COMPONENT-CASE',
        message: `Zoijs components are conventionally PascalCase; consider renaming '${component.name}'.`,
        hint: 'Components read as elements at their call sites — capitalize the first letter.',
      });
    }
  }
  return diagnostics;
}
