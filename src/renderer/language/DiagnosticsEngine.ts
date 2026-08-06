import { Emitter } from '../core/Emitter';
import type { Diagnostic, DiagnosticSink, DiagnosticsReader } from './api';

/**
 * The diagnostics engine. Aggregates diagnostics per document across multiple
 * named sources (parser, compiler, analyzer, linter, extensions…) and notifies
 * consumers — the Monaco bridge (squiggles) and the Problems panel — on change.
 *
 *   Document → Language Service → DiagnosticsEngine → { Problems panel, Editor }
 */
export class DiagnosticsEngine implements DiagnosticSink, DiagnosticsReader {
  private readonly byUri = new Map<string, Map<string, Diagnostic[]>>();
  private readonly changeEmitter = new Emitter<{ uri: string }>();
  readonly onDidChange = this.changeEmitter.event;

  set(uri: string, source: string, diagnostics: Diagnostic[]): void {
    let sources = this.byUri.get(uri);
    if (!sources) {
      sources = new Map();
      this.byUri.set(uri, sources);
    }
    if (diagnostics.length) sources.set(source, diagnostics);
    else sources.delete(source);
    this.changeEmitter.fire({ uri });
  }

  clear(uri: string, source?: string): void {
    const sources = this.byUri.get(uri);
    if (!sources) return;
    if (source) sources.delete(source);
    else sources.clear();
    this.changeEmitter.fire({ uri });
  }

  get(uri: string): Diagnostic[] {
    const sources = this.byUri.get(uri);
    return sources ? [...sources.values()].flat() : [];
  }

  /** URIs that currently have at least one diagnostic. */
  uris(): string[] {
    return [...this.byUri.keys()].filter((uri) => this.get(uri).length > 0);
  }
}
