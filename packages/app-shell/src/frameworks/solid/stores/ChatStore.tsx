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
 * ## A question never travels in the inputs
 *
 * What the opened chat shows travels as the panel instance's inputs — and those are *data*:
 * persisted in localStorage, published on `panelInstances`, readable and replayable by any
 * template. A question put there would be sent by whatever rendered the inputs, however it got
 * them — which is how `{ draft, at }` in a template's own `openPanel` used to send. Instead
 * `openChat` keeps the question itself, in host memory, behind a nonce it issues; the inputs carry
 * only the nonce, and the chat body spends it once against `takePending`. A nonce a template
 * invents answers nothing — the map only holds what a real `openChat` wrote — and a `draft` it
 * forges is just an input nothing reads.
 */
import { NARROW_VIEWPORT_PX } from '@shared/dockGeometry';
import { APP_PANEL_SCOPE } from '@shared/registries/panelInstances';
import { type Accessor, createContext, createSignal, onCleanup, type ParentProps, useContext } from 'solid-js';

import { useShellStore } from './ShellStore';

/** What `openChat` carries: where the chat is scoped, and what it was asked to say. */
export interface ChatOpen {
  /**
   * The perspective the chat is scoped to — set by a space's ask, absent for the global chat.
   * A scoped chat's tools may only act in that one perspective.
   */
  perspectiveUuid?: string;
  /** The space's own name, for the badge the scoped chat wears. */
  spaceName?: string;
  /**
   * A question the chat asks once it is open. Host code only: this is the call the gesture gate
   * stands in front of, and the question is held in the store until the chat body spends the
   * nonce it was issued — never written into the persisted, template-readable panel inputs.
   */
  draft?: string;
  /**
   * Words to put in the composer without sending — what a template's ask is rewritten to. The
   * person reads them, edits them, and presses Send themselves: a template may fill the field,
   * never send the question.
   */
  prefill?: string;
}

/**
 * What an opened chat is told — the panel's inputs, or the sheet's request. Plain data, kept by
 * the panel system: deliberately *not* a question, which is why a forged `{ draft, at }` here
 * sends nothing.
 */
export interface ChatInputs {
  perspectiveUuid?: string;
  spaceName?: string;
  /** Words in the composer, not sent — see {@link ChatOpen.prefill}. */
  prefill?: string;
  /**
   * The one-time key for the question this open asked for, where it carried one. Spends the entry
   * `openChat` wrote — a value nobody issued answers nothing.
   */
  nonce?: string;
}

/** The question an issued nonce answers — kept in the store, spent once. */
export interface PendingQuestion {
  text: string;
  /** The scope it was asked in — bound at issue, so a stolen nonce cannot redirect it. */
  perspectiveUuid?: string;
}

export interface ChatStore {
  /**
   * Open a chat. No `perspectiveUuid` is the global chat; with one, the chat scoped to that
   * perspective. `draft` asks once the chat is up; `prefill` only fills its composer.
   */
  openChat: (input?: ChatOpen) => void;
  /**
   * The question an open was issued for, by nonce — spending it: a second read answers nothing.
   * WIRING so no template can call it: the chat body reads it, nothing else may.
   */
  takePending: (nonce: string) => PendingQuestion | undefined;
  /**
   * The conversation open in a chat window, remembered per scope while the app runs.
   *
   * A space switch hides the panel, which unmounts the body and loses `active` with it — so the
   * chat kept coming back to its list instead of the conversation it was in. Kept here, a plain
   * map for the session's lifetime: reopening the space's chat finds the conversation it had.
   */
  rememberConversation: (
    key: string,
    conversation: { ref: { id: string }; title: string; scope?: string } | null,
  ) => void;
  /** What {@link rememberConversation} kept for a chat window — undefined for the list. */
  rememberedConversation: (key: string) => { ref: { id: string }; title: string; scope?: string } | undefined;
  /** The sheet a narrow window opens instead of a panel — what it was asked for, or null. */
  sheet: Accessor<ChatInputs | null>;
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
    onCleanup(() => window.removeEventListener('resize', onResize));
  }

  const [sheet, setSheet] = createSignal<ChatInputs | null>(null);
  /*
    Questions an open was issued for, by nonce — host memory, not persisted, so a nonce cannot
    outlive the session that made it or arrive anywhere but the chat that asks for it. Entries
    leave on `takePending` or stay small: one per ask, which is how many a person makes.
  */
  const pending = new Map<string, PendingQuestion>();
  // Which conversation each chat window had open — see `rememberConversation`.
  const open = new Map<string, { ref: { id: string }; title: string; scope?: string }>();

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
      const inputs: ChatInputs = {};
      if (input.perspectiveUuid) inputs.perspectiveUuid = input.perspectiveUuid;
      if (input.spaceName) inputs.spaceName = input.spaceName;
      if (input.prefill) inputs.prefill = input.prefill;
      /*
        A question to send travels as a nonce only: the inputs stay data — safe to persist, to
        publish, and for a template to read or replay — while the question itself waits here.
        Unguessable, so a template reading the inputs cannot forge one for a question it made up.
      */
      if (typeof input.draft === 'string' && input.draft.trim()) {
        const nonce = crypto.randomUUID();
        pending.set(nonce, { text: input.draft, perspectiveUuid: input.perspectiveUuid });
        inputs.nonce = nonce;
      }
      if (isNarrow()) {
        setSheet(inputs);
        return;
      }
      // The app's own scope: a chat is about the app (or the space its inputs name), not about the
      // interface it happened to open in — so it stays open across spaces.
      shellStore.openPanel(panelFor(input), inputs as Record<string, unknown>, {
        key: keyFor(input),
        scope: APP_PANEL_SCOPE,
      });
    },
    takePending: (nonce) => {
      const found = pending.get(nonce);
      if (found) pending.delete(nonce);
      return found;
    },
    rememberConversation: (key, conversation) => {
      if (conversation) open.set(key, conversation);
      else open.delete(key);
    },
    rememberedConversation: (key) => open.get(key),
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
