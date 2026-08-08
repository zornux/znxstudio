import { describe, expect, test } from './harness';
import { fileIcon, folderIconClass } from '../src/renderer/explorer/fileIcons';
import { SYMBOL_ICON } from '../src/renderer/ui/symbolIcons';

describe('workbench icon policy', () => {
  test('file and symbol icons use compact text glyphs rather than color emoji', () => {
    const icons = [fileIcon('App.ts'), fileIcon('README.md'), fileIcon('photo.png'), ...Object.values(SYMBOL_ICON)];
    expect(icons.every((icon) => !/[\u{1F300}-\u{1FAFF}]/u.test(icon))).toBe(true);
  });

  test('folder artwork exposes distinct closed and open states', () => {
    expect(folderIconClass()).toBe('znxstudio-folder-icon');
    expect(folderIconClass(true)).toBe('znxstudio-folder-icon is-open');
  });
});
