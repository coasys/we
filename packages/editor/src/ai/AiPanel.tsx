import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import { createEffect, createSignal, For, Show } from 'solid-js';

import type { EditorChatMessage as ChatMessage } from '../host';
import { useEditorHost } from '../host';

export function AiPanel() {
  const session = useEditorHost().session;

  const [inputValue, setInputValue] = createSignal('');
  const [apiKeyInput, setApiKeyInput] = createSignal('');
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
    if (!text || session.isStreaming()) return;
    session.sendMessage(text);
    setInputValue('');
  }

  return (
    <Column
      /*
        No background of its own: the dock frame paints the panel's surface.

        Every dock is wrapped in a frame that sets `surface-sunken`, precisely so a docked panel does
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
      <Row
        ax="between"
        ay="center"
        px="400"
        py="300"
        borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
        flexShrink="0"
      >
        <we-text fontSize="500" fontWeight="600">
          AI Chat
        </we-text>
        <Row ay="center" gap="100">
          <we-tooltip title="New chat session">
            <we-button variant="ghost" size="sm" onClick={() => session.newChat()}>
              <we-icon name="file-plus" size="sm" />
            </we-button>
          </we-tooltip>
          <we-tooltip title="Close chat panel">
            <we-button variant="ghost" size="sm" onClick={() => session.close()}>
              <we-icon name="x" size="sm" />
            </we-button>
          </we-tooltip>
        </Row>
      </Row>

      {/* API Key Setup */}
      <Show when={!session.apiKeyConfigured()}>
        <Column
          gap="200"
          p="400"
          bg="surface"
          borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
          flexShrink="0"
        >
          <we-text fontSize="300" fontWeight="600" color="text">
            Claude API Key
          </we-text>
          <we-text fontSize="200" color="text-muted">
            Enter your Anthropic API key to enable AI chat. The key is stored locally in your agent settings.
          </we-text>
          <Row gap="200">
            <we-input
              type="password"
              value={apiKeyInput()}
              placeholder="sk-ant-..."
              size="sm"
              bg="surface"
              flex="1"
              on:input={(e: CustomEvent) => setApiKeyInput(e.detail)}
              on:keydown={(e: CustomEvent) => {
                if (e.detail.key === 'Enter' && apiKeyInput().trim()) {
                  session.setApiKey(apiKeyInput().trim());
                  setApiKeyInput('');
                }
              }}
            />
            <we-button
              size="sm"
              disabled={!apiKeyInput().trim()}
              onClick={() => {
                session.setApiKey(apiKeyInput().trim());
                setApiKeyInput('');
              }}
            >
              Save
            </we-button>
          </Row>
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
        <we-textarea
          value={inputValue()}
          placeholder="Describe a change to the template..."
          disabled={session.isStreaming()}
          rows={1}
          resize="none"
          flex="1"
          on:input={(e: CustomEvent) => setInputValue(e.detail)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          maxHeight="160px"
          overflowY="auto"
        />
        <we-button size="sm" onClick={handleSend} disabled={session.isStreaming() || inputValue().trim() === ''}>
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
      styles={{ 'word-break': 'break-word' }}
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
