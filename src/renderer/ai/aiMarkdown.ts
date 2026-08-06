/**
 * Shared renderer for AI/model output (Phase 10, modernization).
 *
 * Model responses are Markdown — headings, lists, tables, and fenced code. The AI
 * panels used to dump the raw string into a <pre>, so ` ``` ` fences and `**bold**`
 * showed as literal characters. This renders it as real DOM via the safe document
 * Markdown renderer (which never touches innerHTML, so model text can't inject
 * markup), and adds a Copy button — plus an optional Insert — to each code block.
 */
import { parseMarkdown, renderMarkdown } from '../docs/markdown';

export interface AiMarkdownOptions {
  /** When set, each code block gets an "Insert" button (e.g. paste into the editor). */
  onInsertCode?(code: string, language: string): void;
}

function openExternal(href: string): void {
  void window.znxstudio.shell?.openExternal?.(href);
}

function toolbarButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'znxstudio-ai-md-btn';
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Render `text` as Markdown into `host` (replacing its contents). Reuses the
 * `.znxstudio-md` element styles; `.znxstudio-ai-md` neutralizes its container
 * padding so it sits inside a chat bubble or panel body. Each fenced code block
 * gets a hover Copy (+ optional Insert).
 */
export function renderAiMarkdown(host: HTMLElement, text: string, options: AiMarkdownOptions = {}): void {
  host.replaceChildren();
  host.classList.add('znxstudio-md', 'znxstudio-ai-md');
  host.appendChild(renderMarkdown(parseMarkdown(text), { onExternal: openExternal }));

  for (const wrapper of host.querySelectorAll<HTMLElement>('.znxstudio-md-code')) {
    const code = wrapper.querySelector('code');
    const source = code?.textContent ?? '';
    const bar = document.createElement('div');
    bar.className = 'znxstudio-ai-md-codebar';
    bar.appendChild(toolbarButton('Copy', 'Copy code', () => void navigator.clipboard?.writeText(source)));
    if (options.onInsertCode) {
      bar.appendChild(
        toolbarButton('Insert', 'Insert into editor', () => options.onInsertCode!(source, code?.dataset.language ?? '')),
      );
    }
    wrapper.classList.add('has-toolbar');
    wrapper.insertBefore(bar, wrapper.firstChild);
  }
}
