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
  AiCapability,
  AiEndpoint,
  AiEndpointHealth,
  AiModel,
  AiModelStatusEvent,
  BackendPorts,
  ConsentRequest,
  LocalAiHardware,
  LocalAiPlan,
  LocalAiPort,
  LocalAiProgress,
  LocalAiStatus,
  ModelAdminPort,
  PeerRecords,
  RuntimeAdminPort,
} from '@we/backend-shared';
import { createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let ports: Partial<BackendPorts> | null = null;

/** What the AI step reads of the session, and what it asks of it. */
const session = vi.hoisted(() => ({
  step: 'ready',
  held: 0,
  finished: 0,
  agent: 'did:test:new-account',
  url: 'https://node.test' as string | undefined,
}));

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({
    backendPorts: () => ports,
    signInStep: () => session.step,
    me: () => ({ id: session.agent }),
    serverUrl: () => session.url,
    holdForAiSetup: () => {
      session.held += 1;
    },
    finishSetup: () => {
      session.finished += 1;
    },
  }),
}));

// Never 'settings', so the on-demand load effect stays dormant and each test drives the store
// explicitly. The load-on-open behaviour is asserted separately below. A signal, so a test can close
// the page and see what stops listening.
const [activeShellView, setActiveShellView] = createSignal<string | null>(null);
vi.mock('../src/frameworks/solid/stores/ShellStore', () => ({
  useShellStore: () => ({ activeShellView }),
}));

// Faked for the same reason as the stores above, and for one more: importing the real provider
// pulls the whole app-shell provider graph (down to the block editor) into a test about a settings
// page. Only `executor` is read here.
let executorHost: ExecutorHost | undefined;
vi.mock('../src/frameworks/solid/providers/PlatformProvider', () => ({
  usePlatform: () => ({ executor: executorHost }),
}));

import {
  executorConfigRows,
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
  setActiveShellView(null);
  executorHost = undefined;
  session.step = 'ready';
  session.held = 0;
  session.finished = 0;
  session.agent = 'did:test:new-account';
  session.url = 'https://node.test';
  localStorage.clear();
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
    setActiveShellView('settings');
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

describe('a backend that keeps its own config file', () => {
  /** A runtime port over a config file, recording the calls; the host only restarts and names files. */
  function configBackend() {
    const calls: string[] = [];
    let values: Record<string, unknown> = { mcp_enabled: false, auto_permit_cap_requests: true };
    let restartPending = false;
    const runtime: NonNullable<BackendPorts['runtime']> = {
      async executorConfig() {
        return {
          file: '/data/executor-config.json',
          restartPending,
          entries: [
            { key: 'mcp_enabled', kind: 'boolean', value: values.mcp_enabled, writableFrom: 'anywhere', pinned: false },
            { key: 'mcp_port', kind: 'number', value: values.mcp_port, writableFrom: 'anywhere', pinned: false },
            { key: 'log_config', kind: 'object', value: values.log_config, writableFrom: 'anywhere', pinned: false },
            {
              key: 'auto_permit_cap_requests',
              kind: 'boolean',
              value: values.auto_permit_cap_requests,
              writableFrom: 'anywhere',
              pinned: false,
            },
            {
              key: 'hc_admin_port',
              kind: 'number',
              value: values.hc_admin_port,
              writableFrom: 'this-machine',
              pinned: false,
            },
            { key: 'port', kind: 'number', value: undefined, writableFrom: 'this-machine', pinned: true },
          ],
        };
      },
      async setExecutorConfig(set, unset = []) {
        calls.push(`set:${JSON.stringify(set)}:${unset.join(',')}`);
        if (set.mcp_port === 80)
          return { restartPending, refused: [{ key: 'mcp_port', reason: 'invalid', detail: 'below 1024' }] };
        values = { ...values, ...set };
        for (const key of unset) delete values[key];
        restartPending = true;
        return { restartPending, refused: [] };
      },
      async restartExecutor() {
        calls.push('runtime.restart');
      },
      async executorLogTail(lines) {
        calls.push(`tail:${lines}`);
        return ['first', 'second'];
      },
    };
    const host: ExecutorHost = {
      async restart() {
        calls.push('host.restart');
      },
    };
    return { runtime, host, calls };
  }

  it('writes MCP and log levels into the file, and restarts through the backend', async () => {
    const { runtime, host, calls } = configBackend();
    executorHost = host;
    ports = { runtime };
    const store = mount();

    await store.setMcpEnabled(true);
    await store.setLogLevel('holochain', 'warn');
    await store.removeLogLevel('holochain');

    expect(calls).toEqual([
      'set:{"mcp_enabled":true}:',
      'set:{"log_config":{"holochain":"warn"}}:',
      'set:{}:log_config',
    ]);
    expect(store.mcpEnabled()).toBe(true);
    expect(store.executorRestartPending()).toBe(true);
    expect(store.executorConfigFile()).toBe('/data/executor-config.json');

    await store.restartExecutor();
    // `runtime.restart`: the host starts the executor again with the same arguments.
    expect(calls.at(-1)).toBe('runtime.restart');
    expect(calls).not.toContain('host.restart');
  });

  // A refused restart leaves the settings not taken effect, so "Restart now" must not disappear.
  it('keeps the restart pending when the backend refuses to restart', async () => {
    const { runtime, host } = configBackend();
    runtime.restartExecutor = async () => {
      throw new Error('restart refused');
    };
    executorHost = host;
    ports = { runtime };
    const store = mount();

    await store.setMcpEnabled(true);
    expect(store.executorRestartPending()).toBe(true);

    await store.restartExecutor();
    expect(store.executorRestartPending()).toBe(true);
    expect(store.error()).toMatch(/restart refused/);
  });

  it('shows every key as a row, editable unless a flag of this start sets it', async () => {
    const { runtime, host } = configBackend();
    executorHost = host;
    setActiveShellView('settings');
    ports = { runtime };
    const store = mount();

    await vi.waitFor(() => expect(store.executorConfigRows()).toHaveLength(6));
    const row = (key: string) => store.executorConfigRows().find((r) => r.key === key);
    expect(row('auto_permit_cap_requests')).toMatchObject({ kind: 'boolean', choice: 'on', editable: true });
    expect(row('port')).toMatchObject({ kind: 'number', editable: false });
    expect(row('port')?.note).toBe('Set automatically');

    await store.setExecutorConfigValue('auto_permit_cap_requests', 'off');
    expect(row('auto_permit_cap_requests')).toMatchObject({ choice: 'off' });
    // A row no control is offered for is not written.
    await store.setExecutorConfigValue('port', 12345);
    expect(row('port')?.value).toBe('');
  });

  // `runtime.config` returns what the file holds, so a key the file leaves to its default has no
  // value to tell its type by: the type comes with the key.
  it('offers a key the file does not hold, and keeps its input once it is cleared', async () => {
    const { runtime, host, calls } = configBackend();
    executorHost = host;
    setActiveShellView('settings');
    ports = { runtime };
    const store = mount();

    await vi.waitFor(() => expect(store.executorConfigRows()).toHaveLength(6));
    const row = (key: string) => store.executorConfigRows().find((r) => r.key === key);
    expect(row('hc_admin_port')).toMatchObject({ kind: 'number', value: '', editable: true });

    await store.setExecutorConfigValue('hc_admin_port', '4000');
    expect(calls.at(-1)).toBe('set:{"hc_admin_port":4000}:');
    expect(row('hc_admin_port')).toMatchObject({ kind: 'number', value: '4000', editable: true });

    await store.setExecutorConfigValue('hc_admin_port', '');
    expect(calls.at(-1)).toBe('set:{}:hc_admin_port');
    expect(row('hc_admin_port')).toMatchObject({ kind: 'number', value: '', editable: true });
  });

  // The file holds no default, so a true/false key it leaves alone is neither on nor off.
  it('offers Default, On and Off for a true/false key, and Default unsets it', async () => {
    const { runtime, host, calls } = configBackend();
    executorHost = host;
    setActiveShellView('settings');
    ports = { runtime };
    const store = mount();

    await vi.waitFor(() => expect(store.executorConfigRows()).toHaveLength(6));
    const row = (key: string) => store.executorConfigRows().find((r) => r.key === key);
    expect(row('mcp_enabled')).toMatchObject({ kind: 'boolean', choice: 'off', editable: true });

    await store.setExecutorConfigValue('mcp_enabled', 'on');
    expect(calls.at(-1)).toBe('set:{"mcp_enabled":true}:');
    expect(row('mcp_enabled')).toMatchObject({ choice: 'on' });

    await store.setExecutorConfigValue('mcp_enabled', 'default');
    expect(calls.at(-1)).toBe('set:{}:mcp_enabled');
    expect(row('mcp_enabled')).toMatchObject({ choice: 'default' });
  });

  it('shows a null value as unset', () => {
    const rows = executorConfigRows({
      file: '/tmp/executor-config.json',
      restartPending: false,
      entries: [
        { key: 'mcp_port', kind: 'number', value: null, writableFrom: 'anywhere', pinned: false },
        { key: 'localhost', kind: 'boolean', value: null, writableFrom: 'this-machine', pinned: false },
      ],
    });
    expect(rows[0]).toMatchObject({ value: '' });
    expect(rows[1]).toMatchObject({ choice: 'default' });
  });

  it('says which key the backend refused, and why', async () => {
    const { runtime, host } = configBackend();
    executorHost = host;
    ports = { runtime };
    const store = mount();

    await store.setMcpPort(80);
    expect(store.error()).toBe('mcp_port: invalid (below 1024)');
  });

  it('reads the log tail', async () => {
    const { runtime, host, calls } = configBackend();
    executorHost = host;
    ports = { runtime };
    const store = mount();

    await store.loadExecutorLogTail();
    expect(store.executorLogTail()).toBe('first\nsecond');
    expect(calls).toContain('tail:200');
  });

  describe('on a server reached by its address', () => {
    /** The same file, on a server: its port says so, and it refuses what only its machine may do. */
    function serverBackend(restart: 'refused' | 'allowed' = 'refused') {
      const backend = configBackend();
      const runtime: NonNullable<BackendPorts['runtime']> = {
        ...backend.runtime,
        onThisMachine: false,
        async setExecutorConfig(set, unset = []) {
          const machineOnly = Object.keys(set).filter((key) => key === 'hc_admin_port');
          if (machineOnly.length)
            return { restartPending: false, refused: [{ key: 'hc_admin_port', reason: 'local-only' }] };
          return backend.runtime.setExecutorConfig!(set, unset);
        },
        async restartExecutor() {
          backend.calls.push('runtime.restart');
          if (restart === 'refused') throw new Error('RPC error 403: local-only');
        },
      };
      return { ...backend, runtime };
    }

    it('works against the server, with no host of its own', async () => {
      const { runtime, calls } = serverBackend();
      setActiveShellView('settings');
      ports = { runtime };
      const store = mount();

      expect(store.canConfigureExecutor()).toBe(true);
      expect(store.executorOnServer()).toBe(true);
      await vi.waitFor(() => expect(store.executorConfigRows()).toHaveLength(6));
      await store.setMcpEnabled(true);
      expect(calls).toContain('set:{"mcp_enabled":true}:');
      expect(store.mcpEnabled()).toBe(true);
      expect(store.executorRestartPending()).toBe(true);
      // No database moves: a path would name a file on the server, not here.
      expect(store.canBackUp()).toBe(false);
    });

    it('shows what only that computer may change, and does not offer it', async () => {
      const { runtime, calls } = serverBackend();
      setActiveShellView('settings');
      ports = { runtime };
      const store = mount();

      await vi.waitFor(() => expect(store.executorConfigRows()).toHaveLength(6));
      const row = (key: string) => store.executorConfigRows().find((r) => r.key === key);
      expect(row('hc_admin_port')).toMatchObject({ editable: false, note: 'Only on the host' });
      expect(row('mcp_port')).toMatchObject({ editable: true, note: '' });
      await store.setExecutorConfigValue('hc_admin_port', '4000');
      expect(calls.some((call) => call.includes('hc_admin_port'))).toBe(false);
    });

    it('hides Restart once the server refuses it as local-only, and never restarts this computer', async () => {
      const { runtime, host, calls } = serverBackend('refused');
      // Even with a host present: it starts this computer's executor, not the server's.
      executorHost = host;
      ports = { runtime };
      const store = mount();

      await store.setMcpEnabled(true);
      expect(store.canRestartExecutor()).toBe(true);
      await store.restartExecutor();
      expect(calls).toContain('runtime.restart');
      expect(calls).not.toContain('host.restart');
      expect(store.canRestartExecutor()).toBe(false);
      expect(store.error()).toMatch(/can't restart the host from here/);
      // The change is still waiting for the server's next start.
      expect(store.executorRestartPending()).toBe(true);
    });

    it('restarts the server when it allows it', async () => {
      const { runtime, calls } = serverBackend('allowed');
      ports = { runtime };
      const store = mount();

      await store.setMcpEnabled(true);
      await store.restartExecutor();
      expect(calls.at(-1)).toBe('runtime.restart');
      expect(store.executorRestartPending()).toBe(false);
      expect(store.canRestartExecutor()).toBe(true);
      expect(store.error()).toBe('');
    });

    it('offers no executor settings to an agent of the server', () => {
      // An agent's port has no config members: the adapter builds them for the operator only.
      ports = {
        runtime: {
          onThisMachine: false,
          async trustedAgents() {
            return [];
          },
        },
      };
      const store = mount();
      expect(store.canConfigureExecutor()).toBe(false);
      expect(store.canRestartExecutor()).toBe(false);
    });
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
    managed: false,
  };
  const remote: AiEndpoint = {
    id: 'e2',
    name: 'Remote',
    kind: 'anthropic',
    baseUrl: 'https://api.example.test',
    hasApiKey: true,
    capabilities: ['chat'],
    health: { state: 'unauthorized', detail: '', models: [] },
    managed: false,
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
    let emitHealth: ((endpointId: string, health: AiEndpointHealth, capabilities?: AiCapability[]) => void) | null =
      null;
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
      health: (endpointId: string, health: AiEndpointHealth, capabilities?: AiCapability[]) =>
        emitHealth?.(endpointId, health, capabilities),
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

  it('gives a server it found the models it serves for each role nothing fills yet', async () => {
    const { port, calls } = aiPort();
    ports = { models: port };
    const store = mount();
    await store.loadAiModels();
    await store.detectAiEndpoints();

    await store.addDetectedEndpoint('http://127.0.0.1:8000');
    // The node has a language model already (`qwen`), so only the embeddings role is filled.
    expect(calls).toContain('discover:e9');
    expect(calls.filter((c) => c.startsWith('add:'))).toEqual([
      'add:nomic-embed-text:latest:e9:nomic-embed-text:latest',
    ]);
  });

  it('says where to get a server', () => {
    ports = { models: aiPort().port };
    expect(mount().aiInstallLinks()).toEqual([{ label: 'Ollama', url: 'https://ollama.example.test' }]);
  });

  it('starts a new model on a server that fits, and fills in the recommended model', async () => {
    const { port, calls } = aiPort({ list: async () => [{ ...qwen, status: { state: 'missing' } }] });
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

  it('lets go of a model of the wrong kind before the server has said what it has', async () => {
    // With discovery still out, the language model stayed in an embedding form, and discovery
    // finishing kept it too, since the field was not empty.
    let answer!: (models: { id: string; capabilities: AiCapability[] }[]) => void;
    const ai = aiPort({ discover: () => new Promise((resolve) => (answer = resolve)) });
    ports = { models: ai.port };
    const store = mount();
    await store.loadAiModels();

    store.editAiModel('m1');
    store.setAiFormField('kind', 'embedding');
    expect(store.aiForm()?.remoteModel).toBe('');

    answer([
      { id: 'nomic-embed-text:latest', capabilities: ['embeddings'] },
      { id: 'llama3.2:3b', capabilities: ['chat'] },
    ]);
    await vi.waitFor(() => expect(store.aiForm()?.remoteModel).toBe('nomic-embed-text:latest'));
  });

  it('pulls a model, showing the progress the backend reports', async () => {
    let finish!: () => void;
    const ai = aiPort({ pullModel: () => new Promise<void>((resolve) => (finish = resolve)) });
    ports = { models: ai.port };
    setActiveShellView('settings');
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

  it('re-reads the models after a failed pull, and keeps the error on screen', async () => {
    // A failed or timed-out pull left each row on its last "Downloading N%".
    let fail!: (reason: Error) => void;
    let listedStatus: AiModel['status'] = { state: 'missing' };
    const ai = aiPort({
      list: async () => [{ ...qwen, status: listedStatus }],
      pullModel: () => new Promise<void>((_resolve, reject) => (fail = reject)),
    });
    ports = { models: ai.port };
    setActiveShellView('settings');
    const store = mount();
    await store.loadAiModels();
    store.newAiModel();
    await vi.waitFor(() => expect(store.aiForm()?.remoteModel).toBe('qwen3:8b'));

    const pulling = store.pullAiModel();
    ai.status({ endpointId: 'e1', remoteModel: 'qwen3:8b', status: { state: 'pulling', progress: 45 } });
    expect(store.aiModels()[0].statusText).toBe('Downloading 45%');

    fail(new Error('pull timed out'));
    await pulling;
    await vi.waitFor(() => expect(store.aiModels()[0].statusText).toBe('The server does not have this model'));
    expect(store.error()).toBe('pull timed out');
  });

  it('offers no second pull while the server still downloads the model', async () => {
    // The call can time out while the server goes on downloading; a second pull would start another.
    const ai = aiPort({
      list: async () => [{ ...qwen, status: { state: 'pulling', progress: 60 } }],
      pullModel: async () => {
        throw new Error('pull timed out');
      },
    });
    ports = { models: ai.port };
    setActiveShellView('settings');
    const store = mount();
    await store.loadAiModels();
    store.newAiModel();
    await vi.waitFor(() => expect(store.aiForm()?.remoteModel).toBe('qwen3:8b'));

    expect(store.aiCanPull()).toBe(false);
  });

  it('offers no second pull from the Add form while the server still downloads the model', async () => {
    // The guard read saved models only, so a pull started before saving could start twice after a
    // timeout: no saved row was there to say the server was still downloading.
    let fail!: (reason: Error) => void;
    const ai = aiPort({
      list: async () => [],
      pullModel: () => new Promise<void>((_resolve, reject) => (fail = reject)),
    });
    ports = { models: ai.port };
    setActiveShellView('settings');
    const store = mount();
    await store.loadAiModels();
    store.newAiModel();
    await vi.waitFor(() => expect(store.aiForm()?.remoteModel).toBe('qwen3:8b'));

    const pulling = store.pullAiModel();
    ai.status({ endpointId: 'e1', remoteModel: 'qwen3:8b', status: { state: 'pulling', progress: 45 } });
    fail(new Error('pull timed out'));
    await pulling;
    expect(store.aiCanPull()).toBe(false);

    // The server says how the download ended; a failed one can be tried again.
    ai.status({ endpointId: 'e1', remoteModel: 'qwen3:8b', status: { state: 'missing' } });
    expect(store.aiCanPull()).toBe(true);
  });

  it('lets a download that ended while settings was closed be tried again', async () => {
    // The server's "still downloading" was kept until the server said how it ended. With settings
    // closed nobody heard that, so the Add form's model could not be pulled again until a reload.
    let fail!: (reason: Error) => void;
    const ai = aiPort({
      list: async () => [],
      pullModel: () => new Promise<void>((_resolve, reject) => (fail = reject)),
    });
    ports = { models: ai.port };
    setActiveShellView('settings');
    const store = mount();
    await store.loadAiModels();
    store.newAiModel();
    await vi.waitFor(() => expect(store.aiForm()?.remoteModel).toBe('qwen3:8b'));

    const pulling = store.pullAiModel();
    ai.status({ endpointId: 'e1', remoteModel: 'qwen3:8b', status: { state: 'pulling', progress: 45 } });
    fail(new Error('pull timed out'));
    await pulling;
    expect(store.aiCanPull()).toBe(false);

    setActiveShellView(null);
    ai.status({ endpointId: 'e1', remoteModel: 'qwen3:8b', status: { state: 'missing' } });
    setActiveShellView('settings');
    expect(store.aiCanPull()).toBe(true);

    // A download the server is still running says so again, and is not started twice.
    ai.status({ endpointId: 'e1', remoteModel: 'qwen3:8b', status: { state: 'pulling', progress: 50 } });
    expect(store.aiCanPull()).toBe(false);
  });

  it('offers an Ollama for every kind it can pull, before it has a model of that kind', async () => {
    // A chat-only Ollama was not offered for embeddings, so the download that would give it an
    // embedding model could not be reached from the form.
    const chatOnly: AiEndpoint = { ...ollama, capabilities: ['chat'], health: { ...ollama.health, models: [] } };
    const ai = aiPort({
      endpoints: async () => [chatOnly, remote],
      discover: async () => [{ id: 'llama3.2:3b', capabilities: ['chat'] }],
    });
    ports = { models: ai.port };
    const store = mount();
    await store.loadAiModels();
    store.newAiModel();

    store.setAiFormField('kind', 'embedding');
    expect(store.aiForm()?.endpointId).toBe('e1');
    expect(store.aiEndpointOptions().map((o) => o.value)).toEqual(['e1']);
    await vi.waitFor(() => expect(store.aiDiscoveredModelHint()).not.toBe(''));
    store.setAiFormField('remoteModel', 'nomic-embed-text');
    expect(store.aiCanPull()).toBe(true);

    // An Ollama cannot transcribe, whatever it pulls.
    store.setAiFormField('kind', 'transcription');
    expect(store.aiEndpointOptions()).toEqual([]);
  });

  it('re-reads the models when a server’s health changes', async () => {
    const ai = aiPort();
    ports = { models: ai.port };
    setActiveShellView('settings');
    const store = mount();
    await vi.waitFor(() => expect(store.aiEndpoints()).toHaveLength(2));
    const before = ai.listed();

    ai.health('e2', { state: 'reachable', detail: '', models: ['m'] });

    expect(store.aiEndpoints()[1].healthText).toBe('Answering · 1 model');
    await vi.waitFor(() => expect(ai.listed()).toBe(before + 1));
  });

  it('takes a server’s capabilities from its health event, so a server that gains a kind is offered for it', async () => {
    // Capabilities were read once, when the server was added: a server with only a chat model was
    // never offered for embeddings, so the download that would give it one could not be reached.
    const ai = aiPort();
    ports = { models: ai.port };
    setActiveShellView('settings');
    const store = mount();
    await vi.waitFor(() => expect(store.aiEndpoints()).toHaveLength(2));
    store.newAiModel();
    store.setAiFormField('kind', 'embedding');
    expect(store.aiEndpointOptions().map((o) => o.value)).toEqual(['e1']);

    ai.health('e2', { state: 'reachable', detail: '', models: ['m'] }, ['chat', 'embeddings']);

    expect(store.aiEndpointOptions().map((o) => o.value)).toEqual(['e1', 'e2']);
  });

  it('keeps a server’s capabilities when its health event carries none', async () => {
    const ai = aiPort();
    ports = { models: ai.port };
    setActiveShellView('settings');
    const store = mount();
    await vi.waitFor(() => expect(store.aiEndpoints()).toHaveLength(2));

    ai.health('e1', { state: 'reachable', detail: '', models: ['m'] });

    store.newAiModel();
    store.setAiFormField('kind', 'embedding');
    expect(store.aiEndpointOptions().map((o) => o.value)).toEqual(['e1']);
  });

  it('lists no model of the wrong kind, and says why the list is empty', async () => {
    // A server with only chat models offered them all as embedding models.
    const ai = aiPort({ discover: async () => [{ id: 'llama3.2:3b', capabilities: ['chat'] }] });
    ports = { models: ai.port };
    const store = mount();
    await store.loadAiModels();
    store.newAiModel();
    await vi.waitFor(() => expect(store.aiDiscoveredModelOptions().map((o) => o.value)).toEqual(['llama3.2:3b']));
    expect(store.aiDiscoveredModelHint()).toBe('');

    store.setAiFormField('kind', 'embedding');

    expect(store.aiDiscoveredModelOptions()).toEqual([]);
    expect(store.aiDiscoveredModelHint()).toBe('None of this server’s models are embedding models');
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

  it('leaves a newer server form open when an earlier save finishes', async () => {
    // The form can be closed while its save waits on the server; the save finishing closed whichever
    // form was open by then, past its discard guard.
    let finish!: () => void;
    const ai = aiPort({
      addEndpoint: (draft) => new Promise((resolve) => (finish = () => resolve({ ...ollama, ...draft, id: 'e9' }))),
    });
    ports = { models: ai.port };
    const store = mount();
    await store.loadAiModels();

    store.newAiEndpoint();
    store.setAiService('llama-server');
    const saving = store.saveAiEndpoint();
    store.closeAiEndpointForm();
    store.editAiEndpoint('e2');
    store.setAiEndpointField('name', 'Mine');

    finish();
    await saving;
    expect(store.aiEndpointForm()?.name).toBe('Mine');
  });

  it('leaves a newer model form open when an earlier save finishes', async () => {
    let finish!: () => void;
    const ai = aiPort({ add: () => new Promise<void>((resolve) => (finish = resolve)) });
    ports = { models: ai.port };
    const store = mount();
    await store.loadAiModels();

    store.newAiModel();
    await vi.waitFor(() => expect(store.aiForm()?.remoteModel).toBe('qwen3:8b'));
    const saving = store.saveAiModel();
    store.closeAiForm();
    store.editAiModel('m1');
    store.setAiFormField('name', 'Mine');

    finish();
    await saving;
    expect(store.aiForm()?.name).toBe('Mine');
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

describe('local AI on this device', () => {
  const hardware: LocalAiHardware = {
    os: 'linux',
    arch: 'x64',
    cpu: 'Test CPU',
    ramBytes: 32e9,
    gpus: [{ vendor: 'amd', type: 'integrated', name: 'Test GPU', vramBytes: 4e9 }],
    backends: ['cpu', 'vulkan'],
    memoryBudgetBytes: 19e9,
    hardwareClass: 'test-class',
    notes: [],
  };
  const plan: LocalAiPlan = {
    hardwareClass: 'test-class',
    runtimes: [
      {
        id: 'llama-server',
        version: 'b1',
        build: 'linux-x64-vulkan',
        backend: 'vulkan',
        sizeBytes: 40e6,
        installed: false,
        kinds: ['llm', 'embedding'],
      },
    ],
    models: [
      {
        kind: 'llm',
        model: 'test-chat',
        sizeBytes: 2.5e9,
        memoryBytes: 3e9,
        license: 'MIT',
        installed: false,
        basis: 'measured',
        fromClass: 'test-class',
      },
    ],
    unavailable: [],
    downloadBytes: 2.54e9,
    totalBytes: 2.54e9,
    memoryBytes: 3e9,
    memoryBudgetBytes: 19e9,
    fits: true,
    reasons: [],
  };
  const notInstalled: LocalAiStatus = {
    installed: false,
    installing: false,
    autostart: true,
    runtimes: [],
    models: [],
  };
  const running: LocalAiStatus = {
    installed: true,
    installing: false,
    autostart: true,
    runtimes: [
      {
        id: 'llama-server',
        version: 'b1',
        build: 'linux-x64-vulkan',
        kinds: ['llm'],
        phase: 'running',
        port: 40001,
        restarts: 0,
        detail: '',
        endpointId: 'local',
        onGpu: true,
        gpuBytes: 3e9,
      },
    ],
    models: [{ kind: 'llm', model: 'test-chat', modelId: 'm-local' }],
  };
  const managed: AiEndpoint = {
    id: 'local',
    name: 'Local llama-server',
    kind: 'llama-server',
    baseUrl: 'http://127.0.0.1:40001',
    hasApiKey: false,
    capabilities: ['chat'],
    health: { state: 'reachable', detail: '', models: ['test-chat'] },
    managed: true,
  };

  /** A local port whose install waits until the test lets it finish, emitting progress meanwhile. */
  function localPort(overrides: Partial<LocalAiPort> = {}) {
    const calls: string[] = [];
    let status = notInstalled;
    let emit: ((progress: LocalAiProgress) => void) | null = null;
    let finish: (() => void) | null = null;
    const local: LocalAiPort = {
      hardware: async () => hardware,
      plan: async () => (status.installed ? { ...plan, downloadBytes: 0 } : plan),
      status: async () => status,
      async install() {
        calls.push('install');
        await new Promise<void>((resolve) => (finish = resolve));
        status = running;
        return status;
      },
      async start() {
        calls.push('start');
        status = running;
        return status;
      },
      async stop() {
        calls.push('stop');
        // As the executor answers: a stopped server is no longer its own, so it has no phase.
        status = { ...running, runtimes: [{ ...running.runtimes[0], phase: null, onGpu: null }] };
        return status;
      },
      async remove(deleteFiles) {
        calls.push(`remove:${deleteFiles}`);
        status = notInstalled;
      },
      onProgress(listener) {
        emit = listener;
        return () => (emit = null);
      },
      ...overrides,
    };
    const endpoints: ModelAdminPort = {
      list: async () => [],
      endpoints: async () => (status.installed ? [managed] : []),
      add: async () => {},
      removeEndpoint: async (id) => void calls.push(`removeEndpoint:${id}`),
      updateEndpoint: async () => managed,
      local,
    };
    return {
      models: endpoints,
      calls,
      progress: (event: Partial<LocalAiProgress>) =>
        emit?.({
          phase: 'download',
          item: '',
          itemDoneBytes: 0,
          itemTotalBytes: 0,
          doneBytes: 0,
          totalBytes: 0,
          detail: '',
          ...event,
        }),
      finish: () => finish?.(),
      listening: () => emit !== null,
    };
  }

  it('stops listening to install progress when the settings close', async () => {
    setActiveShellView('settings');
    const local = localPort();
    ports = { models: local.models };
    mount();
    await vi.waitFor(() => expect(local.listening()).toBe(true));

    setActiveShellView(null);
    expect(local.listening()).toBe(false);
  });

  it('tracks an install started elsewhere, and drops its bar once a read says it is over', async () => {
    setActiveShellView('settings');
    const local = localPort();
    ports = { models: local.models };
    const store = mount();
    await vi.waitFor(() => expect(store.localAi().loaded).toBe(true));

    // Started from the launcher: only its progress says so.
    local.progress({ phase: 'download', item: 'test-chat', doneBytes: 1e9, totalBytes: 2.54e9 });
    expect(store.localAi()).toMatchObject({ installing: true, canInstall: false });
    expect(store.localAi().progress?.percent).toBe(39);

    // The settings closed before its end was heard; the next read says no install runs.
    await store.loadLocalAi();
    expect(store.localAi()).toMatchObject({ installing: false, progress: null });
  });

  it('still says an install failed after the settings were closed and opened again', async () => {
    // The first-run step says the install carries on; a failure after that was in the shared error
    // only, which the next read clears as it starts.
    setActiveShellView('settings');
    const local = localPort({
      install: async () => {
        throw new Error('disk full');
      },
    });
    ports = { models: local.models };
    const store = mount();
    await vi.waitFor(() => expect(store.localAi().loaded).toBe(true));
    await store.installLocalAi();

    // Opening the settings again starts listening afresh: what was under way is dropped, a failure kept.
    setActiveShellView(null);
    setActiveShellView('settings');
    await store.loadLocalAi();
    expect(store.error()).toBe('');
    expect(store.localAi().progress).toMatchObject({ text: 'The install failed — disk full', failed: true });
  });

  it('reads the machine and the plan when the settings open, in words', async () => {
    setActiveShellView('settings');
    ports = { models: localPort().models };
    const store = mount();
    await vi.waitFor(() => expect(store.localAi().loaded).toBe(true));
    expect(store.canUseLocalAi()).toBe(true);
    expect(store.localAi()).toMatchObject({
      device: 'Test CPU · 32.0 GB memory',
      gpus: ['Test GPU · integrated · 4.0 GB'],
      compute: 'Can run models on the GPU with Vulkan',
      summary: 'Downloads 2.5 GB · fits this device',
      installLabel: 'Install (2.5 GB)',
      installed: false,
      canInstall: true,
    });
    expect(store.localAi().items.map((item) => [item.label, item.name, item.sizeText])).toEqual([
      ['Language model', 'test-chat', '2.5 GB'],
      ['Model server', 'llama-server b1 · Vulkan', '40 MB'],
    ]);
  });

  it('shows an install’s progress while it runs, then the running state and the managed server', async () => {
    setActiveShellView('settings');
    const local = localPort();
    ports = { models: local.models };
    const store = mount();
    await vi.waitFor(() => expect(store.localAi().loaded).toBe(true));

    const installing = store.installLocalAi();
    expect(store.localAi().installing).toBe(true);
    expect(store.localAi().canInstall).toBe(false);
    local.progress({
      phase: 'download',
      item: 'test-chat',
      itemDoneBytes: 1e9,
      itemTotalBytes: 2.5e9,
      doneBytes: 1e9,
      totalBytes: 2.54e9,
    });
    expect(store.localAi().progress).toEqual({
      percent: 39,
      text: 'Downloading test-chat — 1.0 GB of 2.5 GB',
      failed: false,
    });
    // A late event never moves the bar back within one install.
    local.progress({ phase: 'download', item: 'test-chat', doneBytes: 0.5e9, totalBytes: 2.54e9 });
    expect(store.localAi().progress?.percent).toBe(39);

    local.finish();
    await installing;
    expect(store.localAi()).toMatchObject({ installed: true, installing: false, running: true, progress: null });
    expect(store.localAi().runtimes).toEqual([
      {
        key: 'llama-server',
        label: 'Language model · llama-server b1 · Vulkan',
        stateText: 'Running · on the GPU (3.0 GB)',
        ok: true,
        tone: 'success',
      },
    ]);
    expect(store.aiEndpoints()[0]).toMatchObject({ kindLabel: 'This device', editable: false });
  });

  it('keeps a failed install’s reason on screen', async () => {
    setActiveShellView('settings');
    const local = localPort();
    ports = { models: local.models };
    const store = mount();
    await vi.waitFor(() => expect(store.localAi().loaded).toBe(true));
    local.progress({ phase: 'failed', detail: 'checksum mismatch' });
    expect(store.localAi().progress).toEqual({
      percent: 0,
      text: 'The install failed — checksum mismatch',
      failed: true,
    });
  });

  it('stops, starts and removes, with or without the files', async () => {
    setActiveShellView('settings');
    const local = localPort();
    ports = { models: local.models };
    const store = mount();
    await vi.waitFor(() => expect(store.localAi().loaded).toBe(true));
    await store.startLocalAi();
    expect(store.localAi().running).toBe(true);

    await store.stopLocalAi();
    expect(store.localAi()).toMatchObject({ running: false, anyRunning: false });
    expect(store.localAi().runtimes[0].stateText).toBe('Not running');

    await store.removeLocalAi(true);
    expect(local.calls).toEqual(['start', 'stop', 'remove:true']);
    expect(store.localAi().installed).toBe(false);
    expect(store.aiEndpoints()).toEqual([]);
  });

  it('starts a bar over when the settings open again, rather than holding what it heard before', async () => {
    setActiveShellView('settings');
    const local = localPort({ status: async () => ({ ...notInstalled, installing: true }) });
    ports = { models: local.models };
    const store = mount();
    await vi.waitFor(() => expect(store.localAi().loaded).toBe(true));
    const download = (doneBytes: number) => ({
      phase: 'download' as const,
      item: 'test-chat',
      itemDoneBytes: doneBytes,
      itemTotalBytes: 2.5e9,
      doneBytes,
      totalBytes: 2.54e9,
    });
    local.progress(download(1.524e9));
    expect(store.localAi().progress?.percent).toBe(60);

    // Closed while the install ran, so its end went unheard; a retry of the same plan has the same total.
    setActiveShellView(null);
    setActiveShellView('settings');
    local.progress(download(0.0254e9));
    expect(store.localAi().progress?.percent).toBe(1);
  });

  it('re-reads what an install changed when one it did not start ends', async () => {
    setActiveShellView('settings');
    const local = localPort();
    ports = { models: local.models };
    const store = mount();
    await vi.waitFor(() => expect(store.localAi().loaded).toBe(true));
    // The launcher's install, or the backend's own, ran meanwhile: the backend now has it installed.
    const port = local.models;
    const status = vi.spyOn(port.local as LocalAiPort, 'status').mockResolvedValue(running);
    const plan = vi.spyOn(port.local as LocalAiPort, 'plan');
    const endpoints = vi.spyOn(port, 'endpoints').mockResolvedValue([managed]);
    const list = vi.spyOn(port, 'list');

    // Nothing is in flight from here; only its end is heard.
    local.progress({ phase: 'done', item: '', doneBytes: 0, totalBytes: 0 });
    await vi.waitFor(() => expect(store.localAi().installed).toBe(true));
    for (const read of [status, plan, endpoints, list]) expect(read).toHaveBeenCalled();
    expect(store.localAi()).toMatchObject({ installing: false, running: true });
    expect(store.aiEndpoints()).toHaveLength(1);
  });

  it('does not edit or remove a managed server as a server', async () => {
    setActiveShellView('settings');
    const local = localPort();
    ports = { models: local.models };
    const store = mount();
    await vi.waitFor(() => expect(store.localAi().loaded).toBe(true));
    await store.startLocalAi();
    expect(store.aiEndpoints()).toHaveLength(1);

    store.editAiEndpoint('local');
    expect(store.aiEndpointForm()).toBeNull();
    await store.removeAiEndpoint('local');
    expect(local.calls).not.toContain('removeEndpoint:local');
  });

  it('offers no install to a connection that may only look', async () => {
    const local = localPort({ install: undefined, start: undefined, stop: undefined, remove: undefined });
    ports = { models: local.models };
    const store = mount();
    expect(store.canUseLocalAi()).toBe(true);
    expect(store.canConfigureLocalAi()).toBe(false);
  });

  it('has no local AI where the backend has none', () => {
    ports = { models: { list: async () => [] } };
    const store = mount();
    expect(store.canUseLocalAi()).toBe(false);
    expect(store.localAi().loaded).toBe(false);
  });
});

describe('a first run’s AI step', () => {
  const notInstalled: LocalAiStatus = {
    installed: false,
    installing: false,
    autostart: true,
    runtimes: [],
    models: [],
  };

  /** A node as its operator sees it, with whatever models and local AI the test gives it. */
  function node(options: { models?: AiModel[]; local?: Partial<LocalAiStatus>; operator?: boolean } = {}) {
    const operator = options.operator ?? true;
    const local: LocalAiPort = {
      plan: async () => {
        throw new Error('not read here');
      },
      status: async () => ({ ...notInstalled, ...options.local }),
      ...(operator ? { install: async () => notInstalled } : {}),
    };
    const models: ModelAdminPort = {
      list: async () => options.models ?? [],
      ...(operator
        ? {
            add: async () => {},
            endpoints: async () => [],
            detectEndpoints: async () => [],
            local,
          }
        : {}),
    };
    return models;
  }

  const model: AiModel = {
    id: 'm1',
    name: 'Test chat',
    kind: 'llm',
    endpointId: 'e1',
    remoteModel: 'test-chat',
    status: { state: 'ready' },
    isDefault: true,
  };

  it('holds a first run on the step where the node has no AI and its operator can set it up', async () => {
    ports = { models: node() };
    const store = mount();
    expect(store.aiSetupOptions()).toEqual(['local', 'server', 'skip']);
    expect(await store.openAiStep()).toBe(true);
    expect(session.held).toBe(1);
  });

  it('goes straight on where the node has a model already', async () => {
    ports = { models: node({ models: [model] }) };
    expect(await mount().openAiStep()).toBe(false);
    expect(session.held).toBe(0);
  });

  it('goes straight on where local AI is installed already', async () => {
    ports = { models: node({ local: { installed: true } }) };
    expect(await mount().openAiStep()).toBe(false);
  });

  it('goes straight on for a managed user, who could only skip', async () => {
    ports = { models: node({ operator: false }) };
    const store = mount();
    expect(store.aiSetupOptions()).toEqual(['skip']);
    expect(await store.openAiStep()).toBe(false);
    expect(session.held).toBe(0);
  });

  it('goes straight on where the backend has no AI at all', async () => {
    ports = {};
    expect(await mount().openAiStep()).toBe(false);
  });

  it('finishes setting up on skip, and a second account on that node is not asked again', async () => {
    ports = { models: node() };
    const store = mount();
    expect(await store.openAiStep()).toBe(true);
    store.skipAiSetup();
    expect(session.finished).toBe(1);

    // The step runs only for a new agent, so the answer that counts is the node's: the next account
    // made against it has a new id, and its operator already said no AI for now.
    session.agent = 'did:test:second-account';
    expect(await mount().openAiStep()).toBe(false);
    expect(session.held).toBe(1);
  });

  it('asks an account on another node, whatever this one answered', async () => {
    ports = { models: node() };
    expect(await mount().openAiStep()).toBe(true);
    mount().skipAiSetup();

    session.agent = 'did:test:second-account';
    session.url = 'https://other-node.test';
    expect(await mount().openAiStep()).toBe(true);
    expect(session.held).toBe(2);
  });

  it('keeps no answer where the node has no address to keep it under', async () => {
    session.url = undefined;
    ports = { models: node() };
    const store = mount();
    expect(await store.openAiStep()).toBe(true);
    store.skipAiSetup();
    expect(Object.keys(localStorage).filter((key) => key.startsWith('we.aiSetup'))).toEqual([]);

    session.agent = 'did:test:second-account';
    expect(await mount().openAiStep()).toBe(true);
  });

  it('clears its time limit once the node has answered', async () => {
    ports = { models: node() };
    const store = mount();
    vi.useFakeTimers();
    try {
      const before = vi.getTimerCount();
      expect(await store.openAiStep()).toBe(true);
      expect(vi.getTimerCount()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a set-up answer too, and closes a form left open', async () => {
    ports = { models: node() };
    const store = mount();
    await store.openAiStep();
    store.newAiEndpoint();
    store.finishAiSetup();
    expect(session.finished).toBe(1);
    expect(store.aiEndpointForm()).toBeNull();
    expect(localStorage.getItem('we.aiSetup.answer:https://node.test')).toBe('set-up');
  });

  it('reads the AI sections while the step is up, as it does while the settings are open', async () => {
    let listed = 0;
    let detected = 0;
    ports = {
      models: {
        ...node(),
        list: async () => {
          listed += 1;
          return [];
        },
        detectEndpoints: async () => {
          detected += 1;
          return [];
        },
      },
    };
    session.step = 'setUpAi';
    mount();
    await vi.waitFor(() => expect(listed).toBeGreaterThan(0));
    expect(detected).toBe(1);
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
    setActiveShellView('settings');
    const { port, calls } = stubRuntime();
    ports = { runtime: port };

    const store = mount();

    await vi.waitFor(() => expect(store.trustedAgents()).toEqual(['did:peer:one']));
    expect([...calls].sort()).toEqual(['authorizedApps', 'languages', 'trustedAgents']);
  });

  it('asks for nothing the backend cannot answer', async () => {
    setActiveShellView('settings');
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
    setActiveShellView('settings');
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
