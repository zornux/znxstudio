import type { LanguageCapabilities, LanguageMetadata, LanguageService } from '../api';

/**
 * Plain Text — the universal fallback language. It owns no providers; it exists
 * so the registry always has a baseline language to activate and so unknown file
 * types resolve to something valid. (`plaintext` is also a Monaco built-in id,
 * so the bridge does not re-register it with Monaco.)
 */
export class LanguageServicePlainText implements LanguageService {
  readonly metadata: LanguageMetadata = {
    id: 'plaintext',
    displayName: 'Plain Text',
    extensions: ['.txt', '.log'],
    aliases: ['Plain Text', 'text'],
    native: true,
  };

  readonly capabilities: LanguageCapabilities = {
    diagnostics: false,
    parser: false,
    formatter: false,
    tokenizer: false,
    completion: false,
    hover: false,
    signatureHelp: false,
    documentSymbols: false,
    semanticTokens: false,
    definition: false,
    references: false,
    rename: false,
    codeActions: false,
    folding: false,
  };

  activate(): void {
    /* no-op */
  }

  deactivate(): void {
    /* no-op */
  }
}
