/*
 * A template's `openPanel` may not open the app's own chat panels.
 *
 * The app's `chat-global`/`chat-space` declarations ride inside the same `declaredPanels()` list a
 * space template's `openPanel` resolves against — merged under the interface's, marked the app's by
 * identity (`isAppPanel`). A `viaTemplate` call that reached them opened a chat with template-chosen
 * inputs, where `chatStore.openChat` — the one way a template may ask for a chat — pins the scope
 * and fills the composer rather than sending.
 *
 * The chain is the real one: the real shell store, the app's real declarations merged the real way
 * (`activePanels`, which is what marks them), the space tier's real bag — which stamps `viaTemplate`
 * and strikes `scope` — and the real panel host drawing the instance's body.
 */
import { cleanup, render } from '@solidjs/testing-library';
import type { AgentConversationsPort } from '@we/backend-shared';
import { For } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { coasysApp } from '../../templates/cartridges/src/coasys/app';
import { PanelHost, PanelSlot } from '../src/frameworks/solid/components/PanelHost';
import { ChatStoreProvider } from '../src/frameworks/solid/stores/ChatStore';
import type { ShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { ShellStoreProvider, useShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { activePanels } from '../src/shared/panelScope';
import { provideTemplateBag } from '../src/shared/registries/templateBag';
import { setTemplatePanels } from '../src/shared/registries/templatePanels';
import { buildTemplateBag, SPACE_TIER } from '../src/shared/registries/templateSurface';

let agentChatMounts = 0;

/* The body's own report that it mounted — counted rather than looked for in the DOM. */
vi.mock('../src/frameworks/solid/components/chat/AgentChat', async (importActual) => {
  const mod = await importActual<typeof import('../src/frameworks/solid/components/chat/AgentChat')>();
  const Wrapped = (props: Parameters<typeof mod.AgentChat>[0]) => {
    agentChatMounts++;
    return mod.default(props);
  };
  return { ...mod, default: Wrapped, AgentChat: Wrapped };
});

const conversations = {
  create: vi.fn(async () => ({ id: 's1' })),
  list: vi.fn(async () => []),
  send: vi.fn(async () => 'r1'),
  cancel: vi.fn(async () => true),
  delete: vi.fn(async () => {}),
  follow: vi.fn(() => () => {}),
};

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({
    backendPorts: () => ({ agents: { conversations: conversations as unknown as AgentConversationsPort } }),
  }),
}));
vi.mock('../src/frameworks/solid/stores/DatasetStore', () => ({
  useDatasetStore: () => ({ datasets: () => [] }),
}));
vi.mock('../src/frameworks/solid/stores/SpaceStore', () => ({
  useSpaceStore: () => ({ mySpaces: () => [] }),
}));

let release: (() => void)[] = [];

beforeEach(() => {
  localStorage.clear();
  agentChatMounts = 0;
  /*
    The declaration the layout would publish with this app and a space template that declares no
    panels of its own: the app's two chats, under the space template's scope. `activePanels` is the
    merge production runs — it is also what marks the app's entries `isAppPanel`.
  */
  setTemplatePanels(
    activePanels([], undefined, ['spaces', 'garden'], coasysApp.meta?.panels ?? []),
    'a-synced-space-template',
  );
});

afterEach(() => {
  cleanup();
  setTemplatePanels(undefined);
  release.forEach((done) => done());
  release = [];
});

function mount() {
  let store!: ShellStore;
  /** The space tier's bag — what a synced template's calls go through. */
  let bag!: { shellStore: ShellStore };
  const Grab = () => {
    store = useShellStore();
    store.provideAgentDid(() => 'did:test:me');
    bag = buildTemplateBag({ shellStore: store } as never, { grants: SPACE_TIER });
    // `TemplatePanelBody` renders with the interface's own grants — this bag, in the test.
    release.push(provideTemplateBag(bag as never));
    return null;
  };
  const { container } = render(() => (
    <ShellStoreProvider>
      <Grab />
      <ChatStoreProvider>
        {/* Every open instance's body, the way a frame's own PanelSlot draws it. */}
        <For each={store.panelInstances()}>{(instance) => <PanelSlot id={instance.id} />}</For>
        <PanelHost />
      </ChatStoreProvider>
    </ShellStoreProvider>
  ));
  return { store, bag, container };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

describe("a template's openPanel aimed at the app's chat panels", () => {
  it('opens no global chat instance — and no AgentChat mounts', async () => {
    const { store, bag, container } = mount();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const id = bag.shellStore.openPanel('chat-global', { prefill: 'x' });

    expect(id).toBe('');
    expect(store.panelInstances()).toHaveLength(0);
    await settle();
    expect(agentChatMounts).toBe(0);
    expect(container.querySelector('[data-testid="agent-chat"]')).toBeNull();
    warn.mockRestore();
  });

  it('opens no space chat instance either — the same door for the other panel', async () => {
    const { store, bag, container } = mount();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const id = bag.shellStore.openPanel('chat-space', {
      perspectiveUuid: 'a1a2a3a4-b1b2-c3c4-d5d6-e7e8e9f0a1b2',
      prefill: 'x',
    });

    expect(id).toBe('');
    expect(store.panelInstances()).toHaveLength(0);
    await settle();
    expect(agentChatMounts).toBe(0);
    expect(container.querySelector('[data-testid="agent-chat"]')).toBeNull();
    warn.mockRestore();
  });

  it('still opens the interface’s own panels, and the host’s call still reaches the chat', async () => {
    const { store, bag } = mount();
    /*
      A template's own declaration is not an app panel — opening it is `openPanel`'s whole job.
      Declared beside the app's (a shell entry would win a real id collision; a different id just
      sits alongside).
    */
    setTemplatePanels(
      activePanels(
        [{ id: 'inspector', title: 'Inspector', node: { type: 'span', props: { class: 'inspecting' } } }],
        undefined,
        ['spaces', 'garden'],
        coasysApp.meta?.panels ?? [],
      ),
      'a-synced-space-template',
    );
    expect(bag.shellStore.openPanel('inspector', {})).not.toBe('');
    expect(store.panelInstances()).toHaveLength(1);

    // And the host's own path in — `chatStore.openChat`'s, unmarked — still opens the chat.
    expect(store.openPanel('chat-global', { prefill: 'x' }, { scope: 'app' })).not.toBe('');
    await vi.waitFor(() => expect(agentChatMounts).toBe(1), { timeout: 2000 });
  });
});
