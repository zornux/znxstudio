import './styles/main.css';
import * as monaco from 'monaco-editor';
import { Workbench } from './core/Workbench';

/**
 * Renderer entry point. Configures Monaco's web workers and boots the workbench.
 * If workers can't be created (e.g. under strict file:// policies) Monaco falls
 * back to running language services on the main thread — the editor still works.
 */
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    const workerUrl = (name: string) => new URL(`./${name}`, import.meta.url);
    switch (label) {
      case 'json':
        return new Worker(workerUrl('json.worker.js'));
      case 'css':
      case 'scss':
      case 'less':
        return new Worker(workerUrl('css.worker.js'));
      case 'html':
      case 'handlebars':
      case 'razor':
        return new Worker(workerUrl('html.worker.js'));
      case 'typescript':
      case 'javascript':
        return new Worker(workerUrl('ts.worker.js'));
      default:
        return new Worker(workerUrl('editor.worker.js'));
    }
  },
};

function boot(): void {
  const root = document.getElementById('znxstudio-root');
  if (!root) throw new Error('Missing #znxstudio-root mount point.');
  new Workbench().start(root).catch((error) => console.error('[ZnxStudio] fatal:', error));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
