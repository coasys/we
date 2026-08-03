// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';

import { AssistantMessage } from '../src/components/AssistantMessage';
import type { Message } from '../src/models';
import { sampleMessages, toolCallsJson } from './mockStore';

function msg(over: Partial<Message>): Message {
  return {
    id: 'x',
    threadId: 't1',
    role: 'assistant',
    content: '',
    toolCalls: '',
    ts: '',
    status: 'complete',
    ...over,
  } as unknown as Message;
}

afterEach(cleanup);

describe('AssistantMessage', () => {
  it('renders a user message bubble with markdown content', () => {
    const { container } = render(() => <AssistantMessage message={sampleMessages[0]} />);
    const bubble = screen.getByTestId('assistant-message');
    expect(bubble.getAttribute('data-role')).toBe('user');
    const md = container.querySelector('we-markdown');
    expect(md).toBeTruthy();
    const content = md?.getAttribute('content') ?? (md as unknown as { content?: string })?.content;
    expect(content).toContain('weather in Melbourne');
  });

  it('renders an assistant message with an "Assistant" label', () => {
    const { container } = render(() => <AssistantMessage message={sampleMessages[3]} />);
    expect(screen.getByTestId('assistant-message').getAttribute('data-role')).toBe('assistant');
    expect(screen.getByText('Assistant')).toBeTruthy();
    expect(container.querySelector('we-markdown')).toBeTruthy();
  });

  it('renders a collapsible tool-call block that expands on click', () => {
    render(() => <AssistantMessage message={sampleMessages[1]} />);
    const toolCall = screen.getByTestId('tool-call');
    // Collapsed: header shows the tool name + status, body is hidden.
    expect(within(toolCall).getByText('get_weather')).toBeTruthy();
    expect(within(toolCall).getByText('complete')).toBeTruthy();
    expect(screen.queryByTestId('tool-call-body')).toBeNull();

    // Expand: body reveals Arguments + Result sections.
    (screen.getByTestId('tool-call-header') as HTMLElement).click();
    const body = screen.getByTestId('tool-call-body');
    expect(within(body).getByText('Arguments')).toBeTruthy();
    expect(within(body).getByText('Result')).toBeTruthy();
    // The rendered JSON args/result are present as text.
    expect(body.textContent).toContain('Melbourne');
    expect(body.textContent).toContain('14');
  });

  it('renders a tool-role message with its result text and a "Tool" label', () => {
    render(() => <AssistantMessage message={sampleMessages[2]} />);
    expect(screen.getByTestId('assistant-message').getAttribute('data-role')).toBe('tool');
    expect(screen.getByText('Tool')).toBeTruthy();
    // Tool content renders as a code block (light DOM text, not markdown).
    expect(screen.getByTestId('assistant-message').textContent).toContain('cloudy');
  });

  it('shows a streaming indicator while an assistant message is streaming', () => {
    render(() => <AssistantMessage message={msg({ role: 'assistant', content: '', status: 'streaming' })} />);
    expect(screen.getByText('Thinking…')).toBeTruthy();
  });

  it('shows a "streaming…" tag once streamed tokens have started arriving', () => {
    render(() => (
      <AssistantMessage message={msg({ role: 'assistant', content: 'partial answer', status: 'streaming' })} />
    ));
    expect(screen.getByText('streaming…')).toBeTruthy();
  });

  it('renders a system message as centered italic note', () => {
    render(() => <AssistantMessage message={msg({ role: 'system', content: 'Context cleared.' })} />);
    expect(screen.getByText('Context cleared.')).toBeTruthy();
    // System messages are not rendered as a role bubble.
    expect(screen.queryByTestId('assistant-message')).toBeNull();
  });

  it('has valid tool-call fixture JSON', () => {
    expect(() => JSON.parse(toolCallsJson)).not.toThrow();
  });
});
