/**
 * Pure DI + mock scaffolding (Phase 9F). Zornux has no built-in mock primitive,
 * but it has dependency injection: `repository`/`service` components declare
 * `use <Dep>` and an `application` block composes them (xojin/examples/enterprise).
 * A "mock" is a same-interface component you register in place of the real one.
 * This parses components and generates test doubles. No DOM / no Monaco.
 */
export type ComponentKind = 'repository' | 'service' | 'application';

export interface ComponentFunction {
  name: string;
  async: boolean;
  params: string[];
}

export interface Component {
  kind: ComponentKind;
  name: string;
  uses: string[];
  functions: ComponentFunction[];
  line: number;
}

const COMPONENT_RE = /^(repository|service|application)(?:\s+(\w+))?/;
const USE_RE = /^\s*use\s+(\w+)/;
const FUNCTION_RE = /^\s*(async\s+)?function\s+(\w+)(?:\s+with\s+(.+?))?\s*$/;

/** Every top-level DI component (`repository`/`service`/`application … end`). */
export function parseComponents(text: string): Component[] {
  const lines = text.split(/\r?\n/);
  const components: Component[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const header = COMPONENT_RE.exec(lines[i]);
    if (!header) continue;

    const component: Component = {
      kind: header[1] as ComponentKind,
      name: header[2] ?? 'application',
      uses: [],
      functions: [],
      line: i,
    };

    let j = i + 1;
    for (; j < lines.length; j += 1) {
      if (/^end\b/.test(lines[j])) break; // column-0 end closes the component
      const use = USE_RE.exec(lines[j]);
      if (use) {
        component.uses.push(use[1]);
        continue;
      }
      const fn = FUNCTION_RE.exec(lines[j]);
      if (fn) {
        component.functions.push({
          name: fn[2],
          async: Boolean(fn[1]),
          params: fn[3] ? fn[3].split(',').map((p) => p.trim()).filter(Boolean) : [],
        });
      }
    }

    components.push(component);
    i = j;
  }

  return components;
}

/** A stub return value for a mocked function (best-effort heuristic). */
function mockReturn(fn: ComponentFunction): string {
  if (/\b(all|list|find|search|many)\b/i.test(fn.name)) return '[]';
  if (fn.params.length > 0) return fn.params[0]; // echo the entity (save/create style)
  return '0';
}

/**
 * Generate a mock component with the same interface as `component`, returning
 * stub values. Register it in the `application` block in place of the real one.
 */
export function generateMock(component: Component, name = `Mock${component.name}`): string {
  const lines = [`${component.kind} ${name}`];
  if (component.functions.length === 0) {
    lines.push('    # TODO: add mock methods');
  }
  for (const fn of component.functions) {
    const signature = `${fn.async ? 'async ' : ''}function ${fn.name}${fn.params.length ? ` with ${fn.params.join(', ')}` : ''}`;
    lines.push(`    ${signature}`);
    lines.push('        # TODO: return a test double');
    lines.push(`        give back ${mockReturn(fn)}`);
    lines.push('    end');
  }
  lines.push('end');
  lines.push(`# In your test's application block, swap: use ${component.name} → use ${name}`);
  return `${lines.join('\n')}\n`;
}

/** Components that `use` the named component (its dependents). */
export function dependents(components: Component[], name: string): string[] {
  return components.filter((c) => c.uses.includes(name)).map((c) => c.name);
}
