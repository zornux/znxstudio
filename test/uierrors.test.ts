import { describe, expect, test } from './harness';
import { reportUiError, runUiCallback, setUiErrorReporter } from '../src/renderer/core/uiErrors';

describe('UI error reporting', () => {
  test('routes async action errors through the active workbench reporter', () => {
    const messages: string[] = [];
    const subscription = setUiErrorReporter((message) => messages.push(message));
    reportUiError('Could not copy code', new Error('denied'));
    expect(messages).toEqual(['Could not copy code: denied']);
    subscription.dispose();
  });

  test('contains synchronous modal callbacks and reports the failure', () => {
    const messages: string[] = [];
    const subscription = setUiErrorReporter((message) => messages.push(message));
    runUiCallback('Could not run action', () => { throw new Error('boom'); });
    expect(messages).toEqual(['Could not run action: boom']);
    subscription.dispose();
  });
});
