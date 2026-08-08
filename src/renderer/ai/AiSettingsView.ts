import {
  AI_PROVIDERS,
  describeProvider,
  redactKey,
  resolveModel,
  validateConfig,
  type AiCompletionResult,
  type AiProviderConfig,
  type AiProviderId,
} from '../../shared/ai/providers';

export interface AiSettingsProps {
  config: AiProviderConfig;
  /** Re-read the live config (after writes) so validation reflects reality. */
  readCurrent: () => AiProviderConfig;
  /** Persist one `ai.<key>` setting. */
  onChange: (key: string, value: string | number) => void;
  /** Run a connection probe against the current config. */
  onProbe: () => Promise<AiCompletionResult>;
  onError?: (message: string) => void;
}

/**
 * The AI provider picker (Phase 10A) — the front door to vendor-neutral AI.
 * Radios for None / OpenAI / Anthropic / Google / Ollama / Azure / Custom, with
 * only the fields the chosen provider needs, a Test-Connection probe, and an
 * explicit privacy note. No vendor is ever required; "None" is a first-class,
 * default choice.
 */
export function renderAiSettings(props: AiSettingsProps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'znxstudio-ai-settings';

  const header = document.createElement('div');
  header.className = 'znxstudio-ai-settings-header';
  header.innerHTML = `
    <h1>AI Provider</h1>
    <p class="znxstudio-muted">AI is optional and vendor-neutral. Choose a provider — or leave it off.
    Every AI feature (chat, completion, refactoring, docs, tests, debugging, architecture) uses the one you pick.</p>
  `;
  root.appendChild(header);

  const layout = document.createElement('div');
  layout.className = 'znxstudio-ai-settings-body';
  root.appendChild(layout);

  const radios = document.createElement('div');
  radios.className = 'znxstudio-ai-providers';
  layout.appendChild(radios);

  const detail = document.createElement('div');
  detail.className = 'znxstudio-ai-detail';
  layout.appendChild(detail);

  let provider: AiProviderId = props.config.provider;

  for (const desc of AI_PROVIDERS) {
    const option = document.createElement('label');
    option.className = 'znxstudio-ai-provider';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'ai-provider';
    input.value = desc.id;
    input.checked = desc.id === provider;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      provider = desc.id;
      props.onChange('provider', desc.id);
      renderDetail();
      for (const el of radios.querySelectorAll('.znxstudio-ai-provider')) el.classList.remove('is-active');
      option.classList.add('is-active');
    });
    const text = document.createElement('span');
    text.className = 'znxstudio-ai-provider-text';
    text.innerHTML = `<strong>${desc.label}</strong><small>${desc.blurb}</small>`;
    option.append(input, text);
    if (desc.id === provider) option.classList.add('is-active');
    radios.appendChild(option);
  }

  function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'znxstudio-ai-field';
    const lab = document.createElement('label');
    lab.textContent = label;
    wrap.append(lab, control);
    if (hint) {
      const small = document.createElement('small');
      small.className = 'znxstudio-muted';
      small.textContent = hint;
      wrap.appendChild(small);
    }
    return wrap;
  }

  function textInput(key: string, value: string, placeholder: string, password = false): HTMLInputElement {
    const input = document.createElement('input');
    input.type = password ? 'password' : 'text';
    input.className = 'znxstudio-ai-input';
    input.value = value;
    input.placeholder = placeholder;
    input.spellcheck = false;
    input.addEventListener('change', () => props.onChange(key, input.value.trim()));
    return input;
  }

  function renderDetail(): void {
    detail.replaceChildren();
    const desc = describeProvider(provider);
    const config = props.readCurrent();

    if (provider === 'none') {
      const off = document.createElement('div');
      off.className = 'znxstudio-ai-off';
      off.innerHTML = `<p>AI is <strong>off</strong>. Nothing is sent to any service. Pick a provider above to enable AI features.</p>`;
      detail.appendChild(off);
      return;
    }

    // Model (or Azure deployment).
    if (desc.needsDeployment) {
      detail.appendChild(
        field('Deployment name', textInput('deployment', config.deployment ?? '', 'my-gpt-4o'), 'Your Azure OpenAI deployment.'),
      );
      detail.appendChild(
        field('API version', textInput('apiVersion', config.apiVersion ?? '', '2024-06-01'), 'Azure OpenAI api-version.'),
      );
    } else {
      const model = textInput('model', config.model ?? '', desc.defaultModel || 'model name');
      if (desc.models.length) {
        const listId = `ai-models-${desc.id}`;
        model.setAttribute('list', listId);
        const datalist = document.createElement('datalist');
        datalist.id = listId;
        for (const name of desc.models) {
          const opt = document.createElement('option');
          opt.value = name;
          datalist.appendChild(opt);
        }
        detail.appendChild(datalist);
      }
      detail.appendChild(
        field('Model', model, desc.defaultModel ? `Blank = ${desc.defaultModel}` : 'Any model your provider serves.'),
      );
    }

    // Endpoint (host / base URL).
    if (desc.needsEndpoint || desc.local) {
      const endpoint = textInput('baseUrl', config.baseUrl ?? '', desc.defaultBaseUrl ?? 'https://…');
      detail.appendChild(field(desc.endpointLabel ?? 'Endpoint', endpoint, desc.defaultBaseUrl ? `Blank = ${desc.defaultBaseUrl}` : undefined));
    }

    // API key.
    if (desc.needsKey || desc.id === 'custom') {
      const key = textInput('apiKey', config.apiKey ?? '', 'paste key (or use env var)', true);
      const hint = desc.envKeys.length
        ? `Blank = read from ${desc.envKeys.join(' / ')}. Stored in settings.json when set.`
        : 'Optional. Stored in settings.json when set.';
      detail.appendChild(field(desc.keyLabel ?? 'API key', key, hint));
    }

    // Sampling (shared).
    const temp = document.createElement('input');
    temp.type = 'number';
    temp.className = 'znxstudio-ai-input';
    temp.min = '0';
    temp.max = '2';
    temp.step = '0.1';
    temp.value = String(config.temperature ?? 0.2);
    temp.addEventListener('change', () => props.onChange('temperature', Number(temp.value)));
    detail.appendChild(field('Temperature', temp));

    // Docs link + privacy note.
    const foot = document.createElement('div');
    foot.className = 'znxstudio-ai-foot';
    if (desc.docsUrl) {
      const link = document.createElement('a');
      link.href = '#';
      link.className = 'znxstudio-ai-link';
      link.textContent = 'Where do I get a key? ↗';
      link.addEventListener('click', (event) => {
        event.preventDefault();
        void window.znxstudio.shell.openExternal(desc.docsUrl!).catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          props.onError?.(`Could not open the provider documentation: ${detail}`);
        });
      });
      foot.appendChild(link);
    }
    const privacy = document.createElement('p');
    privacy.className = 'znxstudio-ai-privacy znxstudio-muted';
    privacy.textContent = desc.local
      ? 'Runs locally on your machine — prompts never leave your computer.'
      : 'Prompts are sent to this provider when you use an AI feature.';
    foot.appendChild(privacy);
    detail.appendChild(foot);

    // Test connection.
    const actions = document.createElement('div');
    actions.className = 'znxstudio-ai-actions';
    const probe = document.createElement('button');
    probe.className = 'znxstudio-btn';
    probe.textContent = 'Test connection';
    const result = document.createElement('span');
    result.className = 'znxstudio-ai-probe-result';

    const blocker = validateConfig({ ...config, apiKey: config.apiKey || (desc.needsKey ? 'env-placeholder' : config.apiKey) });
    if (blocker) {
      result.className = 'znxstudio-ai-probe-result is-warn';
      result.textContent = blocker;
    } else {
      result.textContent = `Ready · ${resolveModel(config) || config.deployment || 'deployment'} · key ${redactKey(config.apiKey)}`;
    }

    probe.addEventListener('click', async () => {
      probe.disabled = true;
      result.className = 'znxstudio-ai-probe-result';
      result.textContent = 'Testing…';
      const outcome = await props.onProbe();
      if (outcome.ok) {
        result.className = 'znxstudio-ai-probe-result is-ok';
        result.textContent = `✓ Connected to ${outcome.provider} (${outcome.model || 'default'})`;
      } else {
        result.className = 'znxstudio-ai-probe-result is-error';
        result.textContent = `✗ ${outcome.error ?? 'Connection failed'}`;
      }
      probe.disabled = false;
    });
    actions.append(probe, result);
    detail.appendChild(actions);
  }

  renderDetail();
  return root;
}
