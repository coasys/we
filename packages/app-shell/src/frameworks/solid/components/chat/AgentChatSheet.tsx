/**
 * The chats on a phone: a sheet over the space instead of a window beside it.
 *
 * `chatStore.openChat` sends everything narrow here rather than to a panel — on a phone the global
 * chat and a space's chat are the same shape: the sheet, dragged up for the full screen, or down to
 * put it away. Rendered at the app template's root so it can cover everything but the rail.
 */
import { createSignal, Show } from 'solid-js';

import { useChatStore } from '../../stores/ChatStore';
import AgentChat from './AgentChat';

/** How tall the sheet sits before being pulled up — most of the screen, the space still behind it. */
const RESTING = '78vh';

export function AgentChatSheet() {
  const chat = useChatStore();
  const [raised, setRaised] = createSignal(false);

  return (
    <Show when={chat.sheet()}>
      {(input) => (
        <div
          data-testid="agent-chat-sheet"
          style={{
            position: 'fixed',
            left: '0',
            right: '0',
            bottom: '0',
            height: raised() ? '100vh' : RESTING,
            'z-index': 'var(--we-z-modal, 60)',
            display: 'flex',
            'flex-direction': 'column',
            background: 'var(--we-color-surface, #181926)',
            'border-top-left-radius': 'var(--we-radius-500, 16px)',
            'border-top-right-radius': 'var(--we-radius-500, 16px)',
            'box-shadow': '0 -8px 40px rgb(0 0 0 / 0.45)',
            transition: 'height 160ms ease',
          }}
        >
          {/* The handle is the gesture: drag up for the full screen, tap to put it back. */}
          <div
            style={{ padding: '10px 0 6px', cursor: 'grab', 'flex-shrink': '0', 'text-align': 'center' }}
            onClick={() => setRaised((r) => !r)}
            onPointerDown={(e) => {
              const startY = e.clientY;
              const move = (ev: PointerEvent) => {
                if (startY - ev.clientY > 40) setRaised(true);
                if (ev.clientY - startY > 60) chat.closeSheet();
              };
              const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
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
          </div>
          <div style={{ position: 'absolute', top: '8px', right: '12px', 'z-index': '1' }}>
            <we-button variant="bare" size="sm" aria-label="Close" onClick={() => chat.closeSheet()}>
              <we-icon name="x" size="sm" />
            </we-button>
          </div>
          <div style={{ flex: '1', 'min-height': '0', display: 'flex' }}>
            <AgentChat inputs={input()} />
          </div>
        </div>
      )}
    </Show>
  );
}

export default AgentChatSheet;
