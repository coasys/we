/*
 * The opening draft is spent once — the store, not the component, says so.
 *
 * A panel instance's inputs are what the open asked for, and they persist: reload the app and the
 * chat comes back holding `{ draft, at }`. A component-local guard (`lastDraftAt`) forgets that
 * the draft already ran every time the body remounts — and a remount is unremarkable (the dock
 * hides the window, the app reloads, the lane reflows). These mounts are two whole provider
 * trees, the shape a reload takes: the consumed stamp lives in the store's localStorage, so it
 * survives both.
 */
import { cleanup, render } from '@solidjs/testing-library';
import type { AgentConversationsPort } from '@we/backend-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentChat from '../src/frameworks/solid/components/chat/AgentChat';
import { ChatStoreProvider } from '../src/frameworks/solid/stores/ChatStore';

const conversations = {
  create: vi.fn(async () => ({ id: 's1' })),
  list: vi.fn(async () => []),
  send: vi.fn(async () => 'r1'),
  cancel: vi.fn(async () => true),
  delete: vi.fn(async () => {}),
  messages: vi.fn(async () => []),
  follow: vi.fn(() => () => {}),
};

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({
    backendPorts: () => ({ agents: { conversations: conversations as unknown as AgentConversationsPort } }),
  }),
}));
vi.mock('../src/frameworks/solid/stores/SpaceStore', () => ({
  useSpaceStore: () => ({ mySpaces: () => [] }),
}));
vi.mock('../src/frameworks/solid/stores/ShellStore', () => ({
  useShellStore: () => ({ openPanel: () => '' }),
}));

const mount = (at: number) =>
  render(() => (
    <ChatStoreProvider>
      <AgentChat inputs={{ draft: 'what is here?', at }} />
    </ChatStoreProvider>
  ));

describe('an opening draft, once spent', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('is not asked again by a remount that reads the same inputs', async () => {
    mount(1);
    await vi.waitFor(() => expect(conversations.create).toHaveBeenCalledTimes(1));

    cleanup();
    mount(1);
    // The second mount did run — its refresh reached the port — and still asked nothing.
    await vi.waitFor(() => expect(conversations.list).toHaveBeenCalledTimes(2));
    expect(conversations.create).toHaveBeenCalledTimes(1);
    expect(conversations.send).toHaveBeenCalledTimes(1);
  });

  it('still asks a fresh draft whose `at` moved on', async () => {
    mount(1);
    await vi.waitFor(() => expect(conversations.create).toHaveBeenCalledTimes(1));

    cleanup();
    mount(2);
    await vi.waitFor(() => expect(conversations.create).toHaveBeenCalledTimes(2));
  });
});
