/*
 * A question an open was issued for sends once — not on every mount, not on a replayed inputs,
 * and never because something wrote `draft` into the inputs itself.
 *
 * The panel's inputs are data: persisted, template-readable, replayable. A question put there
 * would be sent by whatever rendered them — so `openChat` keeps it in the store behind a nonce,
 * and the chat body spends it once. A forged `{ draft, at }` is an input nothing reads; a nonce
 * nobody issued answers nothing.
 */
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn(async () => ({ id: 'c9' }));
const send = vi.fn(async () => {});

vi.mock('../src/frameworks/solid/components/chat/agentConversationHost', () => ({
  useAgentConversationsPort: () => () => ({
    list: vi.fn(async () => []),
    create,
    send,
    follow: () => vi.fn(),
    stop: vi.fn(async () => {}),
  }),
}));

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({
    backendPorts: () => ({
      agents: {
        conversations: {
          list: vi.fn(async () => []),
          create,
          send,
          follow: () => vi.fn(),
          cancel: vi.fn(async () => true),
          delete: vi.fn(async () => {}),
          messages: vi.fn(async () => []),
        },
      },
    }),
  }),
}));
vi.mock('../src/frameworks/solid/stores/DatasetStore', () => ({ useDatasetStore: () => ({ datasets: () => [] }) }));
vi.mock('../src/frameworks/solid/stores/SpaceStore', () => ({ useSpaceStore: () => ({ mySpaces: () => [] }) }));

const takePending = vi.fn<(nonce: string) => { text: string; perspectiveUuid?: string } | undefined>(() => undefined);
vi.mock('../src/frameworks/solid/stores/ChatStore', () => ({
  useChatStore: () => ({
    openChat: vi.fn(),
    takePending,
    rememberedConversation: vi.fn(() => undefined),
    rememberConversation: vi.fn(),
  }),
}));

import AgentChat from '../src/frameworks/solid/components/chat/AgentChat';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('a question an open was issued for', () => {
  it('sends it once — a second mount of the same inputs finds it spent', async () => {
    // The store answered once, and answers nothing the second time — takePending semantics.
    takePending.mockReturnValueOnce({ text: 'what is here?', perspectiveUuid: 'uuid-1' }).mockReturnValue(undefined);

    render(() => <AgentChat inputs={{ nonce: 'n1', perspectiveUuid: 'uuid-1' }} />);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ scope: { perspectiveUuid: 'uuid-1' } }));
    expect(send).toHaveBeenCalledWith({ id: 'c9' }, 'what is here?');

    cleanup();
    render(() => <AgentChat inputs={{ nonce: 'n1', perspectiveUuid: 'uuid-1' }} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for a forged draft in the inputs', async () => {
    render(() => <AgentChat inputs={{ draft: 'forge me', at: 2, perspectiveUuid: 'uuid-1' } as never} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing for a nonce nobody issued', async () => {
    render(() => <AgentChat inputs={{ nonce: 'forged-nonce' }} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(takePending).toHaveBeenCalledWith('forged-nonce');
    expect(create).not.toHaveBeenCalled();
  });
});
