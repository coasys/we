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
import { APP_PANEL_SCOPE } from '@shared/registries/panelInstances';
import { type Accessor, createContext, createSignal, onCleanup, type ParentProps, untrack, useContext } from 'solid-js';

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
  /**
   * Whether the draft this request carries was already asked — by `at`, so the same words asked
   * twice still ask, but a remount or reload reading the same inputs does not.
   */
  draftConsumed: (input: ChatOpen) => boolean;
  /**
   * Mark an opening draft asked — the chat calls this as its ask starts, whatever the ask goes on
   * to do. Persisted: the instance inputs keep carrying `draft`/`at`, and only this says they are
   * spent.
   */
  consumeDraft: (input: ChatOpen) => void;
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

/**
 * The `at` a window's opening draft was asked under, per window — the spent stamps the inputs
 * cannot say themselves.
 *
 * Persisted beside the panel instances, which is what makes it work: a draft survives in the
 * instance's inputs across a reload by design, so whether it has run must be remembered somewhere
 * just as durable — a component-local guard forgets on every remount and asks the question again.
 */
const CONSUMED_KEY = 'we-local:chat.consumedDrafts';

function loadConsumed(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(CONSUMED_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveConsumed(consumed: Record<string, number>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CONSUMED_KEY, JSON.stringify(consumed));
  } catch {
    // A forgotten stamp re-asks a question on the next remount — a miss, not a loss.
  }
}

export function ChatStoreProvider(props: ParentProps) {
  const shellStore = useShellStore();

  const [isNarrow, setNarrow] = createSignal(
    typeof window === 'undefined' ? false : window.innerWidth < NARROW_VIEWPORT_PX,
  );
  if (typeof window !== 'undefined') {
    const onResize = () => setNarrow(window.innerWidth < NARROW_VIEWPORT_PX);
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  }

  const [sheet, setSheet] = createSignal<ChatOpen | null>(null);
  const [consumed, setConsumed] = createSignal<Record<string, number>>(loadConsumed());
  /*
    `at` must move forward even inside one millisecond: two asks stamped the same would read as one
    ask to `draftConsumed`, and the second question would never go.
  */
  let lastAt = 0;

  const store: ChatStore = {
    openChat: (input = {}) => {
      /*
        A space's ask that names its perspective but carries no id (the space's local perspective
        not loaded yet) is not a request for the global chat: opening one would answer a question
        about one space with a chat that reaches all of them.
      */
      if ('perspectiveUuid' in input && !input.perspectiveUuid) {
        console.warn('ChatStore: a space chat was asked for before its perspective was known; not opened');
        return;
      }
      // A draft is consumed once per ask — stamped here so the same words asked twice still ask.
      const request = input.draft ? { ...input, at: (lastAt = Math.max(Date.now(), lastAt + 1)) } : input;
      if (isNarrow()) {
        setSheet(request);
        return;
      }
      // The app's own scope: a chat is about the app (or the space its inputs name), not about the
      // interface it happened to open in — so it stays open across spaces.
      shellStore.openPanel(panelFor(request), request as Record<string, unknown>, {
        key: keyFor(request),
        scope: APP_PANEL_SCOPE,
      });
    },
    draftConsumed: (input) => input.at !== undefined && untrack(consumed)[keyFor(input)] === input.at,
    consumeDraft: (input) => {
      if (input.at === undefined) return;
      const next = { ...consumed(), [keyFor(input)]: input.at };
      setConsumed(next);
      saveConsumed(next);
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
