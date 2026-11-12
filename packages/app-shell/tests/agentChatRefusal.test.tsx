/*
 * The refusal card: a plain sentence about the boundary, the raw executor error folded under
 * Details — not the other way around.
 */
import { cleanup, render } from '@solidjs/testing-library';
import type { AgentConversationMessage, AgentConversationsPort } from '@we/backend-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentChat from '../src/frameworks/solid/components/chat/AgentChat';
import { ChatStoreProvider } from '../src/frameworks/solid/stores/ChatStore';

let followed: ((next: AgentConversationMessage[]) => void) | undefined;

const conversations = {
  create: vi.fn(async () => ({ id: 's1' })),
  list: vi.fn(async () => []),
  send: vi.fn(async () => 'r1'),
  cancel: vi.fn(async () => true),
  delete: vi.fn(async () => {}),
  messages: vi.fn(async () => []),
  follow: vi.fn((_ref: unknown, cb: (next: AgentConversationMessage[]) => void) => {
    followed = cb;
    return () => {};
  }),
};

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({
    backendPorts: () => ({ agents: { conversations: conversations as unknown as AgentConversationsPort } }),
  }),
}));
vi.mock('../src/frameworks/solid/stores/SpaceStore', () => ({
  useSpaceStore: () => ({ mySpaces: () => [{ uuid: 'uuid-9', name: 'Garden club' }] }),
}));
vi.mock('../src/frameworks/solid/stores/ShellStore', () => ({
  useShellStore: () => ({ openPanel: () => '' }),
}));

describe('the refusal card', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    followed = undefined;
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);

  it('says the boundary in plain words and keeps the raw error under Details', async () => {
    const { container } = render(() => (
      <ChatStoreProvider>
        <AgentChat
          inputs={{ draft: 'write to the other space', at: 1, perspectiveUuid: 'uuid-9', spaceName: 'Garden club' }}
        />
      </ChatStoreProvider>
    ));
    await vi.waitFor(() => expect(followed).toBeDefined());

    followed!([
      { id: 'u1', role: 'user', text: 'write to the other space', createdAt: 0 },
      {
        id: 'a1',
        role: 'assistant',
        text: '',
        createdAt: 1,
        status: 'done',
        steps: [
          {
            tool: 'note_create',
            outcome: 'error',
            refused: true,
            error: 'Capability is not matched: capability domain perspective pointer uuid-other is not covered',
          },
        ],
      },
    ]);

    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        'This chat can only use Garden club. It was refused access to another space.',
      );
    });
    expect(container.textContent).toContain('Ask in the global chat');
    // The executor's error is still there — folded, not gone.
    const details = container.querySelector('details');
    expect(details?.textContent).toContain('Capability is not matched: capability domain perspective');
  });
});
