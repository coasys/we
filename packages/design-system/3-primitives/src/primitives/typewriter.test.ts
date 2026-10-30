/**
 * `we-typewriter`: a line whose last part types, holds, deletes and types the next phrase — and keeps
 * still for anyone who asked for less motion, reads as one sentence to a screen reader, and holds its
 * size so the page under it does not jump.
 */
import './typewriter';

import { MOTION_ATTRIBUTE } from '@we/tokens';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface TypewriterEl extends HTMLElement {
  text: string;
  phrases: string[];
  typeMs: number;
  deleteMs: number;
  holdMs: number;
  updateComplete: Promise<unknown>;
}

const PHRASES = ['a global brain.', 'intelligence no one owns.'];

async function mount(): Promise<TypewriterEl> {
  const el = document.createElement('we-typewriter') as TypewriterEl;
  el.text = 'We are building';
  el.phrases = PHRASES;
  el.typeMs = 10;
  el.deleteMs = 5;
  el.holdMs = 100;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

/** What the moving line shows — the layer a person sees, not the sizer or the screen-reader copy. */
const typed = (el: TypewriterEl) =>
  el.shadowRoot!.querySelector('.layer:not(.sizer) [part="phrase"]')!.textContent ?? '';

const advance = async (el: TypewriterEl, ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await el.updateComplete;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(MOTION_ATTRIBUTE);
});

describe('a typewriter', () => {
  it('reads right at once: the first phrase whole, before anything types', async () => {
    expect(typed(await mount())).toBe('a global brain.');
  });

  it('holds, deletes the phrase letter by letter, and types the next', async () => {
    const el = await mount();
    const seen: string[] = [];
    for (let t = 0; t < 1200; t += 5) {
      await advance(el, 5);
      if (seen[seen.length - 1] !== typed(el)) seen.push(typed(el));
    }
    const empty = seen.indexOf('');
    // Shrinking a letter at a time down to nothing...
    expect(seen.slice(0, empty).every((s, i, all) => i === 0 || s.length === all[i - 1].length - 1)).toBe(true);
    expect('a global brain.'.startsWith(seen[0])).toBe(true);
    // ...then the next phrase growing from its start.
    expect(empty).toBeGreaterThan(0);
    const after = seen.slice(empty + 1);
    const next = after.indexOf('') < 0 ? after : after.slice(0, after.indexOf(''));
    expect(next.every((s) => 'intelligence no one owns.'.startsWith(s))).toBe(true);
    expect(next).toContain('intelligence no one owns.');
  });

  it('keeps still, with no caret, for anyone who asked for less motion', async () => {
    document.documentElement.setAttribute(MOTION_ATTRIBUTE, 'reduced');
    const el = await mount();
    await advance(el, 5000);
    expect(typed(el)).toBe('a global brain.');
    expect(el.shadowRoot!.querySelector('[part="caret"]')).toBeNull();
  });

  it('is one sentence to a screen reader, and the typing is hidden from it', async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector('.sr')!.textContent).toBe(
      'We are building a global brain, intelligence no one owns.',
    );
    for (const layer of el.shadowRoot!.querySelectorAll('.layer'))
      expect(layer.getAttribute('aria-hidden')).toBe('true');
  });

  it('holds the size of its longest phrase, so the page under it does not move', async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector('.sizer [part="phrase"]')!.textContent).toBe('intelligence no one owns.');
  });
});
