import { join } from 'node:path';

/** Resolve from the compiled main-process directory to the renderer bundle. */
export function simulatorWindowHtmlPath(mainBundleDir: string): string {
  return join(mainBundleDir, '../renderer/simulator.html');
}

export function simulatorWindowPreloadPath(mainBundleDir: string): string {
  return join(mainBundleDir, '../preload/preload.js');
}
