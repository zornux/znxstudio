import { parseExtensionManifest, type ExtensionManifest } from '../../../shared/extensions/manifest';
import type { ZnxStudioExtension } from '../sdk';

/** Sample marketplace extension: counts lines in the active file (SDK-only). */
export const LINE_COUNTER_MANIFEST: ExtensionManifest = parseExtensionManifest({
  name: 'Line Counter',
  publisher: 'acme',
  version: '1.1.0',
  description: 'Counts the lines and characters in the active file.',
  engines: { znxstudio: '^1.0.0' },
  activationEvents: ['onCommand:acme.line-counter.count'],
  permissions: ['commands', 'editor', 'notifications'],
  contributes: { commands: [{ command: 'acme.line-counter.count', title: 'Line Counter: Count Lines' }] },
}).manifest!;

export const lineCounterExtension: ZnxStudioExtension = {
  activate(context) {
    context.subscriptions.push(
      context.commands.register(
        'acme.line-counter.count',
        () => {
          const text = context.editor.activeText();
          if (text === null) {
            context.window.showErrorMessage('Line Counter: no active file.');
            return;
          }
          const lines = text.split('\n').length;
          context.window.showInformationMessage(`Line Counter: ${lines} lines, ${text.length} characters.`);
        },
        'Line Counter: Count Lines',
      ),
    );
  },
};
