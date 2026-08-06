/**
 * Settings UI — the pure model (UX-8).
 *
 * Turns the flat settings schema into grouped, typed, searchable descriptors the
 * form UI renders as real controls (toggles, dropdowns, number/text fields). No
 * DOM: grouping, typing, humanized titles and search all live here so the module
 * only has to bind values. Object/array-valued settings (maps, lists) are left
 * out of the form and stay editable in the JSON editor.
 */
export type SettingType = 'boolean' | 'number' | 'string' | 'enum';

export interface SettingDescriptor {
  key: string;
  group: string;
  title: string;
  description: string;
  type: SettingType;
  enumValues?: string[];
  min?: number;
  max?: number;
}

export interface SchemaProperty {
  type?: string;
  description?: string;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
}

export interface SchemaLike {
  properties?: Record<string, SchemaProperty>;
}

/** Prefix → friendly group. Most specific prefixes first (ai.completion before ai). */
const GROUPS: { prefix: string; name: string }[] = [
  { prefix: 'editor.', name: 'Editor' },
  { prefix: 'files.', name: 'Files' },
  { prefix: 'workbench.', name: 'Workbench' },
  { prefix: 'zornux.compiler.', name: 'Compiler' },
  { prefix: 'zornux.errorLens.', name: 'Diagnostics' },
  { prefix: 'zornux.diagnostics.', name: 'Diagnostics' },
  { prefix: 'zornux.debug.', name: 'Debugging' },
  { prefix: 'zornux.profiles.', name: 'Profiles' },
  { prefix: 'ai.completion.', name: 'AI Completion' },
  { prefix: 'ai.', name: 'AI' },
  { prefix: 'deploy.', name: 'Deployment' },
];

export const GROUP_ORDER = [
  'Editor',
  'Files',
  'Workbench',
  'Compiler',
  'Diagnostics',
  'Debugging',
  'Profiles',
  'AI',
  'AI Completion',
  'Deployment',
  'Other',
];

function matchGroup(key: string): { prefix: string; name: string } {
  for (const group of GROUPS) {
    if (key.startsWith(group.prefix)) return group;
  }
  return { prefix: '', name: 'Other' };
}

/** `zornux.compiler.cache.enabled` (prefix `zornux.compiler.`) → "Cache Enabled". */
function humanize(text: string): string {
  return text
    .replace(/\./g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function inferType(
  prop: SchemaProperty | undefined,
  defaultValue: unknown,
): { type: SettingType; enumValues?: string[]; min?: number; max?: number } {
  if (prop?.enum) return { type: 'enum', enumValues: prop.enum.map((value) => String(value)) };
  const type = prop?.type ?? typeof defaultValue;
  if (type === 'boolean') return { type: 'boolean' };
  if (type === 'number') return { type: 'number', min: prop?.minimum, max: prop?.maximum };
  return { type: 'string' };
}

/**
 * Build form descriptors from the schema + friendly descriptions + defaults.
 * Object/array-valued settings are skipped (edited via JSON), never dropped from
 * the underlying store.
 */
export function describeSettings(
  schema: SchemaLike,
  descriptions: { key: string; description: string }[],
  defaults: Record<string, unknown>,
): SettingDescriptor[] {
  const descMap = new Map(descriptions.map((entry) => [entry.key, entry.description]));
  const props = schema.properties ?? {};
  const out: SettingDescriptor[] = [];
  // The union of schema keys and stored keys: a schema-only optional setting (no stored default, e.g.
  // files.autosaveMode) still renders a control, and a stored key with no schema still renders too.
  const keys = new Set<string>([...Object.keys(props), ...Object.keys(defaults)]);
  for (const key of keys) {
    const value = defaults[key];
    if (value !== null && typeof value === 'object') continue; // maps/lists → JSON editor
    const prop = props[key];
    const info = inferType(prop, value);
    const group = matchGroup(key);
    out.push({
      key,
      group: group.name,
      title: humanize(group.prefix ? key.slice(group.prefix.length) : key),
      description: descMap.get(key) ?? prop?.description ?? '',
      ...info,
    });
  }
  return out;
}

/** Case-insensitive substring match over key + title + description + group. */
export function filterSettings(list: SettingDescriptor[], query: string): SettingDescriptor[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((item) =>
    `${item.key} ${item.title} ${item.description} ${item.group}`.toLowerCase().includes(needle),
  );
}

export interface SettingGroup {
  group: string;
  items: SettingDescriptor[];
}

/** Group descriptors into ordered sections (GROUP_ORDER, then unknown), items by title. */
export function groupSettings(list: SettingDescriptor[]): SettingGroup[] {
  const byGroup = new Map<string, SettingDescriptor[]>();
  for (const item of list) {
    const bucket = byGroup.get(item.group);
    if (bucket) bucket.push(item);
    else byGroup.set(item.group, [item]);
  }
  const order = (name: string) => {
    const index = GROUP_ORDER.indexOf(name);
    return index < 0 ? GROUP_ORDER.length : index;
  };
  return [...byGroup.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([group, items]) => ({
      group,
      items: [...items].sort((a, b) => a.title.localeCompare(b.title)),
    }));
}
