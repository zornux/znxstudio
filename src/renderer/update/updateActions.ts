import type { UpdatePhase } from '../../shared/update';

export type UpdateUserAction = 'download' | 'install' | 'check' | null;

/** The one safe primary action for each updater lifecycle phase. */
export function updateActionForPhase(phase: UpdatePhase): UpdateUserAction {
  if (phase === 'update-available') return 'download';
  if (phase === 'downloaded') return 'install';
  if (phase === 'error' || phase === 'no-feed') return 'check';
  return null;
}

/** Whether a connectivity/resume signal should trigger a background probe. */
export function shouldCheckAfterConnectivity(options: {
  mode: string;
  online: boolean;
  focused: boolean;
  elapsedMs: number;
}): boolean {
  return options.mode !== 'off' && options.online && options.focused && options.elapsedMs >= 5 * 60 * 1000;
}
