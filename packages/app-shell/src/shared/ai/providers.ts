/**
 * AI provider definitions and localStorage persistence.
 *
 * Each provider describes an LLM endpoint the editor can talk to. Two protocols
 * are supported: Anthropic's native messages API and the OpenAI chat-completions
 * format (which most third-party services implement). The protocol field tells
 * aiInfra which request shape and SSE parser to use.
 *
 * Providers persist to localStorage so they survive page reloads without touching
 * the AD4M data layer — this is session-scoped configuration, not user data.
 */

/**
 * Read the connected AD4M executor URL from localStorage (written by ad4m-connect)
 * and return `${origin}/api/v1`. Falls back to the given default when no stored
 * session exists (e.g. first launch, or connecting to a local executor).
 *
 * ad4m-connect namespaces every key with its package version (`0.13.0/ad4m-url`),
 * so we match on the suffix to stay version-agnostic.
 */
/** Apply provider-specific URL resolution for a built-in provider. */
function resolveProviderUrl(p: { id: string; baseUrl: string }): string {
  let url = p.baseUrl;
  if (p.id === 'ad4m') url = storedAd4mBaseUrl(url);
  if (p.id === 'ollama' && !url.endsWith('/v1')) url = `${url.replace(/\/+$/, '')}/v1`;
  return url;
}

function storedAd4mBaseUrl(fallback: string): string {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key === 'ad4m-url' || key.endsWith('/ad4m-url'))) {
        const url = localStorage.getItem(key);
        if (url) return `${url.replace(/\/+$/, '')}/api/v1`;
      }
    }
  } catch {
    /* private browsing — fall through */
  }
  return fallback;
}

export type AiProtocol = 'anthropic' | 'openai';

export interface AiProvider {
  id: string;
  name: string;
  /** Base URL without trailing slash. Anthropic: ends at /v1. OpenAI-compat: ends at /v1. */
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: AiProtocol;
  /** Built-in providers cannot be deleted, only configured. */
  isBuiltIn: boolean;
}

// ---------------------------------------------------------------------------
// Default catalogue — shipped with WE, always present
// ---------------------------------------------------------------------------

export const DEFAULT_PROVIDERS: readonly AiProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    model: 'claude-sonnet-4-6',
    protocol: 'anthropic',
    isBuiltIn: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o',
    protocol: 'openai',
    isBuiltIn: true,
  },
  {
    id: 'google',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: '',
    model: 'gemini-2.5-flash',
    protocol: 'openai',
    isBuiltIn: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: 'anthropic/claude-sonnet-4',
    protocol: 'openai',
    isBuiltIn: true,
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: '',
    model: 'llama-3.3-70b-versatile',
    protocol: 'openai',
    isBuiltIn: true,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: 'llama3.1',
    protocol: 'openai',
    isBuiltIn: true,
  },
  {
    id: 'ad4m',
    name: 'AD4M Executor',
    baseUrl: 'http://localhost:12000/api/v1',
    apiKey: '',
    model: 'default',
    protocol: 'openai',
    isBuiltIn: true,
  },
] as const;

const STORAGE_KEY = 'we-ai-providers';
const ACTIVE_KEY = 'we-ai-active-provider';

/** IDs of providers that run locally and need no API key. */
const LOCAL_PROVIDER_IDS = new Set(['ad4m', 'ollama']);

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Load providers from localStorage, merging with defaults to pick up new built-ins. */
export function loadProviders(): AiProvider[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PROVIDERS.map((p) => ({
        ...p,
        baseUrl: resolveProviderUrl(p),
      }));
    }

    const saved: AiProvider[] = JSON.parse(raw);
    const savedById = new Map(saved.map((p) => [p.id, p]));

    // Merge: keep user-configured keys/models for built-ins, add any new built-ins
    const merged: AiProvider[] = DEFAULT_PROVIDERS.map((def) => {
      const existing = savedById.get(def.id);
      if (existing) {
        // Preserve user-set fields, refresh structural defaults (name, protocol, isBuiltIn).
        // AD4M always re-resolves from the stored connection URL so it tracks the executor.
        const baseUrl = resolveProviderUrl({ id: def.id, baseUrl: existing.baseUrl || def.baseUrl });
        return {
          ...def,
          apiKey: existing.apiKey,
          model: existing.model || def.model,
          baseUrl,
        };
      }
      return { ...def, baseUrl: resolveProviderUrl(def) };
    });

    // Append custom (non-built-in) providers the user added
    for (const s of saved) {
      if (!DEFAULT_PROVIDERS.some((d) => d.id === s.id)) {
        merged.push({ ...s, isBuiltIn: false });
      }
    }

    return merged;
  } catch {
    return DEFAULT_PROVIDERS.map((p) => ({ ...p, baseUrl: resolveProviderUrl(p) }));
  }
}

/** Save the full provider list to localStorage. */
export function saveProviders(providers: AiProvider[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(providers));
}

/** Get the active provider ID, defaulting to Anthropic. */
export function getActiveProviderId(): string {
  return localStorage.getItem(ACTIVE_KEY) || 'anthropic';
}

/** Set the active provider ID. */
export function setActiveProviderId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

// ---------------------------------------------------------------------------
// Migration from legacy claudeApiKey
// ---------------------------------------------------------------------------

/**
 * If the user had a Claude API key in AgentSettings but no saved providers,
 * migrate it to the Anthropic provider entry and persist.
 *
 * Call once during EditorStore init after AgentSettings load.
 */
export function migrateFromClaudeApiKey(claudeApiKey: string): AiProvider[] {
  if (!claudeApiKey) return loadProviders();

  // Only migrate if no providers have been saved yet
  if (localStorage.getItem(STORAGE_KEY)) return loadProviders();

  const providers = DEFAULT_PROVIDERS.map((p) => ({ ...p, baseUrl: resolveProviderUrl(p) }));
  const anthropic = providers.find((p) => p.id === 'anthropic');
  if (anthropic) anthropic.apiKey = claudeApiKey;

  saveProviders(providers);
  setActiveProviderId('anthropic');
  return providers;
}

/** Check whether a provider has enough configuration to send requests. */
export function isProviderReady(provider: AiProvider | undefined): boolean {
  if (!provider) return false;
  if (!provider.baseUrl || !provider.model) return false;
  // Local providers (AD4M, Ollama) need a URL and model but no API key
  if (LOCAL_PROVIDER_IDS.has(provider.id)) return true;
  return !!provider.apiKey;
}

// ---------------------------------------------------------------------------
// Health check — verify a provider responds without spending tokens
// ---------------------------------------------------------------------------

export type HealthStatus = 'unknown' | 'checking' | 'ok' | 'error';

export interface HealthResult {
  status: 'ok' | 'error';
  /** Model IDs the endpoint reported, if the probe succeeded. */
  models?: string[];
  /** Human-readable error when status = 'error'. */
  error?: string;
}

/**
 * Probe a provider's `/models` endpoint (or Anthropic equivalent).
 *
 * This verifies: network reachability, auth credentials, and what models the
 * endpoint offers — without sending a chat completion or spending tokens.
 *
 * Returns within the timeout (default 8 s) or reports the timeout as an error.
 */
export async function checkProviderHealth(provider: AiProvider, timeoutMs = 8_000): Promise<HealthResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (provider.protocol === 'anthropic') {
      // Anthropic has no /models list endpoint — send a minimal request that
      // validates the key and returns almost instantly (1 token).
      const res = await fetch(`${provider.baseUrl}/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      if (res.ok) return { status: 'ok', models: [provider.model] };
      const body = await res.text().catch(() => '');
      if (res.status === 401) return { status: 'error', error: 'Invalid API key' };
      if (res.status === 404) return { status: 'error', error: `Model "${provider.model}" not found` };
      return { status: 'error', error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }

    // OpenAI-compatible: hit GET /models (or /v1/models depending on baseUrl shape)
    const modelsUrl = provider.baseUrl.endsWith('/v1')
      ? `${provider.baseUrl}/models`
      : `${provider.baseUrl.replace(/\/+$/, '')}/models`;

    const headers: Record<string, string> = {};
    if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

    const res = await fetch(modelsUrl, { signal: controller.signal, headers });
    if (!res.ok) {
      if (res.status === 401) return { status: 'error', error: 'Invalid API key' };
      const body = await res.text().catch(() => '');
      return { status: 'error', error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }

    const json = await res.json().catch(() => null);
    const modelIds: string[] = Array.isArray(json?.data)
      ? json.data.map((m: { id?: string }) => m.id).filter(Boolean)
      : [];

    return { status: 'ok', models: modelIds };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { status: 'error', error: `Timed out after ${timeoutMs / 1000}s — endpoint unreachable` };
    }
    const msg = err instanceof Error ? err.message : 'Connection failed';
    // Browser CORS blocks produce a generic "Failed to fetch" TypeError.
    // Surface actionable guidance for local providers.
    if (msg === 'Failed to fetch' && provider.baseUrl.includes('localhost')) {
      return {
        status: 'error',
        error: `CORS blocked — set OLLAMA_ORIGINS="*" (or the page origin) and restart Ollama`,
      };
    }
    return { status: 'error', error: msg };
  } finally {
    clearTimeout(timer);
  }
}
