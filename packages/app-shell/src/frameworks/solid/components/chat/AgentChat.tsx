/**
 * The AI chat — one body behind the global panel, the space's floating window and the phone's
 * sheet. It runs on the conversations the executor keeps (`agents.conversations`): the list of
 * every session the node holds, and inside one, its turns with the steps each reply made, live.
 *
 * What it is opened with arrives as `inputs` — the panel instance's for a declared panel, the
 * sheet's on a phone:
 * - `perspectiveUuid` + `spaceName`: the space chat, scoped to that one perspective. Its badge
 *   says "this space only" and a switch offers the global chat.
 * - `prefill`: words in the composer — what a template's ask fills and a person's Send sends.
 * - `nonce`: the one-time key for a question `openChat` is holding — the chat asks it, once.
 *
 * No question is ever an input: inputs are persisted, template-readable panel state, so a question
 * travels as a nonce against `chatStore`'s own memory instead (see ChatStore). A forged
 * `{ draft, at }` here is just an input nothing reads.
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

import { isSpaceSelf } from '../../../../shared/spaceSync';
import { type ChatInputs, useChatStore } from '../../stores/ChatStore';
import { useDatasetStore } from '../../stores/DatasetStore';
import { useSessionStore } from '../../stores/SessionStore';
import { useSpaceStore } from '../../stores/SpaceStore';
import { lastAsk, refusalOf, refusalSentence, replyRunning, unfinishedWords } from './chatState';

/** What an open chat was asked for — `panel.inputs` on desktop, the sheet's on a phone. */
export type AgentChatInputs = ChatInputs;

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
  const datasetStore = useDatasetStore();
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
  let messagesEnd: HTMLDivElement | undefined;
  /*
    A space switch hides the panel while a `create` is still in flight: the component is disposed
    with the instance, and a `follow` subscribed afterwards would listen forever — nothing left to
    clean it up. `disposed` says what came back too late to be kept.
  */
  let disposed = false;
  let sending = false;

  const spaceChat = () => props.inputs?.perspectiveUuid;

  /*
    A chat's scope is the member's *local* perspective id — for a joined space not the `Space.uuid`
    synced from its creator. Resolving a name goes through the dataset that id is and `isSpaceSelf`,
    the same self-record match the space list uses.
  */
  const spaceForLocalId = (uuid: string) => {
    const ds = datasetStore.datasets().find((d) => d.id === uuid);
    const space = ds ? spaceStore.mySpaces().find((s) => isSpaceSelf(s, ds)) : undefined;
    return { space, ds };
  };

  /** The space a perspective uuid names, where this device holds it — for badges and step names. */
  const spaceName = (uuid: string): string => {
    const { space, ds } = spaceForLocalId(uuid);
    return space?.name || ds?.name || props.inputs?.spaceName || '';
  };

  /** A step's target, named for the reader: the space it went into where we know it. */
  const nameTarget = (target?: string): string | undefined =>
    target ? spaceForLocalId(target).space?.name : undefined;

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

  onCleanup(() => {
    disposed = true;
    stopFollow?.();
  });

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
      // A late answer to a closed chat: the session exists, but nobody is listening — starting one
      // now would leak the subscription, so it is left for the list to find.
      if (disposed) return;
      setActive({ ref, title: text.trim().slice(0, 60), scope: uuid });
      setMessages([]);
      follow(ref);
      await conversations.send(ref, text.trim());
    } catch (cause) {
      if (cause instanceof AgentUnavailableError) setUnavailable(cause.message);
      else {
        setSendFailed(cause instanceof Error ? cause.message : String(cause));
        // A question a send could not deliver stays in the composer, held for another try —
        // including the draft a space asked with, which otherwise disappears with the field.
        if (!disposed) setDraft(text.trim());
      }
    }
  }

  async function send() {
    // Enter and Send can land inside the same tick — one send in flight, never two.
    if (sending) return;
    sending = true;
    try {
      const text = draft().trim();
      const current = active();
      if (!text) return;
      if (!current) {
        await ask(text, spaceChat());
        // A chat that asked took the question; one whose create or send failed keeps it for another
        // try — the words are never thrown away.
        if (active() && !sendFailed()) setDraft('');
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
    } finally {
      sending = false;
    }
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

  /**
   * The composer a template's ask filled — words waiting, never sent. Once on mount: what the
   * person types afterwards is theirs.
   */
  let prefilled = false;
  createEffect(() => {
    if (prefilled || !props.inputs?.prefill) return;
    prefilled = true;
    setDraft(props.inputs.prefill);
  });

  /*
    A question the open was issued for arrives as a nonce, spent once against the store's own
    memory — remounts and replays find it gone, and a nonce nobody issued answers nothing. Its
    scope is the pending entry's, bound when the question was issued, so pairing a stolen nonce
    with other inputs still asks it where it was meant.
  */
  createEffect(() => {
    const inputs = props.inputs ?? {};
    const pending = inputs.nonce ? chat.takePending(inputs.nonce) : undefined;
    if (pending) void ask(pending.text, pending.perspectiveUuid ?? inputs.perspectiveUuid);
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

  /**
   * The perspective the open conversation is pinned to — from the session's own scope once one is
   * open, from what this chat was opened with before. An unscoped session inside the space chat is
   * global, so it must not inherit the space's wording.
   */
  const scopeUuid = () => active()?.scope ?? (active() ? undefined : spaceChat());

  /** Whether the open conversation is pinned to a space — decides the refusal card's words. */
  const scoped = () => !!scopeUuid();

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

        {/* The capability boundary: the plain sentence, the real error folded under Details. */}
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
              {refusalSentence(spaceName(scopeUuid() ?? ''), scoped())}
            </we-text>
            <details class="agent-chat-refusal-detail">
              <summary>
                <we-text variant="footnote" color="text-muted">
                  Details
                </we-text>
              </summary>
              <we-text variant="footnote" color="text-muted">
                {refusal()}
              </we-text>
            </details>
            <Show when={scoped()}>
              <we-button size="sm" onClick={() => chat.openChat({ draft: lastAskText() })}>
                Ask in the global chat
              </we-button>
            </Show>
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
