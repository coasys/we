/**
 * `we-animated-icon`: one element for the drawings that move — which drawing a name gives, how it is
 * coloured and sized, and that every copy is at the same point in its cycle.
 *
 * What it looks like moving, and what it does for somebody who asked for less motion, are a browser's
 * to say: jsdom runs no animations and resolves no cascade. Those are in the app shell's browser
 * harness (`animatedIcon.mjs`).
 */
import './animated-icon';

import { afterEach, describe, expect, it, vi } from 'vitest';

type Mounted = HTMLElement & {
  name: string;
  size: string;
  color: string;
  updateComplete: Promise<unknown>;
};

const mount = async (props: Partial<Record<'name' | 'size' | 'color', string>> = {}): Promise<Mounted> => {
  const el = document.createElement('we-animated-icon') as Mounted;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
};

const phaseOf = (el: Mounted) =>
  (el.shadowRoot!.querySelector('.frame') as HTMLElement).style.getPropertyValue('--we-animated-icon-phase');

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('the drawing a name gives', () => {
  it('is the spinner when no name is given, so a bare one still says "working"', async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelectorAll('.ring div')).toHaveLength(4);
  });

  it.each([
    ['live', '.live-core, .live-ring', 2],
    ['typing', '.typing circle', 3],
    ['speaking', '.speaking rect', 4],
  ])('draws %s', async (name, selector, shapes) => {
    const el = await mount({ name });
    expect(el.shadowRoot!.querySelectorAll(selector)).toHaveLength(shapes);
  });

  it('changes drawing when the name changes', async () => {
    const el = await mount({ name: 'live' });
    el.name = 'typing';
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.live-core')).toBeNull();
    expect(el.shadowRoot!.querySelectorAll('.typing circle')).toHaveLength(3);
  });

  it('is hidden from a screen reader — what is happening is the surrounding words to say', async () => {
    const el = await mount({ name: 'live' });
    expect(el.shadowRoot!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('its colour', () => {
  const colour = (el: Mounted) => el.style.getPropertyValue('--we-animated-icon-color');

  it('is left to the stylesheet with none given, which makes it the accent — so `tone` re-points it', async () => {
    expect(colour(await mount({ name: 'live' }))).toBe('');
  });

  it('takes a role, through its variable', async () => {
    const value = colour(await mount({ name: 'live', color: 'success' }));
    expect(value).toContain('var(');
    expect(value).toContain('success');
  });

  it('takes any CSS colour as written, which a token-only colour would drop', async () => {
    expect(colour(await mount({ name: 'live', color: '#ff3366' }))).toContain('#ff3366');
  });

  it('takes the text colour on request', async () => {
    expect(colour(await mount({ name: 'typing', color: 'currentColor' }))).toBe('currentColor');
  });

  it('goes back to the accent when the colour is cleared', async () => {
    const el = await mount({ name: 'live', color: 'danger' });
    el.color = '';
    await el.updateComplete;
    expect(colour(el)).toBe('');
  });
});

describe('its size', () => {
  it('takes a size token through the attribute rather than writing a length', async () => {
    const el = await mount({ size: 'sm' });
    expect(el.getAttribute('size')).toBe('sm');
    expect(el.style.getPropertyValue('--we-animated-icon-size')).toBe('');
  });

  it('takes any CSS length — the button hands its spinner the icon size it publishes', async () => {
    const el = await mount({ size: 'var(--we-context-icon-size, var(--we-size-sm))' });
    expect(el.style.getPropertyValue('--we-animated-icon-size')).toBe('var(--we-context-icon-size, var(--we-size-sm))');
  });
});

describe('every copy is at the same point in its cycle', () => {
  it('takes its phase from the clock, so two mounted at different times move together', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(10_000_000 + 500);
    const first = await mount({ name: 'live' });
    vi.setSystemTime(10_000_000 + 500 + 1800 * 3);
    const second = await mount({ name: 'live' });
    // Three whole cycles apart: the same place in the cycle.
    expect(phaseOf(first)).toBe(phaseOf(second));
    expect(phaseOf(first)).toMatch(/^-\d+ms$/);
  });

  it('keeps its phase across a re-render, since a new delay would jump a running animation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(10_000_000 + 300);
    const el = await mount({ name: 'live' });
    const before = phaseOf(el);
    vi.setSystemTime(10_000_000 + 900);
    el.color = 'danger';
    await el.updateComplete;
    expect(phaseOf(el)).toBe(before);
  });
});
