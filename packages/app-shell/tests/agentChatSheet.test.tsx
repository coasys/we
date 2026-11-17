/*
 * The phone sheet is a dialog, and the chat list is made of buttons.
 *
 * Findings 7 and 8: `role="dialog"` + `aria-modal`, focus inside on open and trapped, Escape puts
 * the sheet away, the handle is a button with `touch-action: none`, and a `pointercancel` drops
 * the drag's window listeners. In the list, a conversation opens from a `<button>` — Enter and
 * Space reach it, not only a pointer's click.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatInputs } from '../src/frameworks/solid/stores/ChatStore';

const [sheet, setSheet] = createSignal<ChatInputs | null>(null);
const closeSheet = vi.fn(() => setSheet(null));

vi.mock('../src/frameworks/solid/stores/ChatStore', () => ({
  useChatStore: () => ({
    sheet,
    closeSheet,
    openChat: vi.fn(),
    takePending: () => undefined,
    rememberedConversation: () => undefined,
    rememberConversation: () => {},
  }),
}));

// The chat itself is mocked — the sheet's own accessibility is what is under test here.
vi.mock('../src/frameworks/solid/components/chat/AgentChat', () => ({
  default: () => <div data-testid="agent-chat" />,
}));

import AgentChatSheet from '../src/frameworks/solid/components/chat/AgentChatSheet';

afterEach(() => {
  cleanup();
  setSheet(null);
  vi.clearAllMocks();
});

describe('the sheet as a dialog', () => {
  it('announces itself as a modal dialog and takes focus when it opens', async () => {
    const { container } = render(() => <AgentChatSheet />);
    setSheet({ perspectiveUuid: 'u1', spaceName: 'Garden' });

    const dialog = await vi.waitFor(() => {
      const el = container.querySelector<HTMLElement>('[role="dialog"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toContain('Garden');
    await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('closes on Escape — and the handle is a button a keyboard can press', async () => {
    const { container } = render(() => <AgentChatSheet />);
    setSheet({ spaceName: 'Garden' });
    const dialog = await vi.waitFor(() => container.querySelector<HTMLElement>('[role="dialog"]')!);

    const handle = dialog.querySelector<HTMLElement>('[aria-label*="sheet"]')!;
    expect(handle.tagName).toBe('BUTTON');
    expect(handle.style.touchAction).toBe('none');

    // Pressing it raises the sheet to the full dynamic viewport.
    handle.click();
    expect(dialog.style.height).toBe('100dvh');

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closeSheet).toHaveBeenCalledTimes(1);
  });

  it('holds Tab inside — the ends of the focus order wrap around', async () => {
    const { container } = render(() => <AgentChatSheet />);
    setSheet({ spaceName: 'Garden' });
    const dialog = await vi.waitFor(() => container.querySelector<HTMLElement>('[role="dialog"]')!);
    await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    const handle = dialog.querySelector<HTMLElement>('[aria-label*="sheet"]')!;
    handle.focus();

    // Shift+Tab on the first focusable — default is prevented, and focus stays inside.
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    const allowed = dialog.dispatchEvent(back);
    expect(allowed).toBe(false);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('drops the drag’s window listeners on pointercancel — a cancelled touch is not a drag', async () => {
    const { container } = render(() => <AgentChatSheet />);
    setSheet({ spaceName: 'Garden' });
    const dialog = await vi.waitFor(() => container.querySelector<HTMLElement>('[role="dialog"]')!);
    const handle = dialog.querySelector<HTMLElement>('[aria-label*="sheet"]')!;

    const removed: string[] = [];
    vi.spyOn(window, 'removeEventListener').mockImplementation((type: string) => void removed.push(type));
    const down = new Event('pointerdown', { bubbles: true });
    Object.assign(down, { clientY: 300 });
    handle.dispatchEvent(down);
    window.dispatchEvent(new Event('pointercancel'));
    expect(removed).toEqual(expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']));
  });
});
