/**
 * An install's progress moves the bar and its line, and nothing else on the page.
 *
 * Driven through the real `RuntimeStore`, the real template bag and the real AI settings schema.
 * The backend sends progress many times a second while models download, and every event re-derives
 * the "This device" view; when that view was a fresh object each time, the plan's rows were new
 * objects each time too, and the list under them took every row down and drew new ones — under a
 * reader who had scrolled down to watch the bar.
 *
 * Also: the Start and Stop buttons follow the servers' state, and a first run's AI step has the page's
 * error slot, so an install the backend refuses says why there.
 *
 * SessionStore, ShellStore and the platform are faked as in `runtimeStore.test.tsx`: the store reads
 * only the backend's ports from the session and whether a page showing AI is open from the shell.
 */
import { buildTemplateBag, CHROME_TIER } from '@shared/registries/templateSurface';
import { componentRegistry } from '@solid/registries/componentRegistry';
import { cleanup, render } from '@solidjs/testing-library';
import type {
  BackendPorts,
  LocalAiHardware,
  LocalAiPlan,
  LocalAiPort,
  LocalAiProgress,
  LocalAiStatus,
  ModelAdminPort,
} from '@we/backend-shared';
import type { SchemaNode } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import { aiSection, signInForm } from '@we/template-shell';
import { afterEach, describe, expect, it, vi } from 'vitest';

let ports: Partial<BackendPorts> | null = null;

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({
    backendPorts: () => ports,
    signInStep: () => 'ready',
    me: () => ({ id: 'did:test:me' }),
    holdForAiSetup: () => {},
    finishSetup: () => {},
  }),
}));

// The settings page is open, so the store reads local AI and listens for progress.
vi.mock('../src/frameworks/solid/stores/ShellStore', () => ({
  useShellStore: () => ({ activeShellView: () => 'settings' }),
}));

vi.mock('../src/frameworks/solid/providers/PlatformProvider', () => ({
  usePlatform: () => ({ executor: undefined }),
}));

import { RuntimeStoreProvider, useRuntimeStore } from '../src/frameworks/solid/stores/RuntimeStore';

const hardware: LocalAiHardware = {
  os: 'darwin',
  arch: 'arm64',
  cpu: 'Test CPU',
  ramBytes: 32e9,
  gpus: [{ vendor: 'apple', type: 'unified', name: 'Test GPU', vramBytes: 0 }],
  backends: ['cpu', 'metal'],
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
      build: 'darwin-arm64-metal',
      backend: 'metal',
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

const notInstalled: LocalAiStatus = { installed: false, installing: false, autostart: true, runtimes: [], models: [] };

const download = (doneBytes: number): LocalAiProgress => ({
  phase: 'download',
  item: 'test-chat',
  itemDoneBytes: doneBytes,
  itemTotalBytes: 2.5e9,
  doneBytes,
  totalBytes: 2.54e9,
  detail: '',
});

/**
 * A local port whose install never finishes, so the test can send progress for as long as it likes —
 * or whose install is refused, given `install`.
 */
function localPort(
  install: LocalAiPort['install'] = () => new Promise<LocalAiStatus>(() => {}),
  status: LocalAiStatus = notInstalled,
) {
  let emit: ((progress: LocalAiProgress) => void) | null = null;
  const local: LocalAiPort = {
    hardware: async () => hardware,
    plan: async () => plan,
    status: async () => status,
    install,
    onProgress(listener) {
      emit = listener;
      return () => (emit = null);
    },
  };
  const models: ModelAdminPort = { list: async () => [], endpoints: async () => [], local };
  return { models, progress: (event: LocalAiProgress) => emit?.(event) };
}

function renderSection(node: SchemaNode = aiSection, refuse?: LocalAiPort['install'], status?: LocalAiStatus) {
  const local = localPort(refuse, status);
  ports = { models: local.models };
  let install!: () => Promise<void>;
  const { container } = render(() => (
    <RuntimeStoreProvider>
      {(() => {
        const store = useRuntimeStore();
        install = store.installLocalAi;
        // The bag the settings overlay renders against: chrome tier, members as the template sees them.
        const stores = buildTemplateBag({ runtimeStore: store } as never, { grants: CHROME_TIER, gesture: 'report' });
        return <RenderSchema node={node as never} stores={stores} registry={componentRegistry as never} />;
      })()}
    </RuntimeStoreProvider>
  ));
  return { container, progress: local.progress, install: () => install() };
}

afterEach(cleanup);

describe('an install’s progress on the page', () => {
  it('updates the bar in place and takes nothing else down', async () => {
    const { container, progress, install } = renderSection();
    const bar = () => container.querySelector('we-progress-bar') as (Element & { value: number }) | null;
    const textOf = (text: string) =>
      [...container.querySelectorAll('we-text')].find((el) => el.textContent?.includes(text)) ?? null;
    await vi.waitFor(() => expect(textOf('Test CPU')).not.toBeNull());

    void install();
    progress(download(0));
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    const barBefore = bar();
    expect(textOf('test-chat')).not.toBeNull();
    const every = new Set(container.querySelectorAll('*'));

    progress(download(1.27e9));
    progress(download(1.9e9));

    expect(bar()).toBe(barBefore);
    expect(bar()?.value).toBe(75);
    expect(textOf('Downloading test-chat')?.textContent).toContain('1.9 GB of 2.5 GB');
    // Nothing anywhere in the section was taken down and drawn again — the plan's rows included.
    const removed = [...every].filter((el) => !container.contains(el));
    expect(removed.map((el) => `${el.tagName.toLowerCase()} "${el.textContent?.slice(0, 30)}"`)).toEqual([]);
  });
});

/** The node a condition on `step` shows, found in the sign-in form wherever it sits. */
function shownOn(step: string): SchemaNode {
  const visit = (node: unknown): SchemaNode | null => {
    if (!node || typeof node !== 'object') return null;
    const candidate = node as SchemaNode & { props?: { condition?: { $?: string }; then?: SchemaNode } };
    if (candidate.props?.condition?.$ === `sessionStore.signInStep == '${step}'` && candidate.props.then) {
      return candidate.props.then;
    }
    for (const child of Object.values(node)) {
      const found = Array.isArray(child) ? child.map(visit).find(Boolean) : visit(child);
      if (found) return found;
    }
    return null;
  };
  const found = visit(signInForm);
  if (!found) throw new Error(`no step ${step} in the sign-in form`);
  return found;
}

describe('a first run’s AI step', () => {
  it('says why an install was refused', async () => {
    const refused = async (): Promise<LocalAiStatus> => {
      throw new Error('A local AI install is running already');
    };
    const { container, install } = renderSection(shownOn('setUpAi'), refused);
    await vi.waitFor(() => expect(container.textContent).toContain('Test CPU'));

    await install();
    await vi.waitFor(() =>
      expect(container.querySelector('we-alert')?.textContent).toContain('A local AI install is running already'),
    );
  });
});

describe('the buttons under This device', () => {
  const installed = (phase: LocalAiStatus['runtimes'][number]['phase'], installing = false): LocalAiStatus => ({
    installed: true,
    installing,
    autostart: true,
    runtimes: [
      {
        id: 'llama-server',
        version: 'b1',
        build: 'darwin-arm64-metal',
        kinds: ['llm'],
        phase,
        restarts: 5,
        detail: 'exited with 1',
        onGpu: null,
      },
    ],
    models: [],
  });
  const buttons = (container: HTMLElement) =>
    [...container.querySelectorAll('we-button')] as (Element & { text?: string; disabled?: boolean })[];
  const named = (container: HTMLElement, text: string) => buttons(container).find((button) => button.text === text);

  it('offers Start and Stop for a failed server: the backend starts a failed one again', async () => {
    const { container } = renderSection(aiSection, undefined, installed('failed'));
    await vi.waitFor(() => expect(container.textContent).toContain('Failed'));
    expect(named(container, 'Stop')).toBeDefined();
    expect(named(container, 'Start')).toBeDefined();
  });

  it('offers Start once the servers are stopped', async () => {
    const { container } = renderSection(aiSection, undefined, installed(null));
    await vi.waitFor(() => expect(container.textContent).toContain('Not running'));
    expect(named(container, 'Start')).toBeDefined();
    expect(named(container, 'Stop')).toBeUndefined();
  });

  it('holds Start and Stop while an install runs, which stops and starts the servers itself', async () => {
    const { container } = renderSection(aiSection, undefined, installed('running', true));
    await vi.waitFor(() => expect(named(container, 'Stop')).toBeDefined());
    expect(named(container, 'Stop')?.disabled).toBe(true);
  });
});
