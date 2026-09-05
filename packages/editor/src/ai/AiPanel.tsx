import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
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
    if (!text || session.isStreaming()) return;
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
      <Row
        ax="between"
        ay="center"
        px="400"
        py="300"
        borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
        flexShrink="0"
      >
        <Row ay="center" gap="200">
          <we-text fontSize="500" fontWeight="600">
            AI Chat
          </we-text>
          <Show when={session.activeProvider?.()}>
            {(provider) => (
              <Row ay="center" gap="100">
                <we-text fontSize="200" color="neutral-400">
                  {provider().name}
                </we-text>
                <HealthDot />
              </Row>
            )}
          </Show>
        </Row>
        <Row ay="center" gap="100">
          <we-tooltip title="New chat session">
            <we-button variant="ghost" size="sm" onClick={() => session.newChat()}>
              <we-icon name="file-plus" size="sm" />
            </we-button>
          </we-tooltip>
        </Row>
      </Row>

      {/* Provider bar — same layout for every provider */}
      <Show when={session.providers}>
        <ProviderQuickSwitch />
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

// ---------------------------------------------------------------------------
// Health indicator dot — shows reachability without spending tokens
// ---------------------------------------------------------------------------

function HealthDot() {
  const session = useEditorHost().session;
  const status = () => session.healthStatus?.() ?? 'unknown';
  const error = () => (session as { healthError?: () => string }).healthError?.() ?? '';

  const color = () => {
    switch (status()) {
      case 'ok':
        return 'var(--we-color-success-500, #22c55e)';
      case 'error':
        return 'var(--we-color-danger-500, #ef4444)';
      case 'checking':
        return 'var(--we-color-warning-400, #facc15)';
      default:
        return 'var(--we-color-neutral-300, #d4d4d8)';
    }
  };

  const title = () => {
    switch (status()) {
      case 'ok':
        return 'Connected';
      case 'error':
        return error() || 'Connection failed';
      case 'checking':
        return 'Checking…';
      default:
        return 'Not checked';
    }
  };

  return (
    <we-tooltip title={title()}>
      <div
        onClick={() => session.checkHealth?.()}
        style={{
          width: '8px',
          height: '8px',
          'border-radius': '50%',
          'background-color': color(),
          cursor: 'pointer',
          'flex-shrink': '0',
          transition: 'background-color 200ms',
          animation: status() === 'checking' ? 'pulse 1.2s ease-in-out infinite' : 'none',
        }}
      />
    </we-tooltip>
  );
}

// ---------------------------------------------------------------------------
// Shared provider config form — used by both setup and quick-switch
// ---------------------------------------------------------------------------

function ProviderConfigForm(props: {
  /** Show the form in full layout (labels + description) vs compact (fields only). */
  variant: 'full' | 'compact';
  /** Called after a successful save. */
  onSaved?: () => void;
}) {
  const session = useEditorHost().session;
  const [keyInput, setKeyInput] = createSignal('');
  const [urlInput, setUrlInput] = createSignal('');
  const [modelInput, setModelInput] = createSignal('');
  const [showAdvanced, setShowAdvanced] = createSignal(props.variant === 'compact');

  // Whether the active provider requires an API key.
  // Local providers (Ollama, AD4M) report ready without a key — no need to show the field.
  const needsApiKey = () => {
    const p = session.activeProvider?.();
    if (!p) return true;
    return !(session.apiKeyConfigured() && !p.apiKey);
  };

  // Pre-fill fields when the selected provider changes
  createEffect(() => {
    const p = session.activeProvider?.();
    if (p) {
      setUrlInput(p.baseUrl);
      setModelInput(p.model);
      // Only pre-fill key in full mode (setup). Compact mode starts blank for safety.
      setKeyInput(props.variant === 'full' ? p.apiKey : '');
    }
  });

  function handleSave() {
    const p = session.activeProvider?.();
    if (!p) return;
    const changes: Record<string, string> = {};
    if (keyInput().trim()) changes.apiKey = keyInput().trim();
    if (urlInput().trim() && urlInput().trim() !== p.baseUrl) changes.baseUrl = urlInput().trim();
    if (modelInput().trim() && modelInput().trim() !== p.model) changes.model = modelInput().trim();
    if (Object.keys(changes).length > 0) {
      session.updateProvider!(p.id, changes);
    }
    setKeyInput('');
    props.onSaved?.();
  }

  return (
    <Column gap="200">
      {/* API key — hidden for local providers that don't need one */}
      <Show when={needsApiKey()}>
        <Row gap="200">
          <we-input
            type="password"
            value={keyInput()}
            placeholder={props.variant === 'full' ? 'API key or token' : '••••••••'}
            size="sm"
            bg="surface"
            flex="1"
            on:input={(e: CustomEvent) => setKeyInput(e.detail)}
            on:keydown={(e: CustomEvent) => {
              if (e.detail.key === 'Enter' && keyInput().trim()) handleSave();
            }}
          />
          <Show when={props.variant === 'full'}>
            <we-button size="sm" disabled={!keyInput().trim()} onClick={handleSave}>
              Save
            </we-button>
          </Show>
        </Row>
      </Show>

      {/* Advanced toggle (full mode only — compact always shows fields) */}
      <Show when={props.variant === 'full'}>
        <we-button variant="ghost" size="xs" onClick={() => setShowAdvanced((v) => !v)}>
          <Row ay="center" gap="100">
            <we-icon name={showAdvanced() ? 'caret-up' : 'caret-down'} size="xs" />
            <we-text fontSize="200" color="text-muted">
              Advanced
            </we-text>
          </Row>
        </we-button>
      </Show>

      <Show when={showAdvanced()}>
        <Column gap="200">
          <we-form-field label="Base URL" size="sm">
            <we-input
              value={urlInput()}
              placeholder="https://api.example.com/v1"
              size="sm"
              bg="surface"
              on:input={(e: CustomEvent) => setUrlInput(e.detail)}
            />
          </we-form-field>
          <we-form-field label="Model" size="sm">
            {(() => {
              const models = session.availableModels?.() ?? [];
              if (models.length > 0) {
                return (
                  <we-select
                    size="sm"
                    value={modelInput()}
                    options={models.map((m) => ({ value: m, label: m }))}
                    on:change={(e: CustomEvent) => setModelInput(e.detail)}
                  />
                );
              }
              return (
                <we-input
                  value={modelInput()}
                  placeholder="model-name"
                  size="sm"
                  bg="surface"
                  on:input={(e: CustomEvent) => setModelInput(e.detail)}
                />
              );
            })()}
          </we-form-field>
          <Show when={props.variant === 'full'}>
            <we-button size="sm" variant="secondary" onClick={handleSave}>
              Update Settings
            </we-button>
          </Show>
        </Column>
      </Show>

      {/* Compact mode: save/cancel row */}
      <Show when={props.variant === 'compact'}>
        <Row gap="200" ax="end">
          <we-button size="xs" variant="ghost" onClick={() => props.onSaved?.()}>
            Cancel
          </we-button>
          <we-button size="xs" onClick={handleSave}>
            Save
          </we-button>
        </Row>
      </Show>

      {/* Health check feedback */}
      <Show when={session.healthStatus?.() === 'error'}>
        <we-text fontSize="200" color="danger-500">
          {(session as { healthError?: () => string }).healthError?.() || 'Connection failed'}
        </we-text>
      </Show>
    </Column>
  );
}

// ---------------------------------------------------------------------------
// Provider selector — shared between setup and quick-switch
// ---------------------------------------------------------------------------

function ProviderSelector(props: { size?: 'sm' | 'xs' }) {
  const session = useEditorHost().session;
  return (
    <Show when={session.providers}>
      <we-select
        size={props.size ?? 'sm'}
        value={session.activeProviderId?.() ?? 'anthropic'}
        options={session.providers!().map((p) => ({ value: p.id, label: p.name }))}
        on:change={(e: CustomEvent) => session.setActiveProvider!(e.detail)}
      />
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Provider Quick-Switch — same layout for every provider
// ---------------------------------------------------------------------------

function ProviderQuickSwitch() {
  const session = useEditorHost().session;
  const [showConfig, setShowConfig] = createSignal(false);
  // Track whether the user explicitly toggled the config panel
  const [userToggled, setUserToggled] = createSignal(false);

  // Reset user-toggle when switching providers so auto-open runs fresh
  createEffect(() => {
    void session.activeProviderId?.();
    setUserToggled(false);
  });

  // Auto-open settings when health check fails or provider needs an API key
  createEffect(() => {
    if (userToggled()) return;
    const status = session.healthStatus?.() ?? 'unknown';
    const ready = session.apiKeyConfigured();
    if (status === 'error' || !ready) setShowConfig(true);
  });

  return (
    <Column borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`} flexShrink="0">
      <Row ax="between" ay="center" px="300" py="100">
        <ProviderSelector size="xs" />
        <Row ay="center" gap="100">
          <we-tooltip title="Re-check connection">
            <we-button variant="ghost" size="xs" square onClick={() => session.checkHealth?.()}>
              <we-icon name="arrows-clockwise" size="xs" />
            </we-button>
          </we-tooltip>
          <we-tooltip title="Provider settings">
            <we-button
              variant="ghost"
              size="xs"
              square
              onClick={() => {
                setUserToggled(true);
                setShowConfig((v) => !v);
              }}
            >
              <we-icon name="gear" size="xs" />
            </we-button>
          </we-tooltip>
        </Row>
      </Row>

      <Show when={showConfig()}>
        <Column px="300" pb="300">
          <ProviderConfigForm variant="compact" onSaved={() => setShowConfig(false)} />
        </Column>
      </Show>
    </Column>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

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
      bg={isUser() ? 'primary-200' : undefined}
      maxWidth={isUser() ? '90%' : '100%'}
      alignSelf={isUser() ? 'flex-end' : 'flex-start'}
    >
      <Show when={displayContent()}>
        <we-markdown content={displayContent()} markdownGap="400" />
      </Show>
      <Show when={props.message.status === 'error'}>
        <we-text fontSize="300" color="danger-500" mt="4px">
          Failed to send
        </we-text>
      </Show>
    </Column>
  );
}
