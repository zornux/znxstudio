import * as monaco from 'monaco-editor';
import type { IModule, ModuleContext } from '../../core/Module';
import { selfTestCoordinator } from '../../core/SelfTestCoordinator';
import {
  ServiceKeys,
  type LanguageServerStatus,
  type SettingsService,
  type StatusService,
  type WorkspaceService,
} from '../../core/Contracts';
import type { LspStartResult, WorkspaceInfo } from '../../../shared/types';
import { CommandIds } from '../../commands/CommandIds';
import { LanguageServiceKeys, type DiagnosticSink, type DiagnosticsReader } from '../api';
import { DiagnosticSources } from '../diagnosticSources';
import { DocumentManager, type ManagedDocument } from '../DocumentManager';
import { LanguageRegistry } from '../LanguageRegistry';
import { LspLanguageClient } from './LspLanguageClient';
import { toPlatformDiagnostics } from './lspDiagnostics';
import { examplePath, tempPath } from '../../core/selftestFixtures';
import {
  LIVE_SECURITY_CAVEAT,
  buildConfigurationChange,
  buildZornuxSettings,
  partitionDiagnostics,
} from './lspSecurity';
import { LspProviders, type LspProviderBackend } from './LspProviders';
import { ZORNUX_SEMANTIC_LEGEND } from './semanticLegend';
import { isMobileZornux } from '../languages/zornux/mobileSyntax';

/** A language service that can be backed by the LSP server (LanguageServiceZornux). */
interface LspBackedService {
  setLspBackend(backend: LspProviderBackend | null): void;
}
function supportsLspBackend(service: unknown): service is LspBackedService {
  return typeof (service as LspBackedService | undefined)?.setLspBackend === 'function';
}

/** LSP push diagnostics are the authoritative live layer — same bucket the
 *  subprocess `zornux check` used, so the Problems panel/squiggles are unchanged. */
const LSP_DIAGNOSTIC_SOURCE = DiagnosticSources.ZornuxCompiler;

/** Live ZX37xx findings live in their own bucket (see `lspSecurity.ts`). */
const SECURITY_SOURCE = DiagnosticSources.ZornuxSecurity;

/** Persisted preference: publish live security findings as you type. */
const SECURITY_SETTING = 'zornux.lsp.security';

/**
 * Hosts the live connection to the real `zornux lsp` server. LSP-B: starts the
 * server for the workspace, mirrors document opens/edits/closes to it
 * (textDocument/didOpen|didChange|didClose), and routes its pushed diagnostics
 * into the DiagnosticsEngine — making the server the authoritative live
 * diagnostics provider (the Language Platform's `zornux check` subprocess stands
 * down while it runs). Later phases wire the server's answers into Monaco
 * providers (completion/hover/…) via the same `LspLanguageClient`.
 */
export class LspModule implements IModule {
  readonly id = 'znxstudio.languageServer';
  readonly displayName = 'Zornux Language Server';

  private context!: ModuleContext;
  private readonly client = new LspLanguageClient();
  private readonly backend = new LspProviders(this.client);
  private documents: DocumentManager | undefined;
  private engine: (DiagnosticSink & DiagnosticsReader) | undefined;
  private registry: LanguageRegistry | undefined;
  private workspace: WorkspaceService | undefined;
  private compilerPath: string | null = null;
  private lastStart: LspStartResult | null = null;
  private settings: SettingsService | undefined;
  /** Publish live ZX37xx findings as you type. Off by default, like the server. */
  private securityEnabled = false;
  /** Mobile DSL documents are owned by the designer-aware local language
   * service. Keeping them out of an older generic Zornux LSP prevents stale
   * parser diagnostics from racing back after the mobile bucket is cleared. */
  private readonly mobileDocuments = new Set<string>();
  /** Resolves once the initial server-start attempt settles (for the self-test). */
  private ready: Promise<void> = Promise.resolve();

  activate(context: ModuleContext): void {
    this.context = context;
    this.documents = context.services.tryGet<DocumentManager>(LanguageServiceKeys.Documents);
    this.engine = context.services.tryGet<DiagnosticSink & DiagnosticsReader>(LanguageServiceKeys.Diagnostics);
    this.registry = context.services.tryGet<LanguageRegistry>(LanguageServiceKeys.Registry);
    this.workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    this.securityEnabled = this.settings?.get<boolean>(SECURITY_SETTING, false) ?? false;

    context.commands.register(
      CommandIds.LspToggleSecurity,
      () => void this.setSecurityEnabled(!this.securityEnabled),
      'Security: Toggle Live Diagnostics',
    );

    // Back the Zornux service's completion/hover with the server (LSP-C). The
    // backend guards on isRunning/isOpen, so it's safe to inject up front: it
    // simply defers to the TS analysis whenever the server can't answer.
    const zornux = this.registry?.get('zornux');
    if (zornux && supportsLspBackend(zornux)) zornux.setLspBackend(this.backend);

    // Advertise server status so the Language Platform can stand its subprocess
    // check down while the server owns live diagnostics.
    const status: LanguageServerStatus = { isRunning: () => this.client.isRunning() };
    context.services.register(ServiceKeys.LanguageServer, status);

    // Route pushed diagnostics into the engine (empty → clears the source). The
    // server stamps `source: "zornux-security"` on a security finding and
    // `"zornux"` on a compiler diagnostic, and publishes BOTH in one batch — so
    // split them into their own buckets rather than letting one overwrite the other.
    this.client.onDiagnostics((uri, diagnostics) => {
      if (!this.engine) return;
      const document = this.documents?.get(uri);
      if (this.mobileDocuments.has(uri) || (document && isMobileZornux(document.getText()))) {
        this.engine.clear(uri, LSP_DIAGNOSTIC_SOURCE);
        const { security } = partitionDiagnostics(diagnostics);
        if (security.length) this.engine.set(uri, SECURITY_SOURCE, toPlatformDiagnostics(security, SECURITY_SOURCE));
        else this.engine.clear(uri, SECURITY_SOURCE);
        return;
      }
      const { compiler, security } = partitionDiagnostics(diagnostics);

      if (compiler.length) this.engine.set(uri, LSP_DIAGNOSTIC_SOURCE, toPlatformDiagnostics(compiler, LSP_DIAGNOSTIC_SOURCE));
      else this.engine.clear(uri, LSP_DIAGNOSTIC_SOURCE);

      if (security.length) this.engine.set(uri, SECURITY_SOURCE, toPlatformDiagnostics(security, SECURITY_SOURCE));
      else this.engine.clear(uri, SECURITY_SOURCE);
    });

    // If the server dies, reflect it (and the TS fallback resumes automatically).
    this.client.onClosed(() => this.publishStatus());

    // A running server should never keep publishing findings the user turned off.
    if (this.settings) context.subscriptions.push(this.settings.onDidChange((change) => {
      if (change.key !== SECURITY_SETTING) return;
      const next = change.value === true;
      if (next !== this.securityEnabled) void this.setSecurityEnabled(next);
    }));

    // Mirror document lifecycle to the server (Zornux docs only).
    if (this.documents) {
      context.subscriptions.push(this.documents.onDidOpen((doc) => this.syncOpen(doc)));
      context.subscriptions.push(this.documents.onDidChange((doc) => this.syncChange(doc)));
      context.subscriptions.push(this.documents.onDidClose((doc) => {
        this.mobileDocuments.delete(doc.uri);
        this.client.didClose(doc.uri);
        this.engine?.clear(doc.uri, LSP_DIAGNOSTIC_SOURCE);
      }));
    }

    // Restart against a new root when the workspace changes (enables project-aware
    // diagnostics for the new folder).
    this.workspace?.onDidChangeWorkspace((info) => void this.startServer(info));

    this.ready = this.startServer(this.workspace?.currentWorkspace() ?? null);
    void selfTestCoordinator.run('language-server', () => this.maybeSelfTest());
  }

  async deactivate(): Promise<void> {
    await this.client.stop();
  }

  /* ----- server lifecycle ----- */
  private async startServer(workspace: WorkspaceInfo | null): Promise<void> {
    try {
      const info = await window.znxstudio.compiler.info();
      if (!info.available) {
        this.lastStart = { success: false, error: 'compiler unavailable' };
        return; // leave the subprocess-check fallback active
      }
      this.compilerPath = info.path;
      const rootUri = workspace ? monaco.Uri.file(workspace.root).toString() : null;
      const result = await this.client.start({
        compilerPath: info.path,
        rootUri,
        rootPath: workspace?.root ?? null,
        settings: buildZornuxSettings(this.securityEnabled),
      });
      this.lastStart = result;
      if (result.success) {
        this.verifySemanticLegend(result);
        this.openExistingDocuments();
      }
    } catch (error) {
      this.lastStart = { success: false, error: (error as Error).message };
    }
    this.publishStatus();
  }

  /** Surface the language-server state + version in the status bar. */
  /**
   * Turn live security findings on or off. `workspace/didChangeConfiguration`
   * makes the server republish every open document, so the squiggles appear (or
   * vanish) at once — no restart, no reopen. When the server is not running the
   * preference is simply remembered for the next start.
   */
  private async setSecurityEnabled(enabled: boolean): Promise<void> {
    this.securityEnabled = enabled;
    this.settings?.set(SECURITY_SETTING, enabled);

    if (!this.client.isRunning()) {
      this.publishStatus();
      return;
    }

    this.client.notify('workspace/didChangeConfiguration', buildConfigurationChange(buildZornuxSettings(enabled)));

    // Turning it off leaves the last findings on screen until the server
    // republishes; it republishes with an empty security set, which clears the
    // bucket. Clear eagerly anyway so nothing lingers if a document is closed.
    if (!enabled && this.engine && this.documents) {
      for (const document of this.documents.all()) this.engine.clear(document.uri, SECURITY_SOURCE);
    }

    this.context.layout.showToast(
      enabled ? `Live security diagnostics on. ${LIVE_SECURITY_CAVEAT}` : 'Live security diagnostics off.',
      'info',
    );
    this.publishStatus();
  }

  private publishStatus(): void {
    const status = this.context.services.tryGet<StatusService>(ServiceKeys.Status);
    if (!status) return;
    const id = 'znxstudio.languageServer';
    if (this.client.isRunning()) {
      const version = this.lastStart?.serverInfo?.version ?? '?';
      const caps = this.lastStart?.capabilities ? Object.keys(this.lastStart.capabilities).length : 0;
      status.setItem(id, {
        text: `Zornux LSP ${version}`,
        tooltip: `Zornux Language Server v${version} — ${caps} capabilities. Live diagnostics + IntelliSense from the compiler.`,
        side: 'right',
        priority: 40,
      });
    } else if (this.compilerPath) {
      // The compiler exists but the server isn't running — TS analysis is the fallback.
      status.setItem(id, {
        text: 'Zornux LSP · offline',
        tooltip: 'Language server not running — using local analysis fallback.',
        side: 'right',
        priority: 40,
      });
    } else {
      // No compiler at all — the compiler status item already says so.
      status.removeItem(id);
    }
  }

  /** The semantic-tokens legend is static at registration; warn if the running
   *  server advertises a different one (token colors would otherwise be wrong). */
  private verifySemanticLegend(result: LspStartResult): void {
    const advertised = this.advertisedTokenTypes(result);
    if (!advertised) return;
    const expected = ZORNUX_SEMANTIC_LEGEND.tokenTypes;
    const matches = advertised.length === expected.length && advertised.every((type, i) => type === expected[i]);
    if (!matches) {
      console.warn(
        `[ZnxStudio] semantic-tokens legend drift: server advertises [${advertised.join(', ')}] but ZnxStudio expects [${expected.join(', ')}]. Update semanticLegend.ts.`,
      );
    }
  }

  private advertisedTokenTypes(result: LspStartResult | null): string[] | undefined {
    const provider = result?.capabilities?.semanticTokensProvider as
      | { legend?: { tokenTypes?: string[] } }
      | undefined;
    return provider?.legend?.tokenTypes;
  }

  /** didOpen every already-open Zornux document (server (re)start / late join). */
  private openExistingDocuments(): void {
    for (const doc of this.documents?.all() ?? []) {
      if (doc.languageId !== 'zornux') continue;
      if (isMobileZornux(doc.getText())) {
        this.mobileDocuments.add(doc.uri);
        this.engine?.clear(doc.uri, LSP_DIAGNOSTIC_SOURCE);
        continue;
      }
      this.mobileDocuments.delete(doc.uri);
      this.client.didOpen(doc.uri, 'zornux', doc.version, doc.getText());
    }
  }

  private syncOpen(doc: ManagedDocument): void {
    if (doc.languageId !== 'zornux') return;
    if (isMobileZornux(doc.model.getValue())) {
      this.mobileDocuments.add(doc.uri);
      this.client.didClose(doc.uri);
      this.engine?.clear(doc.uri, LSP_DIAGNOSTIC_SOURCE);
      return;
    }
    this.mobileDocuments.delete(doc.uri);
    this.client.didOpen(doc.uri, 'zornux', doc.document.version, doc.model.getValue());
  }

  private syncChange(doc: ManagedDocument): void {
    if (doc.languageId !== 'zornux') return;
    const mobile = isMobileZornux(doc.model.getValue());
    const wasMobile = this.mobileDocuments.has(doc.uri);
    if (mobile) {
      this.mobileDocuments.add(doc.uri);
      this.client.didClose(doc.uri);
      this.engine?.clear(doc.uri, LSP_DIAGNOSTIC_SOURCE);
      return;
    }
    this.mobileDocuments.delete(doc.uri);
    if (wasMobile) {
      this.client.didOpen(doc.uri, 'zornux', doc.document.version, doc.model.getValue());
      return;
    }
    this.client.didChange(doc.uri, doc.document.version, doc.model.getValue());
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  /**
   * Prove live security diagnostics against the REAL server: a document with a
   * hardcoded secret must produce a ZX3701 in the security bucket only while the
   * setting is on, and `didChangeConfiguration` must clear it without a restart.
   */
  private async securitySelfTest(log: (message: string) => void): Promise<void> {
    if (!this.documents || !this.engine) return;
    const info = await window.znxstudio.app.getInfo();
    const path = `${info.tempDir}\\znxstudio-lsp-security.zx`;
    await window.znxstudio.fs.writeFile(path, 'import crypto\nshow crypto.hmac("s3cr3t-signing-key", "message")\n');
    const document = await this.documents.open(path);

    const securityOf = () => this.engine!.get(document.uri).filter((d) => d.source === SECURITY_SOURCE);

    const before = securityOf();
    log(`lsp security OFF by default: findings=${before.length} (expect 0 — the server's own default)`);

    await this.setSecurityEnabled(true);
    const live = await this.waitFor(securityOf, 4000, (v) => v.length > 0);
    const first = live?.[0];
    log(
      `lsp security REAL live: findings=${live?.length ?? 0} first=${first?.code}/${first?.severity} ` +
        `@L${first?.range.start.line} source=${SECURITY_SOURCE} (expect ZX3701/error, 0-based line 1)`,
    );

    // The compiler diagnostics must still be in their own bucket, unclobbered.
    const compilerDiags = this.engine.get(document.uri).filter((d) => d.source === LSP_DIAGNOSTIC_SOURCE);
    log(`lsp security buckets: compiler=${compilerDiags.length} security=${securityOf().length} (separate sources)`);

    await this.setSecurityEnabled(false);
    const gone = await this.waitFor(securityOf, 4000, (v) => v.length === 0);
    log(`lsp security toggle off (didChangeConfiguration, no restart): findings=${gone?.length ?? '?'} (expect 0)`);

    await this.documents.close(document.uri);
  }

  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    try {
      await this.ready;
      const caps = this.lastStart?.capabilities ? Object.keys(this.lastStart.capabilities) : [];
      log(
        `lsp start: success=${this.lastStart?.success} running=${this.client.isRunning()} server="${this.lastStart?.serverInfo?.name ?? '?'}" v${this.lastStart?.serverInfo?.version ?? '?'} capabilities=${caps.length}`,
      );
      if (!this.client.isRunning() || !this.documents || !this.engine) {
        log(`lsp: server not running (${this.lastStart?.error ?? 'unknown'}); skipping LSP-B checks`);
        return;
      }
      // LSP-G: status bar reflects the running server (else "Zornux LSP · offline").
      log(`lsp status bar: text="Zornux LSP ${this.lastStart?.serverInfo?.version ?? '?'}" running=${this.client.isRunning()}`);

      // 1) Live diagnostics through the ENGINE: open a real doc with a static
      //    error; the server's push must land in the compiler source.
      const errPath = await tempPath('znxstudio-lspb-broken.zx');
      if (!errPath) {
        log('lsp: no temp dir; skipping LSP-B checks');
        return;
      }
      await window.znxstudio.fs.writeFile(errPath, 'show "unterminated\n');
      const errDoc = await this.documents.open(errPath);
      const lspDiags = await this.waitFor(
        () => this.engine!.get(errDoc.uri).filter((d) => d.source === LSP_DIAGNOSTIC_SOURCE),
        4000,
        (v) => v.length > 0,
      );
      const first = lspDiags?.[0];
      log(
        `lsp live diagnostics: count=${lspDiags?.length ?? 0} first=${first ? `${first.code} "${first.message.slice(0, 30)}" @L${first.range.start.line}` : 'none'} source=${LSP_DIAGNOSTIC_SOURCE}`,
      );

      // LSP-G: the front-end analyzer stands down — the ONLY diagnostic source for
      // a synced doc should be the server's (no duplicate squiggles).
      const sources = [...new Set(this.engine.get(errDoc.uri).map((d) => d.source))].sort();
      log(`lsp diagnostic sources (dedup): [${sources.join(', ')}] (expect only ${LSP_DIAGNOSTIC_SOURCE})`);

      // 2) Edit → the fix must clear the pushed diagnostics live (didChange).
      errDoc.model.setValue('show "fixed"\n');
      const cleared = await this.waitFor(
        () => this.engine!.get(errDoc.uri).filter((d) => d.source === LSP_DIAGNOSTIC_SOURCE),
        4000,
        (v) => v.length === 0,
      );
      log(`lsp didChange→reclear: remaining=${cleared?.length ?? '?'} (expect 0)`);

      await this.securitySelfTest(log);

      // 3) Request path still works on a synced doc (semantic tokens).
      const tokens = await this.client.request('textDocument/semanticTokens/full', {
        textDocument: { uri: errDoc.uri },
      });
      const data = ((tokens.result ?? {}) as { data?: number[] }).data ?? [];
      log(`lsp semanticTokens (synced doc): ok=${tokens.ok} tokens=${Math.floor(data.length / 5)}`);

      // 3b) LSP-C: completion + hover now flow through the language SERVICE, which
      //     prefers the server for a synced doc (vs its TS fallback for others).
      const zornux = this.registry?.get('zornux');
      if (zornux?.completion) {
        const list = await zornux.completion.provideCompletions(errDoc.document, { line: 0, character: 0 });
        log(
          `lsp completion via service: items=${list.items.length} sample=[${list.items.slice(0, 5).map((i) => i.label).join(', ')}]`,
        );
      }
      // Open a file with functions and exercise hover + LSP-D providers against it.
      const fnPath = await examplePath('functions.zx');
      if (!fnPath) {
        log('lsp functions.zx: skipped (no examples root)');
        return;
      }
      const fnDoc = await this.documents.open(fnPath);
      if (zornux?.hover) {
        const hover = await zornux.hover.provideHover(fnDoc.document, { line: 12, character: 6 }); // "greet(" call
        log(`lsp hover via service: ${hover ? `contents="${(hover.contents[0] ?? '').replace(/\n/g, ' ').slice(0, 50)}"` : 'null'}`);
      }
      // LSP-D: signature help, definition, references, rename — all via the service.
      if (zornux?.signatureHelp) {
        const sig = await zornux.signatureHelp.provideSignatureHelp(fnDoc.document, { line: 10, character: 29 }); // inside calculate_tax(...)
        log(`lsp signatureHelp via service: ${sig ? `label="${sig.signatures[0]?.label}" activeParam=${sig.activeParameter}` : 'null'}`);
      }
      if (zornux?.definition) {
        const defs = await zornux.definition.provideDefinition(fnDoc.document, { line: 10, character: 20 }); // calculate_tax call
        log(`lsp definition via service: count=${defs.length} first=${defs[0] ? `L${defs[0].range.start.line}` : 'none'}`);
      }
      if (zornux?.references) {
        const refs = await zornux.references.provideReferences(fnDoc.document, { line: 12, character: 6 }); // greet
        log(`lsp references via service: count=${refs.length} lines=[${refs.map((r) => r.range.start.line).join(', ')}]`);
      }
      if (zornux?.rename) {
        const edit = await zornux.rename.provideRenameEdits(fnDoc.document, { line: 12, character: 6 }, 'greeting');
        const editCount = edit ? Object.values(edit.changes).reduce((n, e) => n + e.length, 0) : 0;
        log(`lsp rename via service: edits=${editCount} files=${edit ? Object.keys(edit.changes).length : 0}`);
      }
      // LSP-E: document symbols + folding via the service.
      if (zornux?.documentSymbols) {
        const syms = await zornux.documentSymbols.provideDocumentSymbols(fnDoc.document);
        log(`lsp documentSymbols via service: count=${syms.length} names=[${syms.map((s) => `${s.kind}:${s.name}`).join(', ')}]`);
      }
      if (zornux?.folding) {
        const folds = await zornux.folding.provideFoldingRanges(fnDoc.document);
        log(`lsp folding via service: count=${folds.length} ranges=[${folds.map((f) => `${f.start}-${f.end}`).join(', ')}]`);
      }
      // LSP-F: semantic tokens via the service + legend agreement with the server.
      if (zornux?.semanticTokens) {
        const tokens = await zornux.semanticTokens.provideSemanticTokens(fnDoc.document);
        const advertised = this.advertisedTokenTypes(this.lastStart) ?? [];
        const legendMatches =
          advertised.length === ZORNUX_SEMANTIC_LEGEND.tokenTypes.length &&
          advertised.every((type, i) => type === ZORNUX_SEMANTIC_LEGEND.tokenTypes[i]);
        log(
          `lsp semanticTokens via service: ints=${tokens.data.length} tokens=${Math.floor(tokens.data.length / 5)} serverLegend=${advertised.length} legendMatches=${legendMatches}`,
        );
      }
      this.documents.close(fnDoc.uri);

      // LSP-E: formatting via the service — a misformatted doc must yield edits.
      const fmtPath = await tempPath('znxstudio-lspe-fmt.zx');
      if (!fmtPath) {
        log('lsp: no temp dir; skipping LSP-E formatting');
        return;
      }
      await window.znxstudio.fs.writeFile(fmtPath, 'function greet with name\ngive back "hi"\nend\n');
      const fmtDoc = await this.documents.open(fmtPath);
      if (zornux?.formatter) {
        const edits = await zornux.formatter.provideFormattingEdits(fmtDoc.document, { tabSize: 4, insertSpaces: true });
        log(`lsp formatting via service: edits=${edits.length}${edits[0] ? ` newTextLen=${edits[0].newText.length}` : ''}`);
      }
      this.documents.close(fmtDoc.uri);

      // 4) Close → didClose (leave the live server running for the session).
      this.documents.close(errDoc.uri);
      log(`lsp didClose sent; serverKnowsDoc=${this.client.isOpen(errDoc.uri)} (expect false)`);
    } catch (error) {
      log(`lsp self-test failed: ${(error as Error).message}`);
    }
  }

  /** Poll `probe` until `done(value)` holds or the timeout elapses. */
  private waitFor<T>(probe: () => T, timeoutMs: number, done: (value: T) => boolean): Promise<T> {
    return new Promise<T>((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const value = probe();
        if (done(value) || Date.now() - started > timeoutMs) {
          clearInterval(timer);
          resolve(value);
        }
      }, 50);
    });
  }
}
