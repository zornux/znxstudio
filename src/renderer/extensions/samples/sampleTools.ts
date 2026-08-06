import { parseExtensionManifest, type ExtensionManifest } from '../../../shared/extensions/manifest';
import type { ZnxStudioExtension } from '../sdk';

/** Sample marketplace extension: echoes a message to its own output channel. */
export const SAMPLE_TOOLS_MANIFEST: ExtensionManifest = parseExtensionManifest({
  name: 'Sample Tools',
  publisher: 'znxstudio',
  version: '0.9.0',
  description: 'A tiny toolbox that logs to a dedicated output channel.',
  engines: { znxstudio: '^1.0.0' },
  activationEvents: ['onCommand:znxstudio.sample-tools.echo'],
  permissions: ['commands', 'output'],
  contributes: { commands: [{ command: 'znxstudio.sample-tools.echo', title: 'Sample Tools: Echo' }] },
}).manifest!;

export const sampleToolsExtension: ZnxStudioExtension = {
  activate(context) {
    const channel = context.window.createOutputChannel('Sample Tools');
    context.subscriptions.push(
      context.commands.register(
        'znxstudio.sample-tools.echo',
        () => {
          channel.appendLine('echo: tools are working');
          channel.show();
        },
        'Sample Tools: Echo',
      ),
    );
  },
};
