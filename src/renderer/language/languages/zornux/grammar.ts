/**
 * Minimal Monarch grammar for Zornux — syntax highlighting only. This is a
 * lexical placeholder: it colors keywords, strings, numbers and comments so the
 * editor is usable today. The real tokenizer/lexer from the Zornux compiler will
 * replace this object without touching the Monaco bridge.
 *
 * Typed as `object` at the API boundary; the Monaco bridge casts it to
 * `monaco.languages.IMonarchLanguage`.
 */
import { ZORNUX_KEYWORDS } from './keywords';

export const ZORNUX_MONARCH: object = {
  defaultToken: '',
  ignoreCase: false,

  keywords: [...ZORNUX_KEYWORDS],

  operators: ['+', '-', '*', '/', '%', '=', '==', '!=', '<', '>', '<=', '>=', '.'],

  tokenizer: {
    root: [
      // Comments FIRST so nothing inside them (keywords, operators) is re-colored:
      // a `#` line comment is one solid `comment` run to end of line, and a
      // `/* … */` block comment stays `comment` across every line it spans.
      [/#.*$/, 'comment'],
      [/\/\*/, { token: 'comment', next: '@blockComment' }],
      [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
      [/\b\d+(\.\d+)?\b/, 'number'],
      [
        /[a-zA-Z_]\w*/,
        { cases: { '@keywords': 'keyword', '@default': 'identifier' } },
      ],
      [/[{}()[\]]/, '@brackets'],
      [/[<>=!+\-*/%.]+/, 'operator'],
      [/[ \t\r\n]+/, 'white'],
    ],
    string: [
      [/[^"]+/, 'string'],
      [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
    ],
    // Multi-line block comment. Monaco carries this state across lines, so every
    // line of the block is coloured `comment` until the closing `*/`.
    blockComment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, { token: 'comment', next: '@pop' }],
      [/[/*]/, 'comment'],
    ],
  },
};
