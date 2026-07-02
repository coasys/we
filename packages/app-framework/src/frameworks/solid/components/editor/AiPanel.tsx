import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import { createEffect, createSignal, For, Show } from 'solid-js';

import type { ChatMessage } from '../../stores/AiStore';
import { useAiStore } from '../../stores/AiStore';

export function AiPanel() {
  const aiStore = useAiStore();

  const [inputValue, setInputValue] = createSignal('');
  const [apiKeyInput, setApiKeyInput] = createSignal('');
  let messagesEndRef: HTMLDivElement | undefined;

  // Auto-scroll to bottom when messages change or streaming content updates
  createEffect(() => {
    void aiStore.messages().length;
    void aiStore.streamingContent();
    requestAnimationFrame(() => {
      messagesEndRef?.scrollIntoView({ behavior: 'smooth' });
    });
  });

  function handleSend() {
    const text = inputValue().trim();
    if (!text || aiStore.isStreaming()) return;
    aiStore.sendMessage(text);
    setInputValue('');
  }

  return (
    <Column
      bg="neutral-25"
      width="100%"
      height="100%"
      borderLeft={`1px solid ${tokenVar('color', 'ui-200')}`}
      data-testid="chat-panel"
      onKeyDown={(e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) aiStore.redo();
          else aiStore.undo();
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
        styles={{ 'flex-shrink': '0' }}
      >
        <we-text fontSize="500" fontWeight="600">
          AI Chat
        </we-text>
        <Row ay="center" gap="100">
          <we-tooltip title="New chat session">
            <we-button variant="ghost" size="sm" onClick={() => aiStore.newChat()}>
              <we-icon name="file-plus" size="sm" />
            </we-button>
          </we-tooltip>
          <we-tooltip title="Close chat panel">
            <we-button variant="ghost" size="sm" onClick={() => aiStore.close()}>
              <we-icon name="x" size="sm" />
            </we-button>
          </we-tooltip>
        </Row>
      </Row>

      {/* API Key Setup */}
      <Show when={!aiStore.apiKeyConfigured()}>
        <Column
          gap="200"
          p="400"
          bg="neutral-50"
          borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
          styles={{ 'flex-shrink': '0' }}
        >
          <we-text fontSize="300" fontWeight="600" color="neutral-700">
            Claude API Key
          </we-text>
          <we-text fontSize="200" color="neutral-500">
            Enter your Anthropic API key to enable AI chat. The key is stored locally in your agent settings.
          </we-text>
          <Row gap="200">
            <we-input
              type="password"
              value={apiKeyInput()}
              placeholder="sk-ant-..."
              size="sm"
              bg="neutral-0"
              flex="1"
              on:input={(e: CustomEvent) => setApiKeyInput(e.detail)}
              on:keydown={(e: CustomEvent) => {
                if (e.detail.key === 'Enter' && apiKeyInput().trim()) {
                  aiStore.setApiKey(apiKeyInput().trim());
                  setApiKeyInput('');
                }
              }}
            />
            <we-button
              size="sm"
              disabled={!apiKeyInput().trim()}
              onClick={() => {
                aiStore.setApiKey(apiKeyInput().trim());
                setApiKeyInput('');
              }}
            >
              Save
            </we-button>
          </Row>
        </Column>
      </Show>

      {/* Session tabs */}
      <Show when={aiStore.sessions().length > 0}>
        <Row
          ay="center"
          gap="100"
          px="300"
          borderBottom={`1px solid ${tokenVar('color', 'neutral-200')}`}
          styles={{ 'overflow-x': 'auto', 'flex-shrink': '0' }}
        >
          <For each={aiStore.sessions()}>
            {(session) => {
              const isActive = () => session.id === aiStore.activeSessionId();
              return (
                <Row
                  ay="center"
                  gap="200"
                  rt="400"
                  px="12px"
                  height="32px"
                  bg={isActive() ? 'neutral-200' : 'neutral-100'}
                  cursor="pointer"
                  styles={{ 'white-space': 'nowrap', 'flex-shrink': '0' }}
                >
                  <we-text
                    fontSize="300"
                    fontWeight={isActive() ? '600' : '400'}
                    color={isActive() ? 'neutral-900' : 'neutral-700'}
                    onClick={() => aiStore.switchSession(session.id)}
                    cursor="pointer"
                  >
                    {session.name || 'Chat'}
                  </we-text>
                  <Show when={aiStore.sessions().length > 1}>
                    <we-button
                      variant="ghost"
                      size="xs"
                      onClick={(e: MouseEvent) => {
                        e.stopPropagation();
                        aiStore.deleteSession(session.id);
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
        <For each={aiStore.messages()}>
          {(msg) => (
            <MessageBubble
              message={msg}
              isStreaming={aiStore.isStreaming() && msg.status === 'streaming'}
              streamingContent={msg.status === 'streaming' ? aiStore.streamingContent() : undefined}
            />
          )}
        </For>
        <div ref={messagesEndRef} />
      </Column>

      {/* Input area */}
      <Row
        ay="end"
        gap="200"
        p="400"
        borderTop={`1px solid ${tokenVar('color', 'ui-200')}`}
        styles={{ 'flex-shrink': '0' }}
      >
        <we-textarea
          value={inputValue()}
          placeholder="Describe a change to the template..."
          disabled={aiStore.isStreaming()}
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
          styles={{ 'overflow-y': 'auto' }}
        />
        <we-button size="sm" onClick={handleSend} disabled={aiStore.isStreaming() || inputValue().trim() === ''}>
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
        <we-text fontSize="300" color="danger-500" style={{ 'margin-top': '4px' }}>
          Failed to send
        </we-text>
      </Show>
    </Column>
  );
}
