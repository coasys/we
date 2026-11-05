import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import { weProps } from '@we/design-utils/solid';
import { PANEL_TITLE_PROPS } from '@we/schema-kit';
import { createEffect, createSignal, For, Show } from 'solid-js';

import type { EditorAssistantStatus, EditorChatMessage as ChatMessage } from '../host';
import { useEditorHost } from '../host';

export function AiPanel() {
  const session = useEditorHost().session;

  const [inputValue, setInputValue] = createSignal('');
  let messagesEndRef: HTMLDivElement | undefined;

  // Auto-scroll to bottom when messages change or streaming content updates
  createEffect(() => {
    void session.messages().length;
    void session.streamingContent();
    requestAnimationFrame(() => {
      messagesEndRef?.scrollIntoView({ behavior: 'smooth' });
    });
  });

  function handleSend() {
    const text = inputValue().trim();
    if (!text || session.isStreaming() || !session.assistantAvailable()) return;
    void session.sendMessage(text);
    setInputValue('');
  }

  return (
    <Column
      /*
        No background of its own: the dock frame paints the panel's surface.

        Every dock is wrapped in a frame that sets `page`, precisely so a docked panel does
        not have to decide what it is made of — see the note in dockRegistry.ts. The editor's panels
        painted `surface-raised` over the top of it, ten lightness points above the page, so they read
        as a different material from every module panel docked at the same edge.
      */
      width="100%"
      height="100%"
      borderLeft={`1px solid ${tokenVar('color', 'border')}`}
      data-testid="chat-panel"
      onKeyDown={(e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) void session.redo();
          else void session.undo();
        }
      }}
      tabIndex={0}
    >
      {/* Header */}
      <Row ax="between" ay="center" gap="200" px="300" py="300" flexShrink="0">
        <Row ay="center" gap="300" minWidth="0">
          <we-text {...weProps(PANEL_TITLE_PROPS)}>AI Chat</we-text>
          <AssistantStatus />
        </Row>
        <Row ay="center" gap="100" flexShrink="0">
          <we-tooltip content="New chat session">
            <we-button variant="ghost" size="sm" onClick={() => void session.newChat()}>
              <we-icon name="file-plus" size="sm" />
            </we-button>
          </we-tooltip>
        </Row>
      </Row>

      {/*
        No model, no chat — said where the chat would be. The editor used to ask for an Anthropic key
        here; the model is the node's now, configured once in settings for every AI surface.
      */}
      <Show when={!session.assistantAvailable()}>
        <Column gap="200" p="400" bg="surface" borderBottom={`1px solid ${tokenVar('color', 'border')}`} flexShrink="0">
          <we-text fontSize="300" fontWeight="600" color="text">
            No language model
          </we-text>
          <we-text fontSize="200" color="text-muted">
            This node has no language model to talk to. Add one in Settings → AI — a model the node downloads, or a
            remote API such as Anthropic's.
          </we-text>
        </Column>
      </Show>

      {/* Session tabs */}
      <Show when={session.sessions().length > 0}>
        <Row
          ay="center"
          gap="100"
          px="300"
          borderBottom={`1px solid ${tokenVar('color', 'border')}`}
          flexShrink="0"
          overflowX="auto"
        >
          <For each={session.sessions()}>
            {(chat) => {
              const isActive = () => chat.id === session.activeSessionId();
              return (
                <Row
                  ay="center"
                  gap="200"
                  rt="400"
                  px="12px"
                  height="32px"
                  bg={isActive() ? 'surface' : 'surface-sunken'}
                  cursor="pointer"
                  whiteSpace="nowrap"
                  flexShrink="0"
                >
                  <we-text
                    fontSize="300"
                    prop:fontWeight={isActive() ? '600' : '400'}
                    color={isActive() ? 'text' : 'text-muted'}
                    onClick={() => void session.switchSession(chat.id)}
                    cursor="pointer"
                  >
                    {chat.name || 'Chat'}
                  </we-text>
                  <Show when={session.sessions().length > 1}>
                    <we-button
                      variant="ghost"
                      size="xs"
                      onClick={(e: MouseEvent) => {
                        e.stopPropagation();
                        void session.deleteSession(chat.id);
                      }}
                      mr="-8px"
                      square
                    >
                      <we-icon name="x" size="xs" weight="bold" />
                    </we-button>
                  </Show>
                </Row>
              );
            }}
          </For>
        </Row>
      </Show>

      {/* Messages */}
      <Column gap="400" p="400" pr="300" flex="1" overflow="auto">
        <For each={session.messages()}>
          {(msg, index) => (
            <MessageBubble
              message={msg}
              isStreaming={session.isStreaming() && msg.status === 'streaming'}
              streamingContent={msg.status === 'streaming' ? session.streamingContent() : undefined}
              // What the person asked, for "Send again" on a reply that did not finish.
              askedFor={[...session.messages().slice(0, index())].reverse().find((m) => m.role === 'user')?.content}
            />
          )}
        </For>
        <div ref={messagesEndRef} />
      </Column>

      {/* Input area */}
      <Row ay="end" gap="200" p="400" borderTop={`1px solid ${tokenVar('color', 'border')}`} flexShrink="0">
        {/*
          `autoGrow` + `submitOnEnter` rather than a hand-rolled key handler and a guessed
          `maxHeight`. Both were written here first and are now the primitive's, which is also what
          makes the box line up with the button beside it: at rest it takes the control height for
          its size, instead of whatever one row of line-height happens to come to.
        */}
        <we-textarea
          value={inputValue()}
          placeholder="Describe a change to the template..."
          disabled={session.isStreaming() || !session.assistantAvailable()}
          size="sm"
          rows={1}
          autoGrow
          prop:maxRows={6}
          submitOnEnter
          flex="1"
          minWidth="0"
          on:input={(e: CustomEvent<string>) => setInputValue(e.detail)}
          on:submit={handleSend}
        />
        <Show
          when={session.replyRunning()}
          fallback={
            <we-button
              size="sm"
              onClick={handleSend}
              disabled={session.isStreaming() || !session.assistantAvailable() || inputValue().trim() === ''}
            >
              <we-icon name="paper-plane-tilt" size="sm" />
            </we-button>
          }
        >
          <we-tooltip content="Stop the reply. What it has changed stays changed.">
            <we-button size="sm" variant="soft" onClick={() => void session.cancelReply()}>
              <we-icon name="stop" size="sm" />
            </we-button>
          </we-tooltip>
        </Show>
      </Row>
    </Column>
  );
}

const STATUS_COLOR: Record<EditorAssistantStatus['state'], string> = {
  ready: 'success-text',
  loading: 'warning-text',
  error: 'danger-text',
  unchecked: 'text-faint',
  none: 'text-faint',
};

/**
 * Which model is answering, and whether it can — before a message is sent rather than after it
 * fails. A press checks again, which is what somebody does after fixing a key in settings.
 *
 * Nothing for `none`: the notice below the header already says there is no model, in words.
 */
function AssistantStatus() {
  const session = useEditorHost().session;
  const status = () => session.assistantStatus();

  const explanation = () => {
    const current = status();
    if (!current) return '';
    const again = 'Click to check again.';
    switch (current.state) {
      case 'ready':
        return `Ready — ${current.model}. ${again}`;
      case 'loading':
        return `${current.detail || 'Loading'}. ${again}`;
      case 'error':
        return `${current.detail} ${again}`;
      default:
        return `${current.model} — not checked: this app cannot ask the service yet. ${again}`;
    }
  };

  return (
    <Show when={status() && status()!.state !== 'none'}>
      <we-tooltip content={explanation()}>
        <we-button variant="bare" minWidth="0" onClick={() => void session.refreshAssistant()}>
          <Row ay="center" gap="100" minWidth="0">
            <Column width="8px" height="8px" r="full" flexShrink="0" bg={STATUS_COLOR[status()!.state]} />
            <we-text variant="footnote" color="text-muted" truncate>
              {status()!.name}
            </we-text>
          </Row>
        </we-button>
      </we-tooltip>
    </Show>
  );
}

/** A step as the chat reads it: the shape both a backend's replies and the editor's own carry. */
interface ChatStep {
  tool: string;
  target?: string;
  outcome: 'running' | 'ok' | 'error' | 'stopped';
  error?: string;
}

/**
 * What a tool call does, in the chat's words: while it runs, then once it has. The backend records
 * only the tool's name, so the wording is the editor's own, and an unknown tool is shown by name.
 */
const STEP_WORDS: Record<string, [doing: string, done: string]> = {
  template_read: ['Reading the template', 'Read the template'],
  template_update: ['Updating the template', 'Updated the template'],
  update_schema: ['Updating the template', 'Updated the template'],
  get_documentation: ['Reading the documentation', 'Read the documentation'],
  describe_perspective: ['Looking at what this space holds', 'Looked at what this space holds'],
  instance_query: ['Looking up records', 'Looked up records'],
  instance_get: ['Reading a record', 'Read a record'],
  instance_create: ['Creating a record', 'Created a record'],
  instance_update: ['Updating a record', 'Updated a record'],
  instance_remove: ['Removing a record', 'Removed a record'],
  instance_transcript: ['Reading a conversation', 'Read a conversation'],
  get_children: ['Reading what a record holds', 'Read what a record holds'],
  query_links: ['Reading links', 'Read links'],
};

function stepWords(step: ChatStep) {
  const [doing, done] = STEP_WORDS[step.tool] ?? [`Using ${step.tool}`, `Used ${step.tool}`];
  if (step.outcome === 'stopped') return `${doing} (stopped)`;
  // A failed call did not do what its past tense says.
  if (step.outcome === 'error') return `${doing} failed`;
  return step.outcome === 'running' ? doing : done;
}

/**
 * A finished step's mark: how its call went, or that the reply ended before it did, all faint.
 * A done step, by far the most common, is a plain tick, so a reply that worked reads quietly; the
 * rarer outcomes are circled, which is what makes them stand out from it.
 * A stopped step is a minus rather than an x: somebody chose to stop it, so it should not read as
 * a second kind of failure beside the warning.
 * A failed step is not red: when the whole reply failed the line under the steps already says so
 * in red, and when it did not, the agent got past the failure and it is not news.
 */
const STEP_MARK: Record<Exclude<ChatStep['outcome'], 'running'>, string> = {
  ok: 'check',
  error: 'warning-circle',
  stopped: 'minus-circle',
};

/** The tool calls behind a reply: open while it runs, folded to a count once it has settled. */
function ReplySteps(props: { steps: ChatStep[]; running: boolean }) {
  const [unfolded, setUnfolded] = createSignal<boolean | null>(null);
  const open = () => unfolded() ?? props.running;
  return (
    <Column gap="100">
      <Show when={!props.running}>
        <we-button variant="bare" size="xs" alignSelf="flex-start" onClick={() => setUnfolded(!open())}>
          <Row ay="center" gap="100">
            <we-icon name={open() ? 'caret-down' : 'caret-right'} size="xs" color="text-muted" />
            <we-text variant="footnote" color="text-muted">
              {props.steps.length === 1 ? '1 step' : `${props.steps.length} steps`}
            </we-text>
          </Row>
        </we-button>
      </Show>
      <Show when={open()}>
        <For each={props.steps}>
          {(step) => (
            <Row ay="center" gap="200" minWidth="0">
              {/* One slot for every mark, so the text lines up whichever is drawn. The spinner is a
                  size smaller: its ring fills its box, where a glyph leaves a margin round itself. */}
              <Row width="var(--we-size-xs)" height="var(--we-size-xs)" ax="center" ay="center" flexShrink="0">
                <Show when={step.outcome !== 'running'} fallback={<we-animated-icon name="spinner" size="xxs" />}>
                  <we-icon name={STEP_MARK[step.outcome as keyof typeof STEP_MARK]} size="xs" color="text-faint" />
                </Show>
              </Row>
              <we-text variant="footnote" color="text-faint" truncate>
                {step.error ? `${stepWords(step)}: ${step.error}` : stepWords(step)}
              </we-text>
            </Row>
          )}
        </For>
      </Show>
    </Column>
  );
}

/** How a reply that did not finish ended, and the way to ask again. */
const UNFINISHED: Record<string, string> = {
  failed: 'The reply failed',
  cancelled: 'Stopped',
  interrupted: 'Stopped when the node restarted',
};

function MessageBubble(props: {
  message: ChatMessage;
  isStreaming?: boolean;
  streamingContent?: string;
  askedFor?: string;
}) {
  const session = useEditorHost().session;
  const isUser = () => props.message.role === 'user';
  const steps = () => (props.message.steps as ChatStep[] | undefined) ?? [];
  const replyStatus = () => props.message.replyStatus as string | undefined;
  const unfinished = () => UNFINISHED[replyStatus() ?? ''];

  const displayContent = () => {
    if (props.isStreaming) return props.streamingContent || '';
    return props.message.content;
  };

  return (
    <Column
      r="400"
      gap="300"
      p={isUser() ? '300' : '0'}
      /*
        A bubble for what the reader wrote, and nothing behind what the assistant said.

        The panel frame already paints `surface-raised`; a reply painted `surface` over it is a
        second shade a few lightness points away, with no padding to read as a card — so it came
        out as a stray rectangle behind the text rather than as anything holding it. The user's own
        messages keep theirs, where the tint is doing the work of saying who is speaking.
      */
      bg={isUser() ? 'accent-soft' : undefined}
      maxWidth={isUser() ? '90%' : '100%'}
      alignSelf={isUser() ? 'flex-end' : 'flex-start'}
    >
      {/* The steps first: they ran before the text was written, and the text then lands under them
          rather than pushing them down as they fold. */}
      <Show when={steps().length > 0}>
        <ReplySteps steps={steps()} running={replyStatus() === 'running' || !!props.isStreaming} />
      </Show>
      <Show when={displayContent()}>
        <we-markdown content={displayContent()} markdownGap="400" />
      </Show>
      <Show when={unfinished()}>
        <Row ay="center" gap="200" wrap>
          <we-text variant="footnote" color={replyStatus() === 'failed' ? 'danger-text' : 'text-muted'}>
            {props.message.replyError ? `${unfinished()}: ${props.message.replyError as string}` : unfinished()}
          </we-text>
          <Show when={props.askedFor}>
            <we-button
              variant="ghost"
              size="xs"
              disabled={session.isStreaming()}
              onClick={() => void session.sendMessage(props.askedFor!)}
            >
              Send again
            </we-button>
          </Show>
        </Row>
      </Show>
      <Show when={props.message.status === 'error'}>
        <we-text fontSize="300" color="danger-text" mt="4px">
          Failed to send
        </we-text>
      </Show>
    </Column>
  );
}
