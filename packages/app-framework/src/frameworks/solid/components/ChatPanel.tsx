import { tokenVar } from '@we/design-utils';
import { Column, Row } from '@we/components/solid';
import { createEffect, createSignal, For, Show } from 'solid-js';

import type { ChatMessage, ChatPanelProps } from './ChatPanel.types';

export function ChatPanel(props: ChatPanelProps) {
  const side = () => props.side ?? 'right';
  const width = () => props.width ?? '400px';
  const position = () => props.position ?? 'fixed';
  const zIndex = () => props.zIndex ?? 20;
  const title = () => props.title ?? 'AI Chat';
  const placeholder = () => props.placeholder ?? 'Describe a change to the template...';

  const [inputValue, setInputValue] = createSignal('');
  const [apiKeyInput, setApiKeyInput] = createSignal('');
  const [pickerName, setPickerName] = createSignal('');
  const [pickerIcon, setPickerIcon] = createSignal('');
  const [pickerDestination, setPickerDestination] = createSignal<'personal' | 'space'>('personal');
  let messagesEndRef: HTMLDivElement | undefined;

  // Reset picker fields when picker opens
  createEffect(() => {
    if (props.pickerOpen) {
      setPickerName(props.pickerDefaultName ?? '');
      setPickerIcon(props.pickerDefaultIcon ?? 'cube');
      setPickerDestination('personal');
    }
  });

  // Auto-scroll to bottom when messages change or streaming content updates
  createEffect(() => {
    void props.messages.length;
    void props.streamingContent;
    requestAnimationFrame(() => {
      messagesEndRef?.scrollIntoView({ behavior: 'smooth' });
    });
  });

  function handleSend() {
    const text = inputValue().trim();
    if (!text || props.disabled || props.loading) return;
    props.onSend(text);
    setInputValue('');
  }

  function handlePickerConfirm() {
    const name = pickerName().trim();
    if (!name) return;
    props.onPickerConfirm?.(name, pickerIcon() || 'cube', pickerDestination());
  }

  return (
    <Column
      bg="neutral-25"
      position={position() as 'fixed' | 'absolute' | 'relative' | 'sticky'}
      top="0"
      width={width()}
      height="100vh"
      zIndex={zIndex()}
      borderLeft={side() === 'right' ? `1px solid ${tokenVar('color', 'ui-200')}` : 'none'}
      borderRight={side() === 'left' ? `1px solid ${tokenVar('color', 'ui-200')}` : 'none'}
      transition={`${side()} 300ms ease`}
      styles={{
        [side()]: props.open ? '0' : `-${width()}`,
        'box-shadow': props.open ? '-4px 0 24px rgba(0,0,0,0.08)' : 'none',
      }}
      data-testid="chat-panel"
      onKeyDown={(e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) props.onRedo?.();
          else props.onUndo?.();
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
          {title()}
        </we-text>
        <Row ay="center" gap="100">
          <Show when={props.onUndo}>
            <we-button variant="ghost" size="sm" disabled={!props.canUndo || props.loading} onClick={() => props.onUndo?.()}>
              <we-icon name="arrow-u-up-left" size="sm" />
            </we-button>
          </Show>
          <Show when={props.onRedo}>
            <we-button variant="ghost" size="sm" disabled={!props.canRedo || props.loading} onClick={() => props.onRedo?.()}>
              <we-icon name="arrow-u-up-right" size="sm" />
            </we-button>
          </Show>
          <Show when={props.onNewChat}>
            <we-button variant="ghost" size="sm" onClick={() => props.onNewChat?.()}>
              <we-icon name="plus" size="sm" />
            </we-button>
          </Show>
          <Show when={props.onClose}>
            <we-button variant="ghost" size="sm" onClick={() => props.onClose?.()}>
              <we-icon name="x" size="sm" />
            </we-button>
          </Show>
        </Row>
      </Row>

      {/* Template Context Header */}
      <Show when={props.templateName}>
        <Row
          ax="between"
          ay="center"
          gap="200"
          px="400"
          py="200"
          bg={props.isReadOnly ? 'warning-50' : 'primary-200'}
          borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
          styles={{ 'flex-shrink': '0' }}
        >
          <Row ay="center" gap="200" flex="1" minWidth="0">
            <Show when={props.templateIcon}>
              <we-icon name={props.templateIcon} size="sm" />
            </Show>
            <we-text
              fontSize="300"
              fontWeight="600"
              color={props.isReadOnly ? 'warning-700' : 'primary-700'}
              style={{ 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' }}
            >
              {props.templateName}
            </we-text>
            <we-text fontSize="200" color={props.isReadOnly ? 'warning-500' : 'primary-500'}>
              {props.isReadOnly ? '(read-only)' : '(editing)'}
            </we-text>
          </Row>
          <Row gap="100" styles={{ 'flex-shrink': '0' }}>
            <Show when={props.onFork}>
              <we-button variant="ghost" size="xs" onClick={() => props.onFork?.()}>
                {props.isReadOnly ? 'Fork & Customize' : 'Fork'}
              </we-button>
            </Show>
            <Show when={props.isReadOnly && props.onStartFresh}>
              <we-button variant="ghost" size="xs" onClick={() => props.onStartFresh?.()}>
                Start Fresh
              </we-button>
            </Show>
          </Row>
        </Row>

        {/* Pending changes banner */}
        <Show when={props.isReadOnly && props.hasPendingChanges}>
          <Row
            ay="center"
            gap="200"
            px="400"
            py="200"
            bg="info-50"
            borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
            styles={{ 'flex-shrink': '0' }}
          >
            <we-icon name="info" size="xs" />
            <we-text fontSize="200" color="info-700">
              Changes are pending — fork this template to apply them.
            </we-text>
          </Row>
        </Show>
      </Show>

      {/* Name + Icon Picker */}
      <Show when={props.pickerOpen}>
        <Column
          gap="300"
          p="400"
          bg="neutral-50"
          borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
          styles={{ 'flex-shrink': '0' }}
        >
          <we-text fontSize="400" fontWeight="600" color="neutral-800">
            {props.pickerAction === 'fresh' ? 'Create New Template' : 'Name Your Fork'}
          </we-text>
          <Column gap="100">
            <we-text fontSize="200" fontWeight="600" color="neutral-600">
              Name
            </we-text>
            <we-input
              value={pickerName()}
              placeholder="My Template"
              size="sm"
              bg="neutral-0"
              on:input={(e: CustomEvent) => setPickerName(e.detail)}
              on:keydown={(e: CustomEvent) => {
                if (e.detail.key === 'Enter') handlePickerConfirm();
                if (e.detail.key === 'Escape') props.onPickerCancel?.();
              }}
            />
          </Column>
          <Column gap="100">
            <we-text fontSize="200" fontWeight="600" color="neutral-600">
              Icon
            </we-text>
            <we-icon-picker value={pickerIcon()} size="sm" on:change={(e: CustomEvent) => setPickerIcon(e.detail)} />
          </Column>
          <Show when={props.pickerShowDestination}>
            <Column gap="100">
              <we-text fontSize="200" fontWeight="600" color="neutral-600">
                Save to
              </we-text>
              <Row gap="200">
                <we-button size="sm" variant={pickerDestination() === 'personal' ? 'secondary' : 'ghost'} onClick={() => setPickerDestination('personal')}>
                  My templates
                </we-button>
                <we-button size="sm" variant={pickerDestination() === 'space' ? 'secondary' : 'ghost'} onClick={() => setPickerDestination('space')}>
                  This space
                </we-button>
              </Row>
            </Column>
          </Show>
          <Row ax="end" gap="200">
            <we-button size="sm" variant="ghost" onClick={() => props.onPickerCancel?.()} disabled={!!props.operationLoading}>
              Cancel
            </we-button>
            <we-button size="sm" disabled={!pickerName().trim()} loading={!!props.operationLoading} onClick={handlePickerConfirm}>
              {props.operationLoading ? 'Saving...' : props.pickerAction === 'fresh' ? 'Create' : 'Fork'}
            </we-button>
          </Row>
        </Column>
      </Show>

      {/* API Key Setup */}
      <Show when={props.onSetApiKey && !props.apiKeyConfigured}>
        <Column gap="200" p="400" bg="neutral-50" borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}>
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
                  props.onSetApiKey!(apiKeyInput().trim());
                  setApiKeyInput('');
                }
              }}
            />
            <we-button size="sm" disabled={!apiKeyInput().trim()} onClick={() => { props.onSetApiKey!(apiKeyInput().trim()); setApiKeyInput(''); }}>
              Save
            </we-button>
          </Row>
        </Column>
      </Show>

      {/* Session tabs */}
      <Show when={props.sessions && props.sessions.length > 0}>
        <Row
          ay="center"
          gap="100"
          p="300"
          borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
          styles={{ 'overflow-x': 'auto', 'flex-shrink': '0' }}
        >
          <For each={props.sessions}>
            {(session) => {
              const isActive = () => session.id === props.activeSessionId;
              return (
                <Row
                  ay="center"
                  gap="200"
                  r="400"
                  px="200"
                  py="100"
                  bg={isActive() ? 'primary-200' : 'primary-100'}
                  cursor="pointer"
                  styles={{ 'white-space': 'nowrap', 'flex-shrink': '0' }}
                >
                  <we-text
                    fontSize="200"
                    fontWeight={isActive() ? '600' : '400'}
                    color={isActive() ? 'primary-700' : 'neutral-600'}
                    onClick={() => props.onSwitchSession?.(session.id)}
                    cursor="pointer"
                  >
                    {session.name || 'Chat'}
                  </we-text>
                  <Show when={props.onDeleteSession && props.sessions!.length > 1}>
                    <we-button variant="ghost" size="xs" onClick={(e: MouseEvent) => { e.stopPropagation(); props.onDeleteSession?.(session.id); }} opacity={0.5} p="0" minWidth="unset">
                      <we-icon name="x" size="xs" />
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
        <For each={props.messages}>
          {(msg) => (
            <MessageBubble
              message={msg}
              isStreaming={props.loading && msg.status === 'streaming'}
              streamingContent={msg.status === 'streaming' ? props.streamingContent : undefined}
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
          placeholder={placeholder()}
          disabled={props.disabled || props.loading}
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
        <we-button size="sm" onClick={handleSend} disabled={props.disabled || props.loading || inputValue().trim() === ''}>
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
