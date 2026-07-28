import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import type { Message } from '@we/models';
import { createSignal, For, Show } from 'solid-js';

import { parseToolCalls, type ToolCall } from '../../stores/AssistantStore';

/**
 * Renders a single assistant-thread message. Handles the four roles
 * (user / assistant / tool / system), markdown content, a live streaming
 * indicator, and collapsible tool-call invocation/result blocks.
 */
export function AssistantMessage(props: { message: Message }) {
  const role = () => props.message.role || 'assistant';
  const isUser = () => role() === 'user';
  const isTool = () => role() === 'tool';
  const isSystem = () => role() === 'system';
  const isStreaming = () => props.message.status === 'streaming';
  const toolCalls = () => parseToolCalls(props.message.toolCalls);
  const hasContent = () => !!props.message.content?.trim();

  return (
    <Show
      when={!isSystem()}
      fallback={
        <Row ax="center" py="100">
          <we-text fontSize="200" color="neutral-400" italic>
            {props.message.content}
          </we-text>
        </Row>
      }
    >
      <Column
        gap="200"
        r="400"
        p={isUser() ? '300' : '0'}
        bg={isUser() ? 'primary-200' : 'transparent'}
        maxWidth={isUser() ? '85%' : '100%'}
        alignSelf={isUser() ? 'flex-end' : 'flex-start'}
        styles={{ 'word-break': 'break-word' }}
      >
        {/* Role label for assistant/tool turns */}
        <Show when={!isUser()}>
          <Row ay="center" gap="150">
            <we-icon name={isTool() ? 'wrench' : 'sparkle'} size="xs" color="neutral-400" />
            <we-text fontSize="200" fontWeight="600" color="neutral-500">
              {isTool() ? 'Tool' : 'Assistant'}
            </we-text>
            <Show when={isStreaming()}>
              <we-text fontSize="200" color="primary-400">
                <span class="shimmer">streaming…</span>
              </we-text>
            </Show>
          </Row>
        </Show>

        {/* Streaming placeholder before any tokens have arrived */}
        <Show when={isStreaming() && !hasContent() && toolCalls().length === 0}>
          <we-text fontSize="300" color="neutral-400">
            <span class="shimmer">Thinking…</span>
          </we-text>
        </Show>

        {/* Message body */}
        <Show when={hasContent()}>
          <Show
            when={isTool()}
            fallback={<we-markdown content={props.message.content} markdownGap="300" />}
          >
            <CodeBlock text={props.message.content} />
          </Show>
        </Show>

        {/* Tool calls */}
        <Show when={toolCalls().length > 0}>
          <Column gap="150">
            <For each={toolCalls()}>{(call) => <ToolCallBlock call={call} />}</For>
          </Column>
        </Show>

        <Show when={props.message.status === 'error'}>
          <we-text fontSize="200" color="danger-500">
            The assistant reported an error.
          </we-text>
        </Show>
      </Column>
    </Show>
  );
}

/** A collapsible tool invocation with its arguments and (once available) result. */
function ToolCallBlock(props: { call: ToolCall }) {
  const [open, setOpen] = createSignal(false);
  const status = () => props.call.status ?? (props.call.result !== undefined ? 'complete' : 'pending');
  const statusColor = () =>
    status() === 'error' ? 'danger-500' : status() === 'complete' ? 'success-500' : 'warning-500';

  return (
    <Column
      r="300"
      border={`1px solid ${tokenVar('color', 'ui-200')}`}
      bg="neutral-50"
      styles={{ overflow: 'hidden' }}
    >
      <Row
        ay="center"
        gap="200"
        px="300"
        py="200"
        cursor="pointer"
        hoverProps={{ bg: 'neutral-100' }}
        onClick={() => setOpen((v) => !v)}
      >
        <we-icon name={open() ? 'caret-down' : 'caret-right'} size="xs" color="neutral-500" />
        <we-icon name="wrench" size="xs" color="neutral-500" />
        <we-text fontSize="250" fontWeight="600" color="neutral-700" styles={{ flex: '1', 'min-width': '0' }}>
          {props.call.name || 'tool'}
        </we-text>
        <we-text fontSize="150" fontWeight="600" color={statusColor()}>
          {status()}
        </we-text>
      </Row>
      <Show when={open()}>
        <Column gap="200" px="300" py="200" borderTop={`1px solid ${tokenVar('color', 'ui-200')}`}>
          <we-text fontSize="150" fontWeight="600" color="neutral-500">
            Arguments
          </we-text>
          <CodeBlock text={formatJson(props.call.input)} />
          <Show when={props.call.result !== undefined}>
            <we-text fontSize="150" fontWeight="600" color="neutral-500">
              Result
            </we-text>
            <CodeBlock text={formatJson(props.call.result)} />
          </Show>
        </Column>
      </Show>
    </Column>
  );
}

function CodeBlock(props: { text: string }) {
  return (
    <div
      style={{
        'font-family': 'var(--we-font-mono, ui-monospace, monospace)',
        'font-size': '12px',
        'white-space': 'pre-wrap',
        'word-break': 'break-word',
        background: tokenVar('color', 'neutral-100'),
        color: tokenVar('color', 'neutral-700'),
        padding: '8px 10px',
        'border-radius': '6px',
        overflow: 'auto',
        'max-height': '320px',
      }}
    >
      {props.text}
    </div>
  );
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
