import * as monaco from 'monaco-editor';
import {
  ServiceKeys,
  type AiService,
  type EditorService,
  type SettingsService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import {
  buildCompletionMessages,
  cleanCompletion,
  completionWindow,
  shouldComplete,
} from './completion';

/** Languages that receive AI inline completions. */
const COMPLETION_LANGUAGES = ['zornux'];
const AUTO_DEBOUNCE_MS = 450;

/**
 * Inline AI completion (Phase 10B). Registers a Monaco inline-completions
 * provider that asks the configured AI provider (via the vendor-neutral
 * AiService) to continue the code at the cursor, then renders it as ghost text.
 *
 * Off unless a provider is configured. Automatic-as-you-type is opt-in
 * (`ai.completion.auto`) since cloud calls cost tokens — by default completion
 * fires only on an explicit trigger (the "AI: Complete Here" command).
 */
export class CompletionModule implements IModule {
  readonly id = 'znxstudio.ai.completion';
  readonly displayName = 'AI Completion';

  private context!: ModuleContext;
  private ai!: AiService;
  private editor: EditorService | undefined;
  private settings: SettingsService | undefined;
  private lastKey = '';
  private lastText = '';

  activate(context: ModuleContext): void {
    this.context = context;
    this.ai = context.services.get<AiService>(ServiceKeys.Ai);
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);

    context.subscriptions.push(this.registerProvider());
    context.commands.register(CommandIds.AiComplete, () => this.triggerHere(), 'AI: Complete Here');

    void selfTestCoordinator.run('ai-completion', () => this.maybeSelfTest());
  }

  private enabled(): boolean {
    return this.ai.isEnabled() && (this.settings?.get('ai.completion.enabled', true) ?? true);
  }

  private maxTokens(): number {
    const value = Number(this.settings?.get('ai.completion.maxTokens', 128));
    return Number.isFinite(value) && value > 0 ? value : 128;
  }

  private triggerHere(): void {
    if (!this.enabled()) {
      this.context.layout.showToast('AI completion is off — configure a provider first.', 'info');
      return;
    }
    this.editor?.runEditorAction('editor.action.inlineSuggest.trigger');
  }

  private registerProvider(): monaco.IDisposable {
    return monaco.languages.registerInlineCompletionsProvider(COMPLETION_LANGUAGES, {
      provideInlineCompletions: async (model, position, ctx, token) => {
        const empty = { items: [] };
        if (!this.enabled()) return empty;

        const explicit = ctx.triggerKind === monaco.languages.InlineCompletionTriggerKind.Explicit;
        const auto = this.settings?.get('ai.completion.auto', false) ?? false;
        if (!explicit && !auto) return empty;

        // Debounce automatic requests so typing doesn't spawn a call per keystroke.
        if (!explicit) {
          await delay(AUTO_DEBOUNCE_MS);
          if (token.isCancellationRequested) return empty;
        }

        const offset = model.getOffsetAt(position);
        const win = completionWindow(model.getValue(), offset);
        if (!shouldComplete(win)) return empty;

        // Skip an identical automatic re-request at the same spot.
        const key = `${offset}:${win.prefix.slice(-120)}`;
        if (!explicit && key === this.lastKey) {
          return this.lastText ? this.oneItem(model, position, this.lastText) : empty;
        }

        const fileName = basename(model.uri.path);
        const { system, messages } = buildCompletionMessages(win, fileName);
        const result = await this.ai.complete(messages, { system, temperature: 0, maxTokens: this.maxTokens() });
        if (token.isCancellationRequested) return empty;
        if (!result.ok) {
          if (explicit) this.context.layout.showToast(`AI completion failed: ${result.error ?? 'unknown error'}`, 'error');
          return empty;
        }

        const text = cleanCompletion(result.text, win.prefix);
        this.lastKey = key;
        this.lastText = text;
        if (!text) return empty;
        return this.oneItem(model, position, text);
      },
      freeInlineCompletions: () => {
        /* no resources held per result */
      },
    });
  }

  private oneItem(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    text: string,
  ): monaco.languages.InlineCompletions {
    void model;
    return {
      items: [
        {
          insertText: text,
          range: new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          ),
        },
      ],
    };
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

    const text = 'function main\n    print "hi"\n';
    const win = completionWindow(text, text.length);
    log(`completion window prefixEndsNL=${win.prefix.endsWith('\n')} should=${shouldComplete(win)}`);
    const midWord = completionWindow('let valu', 8);
    log(`completion mid-token should=${shouldComplete({ prefix: midWord.prefix, suffix: 'e' })} (expect false)`);
    const framed = buildCompletionMessages(win, 'main.zx');
    log(`completion prompt hasCursor=${framed.messages[0].content.includes('<CURSOR>')} hasFile=${framed.messages[0].content.includes('main.zx')}`);
    const cleaned = cleanCompletion('```zornux\n    give back 1\n```', '    ');
    log(`completion clean fences=${JSON.stringify(cleaned)}`);

    // REAL completion — only if a provider is configured; otherwise honest skip.
    try {
      if (this.ai.isEnabled()) {
        const { system, messages } = buildCompletionMessages(
          completionWindow('function add with a, b\n    give back ', 42),
          'math.zx',
        );
        const result = await this.ai.complete(messages, { system, temperature: 0, maxTokens: 48 });
        log(`completion REAL: provider=${this.ai.providerId()} ok=${result.ok} text=${JSON.stringify((result.text || result.error || '').slice(0, 60))}`);
      } else {
        log('completion REAL: no provider configured — skipped');
      }
    } catch (error) {
      log(`completion REAL failed: ${(error as Error).message}`);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
