import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureGesture,
  claimGesture,
  CREDIT_MS,
  hasGesture,
  installGestureTracking,
  registerGestureOwner,
  runAsOwner,
  runWithGesture,
} from './gesture';

/*
  jsdom events are all synthetic, so trust is waived here — what is under test is the window, not
  the browser's judgement of who made the event. The browser case `security:self-firing-events`
  covers the trusted half in real Chrome.
*/
let stop: () => void;
beforeEach(() => {
  stop = installGestureTracking(window, { requireTrusted: false });
});
afterEach(() => stop());

/** What `hasGesture` says from inside a listener on `el` for an event of `type`. */
function seenDuring(el: EventTarget, event: Event): boolean {
  let seen = false;
  const listener = () => {
    seen = hasGesture();
  };
  el.addEventListener(event.type, listener);
  el.dispatchEvent(event);
  el.removeEventListener(event.type, listener);
  return seen;
}

describe('gesture', () => {
  it('is live while an activation event dispatches, and not after', () => {
    const button = document.body.appendChild(document.createElement('button'));
    expect(seenDuring(button, new MouseEvent('click', { bubbles: true }))).toBe(true);
    expect(hasGesture()).toBe(false);
  });

  it('is not live during events that happen to people rather than being done by them', () => {
    const img = document.body.appendChild(document.createElement('img'));
    for (const type of ['load', 'error', 'toggle', 'focus', 'scroll', 'pointerover']) {
      expect(seenDuring(img, new Event(type)), type).toBe(false);
    }
  });

  it('covers events fired synchronously from inside a press — a component reporting what was done', () => {
    const host = document.body.appendChild(document.createElement('div'));
    let seen = false;
    host.addEventListener('reorder', () => (seen = hasGesture()));
    host.addEventListener('pointerup', () => host.dispatchEvent(new CustomEvent('reorder')));
    host.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(seen).toBe(true);
  });

  it('survives a nested activation ending inside the outer one', () => {
    const el = document.body.appendChild(document.createElement('button'));
    let afterInner = false;
    el.addEventListener('keydown', () => {
      el.dispatchEvent(new MouseEvent('click'));
      afterInner = hasGesture();
    });
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    expect(afterInner).toBe(true);
  });

  it('carries a captured gesture into a continuation, and only there', async () => {
    const el = document.body.appendChild(document.createElement('button'));
    let token: ReturnType<typeof captureGesture> = null;
    el.addEventListener('click', () => (token = captureGesture()));
    el.dispatchEvent(new MouseEvent('click'));
    await Promise.resolve();

    expect(hasGesture()).toBe(false);
    expect(runWithGesture(token, hasGesture)).toBe(true);
    expect(hasGesture()).toBe(false);
    expect(runWithGesture(null, hasGesture)).toBe(false);
  });

  it('counts a blur only when the field was typed into since it was focused', () => {
    const input = document.body.appendChild(document.createElement('input'));
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(seenDuring(input, new FocusEvent('blur'))).toBe(false);

    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(seenDuring(input, new FocusEvent('blur'))).toBe(true);

    // Focusing again starts over: leaving it untouched this time is not the end of any typing.
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(seenDuring(input, new FocusEvent('blur'))).toBe(false);
  });

  it('believes only trusted events by default', () => {
    stop();
    stop = installGestureTracking(window);
    const button = document.body.appendChild(document.createElement('button'));
    expect(seenDuring(button, new MouseEvent('click', { bubbles: true }))).toBe(false);
  });

  describe('credit — a press answered later', () => {
    afterEach(() => vi.useRealTimers());

    /** A node's wrapper with a component inside it, the way the renderer mounts one. */
    function node() {
      const wrapper = document.body.appendChild(document.createElement('div'));
      const inner = wrapper.appendChild(document.createElement('button'));
      return { wrapper, inner, owner: registerGestureOwner(wrapper) };
    }
    const press = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));

    it('lets a handler of the pressed node act after the press has finished, once', () => {
      const { inner, owner } = node();
      press(inner);
      expect(hasGesture()).toBe(false);

      expect(runAsOwner(owner, claimGesture)).toBe(true);
      // Spent: a second late call from the same press is nobody asking.
      expect(runAsOwner(owner, claimGesture)).toBe(false);

      // A new press is a new answer.
      press(inner);
      expect(runAsOwner(owner, claimGesture)).toBe(true);
    });

    it('credits only what the press passed through', () => {
      const pressed = node();
      const other = node();
      press(pressed.inner);
      expect(runAsOwner(other.owner, claimGesture)).toBe(false);
    });

    it('credits nothing for an event that happens by itself', () => {
      const { inner, owner } = node();
      inner.dispatchEvent(new Event('load'));
      expect(runAsOwner(owner, claimGesture)).toBe(false);
    });

    it('expires', () => {
      vi.useFakeTimers();
      const { inner, owner } = node();
      press(inner);
      vi.advanceTimersByTime(CREDIT_MS + 1);
      expect(runAsOwner(owner, claimGesture)).toBe(false);
    });

    it('covers the whole call that spent it, and what that call goes on to do', async () => {
      const { inner, owner } = node();
      press(inner);
      let token: ReturnType<typeof captureGesture> = null;
      const both = runAsOwner(owner, () => {
        const first = claimGesture();
        const second = claimGesture(); // the second action in one handler
        token = captureGesture();
        return first && second;
      });
      expect(both).toBe(true);
      await Promise.resolve();
      // A continuation — onSuccess after a save — rides on the same spent credit.
      expect(runWithGesture(token, claimGesture)).toBe(true);
    });

    it('is not needed, and not spent, inside a live press', () => {
      const { inner, owner } = node();
      let claimed = false;
      inner.addEventListener('click', () => (claimed = runAsOwner(owner, claimGesture)));
      press(inner);
      expect(claimed).toBe(true);
      // The live press paid for that call; the credit it left is still there for a late one.
      expect(runAsOwner(owner, claimGesture)).toBe(true);
    });
  });
});
