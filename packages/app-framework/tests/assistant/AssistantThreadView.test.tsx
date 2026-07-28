// @vitest-environment jsdom
import { AssistantContext } from '@solid/stores/AssistantStore';
import { AssistantThreadView } from '@solid/components/assistant/AssistantThreadView';
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';

import { makeMockStore, sampleMessages } from './mockStore';

afterEach(cleanup);

function renderView(store = makeMockStore()) {
  return render(() => (
    <AssistantContext.Provider value={store}>
      {(<AssistantThreadView />) as JSX.Element}
    </AssistantContext.Provider>
  ));
}

describe('AssistantThreadView', () => {
  it('renders the active thread with a bubble per message', () => {
    const { container } = renderView();
    expect(screen.getByTestId('assistant-thread-view')).toBeTruthy();
    // All four non-system messages render as bubbles.
    expect(screen.getAllByTestId('assistant-message')).toHaveLength(sampleMessages.length);
    // The assistant message carrying tool calls renders a tool-call block.
    expect(screen.getByTestId('tool-call')).toBeTruthy();
    // Header shows the thread title + the active assistant name.
    expect(screen.getByText('Weather in Melbourne')).toBeTruthy();
    expect(screen.getByText('Research Assistant')).toBeTruthy();
    // A model-override <select> is present in the header.
    expect(container.querySelector('select')).toBeTruthy();
  });

  it('lists the discovered models in the per-thread override selector', () => {
    const { container } = renderView();
    const options = Array.from(container.querySelectorAll('select option')).map((o) => o.textContent);
    expect(options.some((t) => t?.includes('llama-3.1-8b'))).toBe(true);
    expect(options.some((t) => t?.includes('qwen2.5-coder'))).toBe(true);
  });

  it('writes a user message when the composer is submitted', () => {
    const store = makeMockStore();
    renderView(store);
    const input = screen.getByTestId('composer-input');
    input.dispatchEvent(new CustomEvent('input', { detail: 'What is the forecast?', bubbles: true }));
    (screen.getByTestId('composer-send') as HTMLElement).click();
    expect(store.sendMessage).toHaveBeenCalledWith('What is the forecast?');
  });

  it('shows a placeholder when no thread is selected', () => {
    const store = makeMockStore({ activeThread: () => null, activeThreadId: () => null });
    renderView(store);
    expect(screen.getByTestId('thread-view-empty')).toBeTruthy();
    expect(screen.getByText('No conversation selected')).toBeTruthy();
  });

  it('renders a streaming assistant message with a live indicator', () => {
    const streaming = [
      sampleMessages[0],
      { ...sampleMessages[3], id: 'sm', content: 'Working on it', status: 'streaming' },
    ];
    const store = makeMockStore({
      messages: () => streaming as typeof sampleMessages,
      streamingMessageId: () => 'sm',
    });
    renderView(store);
    expect(screen.getByText('streaming…')).toBeTruthy();
  });
});
