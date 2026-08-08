import type { Disposable } from './Module';

let reporter: ((message: string) => void) | undefined;

export function setUiErrorReporter(next: (message: string) => void): Disposable {
  reporter = next;
  return { dispose: () => { if (reporter === next) reporter = undefined; } };
}

export function reportUiError(context: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  const message = `${context}: ${detail}`;
  if (reporter) reporter(message);
  else console.error(message, error);
}

export function runUiCallback(context: string, callback: () => void): void {
  try {
    callback();
  } catch (error) {
    reportUiError(context, error);
  }
}
