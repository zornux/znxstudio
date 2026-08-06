import { describe, expect, test } from './harness';
import {
  buildHttpRequest,
  describeProvider,
  isRetryableStatus,
  parseCompletion,
  redactKey,
  resolveModel,
  retryDelayMs,
  validateConfig,
  type AiMessage,
  type AiProviderConfig,
} from '../src/shared/ai/providers';

const MESSAGES: AiMessage[] = [
  { role: 'system', content: 'be terse' },
  { role: 'user', content: 'hello' },
];

function body(config: AiProviderConfig): Record<string, unknown> {
  return JSON.parse(buildHttpRequest(config, MESSAGES).body ?? '{}');
}

describe('buildHttpRequest — OpenAI', () => {
  test('uses chat/completions with a bearer key and the default model', () => {
    const req = buildHttpRequest({ provider: 'openai', apiKey: 'sk-1' }, MESSAGES);
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(req.headers.authorization).toBe('Bearer sk-1');
    const parsed = body({ provider: 'openai', apiKey: 'sk-1' });
    expect(parsed.model).toBe('gpt-4.1-mini');
    expect((parsed.messages as unknown[]).length).toBe(2); // system kept inline
  });
});

describe('buildHttpRequest — Anthropic', () => {
  test('splits the system prompt out and sets version + key headers', () => {
    const req = buildHttpRequest({ provider: 'anthropic', apiKey: 'k' }, MESSAGES);
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.headers['x-api-key']).toBe('k');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    const parsed = body({ provider: 'anthropic', apiKey: 'k' });
    expect(parsed.system).toBe('be terse');
    expect((parsed.messages as unknown[]).length).toBe(1); // system removed from turns
    expect(parsed.model).toBe('claude-sonnet-5');
  });
});

describe('buildHttpRequest — Google', () => {
  test('embeds the key in the URL and maps assistant→model', () => {
    const messages: AiMessage[] = [{ role: 'assistant', content: 'prior' }, { role: 'user', content: 'now' }];
    const req = buildHttpRequest({ provider: 'google', apiKey: 'g', model: 'gemini-1.5-pro' }, messages);
    expect(req.url).toContain('/models/gemini-1.5-pro:generateContent?key=g');
    const parsed = JSON.parse(req.body ?? '{}');
    const contents = parsed.contents as Array<{ role: string }>;
    expect(contents[0].role).toBe('model');
    expect(contents[1].role).toBe('user');
  });
});

describe('buildHttpRequest — Ollama', () => {
  test('hits the local host with no auth header', () => {
    const req = buildHttpRequest({ provider: 'ollama' }, MESSAGES);
    expect(req.url).toBe('http://localhost:11434/api/chat');
    expect(req.headers.authorization).toBe(undefined);
  });
});

describe('buildHttpRequest — Azure', () => {
  test('builds the deployment path with api-version and api-key header', () => {
    const req = buildHttpRequest(
      { provider: 'azure', apiKey: 'z', baseUrl: 'https://res.openai.azure.com', deployment: 'gpt4o' },
      MESSAGES,
    );
    expect(req.url).toBe(
      'https://res.openai.azure.com/openai/deployments/gpt4o/chat/completions?api-version=2024-06-01',
    );
    expect(req.headers['api-key']).toBe('z');
  });
  test('requires an endpoint', () => {
    let threw = false;
    try {
      buildHttpRequest({ provider: 'azure', apiKey: 'z', deployment: 'd' }, MESSAGES);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe('buildHttpRequest — custom & none', () => {
  test('custom uses the given base and optional key', () => {
    const req = buildHttpRequest({ provider: 'custom', baseUrl: 'https://host/v1', model: 'm' }, MESSAGES);
    expect(req.url).toBe('https://host/v1/chat/completions');
    expect(req.headers.authorization).toBe(undefined);
  });
  test('none throws (disabled)', () => {
    let threw = false;
    try {
      buildHttpRequest({ provider: 'none' }, MESSAGES);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe('parseCompletion', () => {
  test('reads each provider wire shape', () => {
    expect(parseCompletion('openai', 200, JSON.stringify({ choices: [{ message: { content: 'a' } }] })).text).toBe('a');
    expect(parseCompletion('anthropic', 200, JSON.stringify({ content: [{ type: 'text', text: 'b' }] })).text).toBe('b');
    expect(parseCompletion('google', 200, JSON.stringify({ candidates: [{ content: { parts: [{ text: 'c' }] } }] })).text).toBe('c');
    expect(parseCompletion('ollama', 200, JSON.stringify({ message: { content: 'd' } })).text).toBe('d');
  });
  test('surfaces provider errors and HTTP failures', () => {
    const authErr = parseCompletion('openai', 401, JSON.stringify({ error: { message: 'bad key' } }));
    expect(authErr.ok).toBe(false);
    expect(authErr.error).toBe('bad key');
    const ollamaErr = parseCompletion('ollama', 404, JSON.stringify({ error: 'model not found' }));
    expect(ollamaErr.error).toBe('model not found');
    const nonJson = parseCompletion('openai', 500, 'Internal Server Error');
    expect(nonJson.ok).toBe(false);
  });
  test('empty content is not ok', () => {
    expect(parseCompletion('openai', 200, JSON.stringify({ choices: [] })).ok).toBe(false);
  });
});

describe('validateConfig & helpers', () => {
  test('none is reported disabled', () => {
    expect(validateConfig({ provider: 'none' })).toContain('disabled');
  });
  test('a keyed openai config is ready', () => {
    expect(validateConfig({ provider: 'openai', apiKey: 'sk' })).toBeNull();
  });
  test('a keyless openai config reports the missing key', () => {
    expect(validateConfig({ provider: 'openai' })).toContain('API key');
  });
  test('resolveModel falls back to the provider default', () => {
    expect(resolveModel({ provider: 'anthropic' })).toBe('claude-sonnet-5');
    expect(resolveModel({ provider: 'openai', model: 'gpt-4o' })).toBe('gpt-4o');
  });
  test('redactKey hides the secret middle', () => {
    expect(redactKey('')).toBe('(none)');
    expect(redactKey('sk-abcdef123')).toBe('sk-…23');
  });
  test('descriptors expose provider needs', () => {
    expect(describeProvider('azure').needsDeployment).toBe(true);
    expect(describeProvider('ollama').local).toBe(true);
    expect(describeProvider('anthropic').needsKey).toBe(true);
  });
  test('default models are current (2026)', () => {
    expect(resolveModel({ provider: 'openai' })).toBe('gpt-4.1-mini');
    expect(resolveModel({ provider: 'google' })).toBe('gemini-2.5-flash');
    expect(resolveModel({ provider: 'anthropic' })).toBe('claude-sonnet-5');
  });
});

describe('providers — retry policy', () => {
  test('retries rate limits and transient 5xx only', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });
  test('retryDelayMs honors Retry-After, else backs off exponentially, capped', () => {
    expect(retryDelayMs(0, '2')).toBe(2000); // Retry-After seconds wins
    expect(retryDelayMs(0, null)).toBe(500); // 2^0 * 500
    expect(retryDelayMs(2, null)).toBe(2000); // 2^2 * 500
    expect(retryDelayMs(9, null)).toBe(20_000); // capped
    expect(retryDelayMs(0, '9999')).toBe(20_000); // Retry-After capped too
    expect(retryDelayMs(1, 'garbage')).toBe(1000); // bad header → backoff
  });
});
