import type { SemanticTokensLegend } from '../api';

/**
 * The Zornux semantic-tokens legend. It must match `zornux lsp`'s
 * `SemanticTokensProvider.TokenTypes` in BOTH names and order — the token-type
 * integers in the tokens data index into these positions, and Monaco needs the
 * legend at provider-registration time (before the server has started). Drift is
 * guarded at runtime: the LSP module compares this to the server's advertised
 * legend on startup and logs a warning if they diverge.
 */
export const ZORNUX_SEMANTIC_LEGEND: SemanticTokensLegend = {
  tokenTypes: [
    'keyword',
    'variable',
    'parameter',
    'function',
    'class',
    'method',
    'field',
    'service',
    'route',
    'builtin',
    'type',
    'number',
    'text',
    'comment',
    'operator',
  ],
  tokenModifiers: [],
};
