// @vitest-environment jsdom
/**
 * An element covering the window holds the rest of the app inert and Tab inside it — and lets go
 * whenever it is no longer the thing in front.
 *
 * Three ways it held on past that, each a keyboard user stuck:
 *
 * - **Unmounted while still marked.** The real rail is nested under the app's chrome, and a cover
 *   was looked for only when the layer's own children changed or the mark did. Navigating out of the
 *   space with the menu open took the rail away still marked: the page stayed inert and Tab was
 *   swallowed for a cover that was no longer there.
 * - **Something above the app has the keyboard.** A host safety prompt makes the app's layer inert
 *   and draws outside it; Tab in the prompt was sent back to the rail, inside the inert layer, where
 *   focus could not go. The same for any surface drawn outside the layer, such as a portal.
 * - **Two covers.** The first marked in document order won, not the last opened: inside a nested
 *   cover the outer one's controls stayed reachable, and beside a sibling cover the newer one was
 *   made inert by the older.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COVER_ATTR, installWindowCover } from '../src/shared/windowCover';

/** jsdom lays nothing out, so nothing would count as drawn; every element is, here. */
const realRects = HTMLElement.prototype.getClientRects;
let stop: (() => void) | undefined;

beforeEach(() => {
  HTMLElement.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList;
  };
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0)) as unknown as typeof requestAnimationFrame;
  }
  document.body.innerHTML = '';
});

afterEach(() => {
  stop?.();
  stop = undefined;
  HTMLElement.prototype.getClientRects = realRects;
  document.body.innerHTML = '';
});

/** Let the observers run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function el(tag: string, parent: Element, id?: string): HTMLElement {
  const node = document.createElement(tag);
  if (id) node.id = id;
  parent.appendChild(node);
  return node;
}

/** Tab (or Shift+Tab) from what has focus. Whether the trap took it. */
function tab(shift = false): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event.defaultPrevented;
}

/** The app as TemplateProvider draws it: its layer, the chrome nesting the rail, the page beside it. */
function app() {
  const layer = el('div', document.body, 'layer');
  const chrome = el('div', layer, 'chrome');
  const rail = el('nav', chrome, 'rail');
  const toggle = el('button', rail, 'menu');
  const row = el('button', rail, 'row');
  const page = el('main', chrome, 'page');
  const pageButton = el('button', page, 'page-button');
  stop = installWindowCover(layer);
  return { layer, chrome, rail, toggle, row, page, pageButton };
}

describe('a cover taken away while still marked', () => {
  it('lets go of the page and of Tab', async () => {
    const { chrome, rail, page, toggle } = app();
    toggle.focus();
    rail.setAttribute(COVER_ATTR, 'true');
    await settle();
    expect(page.inert).toBe(true);

    // The space shell goes, and the rail with it, its mark never turned off.
    chrome.removeChild(rail);
    await settle();
    expect(page.inert).toBe(false);
    page.querySelector('button')!.focus();
    expect(tab()).toBe(false);
  });
});

describe('a surface above the app', () => {
  it('keeps Tab and focus while the host has made the app inert for a prompt', async () => {
    const { layer, rail } = app();
    rail.setAttribute(COVER_ATTR, 'true');
    await settle();

    // The safety prompt: outside the layer, with the layer made inert.
    const prompt = el('div', document.body, 'prompt');
    const allow = el('button', prompt, 'allow');
    const deny = el('button', prompt, 'deny');
    layer.setAttribute('inert', '');
    allow.focus();
    expect(document.activeElement).toBe(allow);
    expect(tab()).toBe(false);
    deny.focus();
    expect(document.activeElement).toBe(deny);
  });

  it('leaves focus in a surface drawn outside the layer, such as a portal', async () => {
    const { rail } = app();
    rail.setAttribute(COVER_ATTR, 'true');
    await settle();

    const portal = el('div', document.body, 'portal');
    const option = el('button', portal, 'option');
    option.focus();
    expect(document.activeElement).toBe(option);
    expect(tab()).toBe(false);
  });

  it('still holds Tab inside the cover while focus is in the app', async () => {
    const { rail, row, toggle } = app();
    rail.setAttribute(COVER_ATTR, 'true');
    await settle();
    row.focus();
    // Past the last control, round to the first.
    expect(tab()).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });
});

describe('two covers', () => {
  it('holds the one opened inside another in front, with the outer one’s controls out of reach', async () => {
    const { rail, row } = app();
    rail.setAttribute(COVER_ATTR, 'true');
    await settle();
    // A sheet opened from the menu, inside it.
    const sheet = el('div', rail, 'sheet');
    const sheetButton = el('button', sheet, 'sheet-button');
    sheetButton.focus();
    sheet.setAttribute(COVER_ATTR, 'true');
    await settle();
    expect(row.inert).toBe(true);
    expect(sheet.inert).not.toBe(true);

    // And closing it gives the menu back, as it was.
    sheet.setAttribute(COVER_ATTR, 'false');
    await settle();
    expect(row.inert).toBe(false);
  });

  it('holds the newer of two side by side in front, and the older again once it closes', async () => {
    const { layer, chrome, rail, page } = app();
    rail.setAttribute(COVER_ATTR, 'true');
    await settle();
    // Something of the app's laid over the window beside the menu, after it.
    const later = el('div', layer, 'later');
    el('button', later, 'later-button');
    later.setAttribute(COVER_ATTR, 'true');
    await settle();
    expect(later.inert).not.toBe(true);
    // The menu is covered with the chrome it sits in.
    expect(chrome.inert).toBe(true);

    later.setAttribute(COVER_ATTR, 'false');
    await settle();
    expect(chrome.inert).not.toBe(true);
    expect(rail.inert).not.toBe(true);
    expect(page.inert).toBe(true);
  });

  it('gives focus back to the control in the outer cover that opened the inner one', async () => {
    const { rail, row } = app();
    rail.setAttribute(COVER_ATTR, 'true');
    await settle();
    row.focus();
    const sheet = el('div', rail, 'sheet');
    const inside = el('button', sheet, 'inside');
    sheet.setAttribute(COVER_ATTR, 'true');
    await settle();
    inside.focus();

    // Closing takes the sheet's control away with it, and focus with it.
    rail.removeChild(sheet);
    // After the frame, as the closing is laid out.
    await vi.waitFor(() => expect(document.activeElement).toBe(row));
    // And the menu is in front again, its own controls in reach.
    expect(row.inert).toBe(false);
  });
});
