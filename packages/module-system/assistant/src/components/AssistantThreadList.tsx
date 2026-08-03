import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import { For, Show } from 'solid-js';

import { useAssistantStore } from '../store';

/**
 * Left pane of the AI-assistant surface: the thread list for the current neighbourhood,
 * plus a new-chat action. Many threads per neighbourhood; selecting one drives the
 * centre thread view.
 */
export function AssistantThreadList() {
  const store = useAssistantStore();

  async function newChat() {
    await store.createThread();
  }

  return (
    <Column
      data-testid="assistant-thread-list"
      width="260px"
      height="100%"
      bg="neutral-25"
      borderRight={`1px solid ${tokenVar('color', 'ui-200')}`}
      styles={{ 'flex-shrink': '0' }}
    >
      {/* Header */}
      <Row
        ay="center"
        ax="between"
        px="300"
        py="300"
        borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
        styles={{ 'flex-shrink': '0' }}
      >
        <we-text fontSize="400" fontWeight="600">
          Chats
        </we-text>
        <we-tooltip title="New chat">
          <we-button data-testid="new-thread" variant="ghost" size="sm" square onClick={newChat}>
            <we-icon name="plus" size="sm" />
          </we-button>
        </we-tooltip>
      </Row>

      {/* Thread list */}
      <Column flex="1" overflow="auto" p="200" gap="50">
        <Show
          when={store.threads().length > 0}
          fallback={
            <Column ax="center" gap="200" p="400">
              <we-text fontSize="250" color="neutral-400" styles={{ 'text-align': 'center' }}>
                No chats yet
              </we-text>
              <we-button size="sm" variant="secondary" onClick={newChat}>
                <we-icon name="plus" size="xs" />
                <we-text fontSize="250">New chat</we-text>
              </we-button>
            </Column>
          }
        >
          <For each={store.threads()}>
            {(thread) => {
              const active = () => thread.id === store.activeThreadId();
              return (
                <Row
                  data-testid="thread-item"
                  ay="center"
                  gap="200"
                  px="200"
                  py="200"
                  r="300"
                  cursor="pointer"
                  bg={active() ? 'neutral-150' : 'transparent'}
                  hoverProps={{ bg: active() ? 'neutral-150' : 'neutral-100' }}
                  onClick={() => store.selectThread(thread.id)}
                >
                  <we-icon name="chat-circle" size="xs" color="neutral-400" />
                  <we-text
                    fontSize="300"
                    fontWeight={active() ? '600' : '400'}
                    color={active() ? 'neutral-900' : 'neutral-700'}
                    styles={{
                      flex: '1',
                      'min-width': '0',
                      'white-space': 'nowrap',
                      overflow: 'hidden',
                      'text-overflow': 'ellipsis',
                    }}
                  >
                    {thread.title || 'Untitled'}
                  </we-text>
                  <we-button
                    variant="ghost"
                    size="xs"
                    square
                    onClick={(e: MouseEvent) => {
                      e.stopPropagation();
                      void store.deleteThread(thread.id);
                    }}
                  >
                    <we-icon name="trash" size="xs" color="neutral-400" />
                  </we-button>
                </Row>
              );
            }}
          </For>
        </Show>
      </Column>
    </Column>
  );
}
