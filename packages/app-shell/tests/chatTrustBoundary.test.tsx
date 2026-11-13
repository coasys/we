/*
 * The chat is not a component a template may name.
 *
 * `componentRegistry` is the vocabulary a synced template renders against. `AgentChat` in it meant
 * `{ type: 'AgentChat', props: { inputs: { draft: 'x', at: 1 } } }` inside any interface — or a
 * panel one declared — mounted a chat driven by inputs the template wrote, sending a real
 * question. The name is absent there now: the tree renders the same missing-component marker any
 * unregistered component gets, and the session adapter never hears a send.
 *
 * The shell's own chat panels render through `chromeComponentRegistry`, which still knows the
 * name — asserted below, so the guard and not a broken lazy import is what the first test sees.
 */
import { cleanup, render } from '@solidjs/testing-library';
import type { AgentConversationsPort } from '@we/backend-shared';
import { RenderSchema } from '@we/schema-solid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chromeComponentRegistry, componentRegistry } from '../src/frameworks/solid/registries/componentRegistry';

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
vi.mock('../src/frameworks/solid/stores/ChatStore', () => ({
  useChatStore: () => ({
    takePending: () => undefined,
    rememberedConversation: () => undefined,
    rememberConversation: () => {},
  }),
}));

/** A template tree naming the chat, as a synced interface would write it. */
const templateTree = {
  type: 'AgentChat',
  props: { inputs: { draft: 'x', at: 1 } },
};

describe('a template naming the chat components', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('renders no chat and sends nothing — the name is absent from its registry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(() => RenderSchema({ node: templateTree, stores: {}, registry: componentRegistry }));

    // The renderer's answer to an unregistered component — the same as any unknown type's.
    await vi.waitFor(() => expect(container.querySelector('[data-we-missing-component="AgentChat"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="agent-chat"]')).toBeNull();
    // The assertion the finding names: the session adapter was never asked to send.
    expect(conversations.send).not.toHaveBeenCalled();
    expect(conversations.create).not.toHaveBeenCalled();
  });

  it('still mounts for the host — the shell registry keeps the name', async () => {
    const { container } = render(() =>
      RenderSchema({
        node: { type: 'AgentChat', props: { inputs: {} } },
        stores: {},
        registry: chromeComponentRegistry,
      }),
    );
    await vi.waitFor(() => expect(container.querySelector('[data-testid="agent-chat"]')).not.toBeNull());
    expect(container.querySelector('[data-we-missing-component]')).toBeNull();
  });
});
