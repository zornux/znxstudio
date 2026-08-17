import {
  ServiceKeys,
  type AiService,
  type EditorService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import type { AiCompletionResult, AiMessage } from '../../shared/ai/providers';
import { ChatSession, composeSystemPrompt } from './chatSession';
import { renderAiMarkdown } from './aiMarkdown';
import {
  ContextStore,
  fileContextItem,
  scanDeclarations,
  formatProjectMap,
  type DeclarationSummary,
} from './context';

/**
 * AI Chat (Phase 10A). A conversational assistant in the sidebar, grounded in
 * the vendor-neutral AiService — it works identically whether the user picked
 * OpenAI, Anthropic, Google, Ollama, Azure, or a custom endpoint, and degrades
 * to a "choose a provider" prompt when AI is off. Optionally includes the active
 * file as context so answers are about the code the user is looking at.
 */
export class ChatModule implements IModule {
  readonly id = 'znxstudio.ai.chat';
  readonly displayName = 'AI Chat';

  private context!: ModuleContext;
  private ai!: AiService;
  private editor: EditorService | undefined;
  private readonly session = new ChatSession();
  private contextStore!: ContextStore;
  private root!: HTMLElement;
  private log!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private sendButton?: HTMLButtonElement;
  private includeFile = true;
  private busy = false;
  /** Cancels the in-flight streamed reply (asks main to abort). */
  private cancel: (() => void) | null = null;

  activate(context: ModuleContext): void {
    this.context = context;
    this.ai = context.services.get<AiService>(ServiceKeys.Ai);
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    this.contextStore = context.services.tryGet<ContextStore>(ServiceKeys.AiContext) ?? new ContextStore();

    this.root = document.createElement('div');
    this.root.className = 'znxstudio-chat';

    context.layout.addActivityItem({
      id: 'ai-chat',
      label: 'AI Chat',
      icon: '✦',
      onSelect: () => this.reveal(),
    });
    context.commands.register(CommandIds.AiChatShow, () => this.reveal(), 'AI: Chat');
    context.commands.register(CommandIds.AiChatClear, () => this.clearAndReveal(), 'AI: New Chat');

    context.subscriptions.push(this.ai.onDidChangeConfig(() => this.render()));
    this.render();
    void selfTestCoordinator.run('ai-chat', () => this.maybeSelfTest());
  }

  private reveal(): void {
    this.context.layout.setSideBar('AI Chat', this.root);
    this.context.layout.focusSideBar();
    this.input?.focus();
  }

  private clear(): void {
    this.session.reset();
    this.render();
  }

  private clearAndReveal(): void {
    this.clear();
    this.reveal();
  }

  private render(): void {
    this.root.replaceChildren();

    // Header row: provider + actions.
    const header = document.createElement('div');
    header.className = 'znxstudio-chat-header';
    const who = document.createElement('span');
    who.className = 'znxstudio-chat-provider';
    who.textContent = this.ai.isEnabled() ? `AI · ${this.ai.providerLabel()}` : 'AI off';
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    const configure = document.createElement('button');
    configure.className = 'znxstudio-btn-small';
    configure.textContent = 'Configure';
    configure.addEventListener('click', () => this.ai.openSettings());
    const clear = document.createElement('button');
    clear.className = 'znxstudio-btn-small';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => this.clear());
    header.append(who, spacer, configure, clear);
    this.root.appendChild(header);

    if (!this.ai.isEnabled()) {
      this.root.appendChild(this.disabledState());
      return;
    }
    const blocker = this.ai.readiness();
    if (blocker) {
      this.root.appendChild(this.configurationState(blocker));
      return;
    }

    // Transcript.
    this.log = document.createElement('div');
    this.log.className = 'znxstudio-chat-log';
    this.root.appendChild(this.log);
    this.paintHistory();

    // Composer.
    const composer = document.createElement('div');
    composer.className = 'znxstudio-chat-composer';

    const ctx = document.createElement('label');
    ctx.className = 'znxstudio-chat-context';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = this.includeFile;
    check.addEventListener('change', () => (this.includeFile = check.checked));
    const active = this.editor?.currentFile();
    const ctxText = document.createElement('span');
    ctxText.textContent = active ? `Include ${this.basename(active)} as context` : 'No active file';
    check.disabled = !active;
    ctx.append(check, ctxText);

    this.input = document.createElement('textarea');
    this.input.className = 'znxstudio-chat-input';
    this.input.rows = 3;
    this.input.placeholder = 'Ask about your Zornux / Zoijs code…  (Enter to send, Shift+Enter for newline)';
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void this.send();
      }
    });

    this.sendButton = document.createElement('button');
    this.sendButton.className = 'znxstudio-btn';
    this.sendButton.addEventListener('click', () => (this.busy ? this.stop() : void this.send()));
    this.updateSendButton();

    // Context items section
    const pinned = this.contextStore.pinned();
    if (pinned.length > 0) {
      const ctxList = document.createElement('div');
      ctxList.className = 'znxstudio-chat-context-list';
      for (const item of pinned) {
        const chip = document.createElement('span');
        chip.className = 'znxstudio-chat-context-chip';
        chip.textContent = item.label;
        chip.title = `${item.kind}: ${item.label} (${item.chars} chars)`;
        const remove = document.createElement('button');
        remove.className = 'znxstudio-chat-context-remove';
        remove.textContent = '×';
        remove.title = 'Remove from context';
        remove.addEventListener('click', () => {
          this.contextStore.remove(item.id);
          this.render();
        });
        chip.appendChild(remove);
        ctxList.appendChild(chip);
      }
      composer.appendChild(ctxList);
    }

    composer.append(ctx, this.input, this.sendButton);
    this.root.appendChild(composer);
  }

  private updateSendButton(): void {
    if (!this.sendButton) return;
    this.sendButton.textContent = this.busy ? '■ Stop' : 'Send';
    this.sendButton.classList.toggle('is-stop', this.busy);
  }

  private stop(): void {
    this.cancel?.();
  }

  private disabledState(): HTMLElement {
    const empty = document.createElement('div');
    empty.className = 'znxstudio-chat-empty';
    empty.innerHTML = `
      <p><strong>AI is off.</strong></p>
      <p class="znxstudio-muted">ZnxStudio is vendor-neutral: connect OpenAI, Anthropic, Google, a local Ollama model,
      Azure OpenAI, or any OpenAI-compatible endpoint. No vendor is required.</p>
    `;
    const button = document.createElement('button');
    button.className = 'znxstudio-btn';
    button.textContent = 'Choose a provider';
    button.addEventListener('click', () => this.ai.openSettings());
    empty.appendChild(button);
    return empty;
  }

  private configurationState(message: string): HTMLElement {
    const empty = document.createElement('div');
    empty.className = 'znxstudio-chat-empty';
    const title = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = 'AI needs configuration.';
    title.appendChild(strong);
    const detail = document.createElement('p');
    detail.className = 'znxstudio-muted';
    detail.textContent = message;
    const button = document.createElement('button');
    button.className = 'znxstudio-btn';
    button.textContent = 'Review AI settings';
    button.addEventListener('click', () => this.ai.openSettings());
    empty.append(title, detail, button);
    return empty;
  }

  private paintHistory(): void {
    this.log.replaceChildren();
    const history = this.session.history();
    if (history.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'znxstudio-chat-hint znxstudio-muted';
      hint.textContent = 'Ask a question to get started. The assistant knows Zornux and Zoijs.';
      this.log.appendChild(hint);
      return;
    }
    for (const message of history) this.appendBubble(message);
    this.log.scrollTop = this.log.scrollHeight;
  }

  private appendBubble(message: AiMessage, pending = false): HTMLElement {
    const bubble = document.createElement('div');
    bubble.className = `znxstudio-chat-msg is-${message.role}${pending ? ' is-pending' : ''}`;
    const role = document.createElement('div');
    role.className = 'znxstudio-chat-role';
    role.textContent = message.role === 'user' ? 'You' : this.ai.providerLabel();
    const body = document.createElement('div');
    body.className = 'znxstudio-chat-body';
    if (message.role === 'assistant' && !pending) {
      // Render the model's Markdown into a child (keeping the bubble's padding):
      // headings, lists, and code blocks with Copy + Insert.
      const content = document.createElement('div');
      renderAiMarkdown(content, message.content, {
        onInsertCode: (code) => this.editor?.insertText(code),
      });
      body.appendChild(content);
    } else {
      body.textContent = message.content;
    }
    bubble.append(role, body);
    if (message.role === 'assistant' && !pending) {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'znxstudio-chat-copy';
      copy.textContent = 'Copy';
      copy.title = 'Copy the full reply';
      copy.setAttribute('aria-label', 'Copy the full reply');
      copy.addEventListener('click', () => void this.copyMessage(message.content));
      bubble.appendChild(copy);
    }
    this.log.appendChild(bubble);
    this.log.scrollTop = this.log.scrollHeight;
    return bubble;
  }

  private async copyMessage(content: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
      this.context.layout.showToast('Response copied.', 'success');
    } catch (error) {
      this.context.layout.showToast(`Could not copy the response: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  private send(): void {
    if (this.busy) return;
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';

    this.session.addUser(text);
    this.appendBubble({ role: 'user', content: text });

    this.busy = true;
    this.updateSendButton();

    const contextBlock = this.contextStore.totalChars() > 0 ? this.contextStore.assemble() : null;
    const system = composeSystemPrompt({
      activeFile: this.includeFile ? this.editor?.currentFile() ?? null : null,
      code: this.includeFile ? this.editor?.activeText() ?? null : null,
      additionalContext: contextBlock,
    });

    // Stream the reply: show plain text token-by-token, then swap in the rendered
    // Markdown (code blocks, copy/insert) when it completes.
    const pending = this.appendBubble({ role: 'assistant', content: '' }, true);
    const body = pending.querySelector<HTMLElement>('.znxstudio-chat-body');
    let acc = '';
    let settled = false;

    const finish = (result: AiCompletionResult): void => {
      if (settled) return;
      settled = true;
      this.busy = false;
      this.cancel = null;
      this.updateSendButton();
      pending.remove();

      const finalText = result.text || acc;
      if (result.ok || (result.cancelled && finalText)) {
        // A completed reply, or a cancelled one that already produced text.
        this.session.addAssistant(finalText);
        this.appendBubble({ role: 'assistant', content: finalText });
      } else if (!result.cancelled) {
        const fail = this.appendBubble({ role: 'assistant', content: `⚠ ${result.error ?? 'Request failed.'}` });
        fail.classList.add('is-error');
        this.context.layout.showToast(`AI request failed: ${result.error ?? 'unknown error'}`, 'error');
      }
      this.input?.focus();
    };

    this.cancel = this.ai.completeStream(
      this.session.history(),
      {
        onDelta: (delta) => {
          acc += delta;
          if (body) body.textContent = acc; // live plain text; markdown renders on finish
          this.log.scrollTop = this.log.scrollHeight;
        },
        onDone: finish,
      },
      { system },
    );
  }

  private basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      const info = await window.znxstudio.app.getInfo();
      enabled = info.selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    const session = new ChatSession();
    log(`chat session start empty=${session.isEmpty()}`);
    session.addUser('hello');
    session.addAssistant('hi');
    session.addUser('again');
    log(`chat session turns=${session.history().length} roles=${session.history().map((m) => m.role).join(',')}`);
    const prompt = composeSystemPrompt({ activeFile: 'main.zx', code: 'function main\n    print "hi"\nend\n' });
    log(`chat system prompt hasFile=${prompt.includes('main.zx')} hasCode=${prompt.includes('print "hi"')} len=${prompt.length}`);
    session.reset();
    log(`chat session reset empty=${session.isEmpty()}`);

    // AI markdown rendering: model output becomes real DOM (headings + code blocks
    // with a Copy button), not a raw <pre> dump.
    const md = document.createElement('div');
    let inserted = '';
    renderAiMarkdown(md, '## Fix\nUse `createState`:\n\n```js\nconst c = createState(0);\n```\n', {
      onInsertCode: (code) => (inserted = code),
    });
    const codeBlocks = md.querySelectorAll('.znxstudio-md-code').length;
    const copyBtn = md.querySelector('.znxstudio-ai-md-btn') as HTMLButtonElement | null;
    const insertBtn = md.querySelector('.znxstudio-ai-md-btn ~ .znxstudio-ai-md-btn') as HTMLButtonElement | null;
    insertBtn?.click();
    log(
      `chat aiMarkdown: headings=${md.querySelectorAll('h2').length} codeBlocks=${codeBlocks} ` +
        `copyBtn=${Boolean(copyBtn)} inlineCodeLiteralBackticks=${md.textContent?.includes('`createState`')} ` +
        `insertWorked=${inserted.includes('createState(0)')} (expect 1 heading, 1 code block, copy+insert, no literal backticks)`,
    );
  }
}
