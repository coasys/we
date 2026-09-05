/**
 * AI provider persistence, readiness checks, and health probes.
 *
 * Exercises the pure functions in `providers.ts` — the layer between
 * localStorage and the EditorStore signals.  Mock `fetch` for health checks,
 * mock `localStorage` for persistence, leave everything else real.
 */
import type { AiProvider } from '@shared/ai/providers';
import {
  checkProviderHealth,
  DEFAULT_PROVIDERS,
  getActiveProviderId,
  isProviderReady,
  loadProviders,
  migrateFromClaudeApiKey,
  saveProviders,
  setActiveProviderId,
} from '@shared/ai/providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// localStorage mock — tests must not leak state between runs
// ---------------------------------------------------------------------------

let storage: Map<string, string>;

function mockLocalStorage() {
  storage = new Map();
  const mock = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
    get length() {
      return storage.size;
    },
    key: (i: number) => [...storage.keys()][i] ?? null,
  };
  vi.stubGlobal('localStorage', mock);
}

beforeEach(() => mockLocalStorage());
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function provider(overrides: Partial<AiProvider> = {}): AiProvider {
  return {
    id: 'test',
    name: 'Test',
    baseUrl: 'https://api.test.com/v1',
    apiKey: 'sk-test',
    model: 'test-model',
    protocol: 'openai',
    isBuiltIn: true,
    ...overrides,
  };
}

function savedProviders(providers: AiProvider[]) {
  storage.set('we-ai-providers', JSON.stringify(providers));
}

// ---------------------------------------------------------------------------
// loadProviders
// ---------------------------------------------------------------------------

describe('loadProviders', () => {
  it('returns defaults when nothing saved', () => {
    const result = loadProviders();
    expect(result.map((p) => p.id)).toEqual(DEFAULT_PROVIDERS.map((p) => p.id));
  });

  it('preserves user-set apiKey and model from saved data', () => {
    const saved = DEFAULT_PROVIDERS.map((p) => ({ ...p }));
    const anthropic = saved.find((p) => p.id === 'anthropic')!;
    anthropic.apiKey = 'sk-user-key';
    anthropic.model = 'claude-opus-5';
    savedProviders(saved);

    const result = loadProviders();
    const loaded = result.find((p) => p.id === 'anthropic')!;
    expect(loaded.apiKey).toBe('sk-user-key');
    expect(loaded.model).toBe('claude-opus-5');
  });

  it('refreshes structural fields (name, protocol, isBuiltIn) from defaults', () => {
    const saved = [{ ...DEFAULT_PROVIDERS[0], name: 'Old Name', protocol: 'openai' as const }];
    savedProviders(saved);

    const result = loadProviders();
    const loaded = result.find((p) => p.id === 'anthropic')!;
    expect(loaded.name).toBe('Anthropic');
    expect(loaded.protocol).toBe('anthropic');
    expect(loaded.isBuiltIn).toBe(true);
  });

  it('includes new built-in providers not present in saved data', () => {
    // Save only the first 3 providers — the rest should appear from defaults
    const saved = DEFAULT_PROVIDERS.slice(0, 3).map((p) => ({ ...p }));
    savedProviders(saved);

    const result = loadProviders();
    expect(result.length).toBeGreaterThanOrEqual(DEFAULT_PROVIDERS.length);
    for (const def of DEFAULT_PROVIDERS) {
      expect(result.some((p) => p.id === def.id)).toBe(true);
    }
  });

  it('preserves custom (non-built-in) user-added providers', () => {
    const custom: AiProvider = {
      id: 'my-custom',
      name: 'My LLM',
      baseUrl: 'https://my-llm.example.com/v1',
      apiKey: 'key-123',
      model: 'custom-model',
      protocol: 'openai',
      isBuiltIn: false,
    };
    savedProviders([...DEFAULT_PROVIDERS.map((p) => ({ ...p })), custom]);

    const result = loadProviders();
    const loaded = result.find((p) => p.id === 'my-custom');
    expect(loaded).toBeDefined();
    expect(loaded!.baseUrl).toBe('https://my-llm.example.com/v1');
    expect(loaded!.isBuiltIn).toBe(false);
  });

  it('appends /v1 to stale Ollama URLs', () => {
    const saved = DEFAULT_PROVIDERS.map((p) => ({ ...p }));
    const ollama = saved.find((p) => p.id === 'ollama')!;
    ollama.baseUrl = 'http://localhost:11434';
    savedProviders(saved);

    const result = loadProviders();
    const loaded = result.find((p) => p.id === 'ollama')!;
    expect(loaded.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('leaves Ollama URL alone when it already has /v1', () => {
    const saved = DEFAULT_PROVIDERS.map((p) => ({ ...p }));
    savedProviders(saved);

    const result = loadProviders();
    const loaded = result.find((p) => p.id === 'ollama')!;
    expect(loaded.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('resolves AD4M baseUrl from stored ad4m-url', () => {
    storage.set('0.13.0/ad4m-url', 'http://remote-host:12000');
    const result = loadProviders();
    const ad4m = result.find((p) => p.id === 'ad4m')!;
    expect(ad4m.baseUrl).toBe('http://remote-host:12000/api/v1');
  });

  it('resolves AD4M baseUrl from bare ad4m-url key', () => {
    storage.set('ad4m-url', 'http://other-host:9999');
    const result = loadProviders();
    const ad4m = result.find((p) => p.id === 'ad4m')!;
    expect(ad4m.baseUrl).toBe('http://other-host:9999/api/v1');
  });

  it('strips trailing slashes from ad4m-url before appending /api/v1', () => {
    storage.set('ad4m-url', 'http://remote-host:12000/');
    const result = loadProviders();
    const ad4m = result.find((p) => p.id === 'ad4m')!;
    expect(ad4m.baseUrl).toBe('http://remote-host:12000/api/v1');
  });

  it('falls back to default AD4M URL when no ad4m-url in localStorage', () => {
    const result = loadProviders();
    const ad4m = result.find((p) => p.id === 'ad4m')!;
    expect(ad4m.baseUrl).toBe('http://localhost:12000/api/v1');
  });

  it('falls back to defaults on corrupt JSON in localStorage', () => {
    storage.set('we-ai-providers', 'not-json{{{');
    const result = loadProviders();
    expect(result.map((p) => p.id)).toEqual(DEFAULT_PROVIDERS.map((p) => p.id));
  });
});

// ---------------------------------------------------------------------------
// saveProviders
// ---------------------------------------------------------------------------

describe('saveProviders', () => {
  it('writes JSON to localStorage', () => {
    const list = [provider({ id: 'a' }), provider({ id: 'b' })];
    saveProviders(list);
    const stored = JSON.parse(storage.get('we-ai-providers')!);
    expect(stored).toHaveLength(2);
    expect(stored[0].id).toBe('a');
    expect(stored[1].id).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// getActiveProviderId / setActiveProviderId
// ---------------------------------------------------------------------------

describe('active provider ID', () => {
  it('defaults to anthropic when nothing stored', () => {
    expect(getActiveProviderId()).toBe('anthropic');
  });

  it('reads what was written', () => {
    setActiveProviderId('ollama');
    expect(getActiveProviderId()).toBe('ollama');
  });
});

// ---------------------------------------------------------------------------
// isProviderReady
// ---------------------------------------------------------------------------

describe('isProviderReady', () => {
  it('returns false for undefined', () => {
    expect(isProviderReady(undefined)).toBe(false);
  });

  it('returns false when baseUrl missing', () => {
    expect(isProviderReady(provider({ baseUrl: '' }))).toBe(false);
  });

  it('returns false when model missing', () => {
    expect(isProviderReady(provider({ model: '' }))).toBe(false);
  });

  it('returns true for local providers without apiKey', () => {
    expect(isProviderReady(provider({ id: 'ollama', apiKey: '' }))).toBe(true);
    expect(isProviderReady(provider({ id: 'ad4m', apiKey: '' }))).toBe(true);
  });

  it('returns false for cloud providers without apiKey', () => {
    expect(isProviderReady(provider({ id: 'anthropic', apiKey: '' }))).toBe(false);
    expect(isProviderReady(provider({ id: 'openai', apiKey: '' }))).toBe(false);
  });

  it('returns true for cloud providers with apiKey', () => {
    expect(isProviderReady(provider({ id: 'anthropic', apiKey: 'sk-abc' }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// migrateFromClaudeApiKey
// ---------------------------------------------------------------------------

describe('migrateFromClaudeApiKey', () => {
  it('returns loadProviders() when called with empty key', () => {
    const result = migrateFromClaudeApiKey('');
    expect(result.map((p) => p.id)).toEqual(DEFAULT_PROVIDERS.map((p) => p.id));
  });

  it('sets Anthropic apiKey and saves when no providers saved', () => {
    const result = migrateFromClaudeApiKey('sk-legacy-key');
    const anthropic = result.find((p) => p.id === 'anthropic')!;
    expect(anthropic.apiKey).toBe('sk-legacy-key');
    // Verify it persisted
    const stored = JSON.parse(storage.get('we-ai-providers')!);
    expect(stored.find((p: AiProvider) => p.id === 'anthropic').apiKey).toBe('sk-legacy-key');
  });

  it('skips migration when providers already saved', () => {
    savedProviders(DEFAULT_PROVIDERS.map((p) => ({ ...p })));
    const result = migrateFromClaudeApiKey('sk-legacy-key');
    const anthropic = result.find((p) => p.id === 'anthropic')!;
    // Should NOT have the legacy key — loadProviders returns the existing empty key
    expect(anthropic.apiKey).toBe('');
  });
});

// ---------------------------------------------------------------------------
// checkProviderHealth
// ---------------------------------------------------------------------------

describe('checkProviderHealth', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: { ok: boolean; status: number; body?: unknown; text?: string }) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.body),
      text: () => Promise.resolve(response.text ?? ''),
    });
  }

  // --- Anthropic protocol ---

  it('Anthropic: returns ok on 200', async () => {
    mockFetch({ ok: true, status: 200, body: {} });
    const result = await checkProviderHealth(provider({ protocol: 'anthropic' }));
    expect(result.status).toBe('ok');
    expect(result.models).toEqual(['test-model']);
  });

  it('Anthropic: returns error on 401 (invalid key)', async () => {
    mockFetch({ ok: false, status: 401 });
    const result = await checkProviderHealth(provider({ protocol: 'anthropic' }));
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/Invalid API key/);
  });

  it('Anthropic: returns error on 404 (model not found)', async () => {
    mockFetch({ ok: false, status: 404 });
    const result = await checkProviderHealth(provider({ protocol: 'anthropic' }));
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/not found/);
  });

  // --- OpenAI-compatible protocol ---

  it('OpenAI: returns ok with model list', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: { data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] },
    });
    const result = await checkProviderHealth(provider({ protocol: 'openai' }));
    expect(result.status).toBe('ok');
    expect(result.models).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  it('OpenAI: returns ok even when configured model not in list', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: { data: [{ id: 'model-a' }, { id: 'model-b' }] },
    });
    const result = await checkProviderHealth(provider({ protocol: 'openai', model: 'model-c' }));
    // Should still return ok — the endpoint responded, models populate the dropdown
    expect(result.status).toBe('ok');
    expect(result.models).toEqual(['model-a', 'model-b']);
  });

  it('OpenAI: returns error on 401', async () => {
    mockFetch({ ok: false, status: 401 });
    const result = await checkProviderHealth(provider({ protocol: 'openai' }));
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/Invalid API key/);
  });

  it('OpenAI: handles empty model list gracefully', async () => {
    mockFetch({ ok: true, status: 200, body: { data: [] } });
    const result = await checkProviderHealth(provider({ protocol: 'openai' }));
    expect(result.status).toBe('ok');
    expect(result.models).toEqual([]);
  });

  it('OpenAI: handles non-array response gracefully', async () => {
    mockFetch({ ok: true, status: 200, body: { unexpected: true } });
    const result = await checkProviderHealth(provider({ protocol: 'openai' }));
    expect(result.status).toBe('ok');
    expect(result.models).toEqual([]);
  });

  // --- Shared behaviour ---

  it('reports network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await checkProviderHealth(provider());
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/Failed to fetch/);
  });

  it('reports timeout', async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );
    const result = await checkProviderHealth(provider(), 50);
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/Timed out/);
  });

  it('OpenAI: builds correct models URL from baseUrl ending in /v1', async () => {
    mockFetch({ ok: true, status: 200, body: { data: [] } });
    await checkProviderHealth(provider({ protocol: 'openai', baseUrl: 'http://localhost:11434/v1' }));
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('http://localhost:11434/v1/models');
  });

  it('OpenAI: builds correct models URL from baseUrl not ending in /v1', async () => {
    mockFetch({ ok: true, status: 200, body: { data: [] } });
    await checkProviderHealth(provider({ protocol: 'openai', baseUrl: 'http://localhost:11434' }));
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('http://localhost:11434/models');
  });

  it('OpenAI: sends Bearer token when apiKey present', async () => {
    mockFetch({ ok: true, status: 200, body: { data: [] } });
    await checkProviderHealth(provider({ protocol: 'openai', apiKey: 'sk-test' }));
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers.Authorization).toBe('Bearer sk-test');
  });

  it('OpenAI: omits Authorization header when no apiKey', async () => {
    mockFetch({ ok: true, status: 200, body: { data: [] } });
    await checkProviderHealth(provider({ protocol: 'openai', apiKey: '' }));
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers.Authorization).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_PROVIDERS catalogue shape
// ---------------------------------------------------------------------------

describe('DEFAULT_PROVIDERS', () => {
  it('includes all expected built-in IDs', () => {
    const ids = DEFAULT_PROVIDERS.map((p) => p.id);
    expect(ids).toContain('anthropic');
    expect(ids).toContain('openai');
    expect(ids).toContain('ollama');
    expect(ids).toContain('ad4m');
  });

  it('every entry has isBuiltIn true', () => {
    for (const p of DEFAULT_PROVIDERS) {
      expect(p.isBuiltIn, `${p.id} should have isBuiltIn: true`).toBe(true);
    }
  });

  it('Ollama defaults to localhost:11434/v1', () => {
    const ollama = DEFAULT_PROVIDERS.find((p) => p.id === 'ollama')!;
    expect(ollama.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('local providers have empty apiKey', () => {
    for (const id of ['ollama', 'ad4m']) {
      const p = DEFAULT_PROVIDERS.find((d) => d.id === id)!;
      expect(p.apiKey, `${id} should have empty apiKey`).toBe('');
    }
  });
});
