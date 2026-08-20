/**
 * Zornux reserved keywords. Single source of truth shared by the Monarch grammar
 * (highlighting) and the lexer (tokenization) so the two never drift apart.
 *
 * Aligned to the real language lexer (Zornux.Lexer/Keywords.cs) so keywords like
 * `create`, `show`, `give back`, `for each`, `has`, `try`/`catch`/`finally` color
 * correctly. A few legacy front-end tokens (`define`, `let`, `set`, `say`, `then`,
 * `when`, `until`, `call`, `return`, …) are kept as a superset because the
 * provisional front-end parser still recognizes them; a full parser realignment
 * to the real grammar is tracked separately.
 */
export const ZORNUX_KEYWORDS: readonly string[] = [
  // Real Zornux keywords (Zornux.Lexer/Keywords.cs)
  'add', 'after', 'and', 'application', 'as', 'async', 'back', 'be', 'cancel',
  'catch', 'class', 'compute', 'configuration', 'contain', 'create', 'database',
  'delete', 'each', 'else', 'end', 'equal', 'every', 'expect', 'extends', 'false',
  'finally', 'find', 'for', 'from', 'function', 'give', 'greater', 'has', 'if',
  'import', 'in', 'is', 'job', 'less', 'message', 'module', 'modulo', 'not',
  'nothing', 'on', 'or', 'otherwise', 'parallel', 'pipeline', 'policy', 'port',
  'private', 'protected', 'public', 'publish', 'receive', 'record', 'repeat',
  'repository', 'restrict', 'save', 'secure', 'select', 'send', 'service', 'show', 'showing',
  'start', 'status', 'step', 'table', 'task', 'test', 'than', 'throw', 'times',
  'to', 'transaction', 'true', 'try', 'update', 'use', 'using', 'while', 'with',
  // Controller & web application (Phase 36).
  'controller', 'web', 'require', 'current',
  // HTTP verbs.
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE',
  // Legacy front-end tokens still used by the provisional parser/tests.
  'break', 'call', 'continue', 'define', 'elseif', 'export', 'foreach', 'let',
  'new', 'null', 'return', 'say', 'set', 'then', 'this', 'type', 'until', 'when',
  // Mobile application DSL.
  'mobile', 'app', 'screen', 'state', 'column', 'row', 'stack', 'grid', 'scroll',
  'text', 'button', 'image', 'icon', 'input', 'checkbox', 'switch', 'slider',
  'dropdown', 'spacer', 'divider', 'top_bar', 'bottom_nav', 'tabs', 'fab', 'card',
  'list', 'chip', 'badge', 'progress', 'snackbar', 'dialog',
  // Mobile styling system (Phases 1–5).
  'style', 'theme', 'dark', 'tokens', 'animate', 'transition', 'responsive',
  'gradient', 'shadow', 'permissions', 'toolbar',
  // Gesture & interaction keywords.
  'swiped', 'dragged', 'pinched', 'long_pressed', 'tapped',
  // Responsive breakpoints.
  'compact', 'medium', 'expanded',
  // Navigation.
  'go',
];

/**
 * Known stdlib function names — provided for offline completion when the LSP
 * server is unavailable. Aligned to the Zornux 1.8.0 standard library.
 */
export const ZORNUX_STDLIB: readonly string[] = [
  // Text
  'trim', 'trim_start', 'trim_end', 'to_upper', 'to_lower', 'split', 'join',
  'starts_with', 'ends_with', 'contains', 'replace', 'length', 'substring',
  'index_of', 'pad_start', 'pad_end',
  // Regex
  'matches', 'match_all', 'replace_pattern',
  // Collections
  'add', 'remove', 'count', 'first', 'last', 'where', 'select', 'sort_by',
  'group_by', 'any', 'all', 'sum', 'average', 'min', 'max', 'distinct',
  'take', 'skip', 'reverse', 'flatten', 'zip',
  // Conversion
  'to_text', 'to_number', 'to_whole', 'to_truth', 'to_json', 'from_json',
  // Math
  'abs', 'ceiling', 'floor', 'round', 'power', 'square_root',
  // Date/time
  'current_datetime', 'current_date', 'elapsed_time', 'format_date',
  // Crypto
  'hash', 'secure_random', 'uuid',
  // I/O
  'show', 'read_line', 'read_file', 'write_file',
];
