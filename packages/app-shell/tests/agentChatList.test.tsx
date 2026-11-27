/*
 * A conversation in the list opens from a button — finding 8. Enter, Space and a switch reach a
 * row the way a pointer's click does, because the row is a `<button>` and not a div listening.
 */
import { cleanup, render as mount } from '@solidjs/testing-library';
import type { AgentConversationsPort } from '@we/backend-shared';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoreRegistryContext } from '../src/frameworks/solid/stores/useStore';
import type { StoreRegistry } from '../src/shared/stores/storeRegistry';

const follow = vi.fn((_ref: unknown, _cb: (next: never[]) => void) => () => {});
const conversations = {
  create: vi.fn(async () => ({ id: 's1' })),
  list: vi.fn(async () => [
    { ref: { id: 'c1' }, title: 'First chat', createdAt: 1, updatedAt: 2 },
    { ref: { id: 'c2' }, title: 'Second chat', createdAt: 0, updatedAt: 1 },
  ]),
  send: vi.fn(async () => 'r1'),
  cancel: vi.fn(async () => true),
  delete: vi.fn(async () => {}),
  messages: vi.fn(async () => []),
  follow,
};

/** What the components read from the registry, as the host composes it. */
const stores = {
  sessionStore: {
    backendPorts: () => ({ agents: { conversations: conversations as unknown as AgentConversationsPort } }),
  },
  datasetStore: { datasets: () => [] },
  spaceStore: { mySpaces: () => [] },
  chatStore: {
    openChat: vi.fn(),
    takePending: () => undefined,
    rememberedConversation: () => undefined,
    rememberConversation: () => {},
  },
} as unknown as Partial<StoreRegistry>;

/** Render inside the store registry, as the host's composition hands it to every component. */
function render(ui: () => JSX.Element) {
  return mount(ui, {
    wrapper: (props) => <StoreRegistryContext.Provider value={stores}>{props.children}</StoreRegistryContext.Provider>,
  });
}

import AgentChat from '../src/frameworks/solid/components/chat/AgentChat';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the conversation list', () => {
  it('names itself "Chats" in the header, with "New chat" as the button', async () => {
    /*
      The header used to show "New chat" — the action's name — as the list's title while the list
      itself was up. The title is what the view is; the button beside it is the action.
    */
    const { container } = render(() => <AgentChat inputs={{}} />);

    await vi.waitFor(() => {
      const header = container.querySelector<HTMLElement>('[data-testid="agent-chat"] > *:first-child');
      expect(header?.textContent).toContain('Chats');
      expect(header?.textContent).not.toContain('New chat');
    });
    const newChat = container.querySelector<HTMLElement>('[aria-label="New chat"]');
    expect(newChat).not.toBeNull();
  });

  it('opens a conversation from a real button — keyboard reaches it, not only the pointer', async () => {
    const { container } = render(() => <AgentChat inputs={{}} />);

    const row = await vi.waitFor(() => {
      const el = container.querySelector<HTMLElement>('.agent-chat-row-open');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(row.tagName).toBe('BUTTON');

    // A button's own activation — click() is what Enter and Space fire.
    row.click();
    await vi.waitFor(() => expect(follow).toHaveBeenCalledWith({ id: 'c1' }, expect.any(Function)));
  });
});
