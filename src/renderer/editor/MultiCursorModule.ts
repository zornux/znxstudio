import * as monaco from 'monaco-editor';
import {
  ServiceKeys,
  type CursorSelection,
  type EditorService,
  type StatusService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { findOccurrences, formatCursorStatus, wordRangeAt } from './multiCursor';

/** Built-in Monaco actions we surface as first-class ZnxStudio commands. */
const MONACO_ACTIONS = {
  addAbove: 'editor.action.insertCursorAbove',
  addBelow: 'editor.action.insertCursorBelow',
  addNext: 'editor.action.addSelectionToNextFindMatch',
  perLine: 'editor.action.insertCursorAtEndOfEachLineSelected',
} as const;

/**
 * Multi-Cursor (Phase 7C). Monaco already provides multi-cursor editing (its
 * keybindings are live in the editor); this module makes those actions
 * discoverable in the command palette, adds an occurrence-select command that
 * works without the find widget, and drives a live caret/selection status item.
 * It owns no Monaco of its own — it goes through the Editor service primitives.
 */
export class MultiCursorModule implements IModule {
  readonly id = 'znxstudio.multicursor';
  readonly displayName = 'Multi-Cursor';

  private editor!: EditorService;
  private status: StatusService | undefined;

  activate(context: ModuleContext): void {
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);

    const commands = context.commands;
    commands.register(
      CommandIds.MultiCursorAddAbove,
      () => this.editor.runEditorAction(MONACO_ACTIONS.addAbove),
      'Editor: Add Cursor Above',
    );
    commands.register(
      CommandIds.MultiCursorAddBelow,
      () => this.editor.runEditorAction(MONACO_ACTIONS.addBelow),
      'Editor: Add Cursor Below',
    );
    commands.register(
      CommandIds.MultiCursorAddNext,
      () => this.editor.runEditorAction(MONACO_ACTIONS.addNext),
      'Editor: Add Cursor to Next Occurrence',
    );
    commands.register(
      CommandIds.MultiCursorPerLine,
      () => this.editor.runEditorAction(MONACO_ACTIONS.perLine),
      'Editor: Add Cursors to Line Ends',
    );
    commands.register(
      CommandIds.MultiCursorSelectAll,
      () => this.selectAllOccurrences(),
      'Editor: Select All Occurrences',
    );
    commands.register(
      CommandIds.MultiCursorClear,
      () => this.clearToPrimary(),
      'Editor: Clear Extra Cursors',
    );

    context.subscriptions.push(this.editor.onDidChangeSelections((selections) => this.updateStatus(selections)));
    context.subscriptions.push(this.editor.onDidChangeActiveFile(() => this.updateStatus(this.editor.getSelections())));

    void selfTestCoordinator.run('multicursor', () => this.maybeSelfTest());
  }

  /**
   * Place a cursor at every occurrence of the primary selection's text (or, for a
   * bare caret, the word under it — matched whole-word). Computed from the model
   * text, so it doesn't depend on the find widget's state.
   */
  private selectAllOccurrences(): void {
    const text = this.editor.activeText();
    const selections = this.editor.getSelections();
    if (text === null || selections.length === 0) return;

    const primary = selections[0];
    let target: string;
    let wholeWord: boolean;
    if (isEmpty(primary)) {
      const word = wordRangeAt(text, primary.startLine, primary.startCharacter);
      if (!word) return;
      target = sliceRange(text, word);
      wholeWord = true;
    } else {
      target = sliceRange(text, primary);
      wholeWord = false;
    }

    const occurrences = findOccurrences(text, target, { caseSensitive: true, wholeWord });
    if (occurrences.length === 0) return;
    this.editor.setSelections(occurrences);
  }

  /** Collapse a multi-cursor back down to just the primary cursor. */
  private clearToPrimary(): void {
    const selections = this.editor.getSelections();
    if (selections.length <= 1) return;
    this.editor.setSelections([selections[0]]);
  }

  private updateStatus(selections: CursorSelection[]): void {
    if (!this.status) return;
    if (selections.length === 0) {
      this.status.removeItem('editor.cursors');
      return;
    }
    const primary = selections[0];
    const text = formatCursorStatus(
      { line: primary.startLine, character: primary.startCharacter },
      selections.length,
      this.editor.selectedCharCount(),
    );
    this.status.setItem('editor.cursors', {
      text,
      tooltip: 'Cursor — click to select all occurrences',
      command: CommandIds.MultiCursorSelectAll,
      side: 'right',
      priority: 25,
    });
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    // Prove the pure ranges round-trip through a REAL Monaco editor (the editor
    // engine): occurrences → setSelections → the editor reports that many cursors.
    let host: HTMLElement | undefined;
    let editor: monaco.editor.IStandaloneCodeEditor | undefined;
    let model: monaco.editor.ITextModel | undefined;
    try {
      host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;width:400px;height:200px';
      document.body.appendChild(host);
      const text = 'let count = 1\nlet total = count + count\nprint(count)\n';
      model = monaco.editor.createModel(text, 'plaintext');
      editor = monaco.editor.create(host, { model });

      const occurrences = findOccurrences(text, 'count', { caseSensitive: true, wholeWord: true });
      editor.setSelections(
        occurrences.map(
          (s) => new monaco.Selection(s.startLine + 1, s.startCharacter + 1, s.endLine + 1, s.endCharacter + 1),
        ),
      );
      log(
        `multicursor occurrences('count'): found=${occurrences.length} editorCursors=${editor.getSelections()?.length ?? 0}`,
      );

      const word = wordRangeAt(text, 1, 12); // caret inside "count" on line 2
      log(`multicursor wordAt(1,12): word="${word ? sliceRange(text, word) : '-'}"`);

      const action = editor.getAction(MONACO_ACTIONS.addBelow);
      editor.setSelection(new monaco.Selection(1, 1, 1, 1));
      await action?.run();
      log(
        `multicursor addBelow: action=${action ? 'present' : 'missing'} cursors=${editor.getSelections()?.length ?? 0}`,
      );

      log(`multicursor status: "${formatCursorStatus({ line: 1, character: 11 }, occurrences.length, 15)}"`);
    } catch (error) {
      log(`multicursor self-test failed: ${(error as Error).message}`);
    } finally {
      editor?.dispose();
      model?.dispose();
      host?.remove();
    }
  }
}

/** Is the selection an empty range (a bare caret)? */
function isEmpty(selection: CursorSelection): boolean {
  return selection.startLine === selection.endLine && selection.startCharacter === selection.endCharacter;
}

/** The substring covered by a 0-based selection. */
function sliceRange(text: string, selection: CursorSelection): string {
  const lines = text.split('\n');
  if (selection.startLine === selection.endLine) {
    return lines[selection.startLine].slice(selection.startCharacter, selection.endCharacter);
  }
  const parts = [lines[selection.startLine].slice(selection.startCharacter)];
  for (let i = selection.startLine + 1; i < selection.endLine; i += 1) parts.push(lines[i]);
  parts.push(lines[selection.endLine].slice(0, selection.endCharacter));
  return parts.join('\n');
}
