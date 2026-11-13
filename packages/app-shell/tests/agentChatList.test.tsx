/*
 * A conversation in the list opens from a button — finding 8. Enter, Space and a switch reach a
 * row the way a pointer's click does, because the row is a `<button>` and not a div listening.
 */
import { cleanup, render } from '@solidjs/testing-library';
import type { AgentConversationsPort } from '@we/backend-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({
    backendPorts: () => ({ agents: { conversations: conversations as unknown as AgentConversationsPort } }),
  }),
}));
vi.mock('../src/frameworks/solid/stores/DatasetStore', () => ({ useDatasetStore: () => ({ datasets: () => [] }) }));
vi.mock('../src/frameworks/solid/stores/SpaceStore', () => ({ useSpaceStore: () => ({ mySpaces: () => [] }) }));
vi.mock('../src/frameworks/solid/stores/ChatStore', () => ({
  useChatStore: () => ({
    openChat: vi.fn(),
    takePending: () => undefined,
    rememberedConversation: () => undefined,
    rememberConversation: () => {},
  }),
}));

import AgentChat from '../src/frameworks/solid/components/chat/AgentChat';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the conversation list', () => {
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
