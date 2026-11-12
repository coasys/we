/*
 * A space's ask opens that space's chat or nothing — never the global chat.
 *
 * "Find or ask" passes the space's local perspective id. Before the space's dataset has loaded that
 * id is undefined, and a store that read "no id" as "global" would answer a question about one
 * space with a chat that reaches every space.
 */
import { render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatStore } from '../src/frameworks/solid/stores/ChatStore';
import { ChatStoreProvider, useChatStore } from '../src/frameworks/solid/stores/ChatStore';

const openPanel = vi.fn(() => '');

vi.mock('../src/frameworks/solid/stores/ShellStore', () => ({
  useShellStore: () => ({ openPanel }),
}));

function withStore(): ChatStore {
  let store: ChatStore | undefined;
  render(() => (
    <ChatStoreProvider>
      {(() => {
        store = useChatStore();
        return null;
      })()}
    </ChatStoreProvider>
  ));
  return store!;
}

afterEach(() => {
  openPanel.mockClear();
  vi.restoreAllMocks();
});

describe('opening a chat', () => {
  it('opens nothing for a space ask whose perspective is not known yet', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = withStore();
    store.openChat({ perspectiveUuid: undefined, spaceName: 'Garden', draft: 'what is here?' });
    store.openChat({ perspectiveUuid: '', spaceName: 'Garden', draft: 'what is here?' });
    expect(openPanel).not.toHaveBeenCalled();
    expect(store.sheet()).toBeNull();
  });

  it('opens the space chat for a space ask with its perspective', () => {
    const store = withStore();
    store.openChat({ perspectiveUuid: '61d5c775-9cdf-4cbe-aa23-19ed212b108b', spaceName: 'Garden' });
    expect(openPanel).toHaveBeenCalledWith(
      'chat-space',
      expect.objectContaining({ perspectiveUuid: '61d5c775-9cdf-4cbe-aa23-19ed212b108b' }),
      expect.objectContaining({ key: '61d5c775-9cdf-4cbe-aa23-19ed212b108b' }),
    );
  });

  it('opens the global chat when no perspective was named at all', () => {
    const store = withStore();
    store.openChat();
    expect(openPanel).toHaveBeenCalledWith(
      'chat-global',
      expect.anything(),
      expect.objectContaining({ key: 'global' }),
    );
  });
});
