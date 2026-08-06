import { describe, expect, test } from './harness';
import {
  alreadyAvailable,
  baseName,
  buildComponentIndex,
  computeImportEdit,
  crossFileComponentCompletions,
  importSpecifier,
  samePath,
} from '../src/renderer/zoijs/zoijsComponentIndex';

const cardFile = 'C:/app/ui/Card.js';
const cardText = "import { html } from '@zoijs/core';\nexport function Card() { return html`<div></div>`; }\n";
const homeFile = 'C:/app/pages/home.js';

describe('zoijs component index', () => {
  test('collects EXPORTED components with their file (skips non-exported)', () => {
    const index = buildComponentIndex([
      { path: cardFile, text: cardText },
      { path: 'C:/app/ui/priv.js', text: "import { html } from '@zoijs/core';\nfunction Hidden() { return html``; }\n" },
    ]);
    expect(index.map((c) => c.name)).toEqual(['Card']);
    expect(index[0].file).toBe(cardFile);
  });

  test('importSpecifier is dot-relative, POSIX, extensionless', () => {
    expect(importSpecifier(homeFile, cardFile)).toBe('../ui/Card');
    expect(importSpecifier('C:/app/a.js', 'C:/app/B.js')).toBe('./B');
    expect(importSpecifier('C:\\app\\a.js', 'C:\\app\\sub\\C.ts')).toBe('./sub/C');
  });

  test('samePath / baseName normalize separators + case', () => {
    expect(samePath('C:/app/UI/Card.js', 'c:\\app\\ui\\card.js')).toBe(true);
    expect(baseName('C:/app/ui/Card.js')).toBe('Card.js');
  });
});

describe('zoijs auto-import edit', () => {
  test('alreadyAvailable detects imports and local declarations', () => {
    expect(alreadyAvailable("import { Card } from '../ui/Card';\n", 'Card')).toBe(true);
    expect(alreadyAvailable('function Card() {}\n', 'Card')).toBe(true);
    expect(alreadyAvailable("import Card from '../ui/Card';\n", 'Card')).toBe(true);
    expect(alreadyAvailable("import { html } from '@zoijs/core';\n", 'Card')).toBe(false);
  });

  test('adds a new import line after the last import', () => {
    const text = "import { html } from '@zoijs/core';\n\nexport function Home() { return html``; }\n";
    const edit = computeImportEdit(text, 'Card', '../ui/Card');
    expect(Boolean(edit)).toBe(true);
    expect(edit!.start.line).toBe(0);
    expect(edit!.newText).toContain("import { Card } from '../ui/Card';");
  });

  test('merges into an existing import from the same specifier', () => {
    const text = "import { html } from '@zoijs/core';\nimport { Button } from '../ui/kit';\n";
    const edit = computeImportEdit(text, 'Card', '../ui/kit');
    expect(edit!.start.line).toBe(1);
    expect(edit!.newText).toBe(', Card');
  });

  test('returns null when the name is already available', () => {
    expect(computeImportEdit("import { Card } from '../ui/Card';\n", 'Card', '../ui/Card')).toBeNull();
  });

  test('inserts at the top when the file has no imports', () => {
    const edit = computeImportEdit('export function Home() {}\n', 'Card', './Card');
    expect(edit!.start.line).toBe(0);
    expect(edit!.start.character).toBe(0);
    expect(edit!.newText).toBe("import { Card } from './Card';\n");
  });
});

describe('zoijs cross-file completions', () => {
  test('offers other files’ components (auto-import), skips local + current file', () => {
    const index = buildComponentIndex([
      { path: cardFile, text: cardText },
      { path: homeFile, text: "import { html } from '@zoijs/core';\nexport function Home() { return html``; }\n" },
    ]);
    const currentText = 'import { html } from "@zoijs/core";\nexport function Home() { return html`${}`; }\n';
    const comps = crossFileComponentCompletions(index, homeFile, currentText, new Set(['Home']));
    const labels = comps.map((c) => c.label);
    expect(labels).toContain('Card'); // cross-file
    expect(labels.includes('Home')).toBe(false); // current file / local
    const card = comps.find((c) => c.label === 'Card')!;
    expect(card.insertText).toBe('Card()');
    expect(Boolean(card.additionalEdit)).toBe(true);
    expect(card.additionalEdit!.newText).toContain("import { Card } from '../ui/Card'");
  });

  test('no auto-import edit when the component is already imported', () => {
    const index = buildComponentIndex([{ path: cardFile, text: cardText }]);
    const currentText = "import { Card } from '../ui/Card';\nexport function Home() { return html`${}`; }\n";
    const card = crossFileComponentCompletions(index, homeFile, currentText, new Set(['Home'])).find((c) => c.label === 'Card')!;
    expect(card.additionalEdit).toBe(undefined);
  });
});
