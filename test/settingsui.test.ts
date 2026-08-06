import { describe, expect, test } from './harness';
import {
  describeSettings,
  filterSettings,
  groupSettings,
  type SchemaLike,
} from '../src/renderer/settings/settingsUi';

const SCHEMA: SchemaLike = {
  properties: {
    'editor.fontSize': { type: 'number', description: 'Font size.', minimum: 8, maximum: 40 },
    'workbench.theme': { type: 'string', description: 'Theme.', enum: ['znxstudio-dark', 'znxstudio-light'] },
    'files.autosave': { type: 'boolean', description: 'Autosave.' },
    'ai.completion.enabled': { type: 'boolean', description: 'Inline completion.' },
    'ai.provider': { type: 'string', description: 'Provider.', enum: ['none', 'openai'] },
  },
};

const DEFAULTS: Record<string, unknown> = {
  'editor.fontSize': 13,
  'workbench.theme': 'znxstudio-dark',
  'files.autosave': false,
  'ai.completion.enabled': true,
  'ai.provider': 'none',
  'zornux.profiles.byRoot': {}, // object → excluded from the form
  'deploy.profiles': [], // array → excluded from the form
};

const DESCRIPTIONS = [{ key: 'editor.fontSize', description: 'Editor font size in pixels.' }];

describe('settings UI — descriptors', () => {
  test('infers types, humanized titles, groups, and skips object/array settings', () => {
    const list = describeSettings(SCHEMA, DESCRIPTIONS, DEFAULTS);
    // byRoot (object) and deploy.profiles (array) are excluded.
    expect(list.map((d) => d.key).sort()).toEqual([
      'ai.completion.enabled',
      'ai.provider',
      'editor.fontSize',
      'files.autosave',
      'workbench.theme',
    ]);

    const font = list.find((d) => d.key === 'editor.fontSize')!;
    expect(font.type).toBe('number');
    expect(font.group).toBe('Editor');
    expect(font.title).toBe('Font Size');
    expect(font.min).toBe(8);
    expect(font.max).toBe(40);
    // Friendly description wins over the schema description.
    expect(font.description).toBe('Editor font size in pixels.');

    const theme = list.find((d) => d.key === 'workbench.theme')!;
    expect(theme.type).toBe('enum');
    expect(theme.enumValues).toEqual(['znxstudio-dark', 'znxstudio-light']);

    expect(list.find((d) => d.key === 'files.autosave')!.type).toBe('boolean');
  });

  test('the AI Completion prefix wins over the broader AI prefix', () => {
    const list = describeSettings(SCHEMA, [], DEFAULTS);
    expect(list.find((d) => d.key === 'ai.completion.enabled')!.group).toBe('AI Completion');
    expect(list.find((d) => d.key === 'ai.provider')!.group).toBe('AI');
  });

  test('renders a schema-only optional setting that has no stored default (union of keys)', () => {
    const schema: SchemaLike = {
      properties: {
        'files.autosaveMode': { type: 'string', enum: ['off', 'afterDelay'], description: 'When to autosave.' },
      },
    };
    const list = describeSettings(schema, [], {}); // no stored defaults at all
    const mode = list.find((d) => d.key === 'files.autosaveMode');
    expect(mode?.type).toBe('enum');
    expect(mode?.enumValues).toEqual(['off', 'afterDelay']);
  });
});

describe('settings UI — search + grouping', () => {
  const list = describeSettings(SCHEMA, DESCRIPTIONS, DEFAULTS);

  test('search matches key, title, description and group; empty returns all', () => {
    expect(filterSettings(list, '').length).toBe(list.length);
    expect(filterSettings(list, 'font').map((d) => d.key)).toEqual(['editor.fontSize']);
    // "theme" is in the title/key of workbench.theme.
    expect(filterSettings(list, 'theme').map((d) => d.key)).toEqual(['workbench.theme']);
    // group name match.
    expect(filterSettings(list, 'completion').map((d) => d.key)).toEqual(['ai.completion.enabled']);
  });

  test('grouping follows GROUP_ORDER with items sorted by title', () => {
    const groups = groupSettings(list);
    expect(groups.map((g) => g.group)).toEqual(['Editor', 'Files', 'Workbench', 'AI', 'AI Completion']);
    expect(groups[0].items[0].key).toBe('editor.fontSize');
  });
});
