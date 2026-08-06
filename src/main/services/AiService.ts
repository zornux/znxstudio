import {
  buildHttpRequest,
  createStreamParser,
  envKeyFor,
  isRetryableStatus,
  parseCompletion,
  resolveModel,
  retryDelayMs,
  validateConfig,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiProviderConfig,
} from '../../shared/ai/providers';

/** A sleep that rejects (AbortError) when the request's overall timeout fires. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}

/**
 * The one place AI requests actually leave the machine (Phase 10A). Lives in the
 * main process because the renderer is Node-free and holds no network access.
 * Vendor-neutral: it only knows the pure provider layer — build request, fetch,
 * parse — so adding a provider never touches this file.
 *
 * A blank API key is sourced from the provider's environment variable, letting
 * enterprises inject secrets without persisting them in settings.json.
 */
export class AiService {
  private readonly timeoutMs: number;

  constructor(timeoutMs = 60_000) {
    this.timeoutMs = timeoutMs;
  }

  /** Fill a blank apiKey from the provider's environment variable(s). */
  private withEnvKey(config: AiProviderConfig): AiProviderConfig {
    if ((config.apiKey ?? '').trim()) return config;
    for (const name of envKeyFor(config.provider)) {
      const value = process.env[name];
      if (value && value.trim()) return { ...config, apiKey: value.trim() };
    }
    return config;
  }

  async complete(request: AiCompletionRequest, attempts = 3): Promise<AiCompletionResult> {
    const config = this.withEnvKey(request.config);
    const model = resolveModel(config);
    const base: AiCompletionResult = { ok: false, text: '', provider: config.provider, model };

    const invalid = validateConfig(config);
    if (invalid) return { ...base, error: invalid };

    let http;
    try {
      http = buildHttpRequest(config, request.messages);
    } catch (error) {
      return { ...base, error: (error as Error).message };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // Retry rate limits (429) and transient 5xx with backoff (honoring
      // Retry-After), all within the single overall timeout above.
      for (let attempt = 0; ; attempt += 1) {
        const response = await fetch(http.url, {
          method: http.method,
          headers: http.headers,
          body: http.body,
          signal: controller.signal,
        });
        const bodyText = await response.text();
        const parsed = parseCompletion(config.provider, response.status, bodyText);
        const canRetry = !parsed.ok && isRetryableStatus(response.status) && attempt < attempts - 1;
        if (!canRetry) {
          return { ...base, ok: parsed.ok, text: parsed.text, status: response.status, error: parsed.error };
        }
        await abortableSleep(retryDelayMs(attempt, response.headers.get('retry-after')), controller.signal);
      }
    } catch (error) {
      const message = (error as Error).name === 'AbortError'
        ? `Request timed out after ${Math.round(this.timeoutMs / 1000)}s.`
        : (error as Error).message;
      return { ...base, error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Stream a completion: token-by-token deltas via `onDelta`, resolving to the
   * final result (full text, or an error). `signal` lets the caller cancel; the
   * overall timeout still applies. Not retried — a stream that starts is live.
   */
  async completeStream(
    request: AiCompletionRequest,
    onDelta: (delta: string) => void,
    signal: AbortSignal,
  ): Promise<AiCompletionResult> {
    const config = this.withEnvKey(request.config);
    const model = resolveModel(config);
    const base: AiCompletionResult = { ok: false, text: '', provider: config.provider, model };

    const invalid = validateConfig(config);
    if (invalid) return { ...base, error: invalid };

    let http;
    try {
      http = buildHttpRequest(config, request.messages, { stream: true });
    } catch (error) {
      return { ...base, error: (error as Error).message };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const relayAbort = (): void => controller.abort();
    signal.addEventListener('abort', relayAbort, { once: true });
    try {
      const response = await fetch(http.url, {
        method: http.method,
        headers: http.headers,
        body: http.body,
        signal: controller.signal,
      });
      // A non-2xx (or bodyless) response isn't a stream — read it as a normal error.
      if (!response.ok || !response.body) {
        const bodyText = await response.text();
        const parsed = parseCompletion(config.provider, response.status, bodyText);
        return { ...base, ok: parsed.ok, text: parsed.text, status: response.status, error: parsed.error };
      }
      const parser = createStreamParser(config.provider);
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let text = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const delta of parser.push(decoder.decode(value, { stream: true }))) {
          text += delta;
          onDelta(delta);
        }
      }
      for (const delta of parser.push(decoder.decode())) {
        text += delta;
        onDelta(delta);
      }
      return { ...base, ok: true, text, status: response.status };
    } catch (error) {
      const aborted = (error as Error).name === 'AbortError';
      const message = aborted
        ? signal.aborted
          ? 'Cancelled.'
          : `Request timed out after ${Math.round(this.timeoutMs / 1000)}s.`
        : (error as Error).message;
      return { ...base, error: message, cancelled: aborted && signal.aborted };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', relayAbort);
    }
  }

  /**
   * A minimal auth/liveness ping. Identical path to `complete` but with a short
   * timeout — the renderer passes a tiny message + maxTokens for a cheap probe.
   */
  async probe(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const config = { maxTokens: 16, ...request.config };
    return this.complete({ config, messages: request.messages }, 1); // no retries — a fast liveness ping
  }
}
