/*
 * The refusal card: a plain sentence about the boundary, the raw executor error folded under
 * Details — not the other way around.
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
vi.mock('../src/frameworks/solid/stores/DatasetStore', () => ({
  // The joined-space shape: the member's local perspective id `uuid-9`, the shared address its
  // Space record answers under — `isSpaceSelf` pairs the two.
  useDatasetStore: () => ({ datasets: () => [{ id: 'uuid-9', sharedId: 'we://garden' }] }),
}));
vi.mock('../src/frameworks/solid/stores/SpaceStore', () => ({
  useSpaceStore: () => ({ mySpaces: () => [{ uuid: 'creator-uuid', url: 'we://garden', name: 'Garden club' }] }),
}));
const mockOpenPanel = vi.fn((_panel: string, _inputs?: unknown, _options?: unknown) => '');
vi.mock('../src/frameworks/solid/stores/ShellStore', () => ({
  useShellStore: () => ({ openPanel: mockOpenPanel }),
}));

/** Mount the chat as `openChat` opened it — the nonce, not the question, in the inputs. */
function openedChat(open: Parameters<ChatStore['openChat']>[0]) {
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
  store.openChat(open);
  setInputs(mockOpenPanel.mock.calls.at(-1)![1] as ChatInputs);
  return result;
}

describe('the refusal card', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    followed = undefined;
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);

  it('says the boundary in plain words and keeps the raw error under Details', async () => {
    const { container } = openedChat({
      draft: 'write to the other space',
      perspectiveUuid: 'uuid-9',
      spaceName: 'Garden club',
    });
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
            error:
              'Capability is not matched: capability domain perspective pointer aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee is not covered',
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

  it('puts the marker and the label in the one summary line', async () => {
    const { container } = openedChat({
      draft: 'write to the other space',
      perspectiveUuid: 'uuid-9',
      spaceName: 'Garden club',
    });
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
            error:
              'Capability is not matched: capability domain perspective pointer aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee is not covered',
          },
        ],
      },
    ]);

    /*
      The native disclosure marker drew on a line of its own above "Details" — a list bullet beside
      a block element. One summary element holds both now: the marker glyph and the label, laid out
      as a flex row so the platform's own marker never renders.
    */
    const summary = await vi.waitFor(() => {
      const el = container.querySelector<HTMLElement>('details.agent-chat-refusal-detail summary');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(summary.style.display).toBe('flex');
    expect(summary.querySelector('.agent-chat-refusal-marker')?.textContent).toBe('▶');
    expect(summary.textContent).toContain('Details');
  });

  it('words it for the account, not a space, in the global chat — and offers no way "out"', async () => {
    const { container } = openedChat({ draft: 'reach for that' });
    await vi.waitFor(() => expect(followed).toBeDefined());

    followed!([
      { id: 'u1', role: 'user', text: 'reach for that', createdAt: 0 },
      {
        id: 'a1',
        role: 'assistant',
        text: '',
        createdAt: 1,
        status: 'done',
        steps: [{ tool: 'agent_status', outcome: 'error', refused: true, error: 'Capability is not matched: agent' }],
      },
    ]);

    // A global chat has no space boundary — the refusal says the account may not reach it, and
    // there is no "ask globally" to offer from inside the global chat itself.
    await vi.waitFor(() => {
      expect(container.textContent).toContain('refused access — it reached for something this account may not use');
    });
    expect(container.textContent).not.toContain('Ask in the global chat');
    expect(container.textContent).not.toContain('this space');
  });

  it('says a refused reply in the plain words — the raw error folds, it is not the sentence', async () => {
    const { container } = openedChat({ draft: 'reach for that' });
    await vi.waitFor(() => expect(followed).toBeDefined());

    followed!([
      { id: 'u1', role: 'user', text: 'reach for that', createdAt: 0 },
      {
        id: 'a1',
        role: 'assistant',
        text: '',
        createdAt: 1,
        status: 'failed',
        refused: true,
        error: 'Capability is not matched: agent',
        steps: [],
      },
    ]);

    const reply = await vi.waitFor(() => {
      const el = container.querySelector('[data-testid="agent-chat-reply"]');
      expect(el).not.toBeNull();
      return el!;
    });
    // The line says what happened; "Capability is not matched" is not part of it.
    const line = [...reply.querySelectorAll('we-text')].find((el) => el.textContent?.includes('The reply failed'));
    expect(line).toBeDefined();
    expect(line!.textContent).not.toContain('Capability is not matched');
    // The diagnostic survives — folded under Details, as the card already folds it.
    expect(reply.querySelector('details')?.textContent).toContain('Capability is not matched: agent');
  });

  it('reads a global conversation inside a space panel as global — the card agrees with the badge', async () => {
    // A space chat's list shows every conversation the node keeps — the global one among them.
    conversations.list.mockResolvedValueOnce([
      { ref: { id: 'g1' }, title: 'Global chat', createdAt: 0, updatedAt: 0 },
    ] as never);
    const { container } = render(() => (
      <ChatStoreProvider>
        <AgentChat inputs={{ perspectiveUuid: 'uuid-9', spaceName: 'Garden club' }} />
      </ChatStoreProvider>
    ));

    const rowEl = await vi.waitFor(() => {
      const el = container.querySelector<HTMLElement>('.agent-chat-row-open');
      expect(el).not.toBeNull();
      return el!;
    });
    rowEl.click();
    await vi.waitFor(() => expect(followed).toBeDefined());

    followed!([
      { id: 'u1', role: 'user', text: 'reach for that', createdAt: 0 },
      {
        id: 'a1',
        role: 'assistant',
        text: '',
        createdAt: 1,
        status: 'done',
        steps: [{ tool: 'agent_status', outcome: 'error', refused: true, error: 'Capability is not matched: agent' }],
      },
    ]);

    /*
      The badge already reads the open conversation's scope — globe, "All your spaces". Read off
      the panel's scope instead, the refusal answered "not outside this space" and showed nothing
      at all: the conversation is global, so its boundary is the account's, and the card says so.
    */
    await vi.waitFor(() => {
      expect(container.textContent).toContain('All your spaces');
      expect(container.textContent).toContain('refused access — it reached for something this account may not use');
    });
    expect(container.textContent).not.toContain('This chat can only use Garden club');
    expect(container.textContent).not.toContain('Ask in the global chat');
  });
});
