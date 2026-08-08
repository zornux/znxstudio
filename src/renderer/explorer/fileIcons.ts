/**
 * Lightweight monochrome file iconography using short, stable glyphs from the
 * workbench icon font stack instead of platform-dependent color emoji.
 */
const ICON_BY_EXTENSION: Record<string, string> = {
  ts: 'TS', tsx: 'TX', js: 'JS', jsx: 'JX', json: '{}', md: 'M↓',
  css: '#', scss: 'S#', html: '<>', zx: 'Z', zornux: 'Z', zoijs: 'Zo',
  png: '▣', jpg: '▣', jpeg: '▣', svg: '◇', gitignore: '⊘',
};

const ICON_BY_NAME: Record<string, string> = {
  'znxstudio.project.json': 'Z',
  'package.json': 'P',
  'readme.md': 'R',
};

export function fileIcon(name: string): string {
  const byName = ICON_BY_NAME[name.toLowerCase()];
  if (byName) return byName;
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return ICON_BY_EXTENSION[extension] ?? '□';
}

export function folderIconClass(expanded = false): string {
  return `znxstudio-folder-icon${expanded ? ' is-open' : ''}`;
}
