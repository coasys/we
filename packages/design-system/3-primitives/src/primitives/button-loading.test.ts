/**
 * What a button shows while it is working.
 *
 * The spinner was pinned at `size="sm"` — 24px, whatever the button — and `color="currentColor"`,
 * and it was always prepended to the content rather than ever standing in for it. Each of those is
 * wrong in a different place, and all three showed up at once on the transcript composer's send
 * button: a 24px wheel beside a 24px icon in a 40px square, in the same colour as ordinary text,
 * which on a dark theme is white.
 *
 * `xs` is the one that was outright broken rather than merely crowded: the whole button is 24px, so
 * a 24px spinner filled it with the padding and the border still to find room.
 */
import './button';

import { describe, expect, it } from 'vitest';

type Mounted = HTMLElement & { updateComplete: Promise<unknown> };

const mount = async (props: Record<string, unknown> = {}): Promise<Mounted> => {
  const el = document.createElement('we-button') as Mounted;
  Object.assign(el, props);
  el.innerHTML = '<we-icon name="paper-plane-tilt"></we-icon>';
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
};

const spinner = (el: Mounted) => el.shadowRoot!.querySelector('we-spinner');
const slots = (el: Mounted) => el.shadowRoot!.querySelectorAll('slot');

describe('a square button while it is loading', () => {
  it('shows the spinner INSTEAD of the icon, because there is room for exactly one glyph', async () => {
    const el = await mount({ square: true, loading: true });
    expect(spinner(el)).not.toBeNull();
    // No slots rendered at all, so the light-DOM icon is not projected and cannot sit beside it.
    expect(slots(el)).toHaveLength(0);
  });

  it('goes back to showing the icon when it stops', async () => {
    const el = await mount({ square: true, loading: false });
    expect(spinner(el)).toBeNull();
    expect(slots(el).length).toBeGreaterThan(0);
  });
});

describe('a button with a label while it is loading', () => {
  it('keeps the label and takes the spinner alongside it', async () => {
    /*
      The opposite decision from `square`, on purpose. The word is what says which action is
      running; swapping it for a wheel would lose that and change the button's width mid-press.
    */
    const el = await mount({ loading: true, text: 'Save' });
    expect(spinner(el)).not.toBeNull();
    expect(el.shadowRoot!.textContent).toContain('Save');
  });
});

describe('the spinner takes the size the icon it stands in for would have', () => {
  it('asks for the button own icon-size variable rather than a fixed size', async () => {
    // Not `sm`. `--we-context-icon-size` is what this component already publishes to size nested
    // `we-icon`s per button size, so the spinner is 12px in an `xs` button and 24px in an `md` one.
    const el = await mount({ square: true, loading: true, size: 'xs' });
    expect(spinner(el)?.getAttribute('size')).toBe('var(--we-context-icon-size, var(--we-size-sm))');
  });

  it('keeps the old 24px as the fallback, for a size that has not reflected yet', async () => {
    const el = await mount({ square: true, loading: true });
    expect(spinner(el)?.getAttribute('size')).toContain('var(--we-size-sm)');
  });
});

describe('the spinner is coloured against the fill it sits on', () => {
  it('uses the accent on a variant with no fill of its own', async () => {
    // `accent-text`, not `accent`: the role for the accent used as a FOREGROUND on a surface, at a
    // lightness that stays readable. This is the case that read as a white wheel on a dark theme.
    for (const variant of ['secondary', 'ghost', 'outline', 'bare']) {
      const el = await mount({ square: true, loading: true, variant });
      expect(spinner(el)?.getAttribute('color')).toBe('accent-text');
    }
  });

  it('takes the button own foreground on a filled variant, where the accent would vanish', async () => {
    // `accent` on an accent fill is an invisible spinner — worse than a flat one. These variants
    // already carry a foreground chosen to contrast with their fill, so `currentColor` IS the
    // considered answer here rather than a default nobody looked at.
    for (const variant of ['primary', 'success', 'danger']) {
      const el = await mount({ square: true, loading: true, variant });
      expect(spinner(el)?.getAttribute('color')).toBe('currentColor');
    }
  });
});
