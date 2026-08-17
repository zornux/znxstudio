import {
  ServiceKeys,
  type AiRequestOptions,
  type AiService,
  type EditorService,
  type SettingsService,
  type StatusService,
  type WorkspaceService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import {
  AI_PROVIDERS,
  buildHttpRequest,
  describeProvider,
  parseCompletion,
  providerLabel,
  redactKey,
  resolveModel,
  validateConfig,
  type AiCompletionResult,
  type AiMessage,
  type AiProviderConfig,
  type AiProviderId,
} from '../../shared/ai/providers';
import { renderAiSettings } from './AiSettingsView';
import { ContextStore } from './context';

/**
 * The vendor-neutral AI facade (Phase 10A). Owns provider configuration (read
 * from settings, sourced from any of OpenAI / Anthropic / Google / Ollama /
 * Azure / custom, or disabled), the provider picker UI, and a status chip. It is
 * the single seam every later AI feature depends on — none of them know or care
 * which vendor is behind `complete()`.
 */
export class AiModule implements IModule, AiService {
  readonly id = 'znxstudio.ai';
  readonly displayName = 'AI';

  private context!: ModuleContext;
  private settings!: SettingsService;
  private status: StatusService | undefined;
  private readonly changeEmitter = new Emitter<AiProviderConfig>();
  readonly onDidChangeConfig = this.changeEmitter.event;

  activate(context: ModuleContext): void {
    this.context = context;
    this.settings = context.services.get<SettingsService>(ServiceKeys.Settings);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);

    context.services.register(ServiceKeys.Ai, this);
    context.services.register(ServiceKeys.AiContext, new ContextStore());
    context.commands.register(CommandIds.AiConfigure, () => this.openSettings(), 'AI: Configure Provider');

    const editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    const workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    const fileCommands = new Set<string>([
      CommandIds.AiComplete,
      CommandIds.AiReview,
      CommandIds.AiDocSymbol,
      CommandIds.AiDocFile,
      CommandIds.AiTestGen,
      CommandIds.AiExplainError,
      CommandIds.AiFixError,
    ]);
    context.commands.addEnablementRule((id) => {
      if (fileCommands.has(id)) return this.isEnabled() && (editor?.currentFile() ?? null) !== null;
      if (id === CommandIds.AiRefactor) return this.isEnabled() && (editor?.selectedCharCount() ?? 0) > 0;
      if (id === CommandIds.AiArchitecture) return this.isEnabled() && (workspace?.currentFolder() ?? null) !== null;
      return undefined;
    });
    const fileSubscription = editor?.onDidChangeActiveFile(() => context.commands.notifyEnablementChanged());
    const selectionSubscription = editor?.onDidChangeSelections(() => context.commands.notifyEnablementChanged());
    const workspaceSubscription = workspace?.onDidChangeWorkspace(() => context.commands.notifyEnablementChanged());
    if (fileSubscription) context.subscriptions.push(fileSubscription);
    if (selectionSubscription) context.subscriptions.push(selectionSubscription);
    if (workspaceSubscription) context.subscriptions.push(workspaceSubscription);

    // React to provider/model/key edits made anywhere (JSON editor or picker).
    context.subscriptions.push(this.settings.onDidChange((event) => {
      if (event.key.startsWith('ai.')) {
        this.updateStatus();
        this.changeEmitter.fire(this.config());
        context.commands.notifyEnablementChanged();
      }
    }));

    this.updateStatus();
    void selfTestCoordinator.run('ai', () => this.maybeSelfTest());
  }

  /* ----- config assembly (settings → AiProviderConfig) ----- */
  config(): AiProviderConfig {
    const s = this.settings;
    const str = (key: string) => String(s.get(key, '') ?? '').trim();
    const num = (key: string, fallback: number) => {
      const value = Number(s.get(key, fallback));
      return Number.isFinite(value) ? value : fallback;
    };
    const provider = (str('ai.provider') || 'none') as AiProviderId;
    const config: AiProviderConfig = { provider };
    const apiKey = str('ai.apiKey');
    const baseUrl = str('ai.baseUrl');
    const model = str('ai.model');
    const deployment = str('ai.deployment');
    const apiVersion = str('ai.apiVersion');
    if (apiKey) config.apiKey = apiKey;
    if (baseUrl) config.baseUrl = baseUrl;
    if (model) config.model = model;
    if (deployment) config.deployment = deployment;
    if (apiVersion) config.apiVersion = apiVersion;
    config.temperature = num('ai.temperature', 0.2);
    config.maxTokens = num('ai.maxTokens', 1024);
    return config;
  }

  providerId(): AiProviderId {
    return this.config().provider;
  }

  providerLabel(): string {
    return providerLabel(this.providerId());
  }

  /**
   * Readiness ignores the API key when the provider sources it from the
   * environment (main fills a blank key). We can't see env vars from the
   * renderer, so a keyless-but-env-capable provider is reported as ready.
   */
  readiness(): string | null {
    const config = this.config();
    if (config.provider === 'none') return validateConfig(config);
    const desc = describeProvider(config.provider);
    if (desc.needsKey && !(config.apiKey ?? '').trim() && desc.envKeys.length > 0) {
      // Might still be provided via env in main — validate the rest.
      return validateConfig({ ...config, apiKey: 'env-placeholder' });
    }
    return validateConfig(config);
  }

  isEnabled(): boolean {
    return this.providerId() !== 'none';
  }

  /* ----- the common interface ----- */
  async complete(messages: AiMessage[], options?: AiRequestOptions): Promise<AiCompletionResult> {
    const config = this.applyOptions(this.config(), options);
    const blocker = this.readiness();
    if (blocker) {
      return { ok: false, text: '', provider: config.provider, model: resolveModel(config), error: blocker };
    }
    const withSystem = this.ensureSystem(messages, options?.system);
    try {
      return await window.znxstudio.ai.complete({ config, messages: withSystem });
    } catch (error) {
      return { ok: false, text: '', provider: config.provider, model: resolveModel(config), error: (error as Error).message };
    }
  }

  /** Stream a completion: `onDelta` per chunk, `onDone` at the end. Returns cancel. */
  completeStream(
    messages: AiMessage[],
    callbacks: { onDelta(delta: string): void; onDone(result: AiCompletionResult): void },
    options?: AiRequestOptions,
  ): () => void {
    const config = this.applyOptions(this.config(), options);
    const blocker = this.readiness();
    if (blocker) {
      callbacks.onDone({ ok: false, text: '', provider: config.provider, model: resolveModel(config), error: blocker });
      return () => undefined;
    }
    const withSystem = this.ensureSystem(messages, options?.system);
    try {
      return window.znxstudio.ai.completeStream({ config, messages: withSystem }, callbacks);
    } catch (error) {
      callbacks.onDone({ ok: false, text: '', provider: config.provider, model: resolveModel(config), error: (error as Error).message });
      return () => undefined;
    }
  }

  ask(prompt: string, options?: AiRequestOptions): Promise<AiCompletionResult> {
    return this.complete([{ role: 'user', content: prompt }], options);
  }

  async probe(): Promise<AiCompletionResult> {
    const config = this.config();
    try {
      return await window.znxstudio.ai.probe({
        config,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      });
    } catch (error) {
      return { ok: false, text: '', provider: config.provider, model: resolveModel(config), error: (error as Error).message };
    }
  }

  private applyOptions(config: AiProviderConfig, options?: AiRequestOptions): AiProviderConfig {
    if (!options) return config;
    const next = { ...config };
    if (options.temperature !== undefined) next.temperature = options.temperature;
    if (options.maxTokens !== undefined) next.maxTokens = options.maxTokens;
    return next;
  }

  private ensureSystem(messages: AiMessage[], system?: string): AiMessage[] {
    if (!system) return messages;
    if (messages.some((m) => m.role === 'system')) return messages;
    return [{ role: 'system', content: system }, ...messages];
  }

  /* ----- provider picker (Settings mock) ----- */
  openSettings(): void {
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (!editor) return;
    const view = renderAiSettings({
      config: this.config(),
      readCurrent: () => this.config(),
      onChange: (key, value) => this.settings.set(`ai.${key}`, value),
      onProbe: () => this.probe(),
      onError: (message) => this.context.layout.showToast(message, 'error'),
    });
    editor.showView(view);
  }

  /* ----- status chip ----- */
  private updateStatus(): void {
    if (!this.status) return;
    const enabled = this.isEnabled();
    const label = this.providerLabel();
    const text = enabled ? `AI ${label}` : 'AI off';
    const ready = this.readiness();
    const tooltip = enabled
      ? ready
        ? `AI: ${label} — ${ready}`
        : `AI: ${label} (${resolveModel(this.config()) || 'default'}) — click to configure`
      : 'AI is off — click to choose a provider';
    this.status.setItem('editor.ai', {
      text,
      tooltip,
      command: CommandIds.AiConfigure,
      side: 'right',
      priority: 25,
    });
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

    // Pure provider layer: every provider builds a request; parsing round-trips.
    const messages: AiMessage[] = [
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'ping' },
    ];
    for (const desc of AI_PROVIDERS) {
      if (desc.id === 'none') continue;
      const cfg: AiProviderConfig = {
        provider: desc.id,
        apiKey: desc.needsKey ? 'test-key' : undefined,
        baseUrl: desc.needsEndpoint ? 'https://example.test/v1' : undefined,
        deployment: desc.needsDeployment ? 'my-deploy' : undefined,
      };
      try {
        const http = buildHttpRequest(cfg, messages);
        log(`ai provider ${desc.id}: ${http.method} ${http.url.replace(/key=[^&]+/, 'key=•••')} model=${resolveModel(cfg) || '(deployment)'}`);
      } catch (error) {
        log(`ai provider ${desc.id}: build FAILED ${(error as Error).message}`);
      }
    }
    // Parse a representative OpenAI + Anthropic + Gemini + Ollama body shape.
    const openai = parseCompletion('openai', 200, JSON.stringify({ choices: [{ message: { content: 'hi' } }] }));
    const anthropic = parseCompletion('anthropic', 200, JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }));
    const gemini = parseCompletion('google', 200, JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }));
    const ollama = parseCompletion('ollama', 200, JSON.stringify({ message: { content: 'hi' } }));
    const errShape = parseCompletion('openai', 401, JSON.stringify({ error: { message: 'bad key' } }));
    log(`ai parse: openai=${openai.text} anthropic=${anthropic.text} gemini=${gemini.text} ollama=${ollama.text} error(401)=${errShape.ok}/${errShape.error}`);
    log(`ai none disabled=${validateConfig({ provider: 'none' }) !== null} redact=${redactKey('sk-abcdef12345')}`);

    // REAL call — ONLY if a provider is configured via env; never dirties repos.
    try {
      const cfg = this.config();
      if (cfg.provider !== 'none') {
        const result = await this.probe();
        log(`ai REAL probe: provider=${cfg.provider} ok=${result.ok} status=${result.status ?? '-'} text=${JSON.stringify((result.text || result.error || '').slice(0, 60))}`);
      } else {
        // Opportunistic local Ollama liveness — real, but optional and non-fatal.
        const probe = await window.znxstudio.ai.probe({
          config: { provider: 'ollama' },
          messages: [{ role: 'user', content: 'ok' }],
        });
        log(`ai REAL: no provider configured — optional local Ollama reachable=${probe.ok || (probe.status !== undefined)} note=${JSON.stringify((probe.error || probe.text || '').slice(0, 50))}`);
      }
    } catch (error) {
      log(`ai REAL failed: ${(error as Error).message}`);
    }
  }
}
