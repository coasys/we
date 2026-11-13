/*
 * The send path's three small leaks: Enter and Send landing together creating two conversations,
 * a failed first send losing the question outright, and a space switch mid-create subscribing a
 * listener nobody is left to dispose.
 */
import { cleanup, render } from '@solidjs/testing-library';
import type { AgentConversationMessage, AgentConversationsPort } from '@we/backend-shared';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentChat from '../src/frameworks/solid/components/chat/AgentChat';
import {
  type ChatInputs,
  type ChatStore,
  ChatStoreProvider,
  useChatStore,
} from '../src/frameworks/solid/stores/ChatStore';

const conversations = {
  create: vi.fn(async () => ({ id: 's1' })),
  list: vi.fn(async () => []),
  send: vi.fn(async () => 'r1'),
  cancel: vi.fn(async () => true),
  delete: vi.fn(async () => {}),
  messages: vi.fn(async () => []),
  follow: vi.fn((_ref: unknown, _cb: (next: AgentConversationMessage[]) => void) => () => {}),
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

const input = (container: HTMLElement) => container.querySelector('we-input')!;

function type(container: HTMLElement, text: string) {
  input(container).dispatchEvent(new CustomEvent('input', { detail: text }));
}

function enter(container: HTMLElement) {
  input(container).dispatchEvent(new CustomEvent('keydown', { detail: { key: 'Enter' } }));
}

const sendButton = (container: HTMLElement) =>
  container.querySelector('we-icon[name="paper-plane-tilt"]')!.closest('we-button')! as HTMLElement;

const openPanel = vi.fn((_panel: string, _inputs?: unknown, _options?: unknown) => '');
vi.mock('../src/frameworks/solid/stores/ShellStore', () => ({
  useShellStore: () => ({ openPanel }),
}));

/**
 * Mount the chat as it would have been opened — `openChat` holds the question, the nonce it
 * issued is all the inputs carry. One provider, so the store that issued it is the one spent.
 */
function openedChat(draft: string) {
  const [inputs, setInputs] = createSignal<ChatInputs>({});
  let store!: ChatStore;
  const result = render(() => (
    <ChatStoreProvider>
      {(() => {
        store = useChatStore();
        return null;
      })()}
      <Show when={inputs().nonce}>
        <AgentChat inputs={inputs()} />
      </Show>
    </ChatStoreProvider>
  ));
  store.openChat({ draft });
  setInputs(openPanel.mock.calls.at(-1)![1] as ChatInputs);
  return result;
}

describe('the send path', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);

  it('creates and sends once when Enter and Send land inside the same tick', async () => {
    // A pending create is what a second press used to slip past — the guard is the send itself.
    let resolveCreate!: (ref: { id: string }) => void;
    conversations.create.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveCreate = done;
        }),
    );
    const { container } = render(() => (
      <ChatStoreProvider>
        <AgentChat inputs={{}} />
      </ChatStoreProvider>
    ));

    type(container, 'the question');
    enter(container);
    sendButton(container).click();
    enter(container);
    resolveCreate({ id: 's1' });

    await vi.waitFor(() => expect(conversations.send).toHaveBeenCalledTimes(1));
    expect(conversations.create).toHaveBeenCalledTimes(1);
    expect(conversations.send).toHaveBeenCalledWith({ id: 's1' }, 'the question');
  });

  it('keeps the question in the composer when the create landed but the send failed', async () => {
    conversations.send.mockRejectedValueOnce(new Error('endpoint down'));
    const { container } = openedChat('keep me');
    await vi.waitFor(() => expect(conversations.send).toHaveBeenCalledTimes(1));

    // The composer still holds it, and Enter sends the same words again — never silently gone.
    enter(container);
    await vi.waitFor(() => expect(conversations.send).toHaveBeenCalledTimes(2));
    expect(conversations.send).toHaveBeenNthCalledWith(2, { id: 's1' }, 'keep me');
  });

  it('keeps the typed question too when creating the conversation fails', async () => {
    conversations.create.mockRejectedValueOnce(new Error('executor offline'));
    const { container } = render(() => (
      <ChatStoreProvider>
        <AgentChat inputs={{}} />
      </ChatStoreProvider>
    ));

    type(container, 'still here');
    enter(container);
    // Let the failed ask settle — its catch puts the words back and clears the in-flight guard.
    await vi.waitFor(() => expect(conversations.create).toHaveBeenCalledTimes(1));
    await new Promise((done) => setTimeout(done));

    // Nothing was created the first time, but the words stayed — Enter retries the whole ask,
    // and the second create lands the same question on the new session.
    enter(container);
    await vi.waitFor(() => expect(conversations.create).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(conversations.send).toHaveBeenCalledWith({ id: 's1' }, 'still here'));
  });

  it('subscribes no listener when the chat closed before the create answered', async () => {
    // A space switch hides the panel mid-create; the late answer must not wire a follow into a
    // component that is gone — the leak the finding named.
    let resolveCreate!: (ref: { id: string }) => void;
    conversations.create.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveCreate = done;
        }),
    );
    const { unmount } = openedChat('too late');
    await vi.waitFor(() => expect(conversations.create).toHaveBeenCalled());

    unmount();
    resolveCreate({ id: 's1' });
    await new Promise((done) => setTimeout(done));

    expect(conversations.follow).not.toHaveBeenCalled();
    expect(conversations.send).not.toHaveBeenCalled();
  });
});
