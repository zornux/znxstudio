/**
 * Pure snippet catalog + helpers (Phase 7F). Snippet bodies use Monaco's snippet
 * syntax (`\n`, `${1:default}` tab-stops, `$0` final caret) and the Zornux bodies
 * mirror the REAL frozen v1.0 surface syntax (has/function/end, `on GET "…"`,
 * `for each … in …`, `give back`, English comparisons). No DOM / no Monaco here.
 */
export interface Snippet {
  /** Display label in the picker. */
  name: string;
  /** Completion trigger word. */
  prefix: string;
  description: string;
  /** Monaco snippet body. */
  body: string;
  /** Language ids this snippet applies to. */
  languages: string[];
}

const ZX = ['zornux'];

export const BUILTIN_SNIPPETS: Snippet[] = [
  { name: 'module', prefix: 'module', description: 'Module declaration', body: 'module ${1:Name}\n\n$0', languages: ZX },
  {
    name: 'function',
    prefix: 'function',
    description: 'Function with a parameter and return',
    body: 'function ${1:name} with ${2:param}\n\tgive back ${3:value}\nend\n$0',
    languages: ZX,
  },
  {
    name: 'class',
    prefix: 'class',
    description: 'Class with a field and method',
    body: 'class ${1:Name}\n\thas ${2:field}\n\n\tfunction ${3:method}\n\t\t$0\n\tend\nend',
    languages: ZX,
  },
  {
    name: 'record',
    prefix: 'record',
    description: 'Record type with a required field',
    body: 'record ${1:Name}\n\thas ${2:field}\n\t\trequired\n\t$0\nend',
    languages: ZX,
  },
  {
    name: 'service',
    prefix: 'service',
    description: 'Web service with a route + publish',
    body:
      'service ${1:Name}\n\ton ${2|GET,POST,PUT,DELETE|} "${3:/path}"\n\t\tgive back status 200 with message "${4:OK}"\n\tend\nend\n\npublish ${1:Name} on port ${5:8080}\n$0',
    languages: ZX,
  },
  {
    name: 'route',
    prefix: 'on',
    description: 'Service route handler',
    body: 'on ${1|GET,POST,PUT,DELETE|} "${2:/path}"\n\tgive back status 200 with message "${3:OK}"\nend\n$0',
    languages: ZX,
  },
  {
    name: 'policy',
    prefix: 'policy',
    description: 'Authorization policy',
    body: 'policy ${1:Name}\n\trequire authentication\n\trequire role "${2:Manager}"\nend\n$0',
    languages: ZX,
  },
  {
    name: 'configuration',
    prefix: 'configuration',
    description: 'Typed configuration block',
    body: 'configuration ${1:Name}\n\thas ${2:field} as ${3|text,whole,truth,secret|} is ${4:"value"}\nend\n$0',
    languages: ZX,
  },
  { name: 'if', prefix: 'if', description: 'If statement', body: 'if ${1:condition}\n\t$0\nend', languages: ZX },
  {
    name: 'if-else',
    prefix: 'ifelse',
    description: 'If / else statement',
    body: 'if ${1:condition}\n\t$2\nelse\n\t$0\nend',
    languages: ZX,
  },
  {
    name: 'for-each',
    prefix: 'for',
    description: 'For-each loop over a collection',
    body: 'for each ${1:item} in ${2:items}\n\t$0\nend',
    languages: ZX,
  },
  { name: 'while', prefix: 'while', description: 'While loop', body: 'while ${1:condition}\n\t$0\nend', languages: ZX },
  { name: 'repeat', prefix: 'repeat', description: 'Counted repeat loop', body: 'repeat ${1:5} times\n\t$0\nend', languages: ZX },
  { name: 'show', prefix: 'show', description: 'Print a value', body: 'show ${1:"message"}$0', languages: ZX },
  { name: 'create', prefix: 'create', description: 'Declare a variable', body: 'create ${1:name} = ${2:value}$0', languages: ZX },
  // Mobile application DSL.
  {
    name: 'mobile-app',
    prefix: 'mobile',
    description: 'Mobile application with a screen',
    body: 'mobile app "${1:My App}"\n\nscreen ${2:Home}\n\tstate ${3:greeting} = "${4:Hello!}"\n\n\tcolumn\n\t\ttext ${3:greeting}\n\tend\nend\n\nstart with ${2:Home}\n$0',
    languages: ZX,
  },
  {
    name: 'screen',
    prefix: 'screen',
    description: 'Mobile screen declaration',
    body: 'screen ${1:Name}\n\t$0\nend',
    languages: ZX,
  },
  {
    name: 'column',
    prefix: 'column',
    description: 'Vertical layout container',
    body: 'column\n\t$0\nend',
    languages: ZX,
  },
  {
    name: 'row',
    prefix: 'row',
    description: 'Horizontal layout container',
    body: 'row\n\t$0\nend',
    languages: ZX,
  },
  {
    name: 'button-tapped',
    prefix: 'button',
    description: 'Button with tap handler',
    body: 'button "${1:Label}"\n\twhen tapped\n\t\t${2:show "tapped"}\n\tend\nend',
    languages: ZX,
  },
  {
    name: 'style-block',
    prefix: 'style',
    description: 'Inline style block',
    body: 'style\n\tbackground_color ${1:primary}\n\tcorner_radius ${2:12}\n\tpadding ${3:16}\nend',
    languages: ZX,
  },
  {
    name: 'theme',
    prefix: 'theme',
    description: 'Theme declaration with colors',
    body: 'theme ${1:AppTheme}\n\tprimary ${2:"#6750A4"}\n\tsecondary ${3:"#625B71"}\n\tbackground ${4:"#FFFBFE"}\nend\n$0',
    languages: ZX,
  },
  {
    name: 'tokens',
    prefix: 'tokens',
    description: 'Design tokens block',
    body: 'tokens\n\tspacing ${1:small} ${2:8}\n\tspacing ${3:medium} ${4:16}\nend\n$0',
    languages: ZX,
  },
  {
    name: 'animate',
    prefix: 'animate',
    description: 'Animation block for a widget',
    body: 'animate ${1|fade_in,slide_up,slide_down,slide_left,slide_right,scale_up,expand|}\n\tduration ${2:300}\nend',
    languages: ZX,
  },
  {
    name: 'transition',
    prefix: 'transition',
    description: 'Screen transition animation',
    body: 'transition\n\tenter ${1|slide_left,slide_right,fade,scale|}\n\texit ${2|slide_right,slide_left,fade,none|}\nend',
    languages: ZX,
  },
  {
    name: 'responsive',
    prefix: 'responsive',
    description: 'Responsive layout with breakpoints',
    body: 'responsive\n\tcompact\n\t\t$1\n\tend\n\texpanded\n\t\t$2\n\tend\nend',
    languages: ZX,
  },
  {
    name: 'when-swiped',
    prefix: 'swiped',
    description: 'Swipe gesture handler',
    body: 'when swiped ${1|left,right,up,down|}\n\t${2:show "swiped"}\nend',
    languages: ZX,
  },
  {
    name: 'permissions',
    prefix: 'permissions',
    description: 'Device permissions block',
    body: 'permissions\n\t${1|camera,location,notifications|} "${2:reason}"\nend\n$0',
    languages: ZX,
  },
];

/** Snippets that apply to `languageId`. */
export function snippetsFor(languageId: string, snippets: Snippet[]): Snippet[] {
  return snippets.filter((snippet) => snippet.languages.includes(languageId));
}

/** Filter snippets by a picker query (prefix or name, case-insensitive). */
export function matchSnippets(query: string, snippets: Snippet[]): Snippet[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return snippets;
  return snippets.filter(
    (snippet) =>
      snippet.prefix.toLowerCase().includes(needle) || snippet.name.toLowerCase().includes(needle),
  );
}

/** A plain-text preview of a snippet body (tab-stops resolved to their defaults). */
export function renderSnippetPreview(body: string): string {
  return body
    .replace(/\$\{\d+\|([^,|}]*)(?:,[^|}]*)?\|\}/g, '$1') // ${1|GET,POST|} -> GET
    .replace(/\$\{\d+:([^}]*)\}/g, '$1') // ${1:default} -> default
    .replace(/\$\{\d+\}/g, '') // ${1} -> ''
    .replace(/\$\d+/g, ''); // $1 / $0 -> ''
}

/** Escape raw text so it inserts literally as a snippet body (no tab-stops). */
export function escapeSnippetBody(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\$/g, '\\$');
}

/** Validate/normalise persisted user snippets (settings are untrusted). */
export function parseUserSnippets(raw: unknown): Snippet[] {
  if (!Array.isArray(raw)) return [];
  const result: Snippet[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.prefix !== 'string' || typeof record.body !== 'string') continue;
    const languages = Array.isArray(record.languages)
      ? record.languages.filter((value): value is string => typeof value === 'string')
      : [];
    if (languages.length === 0) continue;
    result.push({
      name: typeof record.name === 'string' ? record.name : record.prefix,
      prefix: record.prefix,
      description: typeof record.description === 'string' ? record.description : 'User snippet',
      body: record.body,
      languages,
    });
  }
  return result;
}
