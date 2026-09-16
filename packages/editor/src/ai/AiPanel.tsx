import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import { PANEL_TITLE_PROPS } from '@we/schema-kit';
import { createEffect, createSignal, For, Show } from 'solid-js';

import type { EditorChatMessage as ChatMessage } from '../host';
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
    session.sendMessage(text);
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
      borderLeft={`1px solid ${tokenVar('color', 'ui-200')}`}
      data-testid="chat-panel"
      onKeyDown={(e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) session.redo();
          else session.undo();
        }
      }}
      tabIndex={0}
    >
      {/* Header */}
      <Row ax="between" ay="center" px="300" py="300" flexShrink="0">
        <we-text {...PANEL_TITLE_PROPS}>AI Chat</we-text>
        <Row ay="center" gap="100">
          <we-tooltip content="New chat session">
            <we-button variant="ghost" size="sm" onClick={() => session.newChat()}>
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
        <Column gap="200" p="400" bg="surface" borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`} flexShrink="0">
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
          borderBottom={`1px solid ${tokenVar('color', 'neutral-200')}`}
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
                  bg={isActive() ? 'neutral-200' : 'neutral-100'}
                  cursor="pointer"
                  whiteSpace="nowrap"
                  flexShrink="0"
                >
                  <we-text
                    fontSize="300"
                    fontWeight={isActive() ? '600' : '400'}
                    color={isActive() ? 'neutral-900' : 'neutral-700'}
                    onClick={() => session.switchSession(chat.id)}
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
                        session.deleteSession(chat.id);
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
          {(msg) => (
            <MessageBubble
              message={msg}
              isStreaming={session.isStreaming() && msg.status === 'streaming'}
              streamingContent={msg.status === 'streaming' ? session.streamingContent() : undefined}
            />
          )}
        </For>
        <div ref={messagesEndRef} />
      </Column>

      {/* Input area */}
      <Row ay="end" gap="200" p="400" borderTop={`1px solid ${tokenVar('color', 'ui-200')}`} flexShrink="0">
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
          maxRows={6}
          submitOnEnter
          flex="1"
          minWidth="0"
          on:input={(e: CustomEvent) => setInputValue(e.detail)}
          on:submit={handleSend}
        />
        <we-button
          size="sm"
          onClick={handleSend}
          disabled={session.isStreaming() || !session.assistantAvailable() || inputValue().trim() === ''}
        >
          <we-icon name="paper-plane-tilt" size="sm" />
        </we-button>
      </Row>
    </Column>
  );
}

function MessageBubble(props: { message: ChatMessage; isStreaming?: boolean; streamingContent?: string }) {
  const isUser = () => props.message.role === 'user';

  const displayContent = () => {
    if (props.isStreaming) return props.streamingContent || '';
    return props.message.content;
  };

  return (
    <Column
      r="400"
      gap="300"
      p={isUser() ? '300' : '0'}
      bg={isUser() ? 'primary-200' : 'neutral-25'}
      maxWidth={isUser() ? '90%' : '100%'}
      alignSelf={isUser() ? 'flex-end' : 'flex-start'}
    >
      <Show when={displayContent()}>
        <we-markdown content={displayContent()} markdownGap="400" />
      </Show>
      <Show when={props.message.status === 'error'}>
        <we-text fontSize="300" color="danger-text" mt="4px">
          Failed to send
        </we-text>
      </Show>
    </Column>
  );
}
