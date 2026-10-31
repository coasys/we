/**
 * RuntimeStore: capability degradation and the consent queue.
 *
 * The two properties worth pinning. **Degradation** — a backend supplying no runtime port must
 * leave every flag false rather than throwing, because that is precisely the in-memory backend's
 * situation and the settings template gates whole sections on those flags. **The consent queue** —
 * requests raised while the app runs must not be dropped, since a dropped one is indistinguishable
 * from the bug this store exists to fix: an embedded app waiting on a prompt nobody showed.
 *
 * SessionStore is faked rather than booted: RuntimeStore reads exactly one thing from it
 * (`backendPorts`), so driving that directly is both the smaller harness and the more direct test.
 */
import { render } from '@solidjs/testing-library';
import type { ExecutorHost, ExecutorSettings } from '@we/app-shell/shared';
import type {
  AiEndpoint,
  AiEndpointHealth,
  AiModel,
  AiModelStatusEvent,
  BackendPorts,
  ConsentRequest,
  ModelAdminPort,
  PeerRecords,
  RuntimeAdminPort,
} from '@we/backend-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let ports: Partial<BackendPorts> | null = null;

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({ backendPorts: () => ports }),
}));

// Never 'settings', so the on-demand load effect stays dormant and each test drives the store
// explicitly. The load-on-open behaviour is asserted separately below.
let activeShellView: string | null = null;
vi.mock('../src/frameworks/solid/stores/ShellStore', () => ({
  useShellStore: () => ({ activeShellView: () => activeShellView }),
}));

// Faked for the same reason as the stores above, and for one more: importing the real provider
// pulls the whole app-shell provider graph (down to the block editor) into a test about a settings
// page. Only `executor` is read here.
let executorHost: ExecutorHost | undefined;
vi.mock('../src/frameworks/solid/providers/PlatformProvider', () => ({
  usePlatform: () => ({ executor: executorHost }),
}));

import {
  parsePeerInfos,
  type RuntimeStore,
  RuntimeStoreProvider,
  useRuntimeStore,
} from '../src/frameworks/solid/stores/RuntimeStore';

function mount(): RuntimeStore {
  let store!: RuntimeStore;
  function Capture() {
    store = useRuntimeStore();
    return null;
  }
  render(() => (
    <RuntimeStoreProvider>
      <Capture />
    </RuntimeStoreProvider>
  ));
  return store;
}

/** A runtime port that records what it was asked to do. */
function stubRuntime(overrides: Partial<RuntimeAdminPort> = {}) {
  const calls: string[] = [];
  let emit: ((r: ConsentRequest) => void) | null = null;
  const port: RuntimeAdminPort = {
    async trustedAgents() {
      calls.push('trustedAgents');
      return ['did:peer:one'];
    },
    async trustAgent(id) {
      calls.push(`trust:${id}`);
    },
    async untrustAgent(id) {
      calls.push(`untrust:${id}`);
    },
    async authorizedApps() {
      calls.push('authorizedApps');
      return [];
    },
    async languages() {
      calls.push('languages');
      return [];
    },
    onConsentRequest(handler) {
      emit = handler;
      return () => {
        emit = null;
      };
    },
    async approve(request) {
      calls.push(`approve:${request.kind}`);
      return request.kind === 'capability' ? 'secret-code' : undefined;
    },
    async deny(request) {
      calls.push(`deny:${request.kind}`);
    },
    ...overrides,
  };
  return { port, calls, fire: (r: ConsentRequest) => emit?.(r) };
}

const capabilityRequest: ConsentRequest = {
  kind: 'capability',
  title: 'Flux wants access',
  message: 'Flux is requesting capabilities',
  app: { name: 'Flux', description: 'social', url: 'https://flux', capabilities: ['READ all AD4M data'] },
  payload: '{"auth":{}}',
};

const trustRequest: ConsentRequest = {
  kind: 'trust',
  title: 'Unknown peer',
  message: 'An unknown agent wants to be trusted',
  peerId: 'did:peer:stranger',
  payload: 'did:peer:stranger',
};

beforeEach(() => {
  ports = null;
  activeShellView = null;
  executorHost = undefined;
});

describe('how the backend is started', () => {
  /** An executor host that records what it was told, the way a real one persists it. */
  function stubExecutor(overrides: Partial<ExecutorHost> = {}) {
    let stored: ExecutorSettings = { mcpEnabled: false, mcpPort: 3001, logLevels: {} };
    const calls: string[] = [];
    const host: ExecutorHost = {
      async getSettings() {
        return stored;
      },
      async setSettings(update) {
        calls.push(`set:${JSON.stringify(update)}`);
        stored = { ...stored, ...update };
        return stored;
      },
      async restart() {
        calls.push('restart');
      },
      ...overrides,
    };
    return { host, calls };
  }

  it('reports the capability as absent on a host that does not start the backend', () => {
    ports = {};
    const store = mount();

    expect(store.canConfigureExecutor()).toBe(false);
  });

  it('asks for a restart once a setting is changed, and stops asking after one', async () => {
    const { host, calls } = stubExecutor();
    executorHost = host;
    ports = {};
    const store = mount();

    expect(store.executorRestartPending()).toBe(false);

    await store.setMcpEnabled(true);

    // The switch reflects the saved value immediately; the notice is what says it is not live yet.
    expect(store.mcpEnabled()).toBe(true);
    expect(store.executorRestartPending()).toBe(true);

    await store.restartExecutor();
    expect(calls).toEqual(['set:{"mcpEnabled":true}', 'restart']);
    expect(store.executorRestartPending()).toBe(false);
  });

  it('leaves the setting alone when the host refuses it', async () => {
    const { host } = stubExecutor({
      async setSettings() {
        throw new Error('Choose a port between 1024 and 65535');
      },
    });
    executorHost = host;
    ports = {};
    const store = mount();

    await store.setMcpPort(80);

    expect(store.mcpPort()).toBe(3001);
    expect(store.error()).toBe('Choose a port between 1024 and 65535');
    // Nothing was written, so nothing is waiting on a restart.
    expect(store.executorRestartPending()).toBe(false);
  });

  it('reads the current settings when the settings page opens', async () => {
    const { host } = stubExecutor({
      getSettings: async () => ({ mcpEnabled: true, mcpPort: 4321, logLevels: { holochain: 'debug' } }),
    });
    executorHost = host;
    activeShellView = 'settings';
    ports = {};
    const store = mount();

    await vi.waitFor(() => expect(store.mcpPort()).toBe(4321));
    expect(store.mcpEnabled()).toBe(true);
    expect(store.logLevels()).toEqual([{ crate: 'holochain', level: 'debug' }]);
  });

  it('adds and edits a log level through one action, and drops an override on removal', async () => {
    const { host } = stubExecutor();
    executorHost = host;
    ports = {};
    const store = mount();

    await store.setLogLevel('rust_executor', 'debug');
    await store.setLogLevel('holochain', 'trace');
    // Setting one that exists is an edit; there is no separate "add", because to the stored map
    // they are the same write.
    await store.setLogLevel('rust_executor', 'trace');

    expect(store.logLevels()).toEqual([
      { crate: 'holochain', level: 'trace' },
      { crate: 'rust_executor', level: 'trace' },
    ]);

    await store.removeLogLevel('holochain');
    // Removed, not set to a default: the backend applies its own to anything unnamed.
    expect(store.logLevels()).toEqual([{ crate: 'rust_executor', level: 'trace' }]);
  });

  it('offers a backup only when both halves are there', () => {
    const { host } = stubExecutor();

    // The host can name a file, but the backend cannot write one.
    executorHost = { ...host, chooseFile: async () => '/tmp/x.json' };
    ports = { runtime: {} };
    expect(mount().canBackUp()).toBe(false);

    // ...and the reverse: a backend that exports, on a host with no way to name a file. Which is
    // web — where the path would be on somebody else's filesystem anyway.
    executorHost = host;
    ports = { runtime: { exportDatabase: async () => {} } };
    expect(mount().canBackUp()).toBe(false);

    executorHost = { ...host, chooseFile: async () => '/tmp/x.json' };
    ports = { runtime: { exportDatabase: async () => {} } };
    expect(mount().canBackUp()).toBe(true);
  });

  it('does nothing when the file dialog is cancelled', async () => {
    const { host } = stubExecutor({ chooseFile: async () => null });
    executorHost = host;
    let exports = 0;
    ports = {
      runtime: {
        exportDatabase: async () => {
          exports += 1;
        },
      },
    };
    const store = mount();

    await store.exportDatabase();

    expect(exports).toBe(0);
    expect(store.backupStatus()).toBe('');
  });
});

describe('degrading when the backend administers nothing', () => {
  it('reports every capability false rather than throwing', () => {
    ports = {}; // a port bundle with no `runtime` — what the in-memory backend supplies
    const store = mount();

    expect(store.canAdminister()).toBe(false);
    expect(store.canManageTrust()).toBe(false);
    expect(store.canManageNetwork()).toBe(false);
    expect(store.canManageApps()).toBe(false);
    expect(store.canManageLanguages()).toBe(false);
  });

  it('actions no-op instead of throwing, so a mis-gated template cannot crash the page', async () => {
    ports = {};
    const store = mount();

    await store.loadTrustedAgents();
    await store.trustAgent('did:peer:one');
    await store.loadAuthorizedApps();

    expect(store.trustedAgents()).toEqual([]);
    expect(store.error()).toBe('');
  });

  it('detects capabilities member by member, not all-or-nothing', () => {
    // Trust only: no network, no apps.
    ports = { runtime: { trustedAgents: async () => [] } };
    const store = mount();

    expect(store.canAdminister()).toBe(true);
    expect(store.canManageTrust()).toBe(true);
    expect(store.canManageNetwork()).toBe(false);
    expect(store.canManageApps()).toBe(false);
    expect(store.canManageLanguages()).toBe(false);
  });
});

describe('AI models and the servers they run on', () => {
  const ollama: AiEndpoint = {
    id: 'e1',
    name: 'Ollama 11434',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    hasApiKey: false,
    capabilities: ['chat', 'embeddings'],
    health: { state: 'reachable', detail: '', models: ['nomic-embed-text:latest'] },
  };
  const remote: AiEndpoint = {
    id: 'e2',
    name: 'Remote',
    kind: 'anthropic',
    baseUrl: 'https://api.example.test',
    hasApiKey: true,
    capabilities: ['chat'],
    health: { state: 'unauthorized', detail: '', models: [] },
  };
  const qwen: AiModel = {
    id: 'm1',
    name: 'Qwen',
    kind: 'llm',
    endpointId: 'e1',
    remoteModel: 'qwen3:8b',
    status: { state: 'pulling', progress: 30 },
    isDefault: true,
  };

  function aiPort(overrides: Partial<ModelAdminPort> = {}) {
    const calls: string[] = [];
    let emitStatus: ((event: AiModelStatusEvent) => void) | null = null;
    let emitHealth: ((endpointId: string, health: AiEndpointHealth) => void) | null = null;
    let listed = 0;
    const port: ModelAdminPort = {
      async list() {
        listed += 1;
        return [qwen];
      },
      async endpoints() {
        return [ollama, remote];
      },
      async detectEndpoints() {
        return [
          // Already added, under another spelling of the address — not offered again.
          { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434/', capabilities: ['chat'], models: [] },
          { kind: 'openai-audio', baseUrl: 'http://127.0.0.1:8000', capabilities: ['transcription'], models: ['w'] },
        ];
      },
      async discover(query) {
        calls.push(`discover:${'endpointId' in query ? query.endpointId : query.baseUrl}`);
        return [
          { id: 'nomic-embed-text:latest', capabilities: ['embeddings'] },
          { id: 'llama3.2:3b', capabilities: ['chat'] },
        ];
      },
      async add(draft) {
        calls.push(`add:${draft.name}:${draft.endpointId}:${draft.remoteModel}`);
      },
      async update(id, draft) {
        calls.push(`update:${id}:${draft.name}`);
      },
      async addEndpoint(draft) {
        calls.push(`addEndpoint:${draft.name}:${draft.kind}:${draft.baseUrl}:${draft.apiKey ?? '-'}`);
        return { ...ollama, ...draft, id: 'e9' };
      },
      async updateEndpoint(id, draft) {
        calls.push(`updateEndpoint:${id}:${draft.apiKey ?? 'kept'}`);
        return { ...remote, ...draft };
      },
      async pullModel(endpointId, model) {
        calls.push(`pull:${endpointId}:${model}`);
      },
      onModelStatus(listener) {
        emitStatus = listener;
        return () => (emitStatus = null);
      },
      onEndpointHealth(listener) {
        emitHealth = listener;
        return () => (emitHealth = null);
      },
      recommended: () => ({
        models: [{ kind: 'llm', endpointKind: 'ollama', model: 'qwen3:8b', description: '' }],
        installLinks: [{ label: 'Ollama', url: 'https://ollama.example.test' }],
      }),
      ...overrides,
    };
    return {
      port,
      calls,
      listed: () => listed,
      status: (event: AiModelStatusEvent) => emitStatus?.(event),
      health: (endpointId: string, health: AiEndpointHealth) => emitHealth?.(endpointId, health),
    };
  }

  it('describes each model by its server, and each server by its health', async () => {
    ports = { models: aiPort().port };
    const store = mount();
    await store.loadAiModels();

    expect(store.aiModels()[0]).toMatchObject({
      endpointName: 'Ollama 11434',
      kindLabel: 'Language model',
      statusText: 'Downloading 30%',
      ready: false,
    });
    expect(store.aiEndpoints().map((e) => [e.name, e.healthText, e.healthy, e.modelCount])).toEqual([
      ['Ollama 11434', 'Answering · 1 model', true, 1],
      ['Remote', 'The key was refused', false, 0],
    ]);
  });

  it('offers servers found on the node’s machine, but not one already added', async () => {
    const { port, calls } = aiPort();
    ports = { models: port };
    const store = mount();
    await store.loadAiModels();
    await store.detectAiEndpoints();

    expect(store.aiDetectedEndpoints().map((e) => e.label)).toEqual(['Speech server at localhost:8000']);

    await store.addDetectedEndpoint('http://127.0.0.1:8000');
    expect(calls).toContain('addEndpoint:Speech server 8000:openai-audio:http://127.0.0.1:8000:-');
  });

  it('says where to get a server', () => {
    ports = { models: aiPort().port };
    expect(mount().aiInstallLinks()).toEqual([{ label: 'Ollama', url: 'https://ollama.example.test' }]);
  });

  it('starts a new model on a server that fits, and fills in the recommended model', async () => {
    const { port, calls } = aiPort();
    ports = { models: port };
    const store = mount();
    await store.loadAiModels();

    store.newAiModel();
    expect(store.aiForm()?.endpointId).toBe('e1');
    await vi.waitFor(() => expect(store.aiForm()?.remoteModel).toBe('qwen3:8b'));
    expect(calls).toContain('discover:e1');

    // The server lists what it has, of the kind asked for; the recommended model is not among them,
    // so it is offered as a download onto the server.
    expect(store.aiDiscoveredModelOptions().map((o) => o.value)).toEqual(['llama3.2:3b']);
    expect(store.aiRecommendedModel()).toBe('qwen3:8b');
    expect(store.aiCanPull()).toBe(true);
  });

  it('moves the form to a server that can serve the kind chosen', async () => {
    ports = { models: aiPort().port };
    const store = mount();
    await store.loadAiModels();

    store.newAiModel();
    store.setAiFormField('endpointId', 'e2');
    expect(store.aiEndpointOptions().map((o) => o.value)).toEqual(['e1', 'e2']);

    store.setAiFormField('kind', 'embedding');
    expect(store.aiForm()?.endpointId).toBe('e1');
    expect(store.aiEndpointOptions().map((o) => o.value)).toEqual(['e1']);
  });

  it('lets go of a model of the wrong kind when the form changes what it is for', async () => {
    // The form opened on a language model and filled in the recommended one; switching it to
    // embeddings kept that, and saved an embedding model pointed at a chat model.
    ports = { models: aiPort().port };
    const store = mount();
    await store.loadAiModels();
    store.newAiModel();
    await vi.waitFor(() => expect(store.aiForm()?.remoteModel).toBe('qwen3:8b'));

    store.setAiFormField('kind', 'embedding');
    expect(store.aiForm()?.remoteModel).toBe('nomic-embed-text:latest');
  });

  it('pulls a model, showing the progress the backend reports', async () => {
    let finish!: () => void;
    const ai = aiPort({ pullModel: () => new Promise<void>((resolve) => (finish = resolve)) });
    ports = { models: ai.port };
    activeShellView = 'settings';
    const store = mount();
    await store.loadAiModels();
    store.newAiModel();
    await vi.waitFor(() => expect(store.aiForm()?.remoteModel).toBe('qwen3:8b'));

    const pulling = store.pullAiModel();
    expect(store.aiPullText()).toBe('Downloading qwen3:8b — 0%');
    expect(store.aiCanPull()).toBe(false);

    ai.status({ endpointId: 'e1', remoteModel: 'qwen3:8b', status: { state: 'pulling', progress: 45 } });
    expect(store.aiPullText()).toBe('Downloading qwen3:8b — 45%');
    // The model row on that server follows the same event.
    expect(store.aiModels()[0].statusText).toBe('Downloading 45%');

    finish();
    await pulling;
    expect(store.aiPullText()).toBe('');
  });

  it('re-reads the models when a server’s health changes', async () => {
    const ai = aiPort();
    ports = { models: ai.port };
    activeShellView = 'settings';
    const store = mount();
    await vi.waitFor(() => expect(store.aiEndpoints()).toHaveLength(2));
    const before = ai.listed();

    ai.health('e2', { state: 'reachable', detail: '', models: ['m'] });

    expect(store.aiEndpoints()[1].healthText).toBe('Answering · 1 model');
    await vi.waitFor(() => expect(ai.listed()).toBe(before + 1));
  });

  it('saves a new model as an add, named after its id when no name was typed, and an edit as an update', async () => {
    const { port, calls } = aiPort();
    ports = { models: port };
    const store = mount();
    await store.loadAiModels();

    store.newAiModel();
    await vi.waitFor(() => expect(store.aiForm()?.remoteModel).toBe('qwen3:8b'));
    store.setAiFormField('remoteModel', 'llama3.2:3b');
    await store.saveAiModel();

    store.editAiModel('m1');
    store.setAiFormField('name', 'Renamed');
    await store.saveAiModel();

    expect(calls.filter((c) => c.startsWith('add') || c.startsWith('update'))).toEqual([
      'add:llama3.2:3b:e1:llama3.2:3b',
      'update:m1:Renamed',
    ]);
  });

  it('refuses to save a model with no server to run on', async () => {
    const { port, calls } = aiPort({ endpoints: async () => [] });
    ports = { models: port };
    const store = mount();
    await store.loadAiModels();

    store.newAiModel();
    store.setAiFormField('remoteModel', 'qwen3:8b');
    expect(store.aiFormComplete()).toBe(false);
    await store.saveAiModel();
    expect(calls.filter((c) => c.startsWith('add'))).toEqual([]);
  });

  it('keeps the form open when the save fails, so the typing is not lost', async () => {
    const { port } = aiPort({
      async add() {
        throw new Error('the endpoint cannot serve that type');
      },
    });
    ports = { models: port };
    const store = mount();
    await store.loadAiModels();

    store.newAiModel();
    store.setAiFormField('name', 'Fresh');
    store.setAiFormField('remoteModel', 'llama3.2:3b');
    await store.saveAiModel();

    expect(store.aiForm()?.name).toBe('Fresh');
    expect(store.error()).toBe('the endpoint cannot serve that type');
  });

  it('sets kind and address from a named service, and saves a server under a name made from them', async () => {
    const { port, calls } = aiPort();
    ports = { models: port };
    const store = mount();
    await store.loadAiModels();

    store.newAiEndpoint();
    store.setAiService('llama-server');
    expect(store.aiEndpointForm()).toMatchObject({ kind: 'llama-server', baseUrl: 'http://127.0.0.1:9931' });
    store.setAiService('custom');
    expect(store.aiEndpointForm()).toMatchObject({ kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:9931' });
    expect(store.aiServiceOptions().at(-1)?.value).toBe('custom');

    await store.saveAiEndpoint();
    expect(calls).toContain('addEndpoint:OpenAI-compatible 9931:openai-compatible:http://127.0.0.1:9931:-');
    expect(store.aiEndpointForm()).toBeNull();
  });

  it('says why a context limit it cannot read holds Save', () => {
    ports = { models: aiPort().port };
    const store = mount();

    store.newAiEndpoint();
    store.setAiEndpointField('maxContext', '40k');
    expect(store.aiEndpointFormComplete()).toBe(false);
    expect(store.aiMaxContextError()).not.toBe('');
    store.setAiEndpointField('maxContext', '40960');
    expect(store.aiMaxContextError()).toBe('');
  });

  it('edits a keyed server without seeing its key, and asks for it again only where it must', async () => {
    const { port, calls } = aiPort();
    ports = { models: port };
    const store = mount();
    await store.loadAiModels();

    store.editAiEndpoint('e2');
    expect(store.aiEndpointForm()).toMatchObject({ apiKey: '', apiKeyStored: true, service: 'anthropic' });
    expect(store.aiEndpointFormDirty()).toBe(false);

    store.setAiEndpointField('baseUrl', 'https://other.example.test');
    expect(store.aiApiKeyError()).not.toBe('');
    expect(store.aiEndpointFormComplete()).toBe(false);
    store.setAiEndpointField('baseUrl', 'https://api.example.test');
    expect(store.aiApiKeyError()).toBe('');
    await store.saveAiEndpoint();

    store.editAiEndpoint('e2');
    store.setAiEndpointField('apiKeyRemoved', true);
    await store.saveAiEndpoint();

    expect(calls.filter((c) => c.startsWith('updateEndpoint'))).toEqual([
      'updateEndpoint:e2:kept',
      'updateEndpoint:e2:',
    ]);
  });

  it('hides the servers from a connection the backend does not show them to', () => {
    ports = { models: aiPort({ endpoints: undefined, detectEndpoints: undefined }).port };
    const store = mount();
    expect(store.canManageAiEndpoints()).toBe(false);
    expect(store.canManageAi()).toBe(true);
  });
});

describe('languages', () => {
  it('reloads the list after installing, so the new language appears without a manual refresh', async () => {
    let installed = false;
    const calls: string[] = [];
    ports = {
      runtime: {
        async languages() {
          calls.push('languages');
          return installed ? [{ address: 'Qm-new', name: 'note-language', system: false }] : [];
        },
        async installLanguage(address) {
          calls.push(`install:${address}`);
          installed = true;
        },
      },
    };
    const store = mount();

    await store.installLanguage('Qm-new');

    expect(calls).toEqual(['install:Qm-new', 'languages']);
    expect(store.languages()).toEqual([{ address: 'Qm-new', name: 'note-language', system: false }]);
  });

  it('trims the pasted address, and ignores a blank one rather than sending it', async () => {
    const calls: string[] = [];
    ports = {
      runtime: {
        async languages() {
          return [];
        },
        async installLanguage(address) {
          calls.push(`install:${address}`);
        },
      },
    };
    const store = mount();

    // Addresses get here by copy-paste, which routinely brings whitespace with it.
    await store.installLanguage('  Qm-padded  ');
    await store.installLanguage('   ');

    expect(calls).toEqual(['install:Qm-padded']);
  });

  it('surfaces a refused removal as text — the backend guards system languages, not the UI', async () => {
    ports = {
      runtime: {
        async languages() {
          return [{ address: 'Qm-sys', name: 'languages', system: true }];
        },
        async removeLanguage() {
          throw new Error('languages is part of the running node and cannot be removed');
        },
      },
    };
    const store = mount();
    await store.loadLanguages();

    await store.removeLanguage('Qm-sys');

    // The message survives: a failed mutation used to reload its list straight afterwards, and the
    // reload cleared the error slot before anything rendered it.
    expect(store.error()).toBe('languages is part of the running node and cannot be removed');
    expect(store.languages()).toEqual([{ address: 'Qm-sys', name: 'languages', system: true }]);
  });
});

describe('trust settings', () => {
  it('reloads the list after every mutation, so the UI cannot drift from the backend', async () => {
    const { port, calls } = stubRuntime();
    ports = { runtime: port };
    const store = mount();

    await store.trustAgent('did:peer:two');

    expect(calls).toEqual(['trust:did:peer:two', 'trustedAgents']);
    expect(store.trustedAgents()).toEqual(['did:peer:one']);
  });

  it('ignores a blank id rather than sending it', async () => {
    const { port, calls } = stubRuntime();
    ports = { runtime: port };
    const store = mount();

    await store.trustAgent('   ');
    expect(calls).toEqual([]);
  });

  it('keeps a failed mutation on screen instead of reloading over its own error', async () => {
    const { port, calls } = stubRuntime({
      trustAgent: async () => {
        throw new Error('not a valid DID');
      },
    });
    ports = { runtime: port };
    const store = mount();

    await store.trustAgent('nonsense');

    expect(store.error()).toBe('not a valid DID');
    // No reload after a failed mutation — the list cannot have changed, and the reload would clear
    // the error slot before the user saw it.
    expect(calls).toEqual([]);
  });

  it('surfaces a failure as text instead of an unhandled rejection', async () => {
    const { port } = stubRuntime({
      trustedAgents: async () => {
        throw new Error('executor unreachable');
      },
    });
    ports = { runtime: port };
    const store = mount();

    await store.loadTrustedAgents();

    expect(store.error()).toBe('executor unreachable');
    expect(store.loading()).toBe(false);
  });
});

describe('what is in flight', () => {
  /** A promise the test settles by hand, so a call can be held open mid-flight. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  it('names the action a call belongs to, so one control does not spin for another', async () => {
    // Fetching peer records put a spinner on "Restart networking" when both read one flag.
    const infos = deferred<PeerRecords>();
    const { port } = stubRuntime({ peerInfos: () => infos.promise, restartNetwork: async () => {} });
    ports = { runtime: port };
    const store = mount();

    const fetching = store.loadPeerInfos();
    expect(store.pending()).toEqual(['loadPeerInfos']);
    expect(store.pending()).not.toContain('restartNetwork');

    infos.resolve({ records: ['record'], readable: '["record"]' });
    await fetching;
    expect(store.pending()).toEqual([]);
    expect(store.peerInfos()).toEqual(['record']);
  });

  it('keeps an action in flight until its last overlapping call returns', async () => {
    // A double-clicked refresh: the single flag cleared when the first call returned, with the second
    // still running.
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    const pendingCalls = [first, second];
    const { port } = stubRuntime({ trustedAgents: () => pendingCalls.shift()!.promise });
    ports = { runtime: port };
    const store = mount();

    const a = store.loadTrustedAgents();
    const b = store.loadTrustedAgents();
    first.resolve([]);
    await a;
    expect(store.pending()).toEqual(['loadTrustedAgents']);
    expect(store.loading()).toBe(true);

    second.resolve([]);
    await b;
    expect(store.pending()).toEqual([]);
    expect(store.loading()).toBe(false);
  });
});

describe('exchanging peer records', () => {
  it('reports a failed add, so the paste box is not cleared on the attempt that failed', async () => {
    const { port } = stubRuntime({
      addPeerInfos: async () => {
        throw new Error('K2SpaceNotFound');
      },
      peerInfos: async () => ({ records: [], readable: '[]' }),
    });
    ports = { runtime: port };
    const store = mount();

    expect(await store.addPeerInfos('["a"]')).toBe(false);
    expect(store.error()).toBe('K2SpaceNotFound');
    expect(await store.addPeerInfos('   ')).toBe(false);
  });

  it('reports a successful add and reloads what the node now holds', async () => {
    const added: string[][] = [];
    const { port } = stubRuntime({
      addPeerInfos: async (infos) => {
        added.push(infos);
      },
      peerInfos: async () => ({ records: ['mine', 'theirs'], readable: '[\n  "mine",\n  "theirs"\n]' }),
    });
    ports = { runtime: port };
    const store = mount();

    expect(await store.addPeerInfos('theirs')).toBe(true);
    expect(added).toEqual([['theirs']]);
    // The raw records for copying, and the backend's own reading of them for display — kept apart,
    // since a record reformatted on its way to the clipboard no longer matches its signature.
    expect(store.peerInfos()).toEqual(['mine', 'theirs']);
    expect(store.peerInfosReadable()).toBe('[\n  "mine",\n  "theirs"\n]');
  });

  it('offers a restart only where the backend has one', () => {
    ports = { runtime: stubRuntime().port };
    expect(mount().canRestartNetwork()).toBe(false);

    ports = { runtime: stubRuntime({ restartNetwork: async () => {} }).port };
    expect(mount().canRestartNetwork()).toBe(true);
  });
});

describe('the consent queue', () => {
  it('surfaces a request raised while the app is running', () => {
    const { port, fire } = stubRuntime();
    ports = { runtime: port };
    const store = mount();

    fire(capabilityRequest);

    expect(store.pendingConsent()?.kind).toBe('capability');
    expect(store.pendingConsent()?.app?.name).toBe('Flux');
  });

  it('holds a second request instead of dropping it', async () => {
    const { port, fire } = stubRuntime();
    ports = { runtime: port };
    const store = mount();

    fire(capabilityRequest);
    fire(trustRequest);
    expect(store.pendingConsent()?.kind).toBe('capability');

    await store.approveConsent();

    // The second request is still there — dropping it would leave that asker hanging, which is
    // the exact failure this store exists to prevent.
    expect(store.pendingConsent()?.kind).toBe('trust');
  });

  it('keeps the secret a capability approval returns, and clears it on the next approval', async () => {
    const { port, fire } = stubRuntime();
    ports = { runtime: port };
    const store = mount();

    fire(capabilityRequest);
    await store.approveConsent();
    expect(store.consentSecret()).toBe('secret-code');

    // A trust approval returns nothing; a stale code from the previous approval must not linger.
    fire(trustRequest);
    await store.approveConsent();
    expect(store.consentSecret()).toBe('');
  });

  it('denying clears the prompt', async () => {
    const { port, calls, fire } = stubRuntime();
    ports = { runtime: port };
    const store = mount();

    fire(trustRequest);
    await store.denyConsent();

    expect(calls).toContain('deny:trust');
    expect(store.pendingConsent()).toBeNull();
  });

  it('denying clears the prompt even when the backend cannot say no', async () => {
    // No `deny` member — the user still declined, and must not be trapped on the modal.
    const { port, fire } = stubRuntime({ deny: undefined });
    ports = { runtime: port };
    const store = mount();

    fire(trustRequest);
    await store.denyConsent();

    expect(store.pendingConsent()).toBeNull();
  });

  it('stops delivering once the subscription is torn down', () => {
    const { port, fire } = stubRuntime();
    ports = { runtime: port };

    let store!: RuntimeStore;
    function Capture() {
      store = useRuntimeStore();
      return null;
    }
    const { unmount } = render(() => (
      <RuntimeStoreProvider>
        <Capture />
      </RuntimeStoreProvider>
    ));

    unmount();
    fire(capabilityRequest);

    // The adapter's unsubscribe is a flag flip rather than a real teardown (AD4M's exception
    // callback has no removal API), so this is the assertion that keeps that honest.
    expect(store.pendingConsent()).toBeNull();
  });
});

describe('loading on demand', () => {
  it('loads nothing while the settings overlay is closed', async () => {
    const { port, calls } = stubRuntime();
    ports = { runtime: port };

    const store = mount();
    await vi.waitFor(() => expect(store.canManageTrust()).toBe(true));

    expect(calls).toEqual([]);
  });

  it('loads trust and apps when the settings overlay is open', async () => {
    activeShellView = 'settings';
    const { port, calls } = stubRuntime();
    ports = { runtime: port };

    const store = mount();

    await vi.waitFor(() => expect(store.trustedAgents()).toEqual(['did:peer:one']));
    expect([...calls].sort()).toEqual(['authorizedApps', 'languages', 'trustedAgents']);
  });

  it('asks for nothing the backend cannot answer', async () => {
    activeShellView = 'settings';
    const calls: string[] = [];
    // Trust only — the apps load must not be attempted.
    ports = {
      runtime: {
        trustedAgents: async () => {
          calls.push('trustedAgents');
          return [];
        },
      },
    };

    mount();
    await vi.waitFor(() => expect(calls).toEqual(['trustedAgents']));
  });

  // Network metrics stay manual: a diagnostic blob nobody asked for is the same mistake as
  // loading everything at boot, one level down.
  it('never fetches network metrics on open', async () => {
    activeShellView = 'settings';
    const { port, calls } = stubRuntime({
      networkMetrics: async () => {
        calls.push('networkMetrics');
        return '{}';
      },
    });
    ports = { runtime: port };

    mount();
    await vi.waitFor(() => expect(calls).toContain('trustedAgents'));
    expect(calls).not.toContain('networkMetrics');
  });
});

describe('parsePeerInfos', () => {
  it('reads a JSON array', () => {
    expect(parsePeerInfos('["one","two"]')).toEqual(['one', 'two']);
  });

  it('reads one record per line', () => {
    expect(parsePeerInfos(' one \n\n two \n')).toEqual(['one', 'two']);
  });

  it('reads nothing from blank text', () => {
    expect(parsePeerInfos('   \n  ')).toEqual([]);
  });
});
