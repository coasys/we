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
import type { AiModel, BackendPorts, ConsentRequest, RuntimeAdminPort } from '@we/backend-shared';
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

describe('AI models', () => {
  const gpt: AiModel = {
    id: 'm1',
    name: 'GPT',
    kind: 'llm',
    isDefault: true,
    source: { kind: 'api', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x', model: 'gpt-4o' },
  };
  const local: AiModel = {
    id: 'm2',
    name: 'Llama',
    kind: 'llm',
    isDefault: false,
    source: { kind: 'preset', name: 'llama_8b' },
  };

  /** A runtime port with the AI members, recording what it was asked. */
  function aiPort(overrides: Partial<RuntimeAdminPort> = {}) {
    const calls: string[] = [];
    const port: RuntimeAdminPort = {
      async aiModels() {
        calls.push('aiModels');
        return [gpt, local];
      },
      async aiModelPresets() {
        calls.push('presets');
        return ['llama_8b', 'mistral_7b'];
      },
      async addAiModel(draft) {
        calls.push(`add:${draft.name}`);
      },
      async updateAiModel(id, draft) {
        calls.push(`update:${id}:${draft.name}`);
      },
      async aiModelStatus() {
        calls.push('status');
        return { downloaded: false, loaded: false, progress: 30, status: 'fetching' };
      },
      ...overrides,
    };
    return { port, calls };
  }

  it('polls status only for models the backend hosts', async () => {
    const { port, calls } = aiPort();
    ports = { runtime: port };
    const store = mount();

    await store.loadAiModels();
    await vi.waitFor(() => expect(store.aiModels().find((m) => m.id === 'm2')?.statusText).toBe('Downloading 30%'));

    // One status call, for the local model. The remote one has nothing to download, and asking
    // about it would be a round trip whose answer is already known.
    expect(calls.filter((c) => c === 'status')).toEqual(['status']);
    expect(store.aiModels().find((m) => m.id === 'm1')?.statusText).toBe('');
  });

  it('saves a new model as an add, and an edited one as an update', async () => {
    const { port, calls } = aiPort();
    ports = { runtime: port };
    const store = mount();
    await store.loadAiModels();

    store.newAiModel();
    store.setAiFormField('name', 'Fresh');
    store.setAiFormField('presetName', 'mistral_7b');
    await store.saveAiModel();

    store.editAiModel('m2');
    store.setAiFormField('name', 'Renamed');
    await store.saveAiModel();

    expect(calls.filter((c) => c.startsWith('add') || c.startsWith('update'))).toEqual([
      'add:Fresh',
      'update:m2:Renamed',
    ]);
  });

  it('refuses to save a form that is missing what its source needs', async () => {
    const { port, calls } = aiPort();
    ports = { runtime: port };
    const store = mount();

    store.newAiModel();
    store.setAiFormField('name', 'Nameless source');
    // Source is 'preset' by default and no preset has been chosen.
    expect(store.aiFormComplete()).toBe(false);
    await store.saveAiModel();

    expect(calls.filter((c) => c.startsWith('add'))).toEqual([]);
    expect(store.aiForm()).not.toBeNull();
  });

  it('keeps the form open when the save fails, so the typing is not lost', async () => {
    const { port } = aiPort({
      async addAiModel() {
        throw new Error('model type not supported');
      },
    });
    ports = { runtime: port };
    const store = mount();

    store.newAiModel();
    store.setAiFormField('name', 'Fresh');
    store.setAiFormField('presetName', 'llama_8b');
    await store.saveAiModel();

    expect(store.aiForm()?.name).toBe('Fresh');
    expect(store.error()).toBe('model type not supported');
  });

  it('offers presets for the kind the form is on, and refetches when it changes', async () => {
    const asked: string[] = [];
    const { port } = aiPort({
      async aiModelPresets(kind) {
        asked.push(kind);
        return kind === 'llm' ? ['llama_8b'] : ['whisper_small'];
      },
    });
    ports = { runtime: port };
    const store = mount();

    store.newAiModel();
    await vi.waitFor(() => expect(store.aiPresetOptions()).toEqual([{ label: 'llama_8b', value: 'llama_8b' }]));

    store.setAiFormField('kind', 'transcription');
    await vi.waitFor(() =>
      expect(store.aiPresetOptions()).toEqual([{ label: 'whisper_small', value: 'whisper_small' }]),
    );
    expect(asked).toEqual(['llm', 'transcription']);
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
