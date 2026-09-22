/**
 * `we-scroll-area` — the jump controls, the near-start signal, and the coordinate space they read.
 *
 * ## What is no longer here, and why
 *
 * Most of this file used to be about *following*: the element wrote `scrollTop` whenever content
 * changed, and the tests drove that decision — scroll the element, add a row, assert whether the
 * view moved. All of it is gone, along with the code, because chasing the end cannot be made to
 * work. It requires knowing when the content has stopped changing, and nothing can tell you: a
 * MutationObserver is blind to reflow, a ResizeObserver on the host is blind to the content, and the
 * browser's own scroll anchoring — which does see everything — was moving the scroller *against*
 * the chase and being read as the reader. Measured on a real transcript: a jump to the bottom, rows
 * growing 2114px as their bylines arrived, the browser shifting `scrollTop` 2006px to hold the
 * reader's place, and the list unpinning itself 108px short of the end for good.
 *
 * A pinned list is now `flex-direction: column-reverse`, so the browser holds the bottom itself and
 * there is nothing to test about following. What remains is arithmetic, and it is tested here.
 *
 * ## Why jsdom is enough for what is left, and not for the rest
 *
 * jsdom lays nothing out and reports every scroll metric as zero, so heights are stubbed and the
 * questions are about which branch the arithmetic takes. The thing that cannot be asked here is
 * whether the browser actually rests at the bottom and stays there — that is measured for real in
 * `@we/app-shell`'s browser harness, which is where the `column-reverse` semantics were established
 * in the first place.
 */
import './scroll-area';

import { describe, expect, it } from 'vitest';

interface ScrollAreaEl extends HTMLElement {
  pin: '' | 'end';
  jump: '' | 'start' | 'end' | 'both';
  nearStart: number;
  updateComplete: Promise<unknown>;
}

/** jsdom delivers MutationObserver records on a microtask; two turns is comfortably enough. */
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

/**
 * A mounted scroll area whose scroller reports a settable content height.
 *
 * `scrollTop` stays a plain property so the element can write it and a test can read back what it
 * wrote. The rest are configurable getters because jsdom's own are zero.
 *
 * `scrollTo` positions the reader in the element's OWN coordinate space, which is the point: under
 * `pin='end'` the range runs `-(scrollHeight - clientHeight)`..`0`, newest at zero, and a test that
 * silently assumed the ordinary direction would pass while asserting the opposite of the truth.
 */
async function mount(options: {
  pin?: 'end';
  jump?: 'start' | 'end' | 'both';
  nearStart?: number;
  scrollHeight?: number;
  clientHeight?: number;
}) {
  const el = document.createElement('we-scroll-area') as ScrollAreaEl;
  if (options.pin) el.pin = options.pin;
  if (options.jump) el.jump = options.jump;
  if (options.nearStart) el.nearStart = options.nearStart;
  document.body.appendChild(el);
  await el.updateComplete;

  let scrollHeight = options.scrollHeight ?? 1000;
  const clientHeight = options.clientHeight ?? 200;

  const base = el.shadowRoot!.querySelector('[part="base"]') as HTMLElement;
  Object.defineProperty(base, 'scrollHeight', { get: () => scrollHeight, configurable: true });
  Object.defineProperty(base, 'clientHeight', { value: clientHeight, configurable: true });
  const span = () => Math.max(0, scrollHeight - clientHeight);

  /** Put the reader this far from the newest end, and let the element notice. */
  const scrollFromEnd = (distance: number) => {
    base.scrollTop = options.pin === 'end' ? -distance : span() - distance;
    base.dispatchEvent(new Event('scroll'));
  };

  /** Put the reader this far from the oldest end. */
  const scrollFromStart = (distance: number) => scrollFromEnd(span() - distance);

  const grow = (by: number) => {
    scrollHeight += by;
  };

  const addRow = async () => {
    el.appendChild(document.createElement('div'));
    await settle();
  };

  const controls = async () => {
    await el.updateComplete;
    const root = el.shadowRoot!;
    return {
      start: !!root.querySelector('[part="jump-start"]'),
      end: !!root.querySelector('[part="jump-end"]'),
    };
  };

  const press = async (which: 'start' | 'end') => {
    await el.updateComplete;
    const button = el.shadowRoot!.querySelector(`[part="jump-${which}"] we-button`);
    button!.dispatchEvent(new Event('click', { bubbles: true, composed: true }));
    await el.updateComplete;
  };

  return { el, base, scrollFromEnd, scrollFromStart, grow, addRow, controls, press, span };
}

describe('we-scroll-area pin="end"', () => {
  const css = () =>
    (customElements.get('we-scroll-area') as unknown as { styles: { cssText: string }[] }).styles
      .map((s) => s.cssText)
      .join('\n');

  it('pins by layout, not by script', async () => {
    // The whole change in one assertion. `column-reverse` puts the scroll origin at the bottom, so
    // the resting position IS the newest content and the browser holds it there through any reflow.
    expect(css()).toContain('flex-direction: column-reverse');
  });

  it('turns the browser own scroll anchoring off, because it would be a second one', async () => {
    // Anchoring preserves the reader's place when content is inserted above. With the origin already
    // at the bottom it has nothing to add, and leaving it on is what moved the scroller out from
    // under the old implementation and got read as the reader scrolling away.
    expect(css()).toContain('overflow-anchor: none');
  });

  it('reverses exactly one box, so the content keeps its own order', async () => {
    /*
      The alternative was a contract saying "pass your children backwards", which is invisible when
      broken. Collapsing the slot into a single flex item means the reversal never reaches the rows.
    */
    expect(css()).toContain("[part='content']");
    expect(css()).toContain('display: contents');
    const el = (await mount({ pin: 'end' })).el;
    expect(el.shadowRoot!.querySelector('[part="content"] slot')).not.toBeNull();
  });

  it('leaves an unpinned list laid out exactly as it was', async () => {
    /*
      `display: contents` on the wrapper, so it generates no box and its children go on being the
      scroller's own. Nothing that does not ask for pinning pays anything for this.

      Asserted on the attribute's VALUE rather than its presence: `pin` reflects, so an unpinned
      element carries `pin=""`, and every rule above is gated on `[pin='end']` rather than on `[pin]`.
    */
    const { el } = await mount({});
    expect(el.getAttribute('pin')).not.toBe('end');
  });
});

/**
 * The jump controls, which are the one thing that still has to know where the scroller is.
 *
 * Asked as a distance from each end rather than as a `scrollTop`, so the same arithmetic serves a
 * list that runs `0`..max and one that runs `-max`..`0`. Both directions are covered below for
 * exactly that reason — the inversion is the part that would otherwise be got wrong silently.
 */
describe('we-scroll-area jump', () => {
  it('offers neither control without the prop', async () => {
    const { scrollFromEnd, controls } = await mount({});
    scrollFromEnd(400);
    expect(await controls()).toEqual({ start: false, end: false });
  });

  it('offers only the direction there is somewhere to go in', async () => {
    const { scrollFromEnd, scrollFromStart, controls } = await mount({ jump: 'both' });

    scrollFromEnd(0);
    expect(await controls()).toEqual({ start: true, end: false });

    scrollFromStart(0);
    expect(await controls()).toEqual({ start: false, end: true });
  });

  it('answers the same way round in a pinned list, where the coordinates are inverted', async () => {
    // The assertion that earns its place: identical expectations, a scroller running -800..0.
    const { scrollFromEnd, scrollFromStart, controls } = await mount({ pin: 'end', jump: 'both' });

    scrollFromEnd(0);
    expect(await controls()).toEqual({ start: true, end: false });

    scrollFromStart(0);
    expect(await controls()).toEqual({ start: false, end: true });
  });

  it('honours which directions were asked for', async () => {
    const { scrollFromEnd, controls } = await mount({ jump: 'end' });
    scrollFromEnd(400);
    expect(await controls()).toEqual({ start: false, end: true });
  });

  it('draws nothing at all when there is nothing to scroll', async () => {
    const { scrollFromEnd, controls } = await mount({ jump: 'both', scrollHeight: 200 });
    scrollFromEnd(0);
    expect(await controls()).toEqual({ start: false, end: false });
  });

  it('appears when the content grows past a reader who has not moved', async () => {
    // Nobody scrolled, so this is the case a scroll listener alone would miss — the observers are
    // what keep the controls honest, and it is all they are for now.
    const { grow, addRow, controls } = await mount({ jump: 'end', scrollHeight: 200 });
    expect((await controls()).end).toBe(false);

    grow(2000);
    await addRow();
    expect((await controls()).end).toBe(true);
  });

  it('becomes the containing block for its controls, and only then', async () => {
    // A stacking context is not free: an ordinary scroll area has no reason to become one, and
    // something absolutely positioned in slotted content would quietly start resolving against it.
    const plain = await mount({});
    const withJump = await mount({ jump: 'end' });
    expect(getComputedStyle(plain.el).position).not.toBe('relative');
    expect(withJump.el.style.getPropertyValue('--we-scroll-area-position')).toBe('relative');
  });

  it('sends the reader to each end, in whichever direction that is', async () => {
    const forward = await mount({ jump: 'both' });
    forward.scrollFromEnd(400);
    await forward.press('end');
    expect(forward.base.scrollTop).toBe(forward.span());
    await forward.press('start');
    expect(forward.base.scrollTop).toBe(0);

    const pinned = await mount({ pin: 'end', jump: 'both' });
    pinned.scrollFromEnd(400);
    await pinned.press('end');
    expect(pinned.base.scrollTop).toBe(0);
    await pinned.press('start');
    expect(pinned.base.scrollTop).toBe(-pinned.span());
  });
});

/**
 * `nearStart`: say when the reader has come within reach of the oldest end, so a list can load what
 * is before it.
 *
 * The hold that used to go with this is gone. Under `column-reverse` the scroll position is measured
 * from the bottom, so content loaded in above the reader does not move them — the place-keeping that
 * cost a stored distance, a deadline and a restore pass is simply how the box behaves.
 */
describe('we-scroll-area nearStart', () => {
  const nearStarts = (el: HTMLElement) => {
    const seen: Event[] = [];
    el.addEventListener('nearstart', (event) => seen.push(event));
    return seen;
  };

  it('says nothing unless a distance was asked for', async () => {
    const { el, scrollFromStart } = await mount({ pin: 'end' });
    const seen = nearStarts(el);
    scrollFromStart(0);
    expect(seen).toHaveLength(0);
  });

  it('fires once per approach, not once per scroll event', async () => {
    const { el, scrollFromStart } = await mount({ pin: 'end', nearStart: 400 });
    const seen = nearStarts(el);

    scrollFromStart(300);
    scrollFromStart(200);
    scrollFromStart(100);
    // A consumer's handler is "fetch the next page", not "fetch the next page unless I already am".
    expect(seen).toHaveLength(1);

    scrollFromStart(700);
    scrollFromStart(100);
    expect(seen).toHaveLength(2);
  });

  it('measures from the oldest end in an unpinned list too', async () => {
    const { el, scrollFromStart } = await mount({ nearStart: 400 });
    const seen = nearStarts(el);
    scrollFromStart(100);
    expect(seen).toHaveLength(1);
  });

  it('says nothing on a list with nothing to scroll', async () => {
    // Without this a short list fires on mount: a scroller with no overflow is at both ends at once.
    const { el, scrollFromStart } = await mount({ pin: 'end', nearStart: 400, scrollHeight: 200 });
    const seen = nearStarts(el);
    scrollFromStart(0);
    expect(seen).toHaveLength(0);
  });
});

/**
 * The `jump-start` slot: the scroller decides whether there is anywhere to go, the consumer decides
 * what going there means.
 *
 * For a windowed list the top of what is LOADED is not the beginning of anything, so a scroll-to-top
 * would say "start" and deliver "as far back as we happened to fetch". Reaching the real beginning
 * is a different query and only the consumer can run it — but where the control sits and when it is
 * worth offering are still the scroller's to answer, so only the action is handed back.
 */
describe('we-scroll-area jump-start slot', () => {
  it('draws its own button when nothing is slotted', async () => {
    const { el, scrollFromEnd, controls } = await mount({ jump: 'both' });
    scrollFromEnd(400);
    expect((await controls()).start).toBe(true);
    expect(el.shadowRoot!.querySelector('[part="jump-start"] we-button')).not.toBeNull();
  });

  it('is still gated on there being somewhere to go', async () => {
    // Visibility is not handed back. A consumer supplying a control does not get to show it at the
    // oldest end, where "back to the start" means nothing.
    const { el, controls } = await mount({ jump: 'both' });
    el.innerHTML = '<button slot="jump-start">Beginning</button>';
    await settle();
    expect((await controls()).start).toBe(false);
  });

  it('renders the consumer control in place of its own once there is', async () => {
    const { el, scrollFromEnd, controls } = await mount({ jump: 'both' });
    el.innerHTML = '<button slot="jump-start">Beginning</button>';
    scrollFromEnd(400);
    await settle();

    expect((await controls()).start).toBe(true);
    const slot = el.shadowRoot!.querySelector('[part="jump-start"] slot') as HTMLSlotElement;
    expect(slot.assignedElements()).toHaveLength(1);
  });
});
