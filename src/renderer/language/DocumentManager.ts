import * as monaco from 'monaco-editor';
import { Emitter } from '../core/Emitter';
import type { DocumentStore, TextDocument } from './api';
import type { AutosaveMode } from '../editor/unsavedGuard';
import { SerialTaskQueue } from './SerialTaskQueue';

/** TextDocument adapter over a Monaco model — keeps services Monaco-free. */
class ModelTextDocument implements TextDocument {
  constructor(
    private readonly model: monaco.editor.ITextModel,
    readonly uri: string,
    readonly path: string,
    readonly languageId: string,
  ) {}

  get version(): number {
    return this.model.getVersionId();
  }
  getText(): string {
    return this.model.getValue();
  }
  lineCount(): number {
    return this.model.getLineCount();
  }
  lineAt(line: number): string {
    const clamped = Math.min(Math.max(line + 1, 1), this.model.getLineCount());
    return this.model.getLineContent(clamped);
  }
}

export interface ManagedDocument {
  uri: string;
  path: string;
  languageId: string;
  dirty: boolean;
  readonly model: monaco.editor.ITextModel;
  readonly document: TextDocument;
  /** Last content read from or successfully written to disk. */
  diskContent: string;
  externalConflict: boolean;
}

/**
 * The document system. Single owner of the editor models. Tracks open documents,
 * dirty state, versioning (via the model version id), save + autosave, and the
 * active document. Language services consume documents through DocumentStore.
 */
export class DocumentManager implements DocumentStore {
  private readonly docs = new Map<string, ManagedDocument>();
  private active: string | null = null;
  private autosaveMode: AutosaveMode = 'off';
  private autosaveDelay = 1000;
  private readonly autosaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly closePreparations = new Set<string>();
  /** Per-document tails keep filesystem writes in edit order. */
  private readonly saveQueue = new SerialTaskQueue();

  private readonly openEmitter = new Emitter<ManagedDocument>();
  private readonly changeEmitter = new Emitter<ManagedDocument>();
  private readonly activeEmitter = new Emitter<ManagedDocument | null>();
  private readonly saveEmitter = new Emitter<ManagedDocument>();
  private readonly saveErrorEmitter = new Emitter<{ document: ManagedDocument; error: unknown }>();
  private readonly closeEmitter = new Emitter<ManagedDocument>();
  readonly onDidOpen = this.openEmitter.event;
  readonly onDidChange = this.changeEmitter.event;
  readonly onDidChangeActive = this.activeEmitter.event;
  readonly onDidSave = this.saveEmitter.event;
  /** Fires when a manual save or autosave fails; the document remains dirty. */
  readonly onDidSaveError = this.saveErrorEmitter.event;
  /** Fires after a document is closed and its model disposed. */
  readonly onDidClose = this.closeEmitter.event;

  constructor(private readonly resolveLanguageId: (path: string) => string) {}

  async open(path: string): Promise<ManagedDocument> {
    const uri = monaco.Uri.file(path);
    const key = uri.toString();
    const existing = this.docs.get(key);
    if (existing) return existing;

    const content = await window.znxstudio.fs.readFile(path);
    return this.openFromContent(path, content);
  }

  /** Open content already obtained through an explicit trusted user action (Save As). */
  openFromContent(path: string, content: string): ManagedDocument {
    const uri = monaco.Uri.file(path);
    const key = uri.toString();
    const existing = this.docs.get(key);
    if (existing) return existing;
    const languageId = this.resolveLanguageId(path);
    const model =
      monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, languageId, uri);

    const managed: ManagedDocument = {
      uri: key,
      path,
      languageId,
      dirty: false,
      diskContent: content,
      externalConflict: false,
      model,
      document: new ModelTextDocument(model, key, path, languageId),
    };
    this.docs.set(key, managed);

    model.onDidChangeContent(() => {
      managed.dirty = true;
      this.changeEmitter.fire(managed);
      this.scheduleAutosave(managed);
    });

    this.openEmitter.fire(managed);
    return managed;
  }

  /* ----- DocumentStore ----- */
  get(uri: string): TextDocument | undefined {
    return this.docs.get(uri)?.document;
  }
  all(): TextDocument[] {
    return [...this.docs.values()].map((d) => d.document);
  }

  /* ----- Editor-facing ----- */
  getManaged(uri: string): ManagedDocument | undefined {
    return this.docs.get(uri);
  }
  /** Every open document with its dirty flag — the crash snapshot reads this. */
  allManaged(): ManagedDocument[] {
    return [...this.docs.values()];
  }
  models(): monaco.editor.ITextModel[] {
    return [...this.docs.values()].map((d) => d.model);
  }

  setActive(uri: string): void {
    this.active = uri;
    this.activeEmitter.fire(this.docs.get(uri) ?? null);
  }
  getActive(): ManagedDocument | null {
    return this.active ? this.docs.get(this.active) ?? null : null;
  }

  /* ----- Save / autosave ----- */
  save(uri: string, options: { overwriteExternal?: boolean } = {}): Promise<void> {
    return this.saveQueue.enqueue(uri, () => this.performSave(uri, options));
  }

  private async performSave(uri: string, options: { overwriteExternal?: boolean }): Promise<void> {
    const managed = this.docs.get(uri);
    if (!managed) return;
    const version = managed.model.getVersionId();
    const content = managed.model.getValue();
    try {
      if (!options.overwriteExternal) {
        let diskContent: string;
        try {
          diskContent = await window.znxstudio.fs.readFile(managed.path);
        } catch {
          managed.externalConflict = true;
          throw new Error('The file was removed from disk. Restore it or choose Overwrite to recreate it.');
        }
        if (diskContent !== managed.diskContent) {
          managed.externalConflict = true;
          throw new Error('The file changed on disk. Review it or choose Overwrite to keep your changes.');
        }
      }
      await window.znxstudio.fs.writeFile(managed.path, content);
      managed.diskContent = content;
      managed.externalConflict = false;
      // Edits made while the IPC write was in flight are newer than the bytes
      // written to disk and must remain visibly dirty.
      managed.dirty = managed.model.getVersionId() !== version;
      this.saveEmitter.fire(managed);
    } catch (error) {
      managed.dirty = true;
      this.saveErrorEmitter.fire({ document: managed, error });
      throw error;
    }
  }
  async saveActive(): Promise<void> {
    if (this.active) await this.save(this.active);
  }

  /** Let close/discard flows observe the final state of an in-flight autosave. */
  async waitForPendingSave(uri: string): Promise<void> {
    await this.saveQueue.whenIdle(uri);
  }

  /** Pause timer-driven autosave for the full duration of a close confirmation. */
  async prepareForClose(uri: string): Promise<void> {
    this.closePreparations.add(uri);
    const timer = this.autosaveTimers.get(uri);
    if (timer) clearTimeout(timer);
    this.autosaveTimers.delete(uri);
    await this.waitForPendingSave(uri);
  }

  /** Resume normal autosave when a prepared close is cancelled. */
  cancelClosePreparation(uri: string): void {
    this.closePreparations.delete(uri);
    const managed = this.docs.get(uri);
    if (managed?.dirty) this.scheduleAutosave(managed);
  }

  /** Replace an open model with the current file contents from disk. */
  async revert(uri: string): Promise<void> {
    const managed = this.docs.get(uri);
    if (!managed) return;
    const content = await window.znxstudio.fs.readFile(managed.path);
    if (managed.model.getValue() !== content) managed.model.setValue(content);
    const timer = this.autosaveTimers.get(uri);
    if (timer) clearTimeout(timer);
    this.autosaveTimers.delete(uri);
    managed.dirty = false;
    managed.diskContent = content;
    managed.externalConflict = false;
    this.saveEmitter.fire(managed);
  }

  /** Refresh clean buffers and flag dirty buffers whose file changed externally. */
  async checkExternalChanges(): Promise<{ reloaded: string[]; conflicts: string[]; missing: string[] }> {
    const result = { reloaded: [] as string[], conflicts: [] as string[], missing: [] as string[] };
    for (const managed of this.docs.values()) {
      let content: string;
      try {
        content = await window.znxstudio.fs.readFile(managed.path);
      } catch {
        if (!managed.externalConflict) result.missing.push(managed.path);
        managed.externalConflict = true;
        // The in-memory buffer may now be the only copy. Treat it as unsaved so
        // tab/window close guards cannot discard it silently.
        if (!managed.dirty) {
          managed.dirty = true;
          this.changeEmitter.fire(managed);
        }
        continue;
      }
      if (content === managed.diskContent) continue;
      if (managed.dirty) {
        if (!managed.externalConflict) result.conflicts.push(managed.path);
        managed.externalConflict = true;
        continue;
      }
      managed.model.setValue(content);
      const timer = this.autosaveTimers.get(managed.uri);
      if (timer) clearTimeout(timer);
      this.autosaveTimers.delete(managed.uri);
      managed.diskContent = content;
      managed.externalConflict = false;
      managed.dirty = false;
      this.saveEmitter.fire(managed);
      result.reloaded.push(managed.path);
    }
    return result;
  }

  setAutosave(mode: AutosaveMode, delay = 1000): void {
    this.autosaveMode = mode;
    this.autosaveDelay = delay;
  }
  autosave(): AutosaveMode {
    return this.autosaveMode;
  }
  private scheduleAutosave(managed: ManagedDocument): void {
    // Only the delay mode saves on a timer; focus/window-change modes are driven
    // by the editor's blur events via saveAllDirty().
    if (this.autosaveMode !== 'afterDelay' || this.closePreparations.has(managed.uri)) return;
    const previous = this.autosaveTimers.get(managed.uri);
    if (previous) clearTimeout(previous);
    this.autosaveTimers.set(
      managed.uri,
      setTimeout(() => void this.save(managed.uri).catch(() => undefined), this.autosaveDelay),
    );
  }

  /** Save every document with unsaved edits — used by the focus/window-change autosave triggers. */
  async saveAllDirty(): Promise<void> {
    await Promise.all([...this.docs.values()].filter((doc) => doc.dirty).map((doc) => this.save(doc.uri)));
  }

  close(uri: string): void {
    const managed = this.docs.get(uri);
    if (!managed) return;
    // Cancel any pending autosave timer so a closed doc's timer can't fire.
    const timer = this.autosaveTimers.get(uri);
    if (timer) clearTimeout(timer);
    this.autosaveTimers.delete(uri);
    this.closePreparations.delete(uri);
    this.saveQueue.forget(uri);
    managed.model.dispose();
    this.docs.delete(uri);
    if (this.active === uri) {
      this.active = null;
      this.activeEmitter.fire(null);
    }
    this.closeEmitter.fire(managed);
  }
}
