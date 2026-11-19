/**
 * The chats on a phone: a sheet over the space instead of a window beside it.
 *
 * `chatStore.openChat` sends everything narrow here rather than to a panel — on a phone the global
 * chat and a space's chat are the same shape: the sheet, dragged up for the full screen, or down to
 * put it away. Rendered at the app template's root so it can cover everything but the rail.
 *
 * It is a dialog while it is up: focus goes into it, stays in it (Tab wraps at the ends), Escape
 * puts it away, and the handle is a real button — the drag is a gesture, but a keyboard needs
 * something to press.
 */
import { createSignal, onCleanup, Show } from 'solid-js';

import { useChatStore } from '../../stores/ChatStore';
import AgentChat from './AgentChat';

/** How tall the sheet sits before being pulled up — most of the screen, the space still behind it. */
const RESTING = '78dvh';

/** What a keyboard can reach inside the sheet — the trap cycles over these. */
const FOCUSABLE =
  'button, [href], input, textarea, select, details, [tabindex]:not([tabindex="-1"]), we-button, we-input';

export function AgentChatSheet() {
  const chat = useChatStore();
  const [raised, setRaised] = createSignal(false);
  let sheet!: HTMLDivElement;

  const focusables = () =>
    [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'));

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      chat.closeSheet();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && at <= 0) {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (!e.shiftKey && (at === -1 || at === items.length - 1)) {
      e.preventDefault();
      items[0].focus();
    }
  }

  return (
    <Show when={chat.sheet()}>
      {(input) => {
        // Whoever had focus gets it back when the sheet goes away — the button that asked for it.
        const back = document.activeElement as HTMLElement | null;
        onCleanup(() => back?.focus?.());
        return (
          <div
            ref={(el) => {
              sheet = el;
              // Focus goes in when it opens — the handle first, since it is also the way back.
              queueMicrotask(() => (focusables()[0] ?? el).focus());
            }}
            data-testid="agent-chat-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={input().spaceName ? `Chat in ${input().spaceName}` : 'Chat'}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            style={{
              position: 'fixed',
              left: '0',
              right: '0',
              bottom: '0',
              height: raised() ? '100dvh' : RESTING,
              'z-index': 'var(--we-z-modal, 60)',
              display: 'flex',
              'flex-direction': 'column',
              background: 'var(--we-color-surface, #181926)',
              'border-top-left-radius': 'var(--we-radius-500, 16px)',
              'border-top-right-radius': 'var(--we-radius-500, 16px)',
              'box-shadow': '0 -8px 40px rgb(0 0 0 / 0.45)',
              transition: 'height 160ms ease',
              /*
                The bottom row clears two things painted over the window's lower edge: the home
                indicator (`safe-area-inset-bottom`, 0 where there is none) and the connect
                button's corner bar, which a sheet cannot move and must sit above — 44px is that
                bar's band (34px button at 10px in). On a phone with a real inset the larger one
                wins.
              */
              'padding-bottom': 'max(env(safe-area-inset-bottom, 0px), 44px)',
            }}
          >
            {/*
            The handle is the gesture and the button both: drag up for the full screen, down far to
            put it away — or press it for the same. `touch-action: none` so the drag is the sheet's
            and never the page scrolling underneath.
          */}
            <button
              type="button"
              aria-label={raised() ? 'Lower the chat sheet' : 'Raise the chat sheet'}
              style={{
                padding: '10px 0 6px',
                cursor: 'grab',
                'flex-shrink': '0',
                'text-align': 'center',
                background: 'none',
                border: 'none',
                width: '100%',
                'touch-action': 'none',
              }}
              onClick={() => setRaised((r) => !r)}
              onPointerDown={(e) => {
                const startY = e.clientY;
                const move = (ev: PointerEvent) => {
                  if (startY - ev.clientY > 40) setRaised(true);
                  if (ev.clientY - startY > 60) chat.closeSheet();
                };
                const done = () => {
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', done);
                  window.removeEventListener('pointercancel', done);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', done);
                window.addEventListener('pointercancel', done);
              }}
            >
              <div
                style={{
                  display: 'inline-block',
                  width: '44px',
                  height: '5px',
                  'border-radius': '999px',
                  background: 'var(--we-color-border-strong, #3a3b52)',
                }}
              />
            </button>
            <div style={{ position: 'absolute', top: '8px', right: '12px', 'z-index': '1' }}>
              <we-button variant="bare" size="sm" aria-label="Close" onClick={() => chat.closeSheet()}>
                <we-icon name="x" size="sm" />
              </we-button>
            </div>
            <div style={{ flex: '1', 'min-height': '0', display: 'flex' }}>
              <AgentChat inputs={input()} />
            </div>
          </div>
        );
      }}
    </Show>
  );
}

export default AgentChatSheet;
