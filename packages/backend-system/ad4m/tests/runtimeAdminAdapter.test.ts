/**
 * What the runtime port offers, and to whom.
 *
 * The shell feature-detects every section of the settings page against the members of this port, so
 * which members exist *is* the UI. Two properties are worth pinning: a guest on somebody else's
 * node is offered nothing that administers that node, and the guard on system languages lives here
 * rather than only in the template that hides the button.
 */
import { ExceptionType } from '@coasys/ad4m';
import { describe, expect, it, vi } from 'vitest';

import { createAd4mModelAdmin } from '../src/modelAdminAdapter';
import { createAd4mRuntimeAdmin } from '../src/runtimeAdminAdapter';

/** Just enough of an Ad4mClient for the members under test. */
function stubClient(overrides: Record<string, unknown> = {}) {
  return {
    languages: {
      all: vi.fn(async () => [
        { address: 'Qm-sys', name: 'languages' },
        { address: 'Qm-mine', name: 'note-language' },
      ]),
      remove: vi.fn(async () => true),
      byAddress: vi.fn(async () => ({})),
    },
    on: vi.fn(() => () => {}),
    agent: { getApps: vi.fn(async () => []) },
    ...overrides,
  };
}

describe('what a connection is allowed to administer', () => {
  it('offers the whole port to a connection that operates the node', () => {
    const port = createAd4mRuntimeAdmin(stubClient());

    expect(port.trustedAgents).toBeDefined();
    expect(port.networkMetrics).toBeDefined();
    expect(port.languages).toBeDefined();
    expect(port.authorizedApps).toBeDefined();
    expect(port.onConsentRequest).toBeDefined();
    expect(port.approve).toBeDefined();
  });

  it('does not offer a network restart the executor does not perform', () => {
    // `runtime.restartHolochain` is a no-op on the executor this package pins. Offering it put a
    // button in settings that reported success and restarted nothing.
    expect(createAd4mRuntimeAdmin(stubClient()).restartNetwork).toBeUndefined();
  });

  it('withholds node-wide changes from a guest', () => {
    // A hosted or multi-user node: trust, peer networking and languages change something every user
    // of that node shares, and "restart networking" on a shared machine is a control that should not
    // exist rather than one that returns a capability error.
    //
    // Note AD4M would *permit* several of these — its default guest grant includes LANGUAGE DELETE.
    // That is why `administersNode` is not redundant with the capability check: permitted is not the
    // same as appropriate.
    const port = createAd4mRuntimeAdmin(stubClient(), { administersNode: false });

    expect(port.trustedAgents).toBeUndefined();
    expect(port.networkMetrics).toBeUndefined();
    expect(port.restartNetwork).toBeUndefined();
    expect(port.languages).toBeUndefined();

    // Answering consent changes the node: granting an app needs AGENT PERMIT, and the trusted-agent
    // list is the node's. The executor refuses both to a user session, so a prompt here would offer
    // a guest buttons that cannot work.
    expect(port.onConsentRequest).toBeUndefined();
    expect(port.approve).toBeUndefined();
    expect(port.deny).toBeUndefined();
  });

  it('withholds the app list from a guest, because it is not theirs to see', () => {
    // This used to be offered to guests on the reasoning that `agent.getApps()` answers for whoever
    // is authenticated. It does not: the executor keeps apps in one process-global map behind a
    // single `apps_data.json`, so on a multi-user node the list is either empty or somebody else's.
    const port = createAd4mRuntimeAdmin(stubClient(), { administersNode: false });

    expect(port.authorizedApps).toBeUndefined();
    expect(port.revokeApp).toBeUndefined();
    expect(port.removeApp).toBeUndefined();
  });

  it('lets a guest read the AI models they are granted, without offering to change them', () => {
    // The case that proved a single boolean too coarse. AD4M grants a hosted user AI READ and
    // refuses UPDATE/DELETE; WE hid the whole section, so a transcription model the node was happily
    // running looked to the user like no model at all.
    const port = createAd4mModelAdmin(stubClient(), {
      administersNode: false,
      capabilities: [{ with: { domain: 'artificial intelligence', pointers: ['*'] }, can: ['READ'] }],
    });

    expect(port.list).toBeDefined();
    expect(port.status).toBeDefined();

    expect(port.add).toBeUndefined();
    expect(port.update).toBeUndefined();
    expect(port.remove).toBeUndefined();
    expect(port.setDefault).toBeUndefined();
  });

  it('hides AI entirely when the grant does not include it', () => {
    const port = createAd4mModelAdmin(stubClient(), {
      administersNode: false,
      capabilities: [{ with: { domain: 'perspective', pointers: ['*'] }, can: ['READ'] }],
    });

    expect(port.list).toBeUndefined();
  });

  it('treats an unreadable grant as permitted, so a local host keeps its settings page', () => {
    // A desktop host authenticating with an empty token against an executor with no admin credential
    // holds ALL_CAPABILITY. Reading "no capabilities I can parse" as "no capabilities" would empty
    // the settings page on exactly the hosts that own the node.
    const port = createAd4mRuntimeAdmin(stubClient(), { capabilities: null });
    const models = createAd4mModelAdmin(stubClient(), { capabilities: null });

    expect(models.list).toBeDefined();
    expect(models.add).toBeDefined();
    expect(port.languages).toBeDefined();
  });

  it('honours a wildcard grant', () => {
    const port = createAd4mModelAdmin(stubClient(), {
      capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
    });

    expect(port.list).toBeDefined();
    expect(port.add).toBeDefined();
  });
});

describe('system languages', () => {
  it('refuses to remove one, whatever the UI offered', async () => {
    const client = stubClient();
    const port = createAd4mRuntimeAdmin(client);

    await expect(port.removeLanguage?.('Qm-sys')).rejects.toThrow(/cannot be removed/);
    expect(client.languages.remove).not.toHaveBeenCalled();
  });

  it('removes one the user installed', async () => {
    const client = stubClient();
    const port = createAd4mRuntimeAdmin(client);

    await port.removeLanguage?.('Qm-mine');
    expect(client.languages.remove).toHaveBeenCalledWith('Qm-mine');
  });

  it('marks the node’s own languages as system, and nothing else', async () => {
    const port = createAd4mRuntimeAdmin(stubClient());

    expect(await port.languages?.()).toEqual([
      { address: 'Qm-sys', name: 'languages', system: true },
      { address: 'Qm-mine', name: 'note-language', system: false },
    ]);
  });
});

describe('remote models', () => {
  // A model is a row on an endpoint now: the endpoint owns the URL, the key, the protocol and the
  // context ceiling; the model names the endpoint and the id it serves under.
  function aiClient(models: unknown[] = [], endpoints: unknown[] = [], extra: Record<string, unknown> = {}) {
    const added: unknown[] = [];
    const endpointsAdded: unknown[] = [];
    const client = stubClient({
      ai: {
        getModels: vi.fn(async () => models),
        endpoints: vi.fn(async () => endpoints),
        getDefaultModel: vi.fn(async () => undefined),
        setDefaultModel: vi.fn(async () => true),
        addModel: vi.fn(async (input: unknown) => {
          added.push(input);
          return 'new-id';
        }),
        updateModel: vi.fn(async (_id: string, input: unknown) => {
          added.push(input);
          return true;
        }),
        addEndpoint: vi.fn(async (input: Record<string, unknown>) => {
          endpointsAdded.push(input);
          return { id: 'e-new', ...input };
        }),
        updateEndpoint: vi.fn(async (id: string, input: Record<string, unknown>) => {
          endpointsAdded.push({ id, ...input });
          return { id, ...input };
        }),
        ...extra,
      },
    });
    return { client, added, endpointsAdded };
  }

  it('reads an Anthropic model back as Anthropic, and writes it back the same way', async () => {
    // The protocol lives on the endpoint: an edit must keep the model on its ANTHROPIC endpoint,
    // not register it onto an OpenAI one pointed at the same URL.
    const { client, added, endpointsAdded } = aiClient(
      [{ id: 'm1', name: 'Claude', modelType: 'LLM', endpointId: 'e1', remoteModel: 'claude-sonnet-5' }],
      [
        {
          id: 'e1',
          name: 'Anthropic',
          kind: 'ANTHROPIC',
          baseUrl: 'https://api.anthropic.com',
          hasApiKey: true,
          managed: false,
        },
      ],
    );
    const port = createAd4mModelAdmin(client, { capabilities: null });

    const [model] = await port.list!();
    expect(model.source).toMatchObject({ kind: 'api', protocol: 'anthropic' });

    await port.update!('m1', { name: 'Claude, renamed', kind: 'llm', source: model.source });
    expect(added[0]).toMatchObject({ endpointId: 'e1', remoteModel: 'claude-sonnet-5' });
    expect(endpointsAdded).toEqual([]);
  });

  it('reads whether a key is set, and an edit that does not touch it sends none', async () => {
    // The executor answers `hasApiKey` and never the key. An update without `apiKey` keeps the
    // stored one — the endpoint is reused untouched — while a key handed in, even an empty one
    // (which removes it), is a key change on that endpoint.
    const { client, endpointsAdded } = aiClient(
      [{ id: 'm1', name: 'Claude', modelType: 'LLM', endpointId: 'e1', remoteModel: 'claude-sonnet-5' }],
      [
        {
          id: 'e1',
          name: 'Anthropic',
          kind: 'ANTHROPIC',
          baseUrl: 'https://api.anthropic.com',
          hasApiKey: true,
          managed: false,
        },
      ],
    );
    const port = createAd4mModelAdmin(client, { capabilities: null });

    const [model] = await port.list!();
    expect(model.source).toEqual({
      kind: 'api',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      hasApiKey: true,
      model: 'claude-sonnet-5',
    });

    const api = {
      kind: 'api',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-5',
    } as const;
    await port.update!('m1', { name: 'Claude', kind: 'llm', source: api });
    await port.update!('m1', { name: 'Claude', kind: 'llm', source: { ...api, apiKey: 'sk-new' } });
    await port.update!('m1', { name: 'Claude', kind: 'llm', source: { ...api, apiKey: '' } });

    // The first edit never touched the endpoint; the other two sent their key changes to it.
    expect(endpointsAdded).toHaveLength(2);
    expect(endpointsAdded[0]).toMatchObject({ id: 'e1', apiKey: 'sk-new' });
    expect(endpointsAdded[1]).toMatchObject({ id: 'e1', apiKey: '' });
  });

  it('keeps an endpoint’s timeout and concurrency through a key change — the update is whole', async () => {
    // `updateEndpoint` clears every field left out, so a key change that sends only the key used to
    // silently reset the endpoint's timeout and concurrency to the executor's defaults.
    const { client, endpointsAdded } = aiClient(
      [{ id: 'm1', name: 'Claude', modelType: 'LLM', endpointId: 'e1', remoteModel: 'claude-sonnet-5' }],
      [
        {
          id: 'e1',
          name: 'Anthropic',
          kind: 'ANTHROPIC',
          baseUrl: 'https://api.anthropic.com',
          hasApiKey: true,
          managed: false,
          maxNumCtx: 32768,
          requestTimeoutSecs: 120,
          maxConcurrent: 4,
        },
      ],
    );
    const port = createAd4mModelAdmin(client, { capabilities: null });

    await port.update!('m1', {
      name: 'Claude',
      kind: 'llm',
      source: {
        kind: 'api',
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-new',
        model: 'claude-sonnet-5',
      },
    });

    expect(endpointsAdded).toHaveLength(1);
    expect(endpointsAdded[0]).toMatchObject({
      id: 'e1',
      apiKey: 'sk-new',
      maxNumCtx: 32768,
      requestTimeoutSecs: 120,
      maxConcurrent: 4,
    });
  });

  it('saves a changed context ceiling onto the endpoint the model already has', async () => {
    // A limit typed over an existing endpoint is an endpoint change like a key is: it used to go
    // nowhere at all, so the ceiling a user set was never stored.
    const { client, endpointsAdded } = aiClient(
      [{ id: 'm1', name: 'Qwen', modelType: 'LLM', endpointId: 'e1', remoteModel: 'qwen3:4b' }],
      [
        {
          id: 'e1',
          name: 'Ollama',
          kind: 'OLLAMA',
          baseUrl: 'http://localhost:11434',
          hasApiKey: false,
          managed: false,
          maxNumCtx: 40960,
          requestTimeoutSecs: 60,
        },
      ],
    );
    const port = createAd4mModelAdmin(client, { capabilities: null });

    await port.update!('m1', {
      name: 'Qwen',
      kind: 'llm',
      source: {
        kind: 'api',
        protocol: 'ollama',
        baseUrl: 'http://localhost:11434',
        model: 'qwen3:4b',
        maxContext: 8192,
      },
    });

    expect(endpointsAdded).toHaveLength(1);
    expect(endpointsAdded[0]).toMatchObject({ id: 'e1', maxNumCtx: 8192, requestTimeoutSecs: 60 });
  });

  it('renames a managed model in place — it keeps the endpoint it was given', async () => {
    // An executor-managed model cannot name an endpoint to repoint at; a rename keeps the one it
    // already has instead of failing the save outright.
    const { client, added, endpointsAdded } = aiClient(
      [
        {
          id: 'm1',
          name: 'Whisper small',
          modelType: 'TRANSCRIPTION',
          endpointId: 'e-local',
          remoteModel: 'whisper_small',
        },
      ],
      [{ id: 'e-local', name: 'Local AI', kind: 'CUSTOM', baseUrl: 'local://', hasApiKey: false, managed: true }],
    );
    const port = createAd4mModelAdmin(client, { capabilities: null });

    const [model] = await port.list!();
    expect(model.source).toEqual({ kind: 'preset', name: 'whisper_small' });

    await port.update!('m1', { name: 'Whisper, renamed', kind: 'transcription', source: model.source });

    expect(endpointsAdded).toEqual([]);
    expect(added[0]).toMatchObject({
      name: 'Whisper, renamed',
      modelType: 'TRANSCRIPTION',
      endpointId: 'e-local',
      remoteModel: 'whisper_small',
    });
  });

  it('keeps an Ollama model’s provider and context ceiling through an edit', async () => {
    // Both live on the endpoint now: a rename must reuse it, not rewrite it without its ceiling.
    const { client, added, endpointsAdded } = aiClient(
      [{ id: 'm1', name: 'Qwen', modelType: 'LLM', endpointId: 'e1', remoteModel: 'qwen3:4b' }],
      [
        {
          id: 'e1',
          name: 'Ollama',
          kind: 'OLLAMA',
          baseUrl: 'http://localhost:11434',
          hasApiKey: false,
          managed: false,
          maxNumCtx: 40960,
        },
      ],
    );
    const port = createAd4mModelAdmin(client, { capabilities: null });

    const [model] = await port.list!();
    expect(model.source).toMatchObject({ kind: 'api', protocol: 'ollama', maxContext: 40960 });

    await port.update!('m1', { name: 'Qwen, renamed', kind: 'llm', source: model.source });
    expect(added[0]).toMatchObject({ endpointId: 'e1' });
    expect(endpointsAdded).toEqual([]);
  });

  it('sends no ceiling for an endpoint that has none', async () => {
    const { client, added, endpointsAdded } = aiClient();
    const port = createAd4mModelAdmin(client, { capabilities: null });
    await port.add!({
      name: 'Qwen',
      kind: 'llm',
      source: { kind: 'api', protocol: 'ollama', baseUrl: 'http://localhost:11434', apiKey: '', model: 'qwen3:4b' },
    });
    // No endpoint matched, so one was registered — without a `maxNumCtx` the source never carried.
    expect(endpointsAdded[0]).toMatchObject({ kind: 'OLLAMA', baseUrl: 'http://localhost:11434' });
    expect(endpointsAdded[0]).not.toHaveProperty('maxNumCtx');
    expect(added[0]).toMatchObject({ endpointId: 'e-new', remoteModel: 'qwen3:4b' });
  });

  it('reads an endpoint kind it does not know as OpenAI', async () => {
    const { client } = aiClient(
      [{ id: 'm1', name: 'Old', modelType: 'LLM', endpointId: 'e1', remoteModel: 'x' }],
      [{ id: 'e1', name: 'vLLM', kind: 'VLLM', baseUrl: 'u', hasApiKey: false, managed: false }],
    );
    const [model] = await createAd4mModelAdmin(client, { capabilities: null }).list!();
    expect(model.source).toMatchObject({ protocol: 'openai' });
  });

  it('reads a model whose endpoint a guest cannot see as an unnamed remote', async () => {
    // The endpoint list is operator-only: the honest shape is the remote id and nothing more.
    const { client } = aiClient(
      [{ id: 'm1', name: 'Shared', modelType: 'LLM', endpointId: 'e1', remoteModel: 'claude-sonnet-5' }],
      [],
      { endpoints: vi.fn(async () => Promise.reject(new Error('RPC error 403'))) },
    );
    const [model] = await createAd4mModelAdmin(client, { capabilities: null }).list!();
    expect(model.source).toEqual({
      kind: 'api',
      protocol: 'openai',
      baseUrl: '',
      hasApiKey: false,
      model: 'claude-sonnet-5',
    });
  });

  it('marks a model on an executor that predates the endpoint API, so the blank URL is told apart', async () => {
    // `ai.endpoints` unknown → "executor too old", not "endpoint unseen": the flag is what lets a
    // settings row say so instead of showing an empty address.
    const { client } = aiClient(
      [{ id: 'm1', name: 'Old', modelType: 'LLM', endpointId: 'e1', remoteModel: 'claude-sonnet-5' }],
      [],
      { endpoints: vi.fn(async () => Promise.reject(new Error('Unknown type: ai.endpoints'))) },
    );
    const [model] = await createAd4mModelAdmin(client, { capabilities: null }).list!();
    expect(model.source).toMatchObject({ kind: 'api', baseUrl: '', endpointUnlisted: true });
  });

  it('lists an endpoint’s models where the client can ask, in the executor’s spelling', async () => {
    const discoverModels = vi.fn(async () => [{ id: 'claude-sonnet-5', capabilities: [] }]);
    const { client } = aiClient([], [], { discoverModels });
    const port = createAd4mModelAdmin(client, { capabilities: null });

    await expect(
      port.discover!({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '' }),
    ).resolves.toEqual(['claude-sonnet-5']);
    // An empty key is sent as none, which the executor reads as a keyless endpoint.
    expect(discoverModels).toHaveBeenCalledWith({ kind: 'ANTHROPIC', baseUrl: 'https://api.anthropic.com' });
  });

  it('offers no listing on a client that predates it', () => {
    const { client } = aiClient();
    expect(createAd4mModelAdmin(client, { capabilities: null }).discover).toBeUndefined();
  });
});

describe('consent requests', () => {
  /** A client whose `exception-occurred` events the test fires, and which counts live handlers. */
  function exceptionClient() {
    const handlers = new Set<(event: unknown) => void>();
    const on = vi.fn((type: string, handler: (event: unknown) => void) => {
      if (type === 'exception-occurred') handlers.add(handler);
      return () => handlers.delete(handler);
    });
    const emit = (exception: unknown) => {
      for (const h of handlers) h({ exception });
    };
    return { client: stubClient({ on }), emit, handlers };
  }

  it('hands on a trust request, and stops listening when the caller unsubscribes', () => {
    const { client, emit, handlers } = exceptionClient();
    const port = createAd4mRuntimeAdmin(client);
    const heard: unknown[] = [];

    const stop = port.onConsentRequest!((request) => heard.push(request));
    emit({ type: ExceptionType.AgentIsUntrusted, title: 'Untrusted', message: 'who?', addon: 'did:key:zPeer' });
    stop();
    emit({ type: ExceptionType.AgentIsUntrusted, title: 'Untrusted', message: 'again', addon: 'did:key:zPeer' });

    expect(heard).toEqual([
      { kind: 'trust', title: 'Untrusted', message: 'who?', peerId: 'did:key:zPeer', payload: 'did:key:zPeer' },
    ]);
    expect(handlers.size).toBe(0);
  });
});
