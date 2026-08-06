import { parseExtensionManifest, type ExtensionManifest } from '../../../shared/extensions/manifest';
import type { ZnxStudioExtension } from '../sdk';

/**
 * A built-in sample extension (Phase 11A) written ENTIRELY against the public
 * SDK — no workbench internals. It proves the surface end-to-end: a namespaced
 * command + a status-bar item + a notification, gated by declared permissions.
 * It doubles as the reference for third-party authors.
 */
export const HELLO_MANIFEST: ExtensionManifest = parseExtensionManifest({
  name: 'Hello World',
  publisher: 'acme',
  version: '1.0.0',
  description: 'Sample extension demonstrating the ZnxStudio SDK.',
  engines: { znxstudio: '^1.0.0' },
  activationEvents: ['onStartup'],
  permissions: ['commands', 'statusBar', 'notifications', 'output', 'storage'],
  contributes: {
    commands: [{ command: 'acme.hello-world.say', title: 'Hello: Say Hello', category: 'Hello' }],
  },
}).manifest!;

export const helloWorldExtension: ZnxStudioExtension = {
  activate(context) {
    const channel = context.window.createOutputChannel('Hello');
    const count = context.storage.get('activations', 0) + 1;
    context.storage.set('activations', count);
    channel.appendLine(`activated (#${count})`);

    context.subscriptions.push(
      context.commands.register(
        'acme.hello-world.say',
        () => {
          context.window.showInformationMessage('Hello from a ZnxStudio extension! 👋');
          channel.appendLine('said hello');
        },
        'Hello: Say Hello',
      ),
    );
    context.window.setStatusBarItem('greeting', {
      text: '👋 Hello',
      tooltip: 'Sample extension — click to greet',
      command: 'acme.hello-world.say',
    });
    context.logger.info(`activated (activation #${count})`);
  },
};
