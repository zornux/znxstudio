/** Validate a user-supplied project name before using it as a child directory. */
export function assertProjectFolderName(name: string): void {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || windowsReserved.test(trimmed)) {
    throw new Error('Project name must be a single portable folder name.');
  }
}

/** Convert a display name into one valid Android application-ID segment. */
export function androidPackageFragment(name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return /^[a-z_]/.test(normalized) ? normalized : `_${normalized}`;
}
