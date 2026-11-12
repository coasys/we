/**
 * The AI chat — one body behind the global panel, the space's floating window and the phone's
 * sheet. It runs on the conversations the executor keeps (`agents.conversations`): the list of
 * every session the node holds, and inside one, its turns with the steps each reply made, live.
 *
 * What it is opened with arrives as `inputs` — the panel instance's for a declared panel, the
 * sheet's on a phone:
 * - `perspectiveUuid` + `spaceName`: the space chat, scoped to that one perspective. Its badge
 *   says "this space only" and a switch offers the global chat.
 * - `draft` + `at`: a question waiting — the chat opens a fresh conversation and sends it, once
 *   per `at`, so the same words asked twice still ask twice.
 *
 * No streaming: a reply lands whole when its row settles. While it runs the steps show live and a
 * Stop button stands in for send.
 */
import {
  type AgentConversationMessage,
  type AgentConversationRef,
  type AgentConversationSummary,
  AgentUnavailableError,
} from '@we/backend-shared';
import { AgentSteps, Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

import { useChatStore } from '../../stores/ChatStore';
import { useSessionStore } from '../../stores/SessionStore';
import { useSpaceStore } from '../../stores/SpaceStore';
import { lastAsk, refusalOf, replyRunning, unfinishedWords } from './chatState';

/** What an open chat was asked for — `panel.inputs` on desktop, the sheet's on a phone. */
export interface AgentChatInputs {
  perspectiveUuid?: string;
  spaceName?: string;
  draft?: string;
  at?: number;
}

/** "2m ago" for the list — a chat is read as recent or not, not as a timestamp. */
function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function AgentChat(props: { inputs?: AgentChatInputs }) {
  const session = useSessionStore();
  const spaceStore = useSpaceStore();
  const chat = useChatStore();

  const port = () => session.backendPorts()?.agents?.conversations;

  const [unavailable, setUnavailable] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [summaries, setSummaries] = createSignal<AgentConversationSummary[]>([]);
  const [active, setActive] = createSignal<{ ref: AgentConversationRef; title: string; scope?: string } | null>(null);
  const [messages, setMessages] = createSignal<AgentConversationMessage[]>([]);
  const [draft, setDraft] = createSignal('');
  const [sendFailed, setSendFailed] = createSignal<string | null>(null);
  let stopFollow: (() => void) | undefined;
  let lastDraftAt: number | undefined;
  let messagesEnd: HTMLDivElement | undefined;

  const spaceChat = () => props.inputs?.perspectiveUuid;

  /** The space a perspective uuid names, where this device holds it — for badges and step names. */
  const spaceName = (uuid: string): string =>
    spaceStore.mySpaces().find((s) => s.uuid === uuid)?.name ?? props.inputs?.spaceName ?? '';

  /** A step's target, named for the reader: the space it went into where we know it. */
  const nameTarget = (target?: string): string | undefined =>
    target && spaceStore.mySpaces().find((s) => s.uuid === target)?.name;

  async function refresh() {
    const conversations = port();
    if (!conversations) return;
    try {
      setSummaries(await conversations.list());
      setUnavailable(null);
    } catch (cause) {
      if (cause instanceof AgentUnavailableError) setUnavailable(cause.message);
      else setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  /** Follow the open conversation — `follow` re-reads and pushes every change until unsubscribed. */
  function follow(ref: AgentConversationRef) {
    stopFollow?.();
    stopFollow = port()?.follow(ref, (next) => {
      setMessages(next);
      requestAnimationFrame(() => messagesEnd?.scrollIntoView());
    });
  }

  function openConversation(summary: AgentConversationSummary) {
    setActive({ ref: summary.ref, title: summary.title, scope: summary.scope?.perspectiveUuid });
    setMessages([]);
    setSendFailed(null);
    follow(summary.ref);
  }

  function back() {
    stopFollow?.();
    stopFollow = undefined;
    setActive(null);
    void refresh();
  }

  onCleanup(() => stopFollow?.());

  /** A fresh conversation for `text` — scoped to `uuid`, or global when `uuid` is absent. */
  async function ask(text: string, uuid?: string) {
    const conversations = port();
    if (!conversations || !text.trim()) return;
    setError(null);
    setSendFailed(null);
    try {
      const ref = await conversations.create({
        title: text.trim().slice(0, 60),
        ...(uuid ? { scope: { perspectiveUuid: uuid } } : {}),
      });
      setActive({ ref, title: text.trim().slice(0, 60), scope: uuid });
      setMessages([]);
      follow(ref);
      await conversations.send(ref, text.trim());
    } catch (cause) {
      if (cause instanceof AgentUnavailableError) setUnavailable(cause.message);
      else setSendFailed(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function send() {
    const text = draft().trim();
    const current = active();
    if (!text) return;
    if (!current) {
      await ask(text, spaceChat());
      return;
    }
    setSendFailed(null);
    try {
      await port()?.send(current.ref, text);
    } catch (cause) {
      setSendFailed(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    setDraft('');
  }

  async function remove(ref: AgentConversationRef) {
    try {
      await port()?.delete(ref);
      setSummaries((rows) => rows.filter((row) => row.ref.id !== ref.id));
      if (active()?.ref.id === ref.id) back();
    } catch {
      /* a row that would not go stays in the list, which is the honest answer */
    }
  }

  /** A draft the open carried is asked once per `at`: a fresh conversation, then the question. */
  createEffect(() => {
    const { draft: question, at, perspectiveUuid } = props.inputs ?? {};
    if (!question || at === lastDraftAt) return;
    lastDraftAt = at;
    void ask(question, perspectiveUuid);
  });

  createEffect(() => {
    port();
    void refresh();
  });

  /** The reply currently working — its row decides Stop vs send, never a guess. */
  const running = createMemo(() => replyRunning(messages()));

  /** The text the last turn asked with — what "Ask in the global chat" and "Send again" resend. */
  const lastAskText = createMemo(() => lastAsk(messages()));

  /** A refusal the last reply ended on — the boundary the scoped chat's reach stops at. */
  const refusal = createMemo(() => refusalOf(messages()));

  const scopeBadge = (uuid?: string) => (
    <Row ay="center" gap="100" class="agent-chat-scope" flexShrink="0">
      <we-icon name={uuid ? 'lock' : 'globe'} size="xs" color={uuid ? 'accent-text' : 'text-muted'} />
      <we-text variant="footnote" color={uuid ? 'accent-text' : 'text-muted'}>
        {uuid ? `this space only${spaceName(uuid) ? ` · ${spaceName(uuid)}` : ''}` : 'All your spaces'}
      </we-text>
    </Row>
  );

  return (
    <Column width="100%" height="100%" bg="surface" data-testid="agent-chat">
      {/* Header */}
      <Row ax="between" ay="center" gap="200" px="300" py="200" flexShrink="0">
        <Row ay="center" gap="200" minWidth="0">
          <Show when={active()}>
            <we-button variant="bare" size="sm" onClick={back} aria-label="All chats">
              <we-icon name="list" size="sm" />
            </we-button>
          </Show>
          <we-text fontSize="300" fontWeight="600" truncate>
            {active()?.title ?? 'New chat'}
          </we-text>
          {scopeBadge(active() ? active()!.scope : spaceChat())}
        </Row>
        <Show when={active()}>
          <we-button variant="bare" size="sm" aria-label="New chat" onClick={back}>
            <we-icon name="plus" size="sm" />
          </we-button>
        </Show>
      </Row>

      <Show when={unavailable()}>
        <Column gap="200" p="400" flexShrink="0">
          <we-text fontSize="300" fontWeight="600">
            No AI sessions
          </we-text>
          <we-text fontSize="200" color="text-muted">
            {unavailable()}
          </we-text>
        </Column>
      </Show>

      <Show when={!unavailable() && !active()}>
        <Column flex="1" minHeight="0" overflowY="auto" p="300" gap="200">
          {/* The list: every conversation, newest first; a scoped one wears its lock and space. */}
          <For each={summaries()}>
            {(summary) => (
              <Row
                ay="center"
                gap="200"
                p="200"
                r="300"
                class="agent-chat-row"
                styles={{ cursor: 'pointer' }}
                onClick={() => openConversation(summary)}
              >
                <Column gap="100" flex="1" minWidth="0">
                  <we-text fontSize="200" truncate>
                    {summary.title || 'Chat'}
                  </we-text>
                  <Row ay="center" gap="100">
                    <Show when={summary.scope?.perspectiveUuid}>
                      <we-icon name="lock" size="xxs" color="accent-text" />
                    </Show>
                    <we-text variant="footnote" color="text-faint" truncate>
                      {summary.scope?.perspectiveUuid
                        ? spaceName(summary.scope.perspectiveUuid) || 'A space'
                        : 'Global'}
                      {` · ${ago(summary.updatedAt ?? summary.createdAt)}`}
                    </we-text>
                  </Row>
                </Column>
                <we-button
                  variant="bare"
                  size="xs"
                  aria-label="Delete chat"
                  onClick={(e: Event) => {
                    e.stopPropagation();
                    void remove(summary.ref);
                  }}
                >
                  <we-icon name="trash" size="xs" color="text-faint" />
                </we-button>
              </Row>
            )}
          </For>
          <Show when={!summaries().length}>
            <Column ax="center" ay="center" gap="300" flex="1" p="400">
              <we-icon name="sparkle" size="lg" color="accent-text" />
              <we-text fontSize="400" fontWeight="600" textAlign="center">
                Ask about {spaceChat() ? `the ${spaceName(spaceChat()!)} space` : 'any of your spaces'}
              </we-text>
              <we-text fontSize="200" color="text-muted" textAlign="center">
                {spaceChat()
                  ? 'It acts as you in this space only. You see each step and can stop it.'
                  : 'It acts as you, in all your spaces. You see each step and can stop it.'}
              </we-text>
            </Column>
          </Show>
        </Column>
      </Show>

      <Show when={active()}>
        <Column flex="1" minHeight="0" overflowY="auto" p="300" gap="300">
          <For each={messages()}>
            {(message) => (
              <Column
                data-testid={message.role === 'assistant' ? 'agent-chat-reply' : undefined}
                r="400"
                gap="200"
                p={message.role === 'user' ? '300' : '0'}
                bg={message.role === 'user' ? 'accent-soft' : undefined}
                maxWidth={message.role === 'user' ? '90%' : '100%'}
                alignSelf={message.role === 'user' ? 'flex-end' : 'flex-start'}
              >
                <Show when={message.role === 'assistant' && (message.steps?.length ?? 0) > 0}>
                  <AgentSteps
                    steps={(message.steps ?? []).map((s) => ({ ...s, target: nameTarget(s.target) ?? s.target }))}
                    running={message.status === 'running'}
                  />
                </Show>
                <Show when={message.text}>
                  <we-markdown content={message.text} markdownGap="400" />
                </Show>
                <Show when={message.status && message.status !== 'done' && message.status !== 'running'}>
                  <Row ay="center" gap="200" wrap>
                    <we-text variant="footnote" color={message.status === 'failed' ? 'danger-text' : 'text-muted'}>
                      {message.error
                        ? `${unfinishedWords(message.status!)}: ${message.error}`
                        : unfinishedWords(message.status!)}
                    </we-text>
                    <Show when={lastAskText()}>
                      <we-button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          const current = active();
                          if (current) void port()?.send(current.ref, lastAskText());
                        }}
                      >
                        Send again
                      </we-button>
                    </Show>
                  </Row>
                </Show>
              </Column>
            )}
          </For>
          <Show when={running()}>
            <Row ay="center" gap="200">
              <we-animated-icon name="spinner" size="xs" />
              <we-text variant="footnote" color="text-muted">
                Working…
              </we-text>
            </Row>
          </Show>
          <div ref={messagesEnd} />
        </Column>

        {/* The capability boundary: the real error, and the way to ask with the wider reach. */}
        <Show when={refusal()}>
          <Column
            gap="200"
            p="300"
            m="300"
            r="400"
            bg="warning-soft"
            border={`1px solid ${tokenVar('color', 'warning-border')}`}
            flexShrink="0"
          >
            <we-text fontSize="200" color="warning-text">
              {refusal()}
            </we-text>
            <we-button size="sm" onClick={() => chat.openChat({ draft: lastAskText(), at: Date.now() })}>
              Ask in the global chat
            </we-button>
          </Column>
        </Show>
      </Show>

      <Show when={error()}>
        <we-text fontSize="200" color="danger-text" px="300" pb="200" flexShrink="0">
          {error()}
        </we-text>
      </Show>
      <Show when={sendFailed()}>
        <we-text fontSize="200" color="danger-text" px="300" pb="200" flexShrink="0">
          {sendFailed()}
        </we-text>
      </Show>

      {/* The ask field: send while nothing runs, Stop while a reply does — never both. */}
      <Show when={!unavailable()}>
        <Row px="300" py="300" gap="200" ay="center" flexShrink="0">
          <we-input
            data-testid="agent-chat-input"
            style={{ flex: '1' }}
            value={draft()}
            placeholder={spaceChat() ? `Ask ${spaceName(spaceChat()!) || 'this space'}…` : 'Ask about any space…'}
            on:input={(e: CustomEvent<string>) => setDraft(e.detail)}
            on:keydown={(e: CustomEvent<{ key: string }>) => {
              if (e.detail?.key === 'Enter') void send();
            }}
          />
          <Show
            when={running()}
            fallback={
              <we-button size="sm" onClick={() => void send()} disabled={draft().trim() === ''}>
                <we-icon name="paper-plane-tilt" size="sm" />
              </we-button>
            }
          >
            <we-button
              size="sm"
              variant="soft"
              aria-label="Stop"
              onClick={() => {
                const current = active();
                if (current) void port()?.cancel(current.ref);
              }}
            >
              <we-icon name="stop" size="sm" />
            </we-button>
          </Show>
        </Row>
      </Show>
    </Column>
  );
}

export default AgentChat;
