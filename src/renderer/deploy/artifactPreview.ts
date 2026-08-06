/**
 * A shared preview modal for generated deployment artifacts (Phase 13). Shows
 * the generated file with Copy + "Save to project" actions. Reused by every
 * generator (Docker, Kubernetes, CI/CD, devcontainer) so the phases stay thin
 * over their pure generators.
 */

export interface ArtifactPreviewOptions {
  title: string;
  filename: string;
  content: string;
  /** Persist the artifact into the project; wired by the DeploymentService. */
  onSave?: () => void | Promise<void>;
}

export function showArtifactPreview(options: ArtifactPreviewOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'znxstudio-deploy-modal';
  const close = () => overlay.remove();
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  const box = document.createElement('div');
  box.className = 'znxstudio-deploy-modal-box';

  const head = document.createElement('div');
  head.className = 'znxstudio-deploy-modal-head';
  const title = document.createElement('span');
  title.className = 'znxstudio-deploy-modal-title';
  title.textContent = options.title;
  const filename = document.createElement('span');
  filename.className = 'znxstudio-deploy-modal-file';
  filename.textContent = options.filename;
  head.append(title, filename);
  box.appendChild(head);

  const pre = document.createElement('pre');
  pre.className = 'znxstudio-deploy-modal-content';
  pre.textContent = options.content;
  box.appendChild(pre);

  const actions = document.createElement('div');
  actions.className = 'znxstudio-deploy-modal-actions';
  const copy = document.createElement('button');
  copy.className = 'znxstudio-btn';
  copy.textContent = 'Copy';
  copy.addEventListener('click', () => void navigator.clipboard?.writeText(options.content));
  actions.appendChild(copy);
  if (options.onSave) {
    const save = document.createElement('button');
    save.className = 'znxstudio-btn primary';
    save.textContent = `Save ${options.filename}`;
    save.addEventListener('click', async () => {
      await options.onSave!();
      close();
    });
    actions.appendChild(save);
  }
  const dismiss = document.createElement('button');
  dismiss.className = 'znxstudio-btn';
  dismiss.textContent = 'Close';
  dismiss.addEventListener('click', close);
  actions.appendChild(dismiss);
  box.appendChild(actions);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  copy.focus();
}
