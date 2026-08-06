/**
 * Pure code generators (Phase 7H). Unlike snippets (static templates), a
 * generator takes structured input — e.g. a comma-separated field list — and
 * emits variable-length code. Bodies use the REAL Zornux v1.0 surface syntax and
 * idiomatic Zoijs. No DOM / no Monaco — CodeGenModule prompts and inserts.
 */
export interface ParamSpec {
  /** Key in the values object passed to generate(). */
  name: string;
  label: string;
  placeholder?: string;
  /** 'list' values are comma-separated; 'text' is a single value. */
  kind: 'text' | 'list';
  /** A missing/empty value aborts generation. */
  required?: boolean;
}

export interface CodeGenerator {
  id: string;
  title: string;
  description: string;
  languages: string[];
  params: ParamSpec[];
  generate(values: Record<string, string>): string;
}

const INDENT = '    '; // 4 spaces, matching the example sources

/** Split a comma-separated list value into trimmed, non-empty items. */
export function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** PascalCase an identifier-ish string ("user profile" → "UserProfile"). */
export function pascalCase(value: string): string {
  const words = value.trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('') || value.trim();
}

/** kebab-case an identifier-ish string ("MyThing" → "my-thing"). */
export function kebabCase(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export const GENERATORS: CodeGenerator[] = [
  {
    id: 'zx-record',
    title: 'Zornux Record',
    description: 'A record type with fields',
    languages: ['zornux'],
    params: [
      { name: 'name', label: 'Record name', placeholder: 'User', kind: 'text', required: true },
      { name: 'fields', label: 'Fields (comma-separated)', placeholder: 'name, email, age', kind: 'list' },
    ],
    generate: (values) => {
      const name = pascalCase(values.name);
      const fields = parseList(values.fields ?? '');
      const body = fields.length
        ? fields.map((field) => `${INDENT}has ${field}`).join('\n')
        : `${INDENT}has field`;
      return `record ${name}\n${body}\nend\n`;
    },
  },
  {
    id: 'zx-class',
    title: 'Zornux Class',
    description: 'A class with fields and methods',
    languages: ['zornux'],
    params: [
      { name: 'name', label: 'Class name', placeholder: 'Account', kind: 'text', required: true },
      { name: 'fields', label: 'Fields (comma-separated)', placeholder: 'balance, owner', kind: 'list' },
      { name: 'methods', label: 'Methods (comma-separated)', placeholder: 'deposit, withdraw', kind: 'list' },
    ],
    generate: (values) => {
      const name = pascalCase(values.name);
      const fields = parseList(values.fields ?? '');
      const methods = parseList(values.methods ?? '');
      const parts: string[] = [`class ${name}`];
      for (const field of fields.length ? fields : ['field']) parts.push(`${INDENT}has ${field}`);
      for (const method of methods) {
        parts.push('', `${INDENT}function ${method}`, `${INDENT}${INDENT}`, `${INDENT}end`);
      }
      parts.push('end', '');
      return parts.join('\n');
    },
  },
  {
    id: 'zx-service',
    title: 'Zornux Service',
    description: 'A web service with routes + publish',
    languages: ['zornux'],
    params: [
      { name: 'name', label: 'Service name', placeholder: 'Greeter', kind: 'text', required: true },
      { name: 'routes', label: 'Routes (e.g. "GET /greeting, POST /users")', placeholder: 'GET /greeting', kind: 'list' },
      { name: 'port', label: 'Port', placeholder: '8080', kind: 'text' },
    ],
    generate: (values) => {
      const name = pascalCase(values.name);
      const port = (values.port ?? '').trim() || '8080';
      const routes = parseList(values.routes ?? '');
      const specs = routes.length ? routes : ['GET /path'];
      const parts: string[] = [`service ${name}`];
      specs.forEach((spec, index) => {
        const [methodRaw, ...pathParts] = spec.split(/\s+/);
        const method = (methodRaw || 'GET').toUpperCase();
        const path = pathParts.join(' ') || '/path';
        if (index > 0) parts.push('');
        parts.push(
          `${INDENT}on ${method} "${path}"`,
          `${INDENT}${INDENT}give back status 200 with message "OK"`,
          `${INDENT}end`,
        );
      });
      parts.push('end', '', `publish ${name} on port ${port}`, '');
      return parts.join('\n');
    },
  },
  {
    id: 'zx-policy',
    title: 'Zornux Policy',
    description: 'An authorization policy',
    languages: ['zornux'],
    params: [
      { name: 'name', label: 'Policy name', placeholder: 'CanManageOrders', kind: 'text', required: true },
      { name: 'requirements', label: 'Requirements (comma-separated)', placeholder: 'authentication, role "Manager"', kind: 'list' },
    ],
    generate: (values) => {
      const name = pascalCase(values.name);
      const requirements = parseList(values.requirements ?? '');
      const body = (requirements.length ? requirements : ['authentication'])
        .map((requirement) => `${INDENT}require ${requirement}`)
        .join('\n');
      return `policy ${name}\n${body}\nend\n`;
    },
  },
  {
    id: 'zx-configuration',
    title: 'Zornux Configuration',
    description: 'A typed configuration block',
    languages: ['zornux'],
    params: [
      { name: 'name', label: 'Configuration name', placeholder: 'AppConfig', kind: 'text', required: true },
      { name: 'fields', label: 'Fields (name:type, …)', placeholder: 'host:text, port:whole, debug:truth', kind: 'list' },
    ],
    generate: (values) => {
      const name = pascalCase(values.name);
      const fields = parseList(values.fields ?? '');
      const defaults: Record<string, string> = { text: '""', whole: '0', truth: 'false', secret: '""' };
      const lines = (fields.length ? fields : ['field:text']).map((field) => {
        const [fieldName, typeRaw] = field.split(':').map((part) => part.trim());
        const type = typeRaw || 'text';
        return `${INDENT}has ${fieldName} as ${type} is ${defaults[type] ?? '""'}`;
      });
      return `configuration ${name}\n${lines.join('\n')}\nend\n`;
    },
  },
  {
    id: 'zoijs-component',
    title: 'Zoijs Component',
    description: 'A Zoijs component function',
    languages: ['javascript', 'typescript'],
    params: [
      { name: 'name', label: 'Component name', placeholder: 'UserCard', kind: 'text', required: true },
    ],
    generate: (values) => {
      const name = pascalCase(values.name);
      const cls = kebabCase(values.name);
      return [
        "import { html } from '@zoijs/core';",
        '',
        `export function ${name}() {`,
        '  return html`',
        `    <div class="${cls}">`,
        `      <!-- ${name} -->`,
        '    </div>',
        '  `;',
        '}',
        '',
      ].join('\n');
    },
  },
  {
    id: 'zoijs-state-component',
    title: 'Zoijs Stateful Component',
    description: 'A Zoijs component with reactive state',
    languages: ['javascript', 'typescript'],
    params: [
      { name: 'name', label: 'Component name', placeholder: 'Counter', kind: 'text', required: true },
      { name: 'state', label: 'State name', placeholder: 'count', kind: 'text' },
    ],
    generate: (values) => {
      const name = pascalCase(values.name);
      const state = (values.state ?? '').trim() || 'value';
      return [
        "import { html, createState } from '@zoijs/core';",
        '',
        `export function ${name}() {`,
        `  const ${state} = createState(0);`,
        '  return html`',
        `    <div class="${kebabCase(values.name)}">`,
        `      <span>\${() => ${state}.get()}</span>`,
        `      <button onclick=\${() => ${state}.set(${state}.get() + 1)}>+</button>`,
        '    </div>',
        '  `;',
        '}',
        '',
      ].join('\n');
    },
  },
];

/** Generators applicable to a language id. */
export function generatorsFor(languageId: string, generators: CodeGenerator[] = GENERATORS): CodeGenerator[] {
  return generators.filter((generator) => generator.languages.includes(languageId));
}
