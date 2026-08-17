/**
 * Generic command-pattern undo/redo stack for the visual designer. Each action
 * is an object with execute/undo methods and a human-readable label for the
 * Edit menu.
 */

import { Emitter, type Event } from '../core/Emitter';

export interface DesignerAction {
  readonly label: string;
  execute(): void;
  undo(): void;
}

export class UndoRedoStack {
  private readonly done: DesignerAction[] = [];
  private readonly undone: DesignerAction[] = [];
  private readonly maxDepth: number;

  private readonly _onDidChange = new Emitter<void>();
  readonly onDidChange: Event<void> = this._onDidChange.event;

  constructor(maxDepth = 200) {
    this.maxDepth = maxDepth;
  }

  push(action: DesignerAction): void {
    action.execute();
    this.done.push(action);
    if (this.done.length > this.maxDepth) this.done.shift();
    this.undone.length = 0;
    this._onDidChange.fire();
  }

  undo(): DesignerAction | null {
    const action = this.done.pop();
    if (!action) return null;
    action.undo();
    this.undone.push(action);
    this._onDidChange.fire();
    return action;
  }

  redo(): DesignerAction | null {
    const action = this.undone.pop();
    if (!action) return null;
    action.execute();
    this.done.push(action);
    this._onDidChange.fire();
    return action;
  }

  canUndo(): boolean {
    return this.done.length > 0;
  }

  canRedo(): boolean {
    return this.undone.length > 0;
  }

  undoLabel(): string | null {
    return this.done.length > 0 ? this.done[this.done.length - 1].label : null;
  }

  redoLabel(): string | null {
    return this.undone.length > 0 ? this.undone[this.undone.length - 1].label : null;
  }

  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
    this._onDidChange.fire();
  }

  dispose(): void {
    this.clear();
    this._onDidChange.dispose();
  }
}
