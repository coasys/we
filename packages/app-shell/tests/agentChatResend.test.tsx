/*
 * The send path's finer edges (findings 11, 12, 13, 14, 16):
 * "Send again" resends the question of the reply it sits under — not the window's last — through
 * the same send-in-flight guard and the same error line; Enter does nothing while a reply runs or
 * inside an IME composition; a failed send puts the words back; a refresh that lands clears the
 * error a failed one left; and a space's chat comes back to the conversation it had, not the list.
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

let followed: ((next: AgentConversationMessage[]) => void) | undefined;
const [listAnswer, setListAnswer] = createSignal<Promise<unknown[]>>(Promise.resolve([]));
// Bumped to make the port accessor change — `refresh` follows the port, so this re-runs it.
const [convsVersion, setConvsVersion] = createSignal(0);

const conversations = {
  create: vi.fn(async () => ({ id: 's1' })),
  list: vi.fn(() => listAnswer()),
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
    backendPorts: () => (
      convsVersion(),
      { agents: { conversations: conversations as unknown as AgentConversationsPort } }
    ),
  }),
}));
vi.mock('../src/frameworks/solid/stores/DatasetStore', () => ({ useDatasetStore: () => ({ datasets: () => [] }) }));
vi.mock('../src/frameworks/solid/stores/SpaceStore', () => ({ useSpaceStore: () => ({ mySpaces: () => [] }) }));

const mockOpenPanel = vi.fn(() => '');
vi.mock('../src/frameworks/solid/stores/ShellStore', () => ({
  useShellStore: () => ({ openPanel: mockOpenPanel }),
}));

const msg = (partial: Partial<AgentConversationMessage>): AgentConversationMessage => ({
  id: 'm',
  role: 'user',
  text: '',
  createdAt: 0,
  ...partial,
});

const input = (container: HTMLElement) => container.querySelector('we-input')! as HTMLElement & { value: string };
const type = (container: HTMLElement, text: string) =>
  input(container).dispatchEvent(new CustomEvent('input', { detail: text }));
const enter = (container: HTMLElement, isComposing = false) =>
  input(container).dispatchEvent(new CustomEvent('keydown', { detail: { key: 'Enter', isComposing } }));

/** The chat mounted over the real store, a conversation open in it. */
async function openConversation(inputs: ChatInputs = { perspectiveUuid: 'uuid-9' }) {
  const { container } = render(() => (
    <ChatStoreProvider>
      <AgentChat inputs={inputs} />
    </ChatStoreProvider>
  ));
  await vi.waitFor(() => expect(container.querySelector('.agent-chat-row-open')).not.toBeNull());
  (container.querySelector('.agent-chat-row-open') as HTMLElement).click();
  await vi.waitFor(() => expect(followed).toBeDefined());
  return { container };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  followed = undefined;
  setListAnswer(Promise.resolve([{ ref: { id: 'c1' }, title: 'First chat', createdAt: 1, updatedAt: 2 }]));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('Send again under a failed reply', () => {
  it('resends the question of the reply it sits under — not the window’s last', async () => {
    const { container } = await openConversation();
    followed!([
      msg({ id: 'u1', role: 'user', text: 'the first question' }),
      msg({ id: 'a1', role: 'assistant', status: 'failed', error: 'model exploded' }),
      msg({ id: 'u2', role: 'user', text: 'the later question' }),
      msg({ id: 'a2', role: 'assistant', status: 'done', text: 'answered' }),
      msg({ id: 'u3', role: 'user', text: 'the third question' }),
      msg({ id: 'a3', role: 'assistant', status: 'failed', error: 'model exploded again' }),
    ]);

    const buttons = await vi.waitFor(() => {
      const found = [...container.querySelectorAll('we-button')].filter((el) => el.textContent === 'Send again');
      expect(found).toHaveLength(2);
      return found;
    });
    (buttons[0] as HTMLElement).click();
    await vi.waitFor(() => expect(conversations.send).toHaveBeenCalledWith({ id: 'c1' }, 'the first question'));
    (buttons[1] as HTMLElement).click();
    await vi.waitFor(() => expect(conversations.send).toHaveBeenCalledWith({ id: 'c1' }, 'the third question'));
  });

  it('reports a resend that fails on the send line, and does not fire twice', async () => {
    const { container } = await openConversation();
    followed!([
      msg({ id: 'u1', role: 'user', text: 'ask again' }),
      msg({ id: 'a1', role: 'assistant', status: 'failed', error: 'x' }),
    ]);
    conversations.send.mockImplementationOnce(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('endpoint down')), 20)),
    );
    await vi.waitFor(() => expect(container.textContent).toContain('Send again'));
    const again = [...container.querySelectorAll('we-button')].find((el) => el.textContent === 'Send again')!;
    (again as HTMLElement).click();
    (again as HTMLElement).click(); // the second lands inside the first's flight — the guard says no
    await vi.waitFor(() => expect(container.textContent).toContain('endpoint down'));
    expect(conversations.send).toHaveBeenCalledTimes(1);
  });
});

describe('Enter at the composer', () => {
  it('does nothing while a reply runs, nor inside an IME composition', async () => {
    const { container } = await openConversation();
    followed!([
      msg({ id: 'u1', role: 'user', text: 'working on it' }),
      msg({ id: 'a1', role: 'assistant', status: 'running' }),
    ]);
    await vi.waitFor(() => expect(container.textContent).toContain('Working'));

    type(container, 'another');
    enter(container);
    await new Promise((r) => setTimeout(r, 30));
    expect(conversations.send).not.toHaveBeenCalled();

    // The reply settles — Enter works again. An Enter still composing never was a send.
    followed!([msg({ id: 'a1', role: 'assistant', status: 'done', text: 'done' })]);
    await new Promise((r) => setTimeout(r));
    enter(container, true);
    await new Promise((r) => setTimeout(r, 30));
    expect(conversations.send).not.toHaveBeenCalled();

    enter(container);
    await vi.waitFor(() => expect(conversations.send).toHaveBeenCalledWith({ id: 'c1' }, 'another'));
  });
});

describe('the words are never thrown away', () => {
  it('leaves the field before the send, and comes back on a failure', async () => {
    const { container } = await openConversation();
    let rejectSend!: (e: Error) => void;
    conversations.send.mockImplementationOnce(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectSend = reject;
        }),
    );

    type(container, 'in flight');
    enter(container);
    // While the send is still answering, the words are gone — they went with it.
    await vi.waitFor(() => expect(conversations.send).toHaveBeenCalled());
    expect(input(container).value).toBe('');

    rejectSend(new Error('endpoint down'));
    await vi.waitFor(() => expect(input(container).value).toBe('in flight'));
  });
});

describe('a refresh that lands', () => {
  it('clears the error a failed one left', async () => {
    setListAnswer(Promise.reject(new Error('executor offline')));
    const { container } = render(() => (
      <ChatStoreProvider>
        <AgentChat inputs={{}} />
      </ChatStoreProvider>
    ));
    await vi.waitFor(() => expect(container.textContent).toContain('executor offline'));

    // A list that answers clears the line in the same mounted chat.
    setListAnswer(Promise.resolve([{ ref: { id: 'c1' }, title: 'First chat', createdAt: 1, updatedAt: 2 }]));
    setConvsVersion((v) => v + 1);
    await vi.waitFor(() => expect(container.textContent).not.toContain('executor offline'));
  });
});

describe('a space switch and back', () => {
  it('comes back to the conversation the chat had open, not the list', async () => {
    const [mounted, setMounted] = createSignal(true);
    let store!: ChatStore;
    render(() => (
      <ChatStoreProvider>
        {(() => {
          store = useChatStore();
          return null;
        })()}
        <Show when={mounted()}>
          <AgentChat inputs={{ perspectiveUuid: 'uuid-9' }} />
        </Show>
      </ChatStoreProvider>
    ));
    const container = document.body;

    // Open the conversation, then leave the space — the window hides with it.
    await vi.waitFor(() => expect(container.querySelector('.agent-chat-row-open')).not.toBeNull());
    (container.querySelector('.agent-chat-row-open') as HTMLElement).click();
    await vi.waitFor(() => expect(followed).toBeDefined());
    setMounted(false);

    // Back in the space: the window mounts fresh and the remembered conversation is what opens.
    followed = undefined;
    setMounted(true);
    await vi.waitFor(() => expect(followed).toBeDefined());
    expect(conversations.follow).toHaveBeenLastCalledWith({ id: 'c1' }, expect.any(Function));
    expect(container.querySelector('.agent-chat-row-open')).toBeNull();
    expect(store.rememberedConversation('uuid-9')?.ref.id).toBe('c1');
  });
});
