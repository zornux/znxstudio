/**
 * Member completion for Zoijs reactive objects (Phase 6C, member access).
 *
 * Zoijs has no type system, so `state.` can't be resolved by a compiler. This
 * infers the receiver's kind from how it was declared in the same file —
 * `createState` → State, `computed` → Computed, `createRouter` → Router,
 * `effect` → EffectHandle — and offers that kind's members. Member names,
 * signatures and docs are transcribed from the framework's `.d.ts`
 * (vendor/zoijs/{core,router}/index.d.ts). Pure — no DOM.
 */
import type { ZoijsCompletion } from './zoijsCompletions';

export type ReactiveKind = 'state' | 'computed' | 'router' | 'effect';

interface ReactiveMember {
  name: string;
  signature: string;
  doc: string;
  insertText: string;
  snippet?: boolean;
}

const MEMBERS: Record<ReactiveKind, readonly ReactiveMember[]> = {
  state: [
    { name: 'get', signature: 'get(): T', doc: 'Read the current value. Inside a binding/effect this subscribes to it.', insertText: 'get()' },
    { name: 'set', signature: 'set(next: T): void', doc: 'Write a new value. Dependents update only if the value actually changed.', insertText: 'set(${1:next})', snippet: true },
    { name: 'peek', signature: 'peek(): T', doc: 'Read the current value WITHOUT subscribing.', insertText: 'peek()' },
  ],
  computed: [
    { name: 'get', signature: 'get(): T', doc: 'Read the current value. Recomputes only if a dependency changed.', insertText: 'get()' },
    { name: 'peek', signature: 'peek(): T', doc: 'Read without subscribing.', insertText: 'peek()' },
  ],
  router: [
    { name: 'view', signature: 'view(): Element', doc: 'The outlet the current page renders into. Place it once: `${router.view()}`.', insertText: 'view()' },
    { name: 'link', signature: 'link(path: string, text: string): TemplateResult', doc: 'An `<a>` that navigates without a full page reload.', insertText: 'link(${1:path}, ${2:text})', snippet: true },
    { name: 'go', signature: 'go(path: string): void', doc: 'Navigate programmatically (pushes a history entry).', insertText: 'go(${1:path})', snippet: true },
    { name: 'path', signature: 'path(): string', doc: 'The current path (reactive).', insertText: 'path()' },
    { name: 'query', signature: 'query(): RouteParams', doc: 'The current query string as a plain object (reactive).', insertText: 'query()' },
    { name: 'match', signature: 'match(path?: string): RouteMatch', doc: 'Resolve a path to its matched route without rendering — `{ component, params }`.', insertText: 'match()' },
    { name: 'destroy', signature: 'destroy(): void', doc: 'Remove the back/forward listener (called automatically on unmount).', insertText: 'destroy()' },
  ],
  effect: [
    { name: 'dispose', signature: 'dispose(): void', doc: 'Dispose the effect now. It also auto-disposes with its owner (component/list item).', insertText: 'dispose()' },
  ],
};

/** Factory call → the reactive kind of the value it returns. */
const FACTORY: Record<string, ReactiveKind> = {
  createState: 'state',
  computed: 'computed',
  createRouter: 'router',
  effect: 'effect',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The reactive kind of `name`, inferred from its declaration in `text`
 * (`const name = createState(…)` etc.), or null if it isn't a reactive value.
 */
export function reactiveKindOf(text: string, name: string): ReactiveKind | null {
  const decl = new RegExp(
    `(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=\\s*(?<!\\.)([A-Za-z_$][\\w$]*)\\s*\\(`,
  );
  const match = text.match(decl);
  return match ? FACTORY[match[1]] ?? null : null;
}

/**
 * The receiver identifier of a member access at `offset` (`receiver.partial`),
 * or null when the cursor is not in member position.
 */
export function memberReceiverAt(text: string, offset: number): string | null {
  const match = text.slice(0, offset).match(/([A-Za-z_$][\w$]*)\s*\.\s*[\w$]*$/);
  return match ? match[1] : null;
}

/** Completions for a reactive kind's members (get/set/peek, router methods, …). */
export function reactiveMemberCompletions(kind: ReactiveKind): ZoijsCompletion[] {
  return MEMBERS[kind].map((member) => ({
    label: member.name,
    kind: 'function',
    detail: `${kind} · ${member.signature}`,
    documentation: member.doc,
    insertText: member.insertText,
    snippet: member.snippet,
  }));
}

/**
 * Member completions for the receiver at `offset`, or null when the cursor is not
 * in member position. Returns an empty list for a `.` on an unknown receiver so
 * the caller can suppress unrelated suggestions after a dot.
 */
export function reactiveMembersAt(text: string, offset: number): ZoijsCompletion[] | null {
  const receiver = memberReceiverAt(text, offset);
  if (receiver === null) return null;
  const kind = reactiveKindOf(text, receiver);
  return kind ? reactiveMemberCompletions(kind) : [];
}
