import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import { createEffect, createSignal, For, Show } from 'solid-js';

import { useAssistantStore } from '../../stores/AssistantStore';
import { AssistantMessage } from './AssistantMessage';

/**
 * Centre pane of the AI-assistant surface: the active thread's message list (with live
 * streaming + tool-call rendering) and the composer. Sending writes a user Message into
 * the thread's perspective; the assistant's reply arrives from the AD4M backend via the
 * store's live subscription.
 */
export function AssistantThreadView() {
  const store = useAssistantStore();
  const [input, setInput] = createSignal('');
  let endRef: HTMLDivElement | undefined;

  // Auto-scroll to the latest message / streaming update.
  createEffect(() => {
    void store.messages().length;
    void store.messages().find((m) => m.status === 'streaming')?.content;
    // Optional call — scrollIntoView is unavailable in some environments (e.g. jsdom under test).
    requestAnimationFrame(() => endRef?.scrollIntoView?.({ behavior: 'smooth' }));
  });

  function handleSend() {
    const text = input().trim();
    if (!text || !store.activeThreadId()) return;
    void store.sendMessage(text);
    setInput('');
  }

  const effectiveModel = () => {
    const thread = store.activeThread();
    return thread?.modelId || store.activeAssistant()?.modelId || '';
  };

  return (
    <Show
      when={store.activeThread()}
      fallback={
        <Column data-testid="thread-view-empty" ax="center" ay="center" flex="1" gap="200" p="600">
          <we-icon name="chat-circle-dots" size="lg" color="neutral-300" />
          <we-text fontSize="400" color="neutral-500">
            No conversation selected
          </we-text>
          <we-text fontSize="300" color="neutral-400">
            Create a new chat to talk to an assistant.
          </we-text>
        </Column>
      }
    >
      {(thread) => (
        <Column data-testid="assistant-thread-view" flex="1" height="100%" styles={{ 'min-width': '0' }}>
          {/* Header */}
          <Row
            ay="center"
            ax="between"
            gap="300"
            px="400"
            py="300"
            borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
            styles={{ 'flex-shrink': '0' }}
          >
            <Column gap="50" styles={{ 'min-width': '0' }}>
              <we-text fontSize="400" fontWeight="600" styles={{ 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' }}>
                {thread().title || 'Untitled'}
              </we-text>
              <we-text fontSize="200" color="neutral-400">
                {store.activeAssistant()?.name ?? 'No assistant'}
              </we-text>
            </Column>

            {/* Per-thread model override */}
            <Row ay="center" gap="150">
              <we-icon name="cpu" size="xs" color="neutral-400" />
              <select
                value={thread().modelId || ''}
                onChange={(e) => void store.setThreadModel(thread().id, e.currentTarget.value)}
                style={selectStyle()}
              >
                <option value="">{`Assistant default${store.activeAssistant()?.modelId ? ` (${store.activeAssistant()?.modelId})` : ''}`}</option>
                <For each={store.models()}>{(m) => <option value={m}>{m}</option>}</For>
              </select>
            </Row>
          </Row>

          {/* Messages */}
          <Column flex="1" gap="400" p="400" overflow="auto" styles={{ 'scrollbar-gutter': 'stable' }}>
            <Show
              when={store.messages().length > 0}
              fallback={
                <Column ax="center" ay="center" flex="1" gap="100">
                  <we-text fontSize="300" color="neutral-400">
                    Send a message to begin.
                  </we-text>
                  <we-text fontSize="200" color="neutral-300">
                    Replies are produced by the AD4M assistant backend.
                  </we-text>
                </Column>
              }
            >
              <For each={store.messages()}>{(msg) => <AssistantMessage message={msg} />}</For>
            </Show>
            <div ref={endRef} />
          </Column>

          {/* Composer */}
          <Row
            ay="end"
            gap="200"
            p="400"
            borderTop={`1px solid ${tokenVar('color', 'ui-200')}`}
            styles={{ 'flex-shrink': '0' }}
          >
            <we-textarea
              data-testid="composer-input"
              value={input()}
              placeholder="Message the assistant…"
              rows={1}
              resize="none"
              flex="1"
              maxHeight="180px"
              on:input={(e: CustomEvent) => setInput(e.detail as string)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              styles={{ 'overflow-y': 'auto' }}
            />
            <we-button data-testid="composer-send" size="sm" onClick={handleSend} disabled={input().trim() === ''}>
              <we-icon name="paper-plane-tilt" size="sm" />
            </we-button>
          </Row>
        </Column>
      )}
    </Show>
  );
}

function selectStyle(): Record<string, string> {
  return {
    'font-size': '12px',
    padding: '4px 8px',
    'border-radius': '6px',
    border: `1px solid ${tokenVar('color', 'ui-200')}`,
    background: tokenVar('color', 'neutral-0'),
    color: tokenVar('color', 'neutral-700'),
    'max-width': '220px',
    cursor: 'pointer',
  };
}
