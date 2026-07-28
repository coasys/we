// @vitest-environment jsdom
import { AssistantContext } from '@solid/stores/AssistantStore';
import { AssistantThreadList } from '@solid/components/assistant/AssistantThreadList';
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';

import { makeMockStore, sampleThreads } from './mockStore';

afterEach(cleanup);

function renderList(store = makeMockStore()) {
  return render(() => (
    <AssistantContext.Provider value={store}>
      {(<AssistantThreadList />) as JSX.Element}
    </AssistantContext.Provider>
  ));
}

describe('AssistantThreadList', () => {
  it('renders one row per thread with its title', () => {
    renderList();
    const items = screen.getAllByTestId('thread-item');
    expect(items).toHaveLength(sampleThreads.length);
    expect(screen.getByText('Weather in Melbourne')).toBeTruthy();
    expect(screen.getByText('Refactor ideas')).toBeTruthy();
  });

  it('selects a thread when its row is clicked', () => {
    const store = makeMockStore();
    renderList(store);
    (screen.getAllByTestId('thread-item')[1] as HTMLElement).click();
    expect(store.selectThread).toHaveBeenCalledWith('t2');
  });

  it('creates a new thread from the header action', () => {
    const store = makeMockStore();
    renderList(store);
    (screen.getByTestId('new-thread') as HTMLElement).click();
    expect(store.createThread).toHaveBeenCalled();
  });

  it('shows an empty state when there are no threads', () => {
    const store = makeMockStore({ threads: () => [], activeThreadId: () => null, activeThread: () => null });
    renderList(store);
    expect(screen.queryAllByTestId('thread-item')).toHaveLength(0);
    expect(screen.getByText('No chats yet')).toBeTruthy();
  });
});
