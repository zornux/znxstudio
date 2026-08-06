/**
 * Operational transform over plain text (Phase 16B) — the correctness core of
 * live collaboration.
 *
 * Two people typing in the same file at the same time produce edits against
 * DIFFERENT versions of the document. Applying them naively diverges. OT solves
 * this with one algebraic guarantee, the TP1 property:
 *
 *     given `a` and `b` both written against the same document,
 *     [a', b'] = transform(a, b)   satisfies   apply(apply(d, a), b') === apply(apply(d, b), a')
 *
 * Everything else in Phase 16B is bookkeeping around that identity. It is
 * property-tested against randomly generated edits, not just examples.
 *
 * An operation is a sequence of components that together consume the whole
 * document: `retain n` copies, `insert s` adds, `delete n` removes. So an
 * operation is only meaningful against a document of exactly `baseLength`
 * characters, and produces one of exactly `targetLength`.
 */

export type Op = { retain: number } | { insert: string } | { delete: number };

export function isRetain(op: Op): op is { retain: number } {
  return 'retain' in op;
}
export function isInsert(op: Op): op is { insert: string } {
  return 'insert' in op;
}
export function isDelete(op: Op): op is { delete: number } {
  return 'delete' in op;
}

/** How many characters of the source document this operation consumes. */
export function baseLength(ops: Op[]): number {
  return ops.reduce((total, op) => total + (isRetain(op) ? op.retain : isDelete(op) ? op.delete : 0), 0);
}

/** How many characters the resulting document has. */
export function targetLength(ops: Op[]): number {
  return ops.reduce((total, op) => total + (isRetain(op) ? op.retain : isInsert(op) ? op.insert.length : 0), 0);
}

/**
 * Appends components, merging adjacent ones of the same kind and dropping
 * empties, so equivalent operations have one canonical form.
 */
class OpBuilder {
  readonly ops: Op[] = [];

  retain(n: number): this {
    if (n <= 0) return this;
    const last = this.ops[this.ops.length - 1];
    if (last && isRetain(last)) last.retain += n;
    else this.ops.push({ retain: n });
    return this;
  }

  insert(text: string): this {
    if (!text) return this;
    const last = this.ops[this.ops.length - 1];
    // Keep insert before delete at the same position, so a replace is canonical.
    if (last && isInsert(last)) {
      last.insert += text;
      return this;
    }
    if (last && isDelete(last)) {
      const previous = this.ops[this.ops.length - 2];
      if (previous && isInsert(previous)) previous.insert += text;
      else this.ops.splice(this.ops.length - 1, 0, { insert: text });
      return this;
    }
    this.ops.push({ insert: text });
    return this;
  }

  delete(n: number): this {
    if (n <= 0) return this;
    const last = this.ops[this.ops.length - 1];
    if (last && isDelete(last)) last.delete += n;
    else this.ops.push({ delete: n });
    return this;
  }
}

/** Walks an operation, letting a caller take components in arbitrary slices. */
class OpIterator {
  private index = 0;
  private offset = 0;

  constructor(private readonly ops: Op[]) {}

  hasNext(): boolean {
    return this.index < this.ops.length;
  }

  /** Length remaining in the current component, or Infinity when exhausted. */
  peekLength(): number {
    const op = this.ops[this.index];
    if (!op) return Infinity;
    if (isInsert(op)) return op.insert.length - this.offset;
    if (isRetain(op)) return op.retain - this.offset;
    return op.delete - this.offset;
  }

  peekType(): 'retain' | 'insert' | 'delete' | 'end' {
    const op = this.ops[this.index];
    if (!op) return 'end';
    return isInsert(op) ? 'insert' : isRetain(op) ? 'retain' : 'delete';
  }

  /** Take up to `length` of the current component. */
  next(length: number): Op {
    const op = this.ops[this.index];
    if (!op) return { retain: length === Infinity ? 0 : length };

    // The slice starts at the CURRENT offset, so read it before advancing.
    const start = this.offset;
    const remaining = this.peekLength();
    const taken = Math.min(length, remaining);
    if (taken === remaining) {
      this.index += 1;
      this.offset = 0;
    } else {
      this.offset += taken;
    }

    if (isInsert(op)) return { insert: op.insert.substr(start, taken) };
    if (isRetain(op)) return { retain: taken };
    return { delete: taken };
  }
}

/** Apply an operation to a document. Throws when it does not fit. */
export function apply(document: string, ops: Op[]): string {
  if (baseLength(ops) !== document.length) {
    throw new Error(`operation spans ${baseLength(ops)} characters but the document has ${document.length}`);
  }
  let cursor = 0;
  let result = '';
  for (const op of ops) {
    if (isRetain(op)) {
      result += document.slice(cursor, cursor + op.retain);
      cursor += op.retain;
    } else if (isInsert(op)) {
      result += op.insert;
    } else {
      cursor += op.delete;
    }
  }
  return result;
}

/**
 * `compose(a, b)` is the single operation with the same effect as applying `a`
 * then `b`. Requires `targetLength(a) === baseLength(b)`.
 */
export function compose(a: Op[], b: Op[]): Op[] {
  if (targetLength(a) !== baseLength(b)) {
    throw new Error('cannot compose: the second operation does not apply to the first result');
  }
  const left = new OpIterator(a);
  const right = new OpIterator(b);
  const out = new OpBuilder();

  while (left.hasNext() || right.hasNext()) {
    // A delete in `a` removed text `b` never saw; a insert in `b` is new text `a` never saw.
    if (left.peekType() === 'delete') {
      out.delete((left.next(Infinity) as { delete: number }).delete);
      continue;
    }
    if (right.peekType() === 'insert') {
      out.insert((right.next(Infinity) as { insert: string }).insert);
      continue;
    }

    const length = Math.min(left.peekLength(), right.peekLength());
    const leftOp = left.next(length);
    const rightOp = right.next(length);

    if (isRetain(rightOp)) {
      if (isRetain(leftOp)) out.retain(length);
      else if (isInsert(leftOp)) out.insert(leftOp.insert);
    } else if (isDelete(rightOp)) {
      // `b` deletes what `a` retained (a real delete) or what `a` inserted (they cancel).
      if (isRetain(leftOp)) out.delete(length);
    }
  }
  return out.ops;
}

/**
 * Transform two operations written against the SAME document into a pair that
 * can be applied after one another, in either order, to reach the same result.
 * `a` has insert priority: when both insert at one point, `a`'s text lands first.
 */
export function transform(a: Op[], b: Op[]): [Op[], Op[]] {
  if (baseLength(a) !== baseLength(b)) {
    throw new Error('cannot transform: operations were written against different documents');
  }
  const left = new OpIterator(a);
  const right = new OpIterator(b);
  const aPrime = new OpBuilder();
  const bPrime = new OpBuilder();

  while (left.hasNext() || right.hasNext()) {
    if (left.peekType() === 'insert') {
      const inserted = (left.next(Infinity) as { insert: string }).insert;
      aPrime.insert(inserted);
      bPrime.retain(inserted.length);
      continue;
    }
    if (right.peekType() === 'insert') {
      const inserted = (right.next(Infinity) as { insert: string }).insert;
      aPrime.retain(inserted.length);
      bPrime.insert(inserted);
      continue;
    }

    const length = Math.min(left.peekLength(), right.peekLength());
    const leftType = left.peekType();
    const rightType = right.peekType();
    left.next(length);
    right.next(length);

    if (leftType === 'retain' && rightType === 'retain') {
      aPrime.retain(length);
      bPrime.retain(length);
    } else if (leftType === 'delete' && rightType === 'delete') {
      // Both removed the same text; neither has anything left to do.
    } else if (leftType === 'delete') {
      aPrime.delete(length);
    } else if (rightType === 'delete') {
      bPrime.delete(length);
    }
  }
  return [aPrime.ops, bPrime.ops];
}

/** The identity operation over a document of `length` characters. */
export function identity(length: number): Op[] {
  return length > 0 ? [{ retain: length }] : [];
}

/**
 * The operation for one editor change: replace `[start, end)` with `text` in a
 * document of `documentLength` characters.
 */
export function replaceRange(documentLength: number, start: number, end: number, text: string): Op[] {
  const builder = new OpBuilder();
  builder.retain(start);
  builder.insert(text);
  builder.delete(end - start);
  builder.retain(documentLength - end);
  return builder.ops;
}

/** One edit, in character offsets against the document the operation was written for. */
export interface OffsetEdit {
  startOffset: number;
  endOffset: number;
  text: string;
}

/**
 * The operation expressed as editor edits. Offsets refer to the document BEFORE
 * the operation, so an editor can apply them all in one batch. An insert next to
 * a delete becomes a single replace, which is what a user sees as one change.
 */
export function opsToEdits(ops: Op[]): OffsetEdit[] {
  const edits: OffsetEdit[] = [];
  let cursor = 0;
  for (const op of ops) {
    if (isRetain(op)) {
      cursor += op.retain;
      continue;
    }
    const last = edits[edits.length - 1];
    const adjacent = last && last.endOffset === cursor && last.startOffset === cursor;
    if (isInsert(op)) {
      if (last && last.endOffset === cursor && last.text === '') last.text = op.insert;
      else if (adjacent) last.text += op.insert;
      else edits.push({ startOffset: cursor, endOffset: cursor, text: op.insert });
    } else {
      if (last && last.endOffset === cursor && last.text !== '' && last.startOffset === cursor) last.endOffset = cursor + op.delete;
      else edits.push({ startOffset: cursor, endOffset: cursor + op.delete, text: '' });
      cursor += op.delete;
    }
  }
  return edits;
}

/**
 * Where a cursor at `position` ends up after `ops` is applied. An insert exactly
 * at the cursor pushes it right only when the cursor belongs to the author of
 * that insert (`insertBefore` false) — otherwise the remote caret stays put.
 */
export function transformPosition(position: number, ops: Op[], insertBefore = false): number {
  let cursor = 0;
  let result = position;
  for (const op of ops) {
    if (cursor > position) break;
    if (isRetain(op)) {
      cursor += op.retain;
    } else if (isInsert(op)) {
      if (cursor < position || (cursor === position && !insertBefore)) result += op.insert.length;
    } else {
      // Text removed before the cursor pulls it left; text removed under it collapses onto the start.
      result -= Math.min(op.delete, Math.max(0, position - cursor));
      cursor += op.delete;
    }
  }
  return result;
}
