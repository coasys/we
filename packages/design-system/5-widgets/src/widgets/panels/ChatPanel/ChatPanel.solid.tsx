import { tokenVar } from '@we/design-utils';
import { createEffect, createSignal, For, type JSX, Show } from 'solid-js';

export type * from './ChatPanel.types';
import type { ChatMessage, ChatPanelProps } from './ChatPanel.types';

const ICON_CHOICES = [
  'cube',
  'rocket-launch',
  'gear',
  'star',
  'target',
  'chat-circle',
  'list-checks',
  'palette',
  'house',
  'folder',
  'bell',
  'users',
  'chart-bar',
  'pencil-simple',
  'music-note',
  'camera',
];

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
  let messagesEndRef: HTMLDivElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;

  // Reset picker fields when picker opens
  createEffect(() => {
    if (props.pickerOpen) {
      setPickerName(props.pickerDefaultName ?? '');
      setPickerIcon(props.pickerDefaultIcon ?? 'cube');
    }
  });

  // Auto-scroll to bottom when messages change
  createEffect(() => {
    void props.messages.length;
    requestAnimationFrame(() => {
      messagesEndRef?.scrollIntoView({ behavior: 'smooth' });
    });
  });

  // Auto-resize textarea
  function resizeTextarea() {
    if (!inputRef) return;
    inputRef.style.height = 'auto';
    inputRef.style.height = Math.min(inputRef.scrollHeight, 160) + 'px';
  }

  function handleSend() {
    const text = inputValue().trim();
    if (!text || props.disabled || props.loading) return;
    props.onSend(text);
    setInputValue('');
    if (inputRef) {
      inputRef.style.height = 'auto';
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handlePickerConfirm() {
    const name = pickerName().trim();
    if (!name) return;
    props.onPickerConfirm?.(name, pickerIcon() || 'cube');
  }

  // Container styles
  const containerStyles = (): JSX.CSSProperties => ({
    position: position(),
    top: '0',
    [side()]: props.open ? '0' : `-${width()}`,
    width: width(),
    height: '100vh',
    'z-index': zIndex(),
    display: 'flex',
    'flex-direction': 'column',
    background: tokenVar('color', 'neutral-0'),
    'border-left': side() === 'right' ? `1px solid ${tokenVar('color', 'ui-200')}` : 'none',
    'border-right': side() === 'left' ? `1px solid ${tokenVar('color', 'ui-200')}` : 'none',
    transition: `${side()} 300ms ease`,
    'box-shadow': props.open ? '-4px 0 24px rgba(0,0,0,0.08)' : 'none',
  });

  // Header styles
  const headerStyles = (): JSX.CSSProperties => ({
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'space-between',
    padding: `${tokenVar('space', '300')} ${tokenVar('space', '400')}`,
    'border-bottom': `1px solid ${tokenVar('color', 'ui-200')}`,
    'flex-shrink': '0',
  });

  // Messages area styles
  const messagesStyles = (): JSX.CSSProperties => ({
    flex: '1',
    'overflow-y': 'auto',
    padding: tokenVar('space', '400'),
    display: 'flex',
    'flex-direction': 'column',
    gap: tokenVar('space', '300'),
  });

  // Input area styles
  const inputAreaStyles = (): JSX.CSSProperties => ({
    display: 'flex',
    'align-items': 'flex-end',
    gap: tokenVar('space', '200'),
    padding: tokenVar('space', '400'),
    'border-top': `1px solid ${tokenVar('color', 'ui-200')}`,
    'flex-shrink': '0',
  });

  return (
    <div style={containerStyles()} data-testid="chat-panel">
      {/* Header */}
      <div style={headerStyles()}>
        <we-text fontSize="500" fontWeight="600">
          {title()}
        </we-text>
        <Show when={props.onClose}>
          <we-button variant="ghost" size="sm" onClick={() => props.onClose?.()}>
            <we-icon name="x" size="sm" />
          </we-button>
        </Show>
      </div>

      {/* Template Context Header */}
      <Show when={props.templateName}>
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'space-between',
            padding: `${tokenVar('space', '200')} ${tokenVar('space', '400')}`,
            'border-bottom': `1px solid ${tokenVar('color', 'ui-200')}`,
            background: props.isReadOnly ? tokenVar('color', 'warning-50') : tokenVar('color', 'primary-50'),
            'flex-shrink': '0',
            gap: tokenVar('space', '200'),
          }}
        >
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: tokenVar('space', '200'),
              'min-width': '0',
              flex: '1',
            }}
          >
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
          </div>
          <div style={{ display: 'flex', gap: tokenVar('space', '100'), 'flex-shrink': '0' }}>
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
          </div>
        </div>

        {/* Pending changes banner (for read-only templates) */}
        <Show when={props.isReadOnly && props.hasPendingChanges}>
          <div
            style={{
              padding: `${tokenVar('space', '200')} ${tokenVar('space', '400')}`,
              background: tokenVar('color', 'info-50'),
              'border-bottom': `1px solid ${tokenVar('color', 'ui-200')}`,
              display: 'flex',
              'align-items': 'center',
              gap: tokenVar('space', '200'),
              'flex-shrink': '0',
            }}
          >
            <we-icon name="info" size="xs" />
            <we-text fontSize="200" color="info-700">
              Changes are pending — fork this template to apply them.
            </we-text>
          </div>
        </Show>
      </Show>

      {/* Name + Icon Picker */}
      <Show when={props.pickerOpen}>
        <div
          style={{
            padding: tokenVar('space', '400'),
            'border-bottom': `1px solid ${tokenVar('color', 'ui-200')}`,
            display: 'flex',
            'flex-direction': 'column',
            gap: tokenVar('space', '300'),
            background: tokenVar('color', 'neutral-50'),
            'flex-shrink': '0',
          }}
        >
          <we-text fontSize="400" fontWeight="600" color="neutral-800">
            {props.pickerAction === 'fresh' ? 'Create New Template' : 'Name Your Fork'}
          </we-text>

          {/* Name input */}
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: tokenVar('space', '100') }}>
            <we-text fontSize="200" fontWeight="600" color="neutral-600">
              Name
            </we-text>
            <input
              type="text"
              value={pickerName()}
              onInput={(e) => setPickerName(e.currentTarget.value)}
              placeholder="My Template"
              style={{
                border: `1px solid ${tokenVar('color', 'ui-300')}`,
                'border-radius': tokenVar('radius', 'sm'),
                padding: `${tokenVar('space', '200')} ${tokenVar('space', '300')}`,
                'font-size': tokenVar('font-size', '300'),
                background: tokenVar('color', 'neutral-0'),
                color: tokenVar('color', 'neutral-900'),
                outline: 'none',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePickerConfirm();
                if (e.key === 'Escape') props.onPickerCancel?.();
              }}
            />
          </div>

          {/* Icon picker grid */}
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: tokenVar('space', '100') }}>
            <we-text fontSize="200" fontWeight="600" color="neutral-600">
              Icon
            </we-text>
            <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: tokenVar('space', '100') }}>
              <For each={ICON_CHOICES}>
                {(iconName) => (
                  <button
                    onClick={() => setPickerIcon(iconName)}
                    style={{
                      width: '36px',
                      height: '36px',
                      display: 'flex',
                      'align-items': 'center',
                      'justify-content': 'center',
                      border:
                        pickerIcon() === iconName
                          ? `2px solid ${tokenVar('color', 'primary-500')}`
                          : `1px solid ${tokenVar('color', 'ui-200')}`,
                      'border-radius': tokenVar('radius', 'sm'),
                      background:
                        pickerIcon() === iconName ? tokenVar('color', 'primary-50') : tokenVar('color', 'neutral-0'),
                      cursor: 'pointer',
                      padding: '0',
                    }}
                  >
                    <we-icon name={iconName} size="sm" />
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: tokenVar('space', '200'), 'justify-content': 'flex-end' }}>
            <we-button size="sm" variant="ghost" onClick={() => props.onPickerCancel?.()}>
              Cancel
            </we-button>
            <we-button size="sm" disabled={!pickerName().trim()} onClick={handlePickerConfirm}>
              {props.pickerAction === 'fresh' ? 'Create' : 'Fork'}
            </we-button>
          </div>
        </div>
      </Show>

      {/* API Key Setup */}
      <Show when={props.onSetApiKey && !props.apiKeyConfigured}>
        <div
          style={{
            padding: tokenVar('space', '400'),
            'border-bottom': `1px solid ${tokenVar('color', 'ui-200')}`,
            display: 'flex',
            'flex-direction': 'column',
            gap: tokenVar('space', '200'),
            background: tokenVar('color', 'neutral-50'),
          }}
        >
          <we-text fontSize="300" fontWeight="600" color="neutral-700">
            Claude API Key
          </we-text>
          <we-text fontSize="200" color="neutral-500">
            Enter your Anthropic API key to enable AI chat. The key is stored locally in your agent settings.
          </we-text>
          <div style={{ display: 'flex', gap: tokenVar('space', '200') }}>
            <input
              type="password"
              value={apiKeyInput()}
              onInput={(e) => setApiKeyInput(e.currentTarget.value)}
              placeholder="sk-ant-..."
              style={{
                flex: '1',
                border: `1px solid ${tokenVar('color', 'ui-300')}`,
                'border-radius': tokenVar('radius', 'sm'),
                padding: `${tokenVar('space', '200')} ${tokenVar('space', '300')}`,
                'font-size': tokenVar('font-size', '300'),
                background: tokenVar('color', 'neutral-0'),
                color: tokenVar('color', 'neutral-900'),
                outline: 'none',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && apiKeyInput().trim()) {
                  props.onSetApiKey!(apiKeyInput().trim());
                  setApiKeyInput('');
                }
              }}
            />
            <we-button
              size="sm"
              disabled={!apiKeyInput().trim()}
              onClick={() => {
                props.onSetApiKey!(apiKeyInput().trim());
                setApiKeyInput('');
              }}
            >
              Save
            </we-button>
          </div>
        </div>
      </Show>

      {/* Messages */}
      <div style={messagesStyles()}>
        <For each={props.messages}>{(msg) => <MessageBubble message={msg} />}</For>

        {/* Streaming / loading indicator */}
        <Show when={props.loading}>
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: tokenVar('space', '200'),
              padding: `${tokenVar('space', '200')} ${tokenVar('space', '300')}`,
            }}
          >
            <we-icon name="circle-notch" size="sm" class="we-spin" />
            <we-text fontSize="300" color="neutral-500">
              Thinking...
            </we-text>
          </div>
        </Show>

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={inputAreaStyles()}>
        <textarea
          ref={inputRef}
          value={inputValue()}
          onInput={(e) => {
            setInputValue(e.currentTarget.value);
            resizeTextarea();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder()}
          disabled={props.disabled || props.loading}
          rows={1}
          style={{
            flex: '1',
            resize: 'none',
            border: `1px solid ${tokenVar('color', 'ui-300')}`,
            'border-radius': tokenVar('radius', 'sm'),
            padding: `${tokenVar('space', '200')} ${tokenVar('space', '300')}`,
            'font-family': 'inherit',
            'font-size': tokenVar('font-size', '400'),
            'line-height': '1.5',
            background: tokenVar('color', 'neutral-50'),
            color: tokenVar('color', 'neutral-900'),
            outline: 'none',
            'max-height': '160px',
            'overflow-y': 'auto',
          }}
        />
        <we-button
          size="sm"
          onClick={handleSend}
          disabled={props.disabled || props.loading || inputValue().trim() === ''}
        >
          <we-icon name="paper-plane-tilt" size="sm" />
        </we-button>
      </div>
    </div>
  );
}

// ----- Message Bubble Component -----

function MessageBubble(props: { message: ChatMessage }) {
  const isUser = () => props.message.role === 'user';
  const isSystem = () => props.message.role === 'system';

  const bubbleStyles = (): JSX.CSSProperties => {
    if (isSystem()) {
      return {
        padding: `${tokenVar('space', '200')} ${tokenVar('space', '300')}`,
        background: tokenVar('color', 'warning-50'),
        'border-radius': tokenVar('radius', 'sm'),
        'border-left': `3px solid ${tokenVar('color', 'warning-400')}`,
      };
    }
    return {
      padding: `${tokenVar('space', '200')} ${tokenVar('space', '300')}`,
      background: isUser() ? tokenVar('color', 'primary-50') : tokenVar('color', 'neutral-50'),
      'border-radius': tokenVar('radius', 'sm'),
      'max-width': '95%',
      'align-self': isUser() ? 'flex-end' : 'flex-start',
      'word-break': 'break-word',
    };
  };

  const labelColor = () => (isUser() ? 'primary-600' : 'neutral-500');
  const label = () => {
    if (isSystem()) return 'System';
    return isUser() ? 'You' : 'AI';
  };

  return (
    <div style={bubbleStyles()}>
      <we-text fontSize="200" color={labelColor()} fontWeight="600" style={{ 'margin-bottom': '2px' }}>
        {label()}
      </we-text>
      <we-text fontSize="300" color="neutral-800" style={{ 'white-space': 'pre-wrap' }}>
        {props.message.content}
      </we-text>
      <Show when={props.message.status === 'error'}>
        <we-text fontSize="200" color="danger-500" style={{ 'margin-top': '4px' }}>
          Failed to send
        </we-text>
      </Show>
    </div>
  );
}
