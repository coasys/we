/**
 * The model and endpoint administration port, over a stand-in AI client.
 *
 * What is worth pinning is the translation: the executor's vocabulary into the port's and back, and
 * the two places where leaving something out of a write changes it — a key (absent keeps it, `''`
 * removes it) and a setting an update would otherwise drop.
 */
import { describe, expect, it, vi } from 'vitest';

import { createAd4mModelAdmin } from '../src/modelAdminAdapter';

const qwen = {
  id: 'm1',
  name: 'Qwen',
  modelType: 'LLM',
  endpointId: 'e1',
  remoteModel: 'qwen3:8b',
  nativeTools: false,
  status: { state: 'READY' },
};

const ollama = {
  id: 'e1',
  name: 'Ollama',
  kind: 'OLLAMA',
  baseUrl: 'http://127.0.0.1:11434',
  hasApiKey: false,
  capabilities: ['chat', 'embeddings'],
  maxNumCtx: 32768,
  requestTimeoutSecs: 600,
  health: { state: 'REACHABLE', servedModels: ['qwen3:8b'] },
};

function aiClient(extra: Record<string, unknown> = {}) {
  const handlers = new Map<string, (event: unknown) => void>();
  const ai = {
    getModels: vi.fn(async () => [qwen]),
    getDefaultModel: vi.fn(async (type: string) => (type === 'LLM' ? qwen : null)),
    setDefaultModel: vi.fn(async () => true),
    modelStatus: vi.fn(async () => ({ state: 'PULLING', progress: 41.6 })),
    addModel: vi.fn(async () => 'new-id'),
    updateModel: vi.fn(async () => true),
    endpoints: vi.fn(async () => [ollama]),
    addEndpoint: vi.fn(async (input: object) => ({ ...ollama, ...input, id: 'e2' })),
    updateEndpoint: vi.fn(async (_id: string, input: object) => ({ ...ollama, ...input })),
    detectEndpoints: vi.fn(async () => [
      { kind: 'OPEN_AI_AUDIO', baseUrl: 'http://127.0.0.1:8000', capabilities: ['transcription'], servedModels: ['w'] },
    ]),
    discoverModels: vi.fn(async () => [{ id: 'qwen3:8b', capabilities: ['chat'], contextLength: 40960 }]),
    pullModel: vi.fn(async () => true),
    ...extra,
  };
  const client = {
    ai,
    on: vi.fn((type: string, handler: (event: unknown) => void) => {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    }),
  };
  return { client, ai, emit: (type: string, event: unknown) => handlers.get(type)?.(event) };
}

describe('models', () => {
  it('reads a model as a reference to its endpoint, with its status and whether it is the default', async () => {
    const { client } = aiClient();
    const [model] = await createAd4mModelAdmin(client, { capabilities: null }).list!();
    expect(model).toEqual({
      id: 'm1',
      name: 'Qwen',
      kind: 'llm',
      endpointId: 'e1',
      remoteModel: 'qwen3:8b',
      nativeTools: false,
      status: { state: 'ready' },
      isDefault: true,
    });
  });

  it('reads a speech model as speech rather than as a language model', async () => {
    const { client } = aiClient({ getModels: vi.fn(async () => [{ ...qwen, modelType: 'SPEECH' }]) });
    const [model] = await createAd4mModelAdmin(client, { capabilities: null }).list!();
    expect(model.kind).toBe('speech');
  });

  it('writes `modelType`, and sends back a tool choice an edit did not show', async () => {
    const { client, ai } = aiClient();
    const port = createAd4mModelAdmin(client, { capabilities: null });
    const [model] = await port.list!();

    await port.update!('m1', { ...model, name: 'Qwen, renamed' });
    expect(ai.updateModel).toHaveBeenCalledWith('m1', {
      name: 'Qwen, renamed',
      modelType: 'LLM',
      endpointId: 'e1',
      remoteModel: 'qwen3:8b',
      nativeTools: false,
    });
  });

  it('makes a first model of its kind the default', async () => {
    const { client, ai } = aiClient();
    const port = createAd4mModelAdmin(client, { capabilities: null });
    await port.add!({ name: 'Embed', kind: 'embedding', endpointId: 'e1', remoteModel: 'nomic-embed-text' });
    expect(ai.addModel).toHaveBeenCalledWith({
      name: 'Embed',
      modelType: 'EMBEDDING',
      endpointId: 'e1',
      remoteModel: 'nomic-embed-text',
    });
    expect(ai.setDefaultModel).toHaveBeenCalledWith('EMBEDDING', 'new-id');
  });

  it('reads a pull’s progress from `ai.modelStatus`', async () => {
    const { client } = aiClient();
    await expect(createAd4mModelAdmin(client, { capabilities: null }).status!('m1')).resolves.toEqual({
      state: 'pulling',
      progress: 42,
    });
  });

  it('hands on `model-status` events in the port’s words', () => {
    const { client, emit } = aiClient();
    const heard: unknown[] = [];
    const stop = createAd4mModelAdmin(client, { capabilities: null }).onModelStatus!((event) => heard.push(event));
    emit('model-status', { endpointId: 'e1', remoteModel: 'qwen3:8b', status: { state: 'PULLING', progress: 10 } });
    stop();
    emit('model-status', { endpointId: 'e1', remoteModel: 'qwen3:8b', status: { state: 'READY' } });
    expect(heard).toEqual([{ endpointId: 'e1', remoteModel: 'qwen3:8b', status: { state: 'pulling', progress: 10 } }]);
  });
});

describe('endpoints', () => {
  it('reads an endpoint, its key as a flag and its health', async () => {
    const { client } = aiClient();
    const [endpoint] = await createAd4mModelAdmin(client, { capabilities: null }).endpoints!();
    expect(endpoint).toEqual({
      id: 'e1',
      name: 'Ollama',
      kind: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      hasApiKey: false,
      capabilities: ['chat', 'embeddings'],
      maxContext: 32768,
      requestTimeoutSecs: 600,
      health: { state: 'reachable', detail: '', models: ['qwen3:8b'] },
    });
  });

  it('sends no key for an edit that does not touch it, and `""` to remove one', async () => {
    const { client, ai } = aiClient();
    const port = createAd4mModelAdmin(client, { capabilities: null });
    const draft = { name: 'Remote', kind: 'anthropic', baseUrl: 'https://api.example.test' } as const;

    await port.updateEndpoint!('e1', draft);
    await port.updateEndpoint!('e1', { ...draft, apiKey: 'sk-test' });
    await port.updateEndpoint!('e1', { ...draft, apiKey: '' });

    const sent = ai.updateEndpoint.mock.calls.map(([, input]) => input as Record<string, unknown>);
    expect(sent[0]).toEqual({ name: 'Remote', kind: 'ANTHROPIC', baseUrl: 'https://api.example.test' });
    expect(sent[1]).toMatchObject({ apiKey: 'sk-test' });
    expect(sent[2]).toMatchObject({ apiKey: '' });
  });

  it('keeps the context ceiling and timeout through an edit, since an update replaces the settings', async () => {
    const { client, ai } = aiClient();
    const port = createAd4mModelAdmin(client, { capabilities: null });
    const [endpoint] = await port.endpoints!();

    await port.updateEndpoint!('e1', { ...endpoint, name: 'Ollama, renamed' });
    expect(ai.updateEndpoint).toHaveBeenCalledWith('e1', {
      name: 'Ollama, renamed',
      kind: 'OLLAMA',
      baseUrl: 'http://127.0.0.1:11434',
      maxNumCtx: 32768,
      requestTimeoutSecs: 600,
    });
  });

  it('detects servers on the node’s machine', async () => {
    const { client } = aiClient();
    await expect(createAd4mModelAdmin(client, { capabilities: null }).detectEndpoints!()).resolves.toEqual([
      { kind: 'openai-audio', baseUrl: 'http://127.0.0.1:8000', capabilities: ['transcription'], models: ['w'] },
    ]);
  });

  it('lists a saved endpoint’s models by its id, and an unsaved one by kind and address', async () => {
    const { client, ai } = aiClient();
    const port = createAd4mModelAdmin(client, { capabilities: null });

    await expect(port.discover!({ endpointId: 'e1' })).resolves.toEqual([{ id: 'qwen3:8b', capabilities: ['chat'] }]);
    await port.discover!({ kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', apiKey: '' });

    expect(ai.discoverModels.mock.calls).toEqual([
      [{ endpointId: 'e1' }],
      // An empty key is sent as none, which the executor reads as a keyless server.
      [{ kind: 'OPEN_AI_COMPATIBLE', baseUrl: 'http://127.0.0.1:8080/v1' }],
    ]);
  });

  it('pulls a model onto a server', async () => {
    const { client, ai } = aiClient();
    await createAd4mModelAdmin(client, { capabilities: null }).pullModel!('e1', 'qwen3:8b');
    expect(ai.pullModel).toHaveBeenCalledWith('e1', 'qwen3:8b');
  });

  it('recommends a model per kind, and where to get a server', () => {
    const { client } = aiClient();
    const { models, installLinks } = createAd4mModelAdmin(client, { capabilities: null }).recommended!();
    expect(models.map((m) => [m.kind, m.endpointKind])).toEqual([
      ['llm', 'ollama'],
      ['embedding', 'ollama'],
      ['transcription', 'openai-audio'],
    ]);
    expect(installLinks.map((link) => link.label)).toEqual(['Ollama', 'speaches']);
  });
});
