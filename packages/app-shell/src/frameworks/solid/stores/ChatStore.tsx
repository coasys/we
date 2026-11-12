/**
 * ChatStore — the two ways into the AI chats the executor keeps.
 *
 * One entry point for "open the chat": the shell rail's sparkle asks with no scope (the global
 * chat, which reaches everything the app's token does) and a space's "Find or ask" asks with that
 * space's perspective (the space chat, whose tools may only act there).
 *
 * ## Where a chat opens is a viewport question, not two features
 *
 * Given the room, a chat is a panel like any other — `shellStore.openPanel` on a declaration the
 * app template carries (`chat-global` docks at the right, `chat-space` floats over the space, and
 * both can then be moved, resized, docked and shrunk the way every panel can). Below
 * `NARROW_VIEWPORT_PX` a card over the page leaves nothing usable of either, so the same request
 * becomes a sheet over the space instead: the content stays behind it and the sheet drags up to
 * take the screen. `sheet` is what `AgentChatSheet` reads to know it is wanted; a phone opening
 * never touches the panel system.
 *
 * What the opened chat then shows — which conversation, a draft question waiting to be sent —
 * travels as the panel instance's inputs (or the sheet's), so the same `openChat` serves "open the
 * chats", "ask this in this space" and "ask this globally instead".
 */
import { NARROW_VIEWPORT_PX } from '@shared/dockGeometry';
import { type Accessor, createContext, createSignal, type ParentProps, useContext } from 'solid-js';

import { useShellStore } from './ShellStore';

/** What `openChat` carries: the panel it wants, and the inputs to open it with. */
export interface ChatOpen {
  /**
   * The perspective the chat is scoped to — set by a space's ask, absent for the global chat.
   * A scoped chat's tools may only act in that one perspective.
   */
  perspectiveUuid?: string;
  /** The space's own name, for the badge the scoped chat wears. */
  spaceName?: string;
  /** A question waiting to be asked — the chat creates a fresh conversation and sends it. */
  draft?: string;
  /**
   * When `draft` was stamped, so asking the same words twice still asks twice — the chat consumes a
   * draft by this key rather than by its text.
   */
  at?: number;
}

export interface ChatStore {
  /**
   * Open a chat. No `perspectiveUuid` is the global chat; with one, the chat scoped to that
   * perspective. `draft` sends itself once the chat is up.
   */
  openChat: (input?: ChatOpen) => void;
  /** The sheet a narrow window opens instead of a panel — what it was asked for, or null. */
  sheet: Accessor<ChatOpen | null>;
  closeSheet: () => void;
  /** Below the width where a floating panel stops being usable — where `openChat` sends chats. */
  isNarrow: Accessor<boolean>;
}

/** The panel the request lands in, on a window with room for panels. */
function panelFor(input: ChatOpen): string {
  return input.perspectiveUuid ? 'chat-space' : 'chat-global';
}

/** One window per place a chat is about: the global chat, or the space's own. */
function keyFor(input: ChatOpen): string {
  return input.perspectiveUuid ?? 'global';
}

export function ChatStoreProvider(props: ParentProps) {
  const shellStore = useShellStore();

  const [isNarrow, setNarrow] = createSignal(
    typeof window === 'undefined' ? false : window.innerWidth < NARROW_VIEWPORT_PX,
  );
  if (typeof window !== 'undefined') {
    const onResize = () => setNarrow(window.innerWidth < NARROW_VIEWPORT_PX);
    window.addEventListener('resize', onResize);
  }

  const [sheet, setSheet] = createSignal<ChatOpen | null>(null);

  const store: ChatStore = {
    openChat: (input = {}) => {
      // A draft is consumed once per ask — stamped here so the same words asked twice still ask.
      const request = input.draft ? { ...input, at: Date.now() } : input;
      if (isNarrow()) {
        setSheet(request);
        return;
      }
      shellStore.openPanel(panelFor(request), request as Record<string, unknown>, { key: keyFor(request) });
    },
    sheet,
    closeSheet: () => setSheet(null),
    isNarrow,
  };

  return <ChatContext.Provider value={store}>{props.children}</ChatContext.Provider>;
}

const ChatContext = createContext<ChatStore>();

export function useChatStore(): ChatStore {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatStore must be used within ChatStoreProvider');
  return ctx;
}

export default ChatStoreProvider;
