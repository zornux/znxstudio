/**
 * Lightweight, dependency-free file iconography. Emoji glyphs keep the explorer
 * icon-typed without shipping an icon font. Language modules can extend this map
 * later through the extension system.
 */
const ICON_BY_EXTENSION: Record<string, string> = {
  ts: '🟦',
  tsx: '🟦',
  js: '🟨',
  jsx: '🟨',
  json: '🟧',
  md: '📘',
  css: '🎨',
  scss: '🎨',
  html: '🌐',
  zx: '⚡',
  zornux: '⚡',
  zoijs: '🟪',
  png: '🖼',
  jpg: '🖼',
  jpeg: '🖼',
  svg: '🖼',
  gitignore: '🚫',
};

const ICON_BY_NAME: Record<string, string> = {
  'znxstudio.project.json': '⚡',
  'package.json': '📦',
  'readme.md': '📖',
};

export function fileIcon(name: string): string {
  const byName = ICON_BY_NAME[name.toLowerCase()];
  if (byName) return byName;
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return ICON_BY_EXTENSION[extension] ?? '📄';
}

export function folderIcon(): string {
  return '📁';
}
