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

  it('keeps the executor’s reason why a model is not ready', async () => {
    const { client } = aiClient({
      getModels: vi.fn(async () => [{ ...qwen, status: { state: 'ENDPOINT_DOWN', detail: 'connection refused' } }]),
    });
    const [model] = await createAd4mModelAdmin(client, { capabilities: null }).list!();
    expect(model.status).toEqual({ state: 'endpoint-down', detail: 'connection refused' });
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
      managed: false,
    });
  });

  it('reads the executor’s own local server as managed', async () => {
    const { client } = aiClient({ endpoints: vi.fn(async () => [{ ...ollama, kind: 'LLAMA_SERVER', managed: true }]) });
    const [endpoint] = await createAd4mModelAdmin(client, { capabilities: null }).endpoints!();
    expect(endpoint.managed).toBe(true);
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

const hardware = {
  os: 'linux',
  arch: 'x64',
  cpu: { brand: 'Test CPU', physicalCores: 8, logicalCores: 16, features: ['avx2'] },
  ramBytes: 32e9,
  availableRamBytes: 20e9,
  gpus: [
    {
      vendor: 'amd',
      type: 'integrated',
      name: 'Test GPU',
      vramBytes: 4e9,
      sharedBytes: null,
      driver: null,
      cudaVersion: null,
      source: 'sysfs',
    },
  ],
  backends: ['cpu', 'vulkan'],
  gpuBudgetBytes: 20e9,
  memoryBudgetBytes: 19e9,
  diskFreeBytes: null,
  storageDir: '/data/local-ai',
  hardwareClass: 'linux-x64-igpu-amd',
  notes: [],
};

const plan = {
  hardwareClass: 'linux-x64-igpu-amd',
  runtimes: [
    {
      runtimeId: 'llama-server',
      provider: 'llama-server',
      version: 'b6000',
      build: 'linux-x64-vulkan',
      backend: 'vulkan',
      sizeBytes: 30e6,
      installed: false,
      services: ['llm', 'embeddings'],
    },
  ],
  models: [
    {
      service: 'stt',
      modelId: 'parakeet-tdt-0.6b-v3',
      provider: 'nemo-speech',
      sizeBytes: 480e6,
      memoryBytes: 600e6,
      license: 'CC-BY-4.0',
      installed: true,
      basis: 'default',
      fromClass: 'linux-x64-igpu-amd',
      evidence: [],
      metrics: {},
      serverFlags: [],
    },
  ],
  unavailable: [{ service: 'tts', reason: 'Nothing measured' }],
  downloadBytes: 30e6,
  totalBytes: 510e6,
  memoryBytes: 600e6,
  memoryBudgetBytes: 19e9,
  diskFreeBytes: 100e9,
  fits: true,
  reasons: [],
  recommendationsGeneratedAt: '2026-10-01',
  device: null,
};

const status = {
  installed: true,
  installing: false,
  storageDir: '/data/local-ai',
  autostart: true,
  runtimes: [
    {
      provider: 'llama-server',
      runtimeId: 'llama-server',
      version: 'b6000',
      build: 'linux-x64-vulkan',
      services: ['llm'],
      phase: 'running',
      port: 41234,
      pid: 99,
      restarts: 1,
      detail: null,
      endpointId: 'local-1',
      onGpu: true,
      gpuBytes: 3e9,
    },
  ],
  models: [{ service: 'llm', modelId: 'qwen3-4b', model: null }],
};

function localClient() {
  const local = {
    localHardware: vi.fn(async () => hardware),
    localPlan: vi.fn(async () => plan),
    localStatus: vi.fn(async () => status),
    localInstall: vi.fn(async (_params?: object) => status),
    localStart: vi.fn(async () => status),
    localStop: vi.fn(async () => ({ ...status, runtimes: [{ ...status.runtimes[0], phase: 'stopped' }] })),
    localRemove: vi.fn(async (_deleteFiles?: boolean) => true),
  };
  const { client, emit } = aiClient(local);
  return { client, emit, ai: local };
}

const AI = 'artificial intelligence';

describe('local AI', () => {
  it('reads the machine in the port’s words, an unread value as absent and without the storage path', async () => {
    const { client } = localClient();
    expect(await createAd4mModelAdmin(client, { capabilities: null }).local!.hardware!()).toEqual({
      os: 'linux',
      arch: 'x64',
      cpu: 'Test CPU',
      ramBytes: 32e9,
      gpus: [{ vendor: 'amd', type: 'integrated', name: 'Test GPU', vramBytes: 4e9 }],
      backends: ['cpu', 'vulkan'],
      memoryBudgetBytes: 19e9,
      hardwareClass: 'linux-x64-igpu-amd',
      notes: [],
    });
  });

  it('reads a plan with services as kinds of model', async () => {
    const { client } = localClient();
    const read = await createAd4mModelAdmin(client, { capabilities: null }).local!.plan!();
    expect(read.runtimes[0]).toMatchObject({ id: 'llama-server', kinds: ['llm', 'embedding'], installed: false });
    expect(read.models[0]).toEqual({
      kind: 'transcription',
      model: 'parakeet-tdt-0.6b-v3',
      sizeBytes: 480e6,
      memoryBytes: 600e6,
      license: 'CC-BY-4.0',
      installed: true,
      basis: 'default',
      fromClass: 'linux-x64-igpu-amd',
    });
    expect(read.unavailable).toEqual([{ kind: 'speech', reason: 'Nothing measured' }]);
    expect(read).toMatchObject({ downloadBytes: 30e6, fits: true, diskFreeBytes: 100e9 });
    // No device in the settings: the plan follows detection, and says nothing about one.
    expect(read).not.toHaveProperty('device');
  });

  it('reads the device the settings hold the plan to', async () => {
    const { client, ai } = localClient();
    ai.localPlan.mockResolvedValueOnce({ ...plan, device: 'cpu' } as never);
    const read = await createAd4mModelAdmin(client, { capabilities: null }).local!.plan!();
    expect(read.device).toBe('cpu');
  });

  it('reads the running state, with the managed server it registered as', async () => {
    const { client } = localClient();
    const read = await createAd4mModelAdmin(client, { capabilities: null }).local!.status!();
    expect(read.runtimes[0]).toEqual({
      id: 'llama-server',
      version: 'b6000',
      build: 'linux-x64-vulkan',
      kinds: ['llm'],
      phase: 'running',
      port: 41234,
      restarts: 1,
      detail: '',
      endpointId: 'local-1',
      onGpu: true,
      gpuBytes: 3e9,
    });
    expect(read.models).toEqual([{ kind: 'llm', model: 'qwen3-4b' }]);
  });

  it('installs some kinds by their services, or everything', async () => {
    const { client, ai } = localClient();
    const local = createAd4mModelAdmin(client, { capabilities: null }).local!;
    await local.install!({ kinds: ['llm', 'transcription'] });
    expect(ai.localInstall).toHaveBeenLastCalledWith({ services: ['llm', 'stt'] });
    await local.install!();
    expect(ai.localInstall).toHaveBeenLastCalledWith({});
  });

  it('starts, stops, and removes with or without the files', async () => {
    const { client, ai } = localClient();
    const local = createAd4mModelAdmin(client, { capabilities: null }).local!;
    expect((await local.stop!()).runtimes[0].phase).toBe('stopped');
    await local.start!();
    expect(ai.localStart).toHaveBeenCalled();
    await local.remove!(true);
    expect(ai.localRemove).toHaveBeenLastCalledWith(true);
  });

  it('hands on `ai-local-progress` events in the port’s words', () => {
    const { client, emit } = localClient();
    const heard: unknown[] = [];
    const stop = createAd4mModelAdmin(client, { capabilities: null }).local!.onProgress!((p) => heard.push(p));
    const event = { item: null, itemDoneBytes: 0, itemTotalBytes: 0, doneBytes: 5, totalBytes: 10, detail: null };
    emit('ai-local-progress', { ...event, phase: 'download' });
    emit('ai-local-progress', { ...event, phase: 'warming-up' });
    stop();
    emit('ai-local-progress', { ...event, phase: 'done' });
    expect(heard).toEqual([
      { ...event, phase: 'download', item: '', detail: '' },
      // A phase the executor adds later reads as a step before done, not as done or failed.
      { ...event, phase: 'register', item: '', detail: '' },
    ]);
  });

  it('is the operator’s: absent on a node that is not ours, read-only without the grant to change', () => {
    const { client } = localClient();
    expect(createAd4mModelAdmin(client, { capabilities: null, administersNode: false }).local).toBeUndefined();
    const readOnly = createAd4mModelAdmin(client, {
      capabilities: [{ with: { domain: AI, pointers: ['*'] }, can: ['READ'] }],
    }).local!;
    expect(readOnly.plan).toBeDefined();
    expect(readOnly.install).toBeUndefined();
    expect(readOnly.remove).toBeUndefined();
  });

  /*
    The executor guards install, start, stop and remove with the operator credential, which "a grant
    never is, whatever its capabilities". WE web connects with an app token holding `*`: offering
    the actions there gave buttons that always answered 403.
  */
  it('offers install, start, stop and remove to the operator only, never to a grant holding `*`', () => {
    const { client } = localClient();
    const everything = [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }];
    const grant = createAd4mModelAdmin(client, { capabilities: everything, operator: false }).local!;
    expect(grant.plan).toBeDefined();
    expect(grant.status).toBeDefined();
    expect(grant.install).toBeUndefined();
    expect(grant.start).toBeUndefined();
    expect(grant.stop).toBeUndefined();
    expect(grant.remove).toBeUndefined();
    // The executor sends `ai-local-progress` to operator sessions only: a grant would listen to nothing.
    expect(grant.onProgress).toBeUndefined();

    const operator = createAd4mModelAdmin(client, { capabilities: null, operator: true }).local!;
    expect(operator.install).toBeDefined();
    expect(operator.remove).toBeDefined();
    expect(operator.onProgress).toBeDefined();
  });
});
