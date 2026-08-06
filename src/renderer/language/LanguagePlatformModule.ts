import * as monaco from 'monaco-editor';
import {
  ServiceKeys,
  type CompilerService,
  type LanguageServerStatus,
  type SettingsService,
  type StatusService,
  type ToolchainService,
  type WorkspaceService,
} from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import { resolveAutosaveMode } from '../editor/unsavedGuard';
import type { CompilerInfo, WorkspaceInfo } from '../../shared/types';
import { CommandIds } from '../commands/CommandIds';
import { CompilerClient } from '../compiler/CompilerClient';
import { ToolchainClient } from '../toolchain/ToolchainClient';
import { enabledCapabilities, supports } from '../../shared/toolchain/negotiation';
import { evaluateToolchain } from '../../shared/toolchain/compatibility';
import { editorMode } from '../../shared/toolchain/offline';
import { toPlatformDiagnostics } from '../compiler/compilerDiagnostics';
import { fastHash } from '../../shared/hash';
import { LanguageServiceKeys, type LanguageActivationContext, type TextDocument } from './api';
import { DiagnosticSources } from './diagnosticSources';
import { DiagnosticsEngine } from './DiagnosticsEngine';
import { DocumentManager, type ManagedDocument } from './DocumentManager';
import { LanguageRegistry } from './LanguageRegistry';
import { MonacoLanguageBridge } from './MonacoLanguageBridge';
import { LanguageServicePlainText } from './languages/LanguageServicePlainText';
import { LanguageServiceZornux } from './languages/LanguageServiceZornux';

const ZORNUX_FRONTEND_SOURCE = DiagnosticSources.ZornuxFrontend; // fast, provisional
const ZORNUX_COMPILER_SOURCE = DiagnosticSources.ZornuxCompiler; // authoritative (real CLI)

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const BUILTIN_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  sql: 'sql',
};

/**
 * The Language Platform module. Constructs and wires the registry, document
 * manager, diagnostics engine and Monaco bridge, then:
 *   - registers native languages (Zornux, Plain Text),
 *   - runs diagnostics on document open/change,
 *   - activates language services per workspace + per opened extension,
 *   - drives autosave from settings.
 *
 * The editor and Problems panel consume this through registered services; the
 * platform never depends on them.
 */
export class LanguagePlatformModule implements IModule {
  readonly id = 'znxstudio.language';
  readonly displayName = 'Language Platform';

  private context!: ModuleContext;
  private registry!: LanguageRegistry;
  private documents!: DocumentManager;
  private engine!: DiagnosticsEngine;
  private bridge!: MonacoLanguageBridge;
  private compiler!: CompilerClient;
  private toolchain!: ToolchainClient;
  private compilerInfo: CompilerInfo | null = null;
  private readonly diagnosticTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly compilerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Content hash of the last APPLIED compiler check per uri (incremental skip). */
  private readonly compilerCheckedHash = new Map<string, string>();

  async activate(context: ModuleContext): Promise<void> {
    this.context = context;

    this.registry = new LanguageRegistry();
    const zornux = new LanguageServiceZornux();
    this.registry.register(zornux);
    this.registry.register(new LanguageServicePlainText());

    this.documents = new DocumentManager((path) => this.resolveLanguageId(path));
    this.engine = new DiagnosticsEngine();
    this.bridge = new MonacoLanguageBridge(this.registry, this.documents, this.engine);
    this.bridge.registerLanguages();

    this.compiler = new CompilerClient();
    this.toolchain = new ToolchainClient();

    // Route the Zornux document formatter through the real `zornux format` CLI
    // when the toolchain is available; the language service falls back to its
    // in-IDE re-indenter when it isn't (info() is cached, so this stays cheap).
    zornux.setCliFormatter(async (source) => {
      const info = await this.compiler.info();
      return info.available ? this.compiler.format(source) : null;
    });

    context.services.register(LanguageServiceKeys.Registry, this.registry);
    context.services.register(LanguageServiceKeys.Documents, this.documents);
    context.services.register(LanguageServiceKeys.Diagnostics, this.engine);
    context.services.register<CompilerService>(ServiceKeys.Compiler, this.compiler);
    context.services.register<ToolchainService>(ServiceKeys.Toolchain, this.toolchain);

    // Baseline language is always active.
    await this.registry.activate('plaintext', this.makeContext(null));

    // Diagnostics pipeline. Two layers per document:
    //   - front-end (fast, provisional) runs on open / debounced on change,
    //   - compiler (authoritative) runs on open / save and debounced on change,
    //     superseding the front-end squiggles once it returns.
    this.documents.onDidOpen((doc) => {
      void this.ensureActivatedForDocument(doc);
      this.scheduleDiagnostics(doc, 0);
      this.scheduleCompilerCheck(doc, 250, false);
    });
    this.documents.onDidChange((doc) => {
      this.scheduleDiagnostics(doc, 300);
      this.scheduleCompilerCheck(doc, 600, true);
    });
    this.documents.onDidSave((doc) => this.scheduleCompilerCheck(doc, 0, false));

    this.wireAutosave(context);
    this.wireCompilerSettings(context);
    this.wireCache(context);
    this.wireWorkspaceActivation(context);

    // 20D: probing the compiler spawns the CLI (~200ms). Do it in the BACKGROUND
    // so it never blocks startup — the status bar shows "checking…" and updates
    // when the probe resolves. This was ~44% of the whole activation pass.
    this.publishCompilerStatus(); // "checking…" while compilerInfo is still null
    void this.compiler.info().then((info) => {
      this.compilerInfo = info;
      this.publishCompilerStatus();
    });

    await selfTestCoordinator.run('language-platform', () => this.maybeRunSelfTest());

    this.publishStatus();
  }

  /* ----- language resolution ----- */
  private resolveLanguageId(path: string): string {
    const extension = path.split('.').pop()?.toLowerCase() ?? '';
    return this.registry.languageIdForExtension(extension) ?? BUILTIN_LANGUAGE[extension] ?? 'plaintext';
  }

  private async ensureActivatedForDocument(doc: ManagedDocument): Promise<void> {
    if (this.registry.get(doc.languageId) && !this.registry.isActive(doc.languageId)) {
      await this.registry.activate(doc.languageId, this.makeContext(this.currentWorkspace()));
      this.publishStatus();
    }
  }

  /* ----- diagnostics pipeline ----- */
  private scheduleDiagnostics(doc: ManagedDocument, delay: number): void {
    const previous = this.diagnosticTimers.get(doc.uri);
    if (previous) clearTimeout(previous);
    this.diagnosticTimers.set(
      doc.uri,
      setTimeout(() => void this.runDiagnostics(doc), delay),
    );
  }

  private async runDiagnostics(doc: ManagedDocument): Promise<void> {
    const service = this.registry.get(doc.languageId);
    if (!service) return;
    // When the language server owns live diagnostics (Zornux), the front-end
    // analyzer stands down to its offline-fallback role — otherwise the same
    // error would squiggle twice (front-end + server). It resumes when the
    // server is down (see scheduleCompilerCheck for the matching gate).
    if (doc.languageId === 'zornux' && this.languageServerRunning()) {
      this.engine.clear(doc.uri, service.metadata.id);
      return;
    }
    try {
      if (this.registry.isActive(doc.languageId) && service.diagnostics) {
        const diagnostics = await service.diagnostics.provideDiagnostics(doc.document);
        this.engine.set(doc.uri, service.metadata.id, diagnostics);
      } else {
        this.engine.clear(doc.uri, service.metadata.id);
      }
    } catch (error) {
      // A misbehaving provider must never crash the pipeline.
      console.error(`[ZnxStudio] diagnostics failed for ${doc.languageId}:`, error);
      this.engine.clear(doc.uri, service.metadata.id);
    }
  }

  /** True when the `zornux lsp` server is up and owns live diagnostics (LSP-B). */
  private languageServerRunning(): boolean {
    return this.context.services.tryGet<LanguageServerStatus>(ServiceKeys.LanguageServer)?.isRunning() ?? false;
  }

  /* ----- compiler diagnostics (authoritative; fallback when the LSP is down) ----- */
  private scheduleCompilerCheck(doc: ManagedDocument, delay: number, invalidate: boolean): void {
    if (doc.languageId !== 'zornux' || !this.compilerEnabled()) return;
    // If we know the compiler is absent, never schedule — the front-end stands alone.
    if (this.compilerInfo && !this.compilerInfo.available) return;
    // When the language server is running it pushes the same authoritative
    // diagnostics live (LSP-B) and owns the compiler source, so the per-check
    // `zornux check` subprocess is redundant — stand down entirely.
    if (this.languageServerRunning()) return;

    // On edit, drop the now-stale authoritative squiggles immediately; the
    // fast front-end provides provisional feedback until the compiler catches up.
    // Forgetting the applied-hash lets the next (changed) content re-check.
    if (invalidate) {
      this.engine.clear(doc.uri, ZORNUX_COMPILER_SOURCE);
      this.compilerCheckedHash.delete(doc.uri);
    }

    const previous = this.compilerTimers.get(doc.uri);
    if (previous) clearTimeout(previous);
    this.compilerTimers.set(
      doc.uri,
      setTimeout(() => void this.runCompilerCheck(doc), delay),
    );
  }

  private async runCompilerCheck(doc: ManagedDocument): Promise<void> {
    const text = doc.model.getValue();
    const hash = fastHash(text);
    // Incremental skip: content unchanged since the last applied check → nothing
    // to do (no IPC, no subprocess). Edits delete this entry via scheduleCompilerCheck.
    if (this.compilerCheckedHash.get(doc.uri) === hash) return;

    const versionAtRequest = doc.model.getVersionId();
    let result;
    try {
      result = await this.compiler.check({
        uri: doc.uri,
        path: doc.path,
        source: text,
        isDirty: doc.dirty,
        workspaceRoot: this.currentWorkspace()?.root ?? null,
        compilerPath: this.compilerPathOverride(),
      });
    } catch {
      return; // client already swallows errors; nothing to paint.
    }

    // Discard stale results — a newer edit (and check) has superseded this one.
    const managed = this.documents.getManaged(doc.uri);
    if (!managed || managed.model.getVersionId() !== versionAtRequest) return;

    if (!result.available) {
      // Compiler vanished at runtime: record it, keep the front-end, stop scheduling.
      this.compilerInfo = { available: false, path: null, version: null, source: 'none' };
      this.engine.clear(doc.uri, ZORNUX_COMPILER_SOURCE);
      this.compilerCheckedHash.delete(doc.uri);
      this.publishCompilerStatus();
      return;
    }
    if (!result.ran) {
      // Usage / not-found / internal error — don't clobber the front-end.
      this.engine.clear(doc.uri, ZORNUX_COMPILER_SOURCE);
      this.compilerCheckedHash.delete(doc.uri);
      return;
    }

    // Authoritative diagnostics for the current version supersede the provisional
    // front-end layer, so clear it to avoid duplicate squiggles.
    this.engine.set(doc.uri, ZORNUX_COMPILER_SOURCE, toPlatformDiagnostics(result.diagnostics, ZORNUX_COMPILER_SOURCE));
    this.engine.clear(doc.uri, ZORNUX_FRONTEND_SOURCE);
    this.compilerCheckedHash.set(doc.uri, hash);
  }

  private compilerEnabled(): boolean {
    const settings = this.context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    return Boolean(settings?.get('zornux.compiler.enabled', true));
  }

  private compilerPathOverride(): string | null {
    const settings = this.context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    const value = settings?.get('zornux.compiler.path', '');
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private wireCompilerSettings(context: ModuleContext): void {
    const settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    settings?.onDidChange((event) => {
      if (!event.key.startsWith('zornux.compiler.')) return;
      // Re-probe (path/enablement changed) and re-check every open Zornux doc.
      void this.compiler.info(true).then((info) => {
        this.compilerInfo = info;
        this.publishCompilerStatus();
        for (const managed of this.openZornuxDocuments()) {
          this.scheduleCompilerCheck(managed, 0, true);
        }
      });
    });
  }

  private openZornuxDocuments(): ManagedDocument[] {
    return this.documents
      .all()
      .map((doc) => this.documents.getManaged(doc.uri))
      .filter((managed): managed is ManagedDocument => !!managed && managed.languageId === 'zornux');
  }

  /* ----- persistent compile cache (Phase 3F) ----- */
  private wireCache(context: ModuleContext): void {
    const settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    const apply = () => void this.compiler.cacheConfig(Boolean(settings?.get('zornux.compiler.cache.enabled', true)));
    apply();
    settings?.onDidChange((event) => {
      if (event.key.startsWith('zornux.compiler.cache.')) apply();
    });

    context.commands.register(
      CommandIds.CacheClear,
      async () => {
        const before = await this.compiler.cacheClear();
        this.context.layout.showToast(
          `Cleared build cache — ${before.entries} entr${before.entries === 1 ? 'y' : 'ies'} (${formatBytes(before.bytes)}).`,
          'info',
        );
      },
      'Zornux: Clear Build Cache',
    );
  }

  private publishCompilerStatus(): void {
    const status = this.context.services.tryGet<StatusService>(ServiceKeys.Status);
    if (!status) return;
    const info = this.compilerInfo;
    if (info === null) {
      // 20D: probe still in flight — honest "checking…" rather than a false "not found".
      status.setItem('compiler', { text: '⚙ zornux: checking…', side: 'right', priority: 17 });
      return;
    }
    if (info.available) {
      status.setItem('compiler', {
        text: `⚙ zornux ${info.version ?? ''}`.trim(),
        tooltip: `Zornux compiler (authoritative diagnostics)\n${info.path ?? ''}`,
        side: 'right',
        priority: 17,
      });
    } else {
      status.setItem('compiler', {
        text: '⚙ zornux: not found',
        tooltip:
          'Zornux compiler not located — using the built-in analyzer only.\n' +
          'Set "zornux.compiler.path" or add zornux to your PATH.',
        side: 'right',
        priority: 17,
      });
    }
  }

  /* ----- autosave ----- */
  private wireAutosave(context: ModuleContext): void {
    const settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    // Resolve the trigger mode (off | afterDelay | onFocusChange | onWindowChange),
    // tolerating the legacy `files.autosave` boolean (Phase 20J WI2). The editor
    // drives the focus/window triggers; the manager owns the afterDelay timer.
    const apply = () =>
      this.documents.setAutosave(
        resolveAutosaveMode(settings?.get<string | undefined>('files.autosaveMode', undefined), settings?.get('files.autosave', false)),
        Number(settings?.get('files.autosaveDelay', 1000)),
      );
    apply();
    settings?.onDidChange((event) => {
      if (event.key.startsWith('files.')) apply();
    });
  }

  /* ----- workspace-driven activation ----- */
  private wireWorkspaceActivation(context: ModuleContext): void {
    const workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    if (!workspace) return;
    const current = workspace.currentWorkspace();
    if (current) void this.activateWorkspace(current);
    workspace.onDidChangeWorkspace((info) => void this.activateWorkspace(info));
  }

  private async activateWorkspace(info: WorkspaceInfo | null): Promise<void> {
    const report = await this.registry.activateForWorkspace(info, (ws) => this.makeContext(ws));
    console.info(
      `[ZnxStudio] language activation → activated=[${report.activated.join(', ')}] builtin=[${report.builtin.join(', ')}]`,
    );
    this.publishStatus();
  }

  private currentWorkspace(): WorkspaceInfo | null {
    return this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace)?.currentWorkspace() ?? null;
  }

  private makeContext(workspace: WorkspaceInfo | null): LanguageActivationContext {
    return {
      documents: this.documents,
      diagnostics: this.engine,
      workspace,
      log: (message) => console.info(`[ZnxStudio:lang] ${message}`),
    };
  }

  private publishStatus(): void {
    const status = this.context.services.tryGet<StatusService>(ServiceKeys.Status);
    const active = this.registry.activeIds();
    status?.setItem('languages', {
      text: `🧠 ${active.length} lang`,
      tooltip: `Active language services: ${active.join(', ') || 'none'}`,
      side: 'right',
      priority: 18,
    });
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeRunSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;

    const log = (message: string) => console.info(`[selftest] ${message}`);
    log(`registry: ${this.registry.list().map((l) => `${l.id}(${l.active ? 'active' : 'idle'})`).join(', ')}`);
    log(`monaco has zornux language: ${monaco.languages.getLanguages().some((l) => l.id === 'zornux')}`);

    // Document lifecycle via an in-memory Zornux document.
    const uri = monaco.Uri.parse('inmemory://selftest/demo.zx');
    const model = monaco.editor.createModel('say "hello\ndefine greeting to "hi"\n', 'zornux', uri);
    const doc: TextDocument = {
      uri: uri.toString(),
      path: 'demo.zx',
      languageId: 'zornux',
      version: model.getVersionId(),
      getText: () => model.getValue(),
      lineCount: () => model.getLineCount(),
      lineAt: (line) => model.getLineContent(line + 1),
    };

    await this.registry.activate('zornux', this.makeContext(null));
    const service = this.registry.get('zornux')!;
    const diagnostics = await service.diagnostics!.provideDiagnostics(doc);
    log(`zornux diagnostics: ${diagnostics.length} → ${diagnostics.map((d) => `${d.code}@L${d.range.start.line + 1}`).join(', ')}`);

    const symbols = (await service.documentSymbols!.provideDocumentSymbols(doc)) ?? [];
    log(`zornux symbols: ${symbols.length} → ${symbols.map((s) => `${s.kind}:${s.name}`).join(', ') || 'none'}`);

    // Semantic analysis: duplicate declaration, undefined identifier, go-to-definition.
    const semSource = 'define value to 1\ndefine value to 2\nfunction main() {\n  say value\n  say missing\n}\n';
    const semUri = monaco.Uri.parse('inmemory://selftest/sem.zx');
    const semModel = monaco.editor.createModel(semSource, 'zornux', semUri);
    const semDoc: TextDocument = {
      uri: semUri.toString(),
      path: 'sem.zx',
      languageId: 'zornux',
      version: semModel.getVersionId(),
      getText: () => semModel.getValue(),
      lineCount: () => semModel.getLineCount(),
      lineAt: (line) => semModel.getLineContent(line + 1),
    };
    const semDiags = await service.diagnostics!.provideDiagnostics(semDoc);
    log(`semantic diagnostics: ${semDiags.length} → ${semDiags.map((d) => d.code).join(', ')}`);
    const def = service.definition ? await service.definition.provideDefinition(semDoc, { line: 3, character: 7 }) : [];
    log(`go-to-definition of 'value' usage → ${def.length ? `L${def[0].range.start.line + 1}:${def[0].range.start.character + 1}` : 'none'}`);

    const completions = service.completion
      ? await service.completion.provideCompletions(semDoc, { line: 3, character: 6 })
      : { items: [] };
    const labels = completions.items.map((item) => item.label);
    log(
      `completions: ${completions.items.length} (symbol 'value'=${labels.includes('value')}, symbol 'main'=${labels.includes('main')}, keyword 'define'=${labels.includes('define')})`,
    );
    semModel.dispose();

    // Hover + signature help.
    const sigSource = 'function greet(name, greeting) {\n  say greeting\n}\n\ncall greet(x, y)\n';
    const sigUri = monaco.Uri.parse('inmemory://selftest/sig.zx');
    const sigModel = monaco.editor.createModel(sigSource, 'zornux', sigUri);
    const sigDoc: TextDocument = {
      uri: sigUri.toString(),
      path: 'sig.zx',
      languageId: 'zornux',
      version: sigModel.getVersionId(),
      getText: () => sigModel.getValue(),
      lineCount: () => sigModel.getLineCount(),
      lineAt: (line) => sigModel.getLineContent(line + 1),
    };
    const hover = service.hover ? await service.hover.provideHover(sigDoc, { line: 0, character: 9 }) : null;
    log(`hover on 'greet' → ${hover ? hover.contents[0].replace(/[`\n]/g, ' ').trim() : 'none'}`);
    const sig = service.signatureHelp
      ? await service.signatureHelp.provideSignatureHelp(sigDoc, { line: 4, character: 13 })
      : null;
    log(`signature help → ${sig ? `${sig.signatures[0].label} activeParam=${sig.activeParameter}` : 'none'}`);
    sigModel.dispose();

    // References + rename.
    const refSource = 'define value to 1\nfunction main() {\n  say value\n  say value\n}\n';
    const refUri = monaco.Uri.parse('inmemory://selftest/ref.zx');
    const refModel = monaco.editor.createModel(refSource, 'zornux', refUri);
    const refDoc: TextDocument = {
      uri: refUri.toString(),
      path: 'ref.zx',
      languageId: 'zornux',
      version: refModel.getVersionId(),
      getText: () => refModel.getValue(),
      lineCount: () => refModel.getLineCount(),
      lineAt: (line) => refModel.getLineContent(line + 1),
    };
    const refs = service.references ? await service.references.provideReferences(refDoc, { line: 2, character: 7 }) : [];
    log(`references of 'value': ${refs.length}`);
    const edit = service.rename ? await service.rename.provideRenameEdits(refDoc, { line: 2, character: 7 }, 'amount') : null;
    const editCount = edit ? Object.values(edit.changes).reduce((total, edits) => total + edits.length, 0) : 0;
    log(`rename 'value'→'amount': ${editCount} edits`);
    const rejected = service.rename ? await service.rename.provideRenameEdits(refDoc, { line: 2, character: 7 }, 'if') : {};
    log(`rename to keyword 'if' rejected: ${rejected === null}`);
    refModel.dispose();

    // Formatting.
    const uglySource = 'function main(){\nsay "hi"\nif true then {\nsay "x"\n}\n}\n';
    const uglyUri = monaco.Uri.parse('inmemory://selftest/fmt.zx');
    const uglyModel = monaco.editor.createModel(uglySource, 'zornux', uglyUri);
    const uglyDoc: TextDocument = {
      uri: uglyUri.toString(),
      path: 'fmt.zx',
      languageId: 'zornux',
      version: uglyModel.getVersionId(),
      getText: () => uglyModel.getValue(),
      lineCount: () => uglyModel.getLineCount(),
      lineAt: (line) => uglyModel.getLineContent(line + 1),
    };
    const fmtEdits = service.formatter
      ? await service.formatter.provideFormattingEdits(uglyDoc, { tabSize: 2, insertSpaces: true })
      : [];
    const formatted = fmtEdits.length ? fmtEdits[0].newText : uglySource;
    const indentedLines = formatted.split('\n').filter((l) => l.startsWith('  ')).length;
    log(`formatting: ${fmtEdits.length} edit, ${indentedLines} indented lines (was 0)`);
    uglyModel.dispose();

    // Code actions / quick fixes.
    const caSource = 'define value to 1\nsay valeu\n';
    const caUri = monaco.Uri.parse('inmemory://selftest/ca.zx');
    const caModel = monaco.editor.createModel(caSource, 'zornux', caUri);
    const caDoc: TextDocument = {
      uri: caUri.toString(),
      path: 'ca.zx',
      languageId: 'zornux',
      version: caModel.getVersionId(),
      getText: () => caModel.getValue(),
      lineCount: () => caModel.getLineCount(),
      lineAt: (line) => caModel.getLineContent(line + 1),
    };
    const actions = service.codeActions
      ? await service.codeActions.provideCodeActions(
          caDoc,
          { start: { line: 1, character: 4 }, end: { line: 1, character: 9 } },
          { diagnostics: [] },
        )
      : [];
    log(`code actions for 'valeu': ${actions.map((a) => a.title).join(' | ') || 'none'}`);
    caModel.dispose();

    // Refactorings (cursor on a constant declaration).
    const rfSource = 'define greeting to "Hello"\nsay greeting\nsay greeting\n';
    const rfUri = monaco.Uri.parse('inmemory://selftest/rf.zx');
    const rfModel = monaco.editor.createModel(rfSource, 'zornux', rfUri);
    const rfDoc: TextDocument = {
      uri: rfUri.toString(),
      path: 'rf.zx',
      languageId: 'zornux',
      version: rfModel.getVersionId(),
      getText: () => rfModel.getValue(),
      lineCount: () => rfModel.getLineCount(),
      lineAt: (line) => rfModel.getLineContent(line + 1),
    };
    const refactors = service.codeActions
      ? (await service.codeActions.provideCodeActions(
          rfDoc,
          { start: { line: 0, character: 7 }, end: { line: 0, character: 7 } },
          { diagnostics: [] },
        )).filter((a) => a.kind?.startsWith('refactor'))
      : [];
    log(`refactorings on 'greeting': ${refactors.map((a) => a.title).join(' | ') || 'none'}`);
    rfModel.dispose();

    this.engine.set(doc.uri, 'zornux', diagnostics);
    log(`engine uris-with-diagnostics: ${this.engine.uris().length}`);

    const report = await this.registry.activateForWorkspace(
      {
        root: '/virtual',
        isZnxStudioProject: true,
        project: {
          name: 'demo',
          type: 'zornux-zoijs-fullstack',
          version: '1.0.0',
          languageTargets: ['zornux'],
          frameworkTargets: ['zoijs'],
        },
        detectedType: 'zornux-zoijs-fullstack',
        diagnostics: [],
      },
      (ws) => this.makeContext(ws),
    );
    log(`activation(fullstack) → activated=[${report.activated.join(', ')}] builtin=[${report.builtin.join(', ')}]`);

    // Compiler service: availability + a real single-file check against the CLI.
    try {
      const info = await this.compiler.info(true);
      log(`compiler: available=${info.available} version=${info.version ?? 'n/a'} source=${info.source} path=${info.path ?? 'n/a'}`);

      // Toolchain negotiation (Integration Layer): product/protocol versions + capabilities.
      const tc = await this.toolchain.info(true);
      const caps = enabledCapabilities(tc);
      log(
        `toolchain: source=${tc.source} product=${tc.productVersion ?? 'n/a'} ` +
          `protocols=[cli ${tc.protocols.cli}, lsp ${tc.protocols.lsp}, dap ${tc.protocols.dap}, manifest ${tc.protocols.projectManifest}] ` +
          `capabilities=${caps.length} (security=${supports(tc, 'securityDiagnostics')}, heap=${supports(tc, 'heapSnapshots')}, ` +
          `remoteDebug=${supports(tc, 'remoteDebug')}, jsonEnvelope=${supports(tc, 'jsonEnvelope')}) ` +
          `compatible=${await this.toolchain.compatible()} status=${evaluateToolchain(tc).status} mode=${editorMode(evaluateToolchain(tc).status)}`,
      );

      if (info.available) {
        const result = await this.compiler.check({
          uri: 'inmemory://selftest/comp.zx',
          path: null,
          source: 'if age is less than 18\n  say "minor"\n',
          isDirty: true,
          workspaceRoot: null,
          compilerPath: this.compilerPathOverride(),
        });
        log(
          `compiler check: available=${result.available} ran=${result.ran} outcome=${result.outcome} cached=${result.cached} ` +
            `diags=${result.diagnostics.length} → ${result.diagnostics.map((d) => `${d.code}@L${d.range.start.line}`).join(', ') || 'none'} (${result.durationMs.toFixed(1)}ms)`,
        );
        const cacheStats = await this.compiler.cacheStats();
        log(`compiler cache (disk): enabled=${cacheStats.enabled} entries=${cacheStats.entries} bytes=${cacheStats.bytes}`);

        // Incremental cache: an identical second check must be served without a subprocess.
        const cachedCheck = await this.compiler.check({
          uri: 'inmemory://selftest/comp.zx',
          path: null,
          source: 'if age is less than 18\n  say "minor"\n',
          isDirty: true,
          workspaceRoot: null,
          compilerPath: this.compilerPathOverride(),
        });
        log(
          `compiler check #2 (incremental): cached=${cachedCheck.cached} diags=${cachedCheck.diagnostics.length} (${cachedCheck.durationMs.toFixed(2)}ms) ` +
            `[first was ${result.durationMs.toFixed(1)}ms]`,
        );

        // Build an on-disk invalid example → structured build diagnostics (no artifact side-effect).
        const build = await this.compiler.build({
          path: 'C:\\Studio Apps\\xojin\\examples\\invalid\\missing_end.zx',
          workspaceRoot: 'C:\\Studio Apps\\xojin',
          compilerPath: this.compilerPathOverride(),
        });
        log(
          `compiler build: available=${build.available} ran=${build.ran} ok=${build.ok} outcome=${build.outcome} ` +
            `diags=${build.diagnostics.length} → ${build.diagnostics.map((d) => d.code).join(', ') || 'none'} ` +
            `artifact=${build.artifact ?? 'none'} (${build.durationMs.toFixed(1)}ms)`,
        );

        const profile = await this.compiler.profile();
        log(
          `compiler profile: ops=${profile.totalOps} cached=${profile.totalCached} ` +
            `commands=[${profile.commands.map((c) => `${c.command}:${c.total}(${c.cached}cached,max${c.maxMs.toFixed(0)}ms)`).join(', ')}] ` +
            `slowest=${profile.slowestFiles.length}`,
        );
      }
    } catch (error) {
      log(`compiler probe failed: ${(error as Error).message}`);
    }

    model.dispose();
    log('self-test complete');
  }
}
