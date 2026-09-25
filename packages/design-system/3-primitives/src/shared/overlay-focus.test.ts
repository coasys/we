import '../primitives/button';
import '../primitives/input';
import '../primitives/modal';

import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Where an overlay puts focus when it opens.
 *
 * Every assertion here failed before the fix these tests arrived with, and each failed silently:
 * focus is not something a render assertion notices, so a dialog that focused the wrong thing —
 * or nothing at all — looked identical to one that got it right.
 */

/** The real focused element — `document.activeElement` reports the host, not what is inside it. */
const deepActiveElement = (): HTMLElement | null => {
  let active = document.activeElement as HTMLElement | null;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement as HTMLElement;
  return active;
};

/** Mount the modal and let the frame `captureFocus` waits for go by. */
const openModal = async (children: HTMLElement[]): Promise<HTMLElement> => {
  const modal = document.createElement('we-modal');
  for (const child of children) modal.appendChild(child);
  document.body.appendChild(modal);
  await (modal as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return modal;
};

/** A `role="button"` tile, the shape `EditableImage` renders. */
const tile = (skip: boolean): HTMLElement => {
  const el = document.createElement('div');
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.dataset.testid = 'tile';
  if (skip) el.setAttribute('data-we-skip-autofocus', '');
  return el;
};

const input = (): HTMLElement => document.createElement('we-input');

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('a modal moves focus inside itself', () => {
  it('lands on the first field, not on body', async () => {
    // The general case, and the one that was broken for every form modal in the app: the fields are
    // all primitives, whose shadow roots do not exist in the frame the modal first renders in — so
    // nothing was found, nothing was focused, and focus stayed behind the scrim.
    await openModal([input(), input()]);
    expect(deepActiveElement()?.tagName.toLowerCase()).toBe('input');
  });

  it('skips the close button, which is a poor first stop', async () => {
    // The close button is the first focusable thing in the composed tree — it is rendered above the
    // slots. The rule that skips it used to match on the collected element's own `part`, which is
    // `base` on `we-button`'s inner control, so it never fired.
    const modal = await openModal([input()]);
    const focusable = (modal as unknown as { collectFocusable(): HTMLElement[] }).collectFocusable();
    const closeButton = focusable[0];
    // It is found, and it is first — so "the first focusable thing" alone would land here.
    expect((closeButton.getRootNode() as ShadowRoot).host.getAttribute('part')).toBe('close-button');
    expect(deepActiveElement()).not.toBe(closeButton);
    expect(deepActiveElement()?.tagName.toLowerCase()).toBe('input');
  });
});

describe('data-we-skip-autofocus', () => {
  it('passes over a marked control and takes the next one', async () => {
    // The create-space modal: a cover-image tile above the name field. Enter on the tile opens the
    // OS file picker, so opening the dialog there puts a file dialog over the form.
    await openModal([tile(true), input()]);
    expect(deepActiveElement()?.tagName.toLowerCase()).toBe('input');
  });

  it('takes an unmarked one, so the rule is the marker and not the shape', async () => {
    await openModal([tile(false), input()]);
    expect((deepActiveElement() as HTMLElement)?.dataset.testid).toBe('tile');
  });

  it('never leaves focus outside, however much is marked', async () => {
    // A dialog holding nothing but marked controls still has to take focus — it claims to be modal
    // and traps Tab, so focus left on `body` is focus with nowhere to go. The marker orders the
    // candidates; it is not a veto, and the last resort is whatever is first (here, Close).
    const modal = await openModal([tile(true)]);
    const focusable = (modal as unknown as { collectFocusable(): HTMLElement[] }).collectFocusable();
    expect(deepActiveElement()).not.toBe(document.body);
    expect(focusable).toContain(deepActiveElement());
  });

  it('leaves it in the tab order', async () => {
    // Skipped as an opening target only. One Tab from the field must still reach it.
    const modal = await openModal([tile(true), input()]);
    const focusable = (modal as unknown as { collectFocusable(): HTMLElement[] }).collectFocusable();
    expect(focusable.some((el) => el.dataset.testid === 'tile')).toBe(true);
  });
});
