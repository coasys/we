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
  nearEnd: number;
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
  /** Ends with unloaded content beyond them, marked the way a consumer marks them. */
  more?: ('start' | 'end')[];
  nearStart?: number;
  nearEnd?: number;
  scrollHeight?: number;
  clientHeight?: number;
}) {
  const el = document.createElement('we-scroll-area') as ScrollAreaEl;
  if (options.pin) el.pin = options.pin;
  if (options.jump) el.jump = options.jump;
  for (const end of options.more ?? []) {
    const marker = document.createElement('div');
    marker.setAttribute('data-we-more', end);
    el.appendChild(marker);
  }
  if (options.nearStart) el.nearStart = options.nearStart;
  if (options.nearEnd) el.nearEnd = options.nearEnd;
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

    // Out of reach first: the first look only records where the reader is — see `#checkEdge`.
    scrollFromStart(900);
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
    scrollFromStart(900);
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
 * `data-we-more`: a jump scrolls to an end that is loaded, and asks for one that is not.
 *
 * For a windowed list the edge of what is LOADED is not the edge of anything, so a scroll there
 * would say "start" and deliver "as far back as we happened to fetch". Reaching the real beginning
 * is a different query and only the consumer can run it — but once the whole thing IS loaded, both
 * ends are reachable and both buttons should simply scroll.
 *
 * The consumer marks the ends it has not finished loading, and the scroller reads the marker on the
 * press. A prop naming those ends came first and was wrong: the fragment that knows is the one
 * holding the rows, which sits *inside* the scroller, while the prop is set by the fragment outside
 * it — so it could only ever approximate, and a fully-loaded short list jumped where it should have
 * scrolled.
 */
describe('we-scroll-area data-we-more', () => {
  const heard = (el: HTMLElement, type: string) => {
    const seen: Event[] = [];
    el.addEventListener(type, (event) => seen.push(event));
    return seen;
  };

  it('scrolls to an end with nothing unloaded beyond it', async () => {
    const { el, base, scrollFromEnd, press } = await mount({ jump: 'both' });
    const seen = heard(el, 'jumpstart');

    scrollFromEnd(400);
    await press('start');
    expect(seen).toHaveLength(0);
    expect(base.scrollTop).toBe(0);
  });

  it('asks instead, and moves nothing, for an end that is marked', async () => {
    // Moving nothing is half the point: the consumer is about to replace the content, and a scroll
    // through what is on screen on the way there would be a journey to somewhere that is leaving.
    const { el, base, scrollFromEnd, press } = await mount({ jump: 'both', more: ['start'] });
    const seen = heard(el, 'jumpstart');

    scrollFromEnd(400);
    const before = base.scrollTop;
    await press('start');
    expect(seen).toHaveLength(1);
    expect(base.scrollTop).toBe(before);
  });

  it('takes the two ends separately, which is the case it exists for', async () => {
    const { el, base, scrollFromStart, press, span } = await mount({ jump: 'both', more: ['start'] });
    const asked = heard(el, 'jumpend');

    // The other end still scrolls: anchored one way, one button is a trip through loaded content and
    // the other is a different question.
    scrollFromStart(0);
    await press('end');
    expect(asked).toHaveLength(0);
    expect(base.scrollTop).toBe(span());
  });

  it('asks about both when both are marked', async () => {
    const { el, press, scrollFromEnd } = await mount({ jump: 'both', more: ['start', 'end'] });
    const starts = heard(el, 'jumpstart');
    const ends = heard(el, 'jumpend');

    scrollFromEnd(400);
    await press('start');
    await press('end');
    expect([starts.length, ends.length]).toEqual([1, 1]);
  });

  it('goes back to scrolling once the marker is gone, which is the case that prompted this', async () => {
    /*
      A short transcript that has loaded whole has nothing beyond either end, so both buttons should
      simply scroll — and under the prop this replaced they went on re-anchoring, jumping where a
      scroll was both possible and nicer. Read on the press rather than cached, so the moment the
      last page lands the buttons change their minds.
    */
    const { el, base, scrollFromEnd, press } = await mount({ jump: 'both', more: ['start'] });
    const seen = heard(el, 'jumpstart');

    scrollFromEnd(400);
    await press('start');
    expect(seen).toHaveLength(1);

    el.querySelector('[data-we-more]')?.remove();
    await press('start');
    expect(seen).toHaveLength(1);
    expect(base.scrollTop).toBe(0);
  });
});

describe('we-scroll-area edges', () => {
  const heard = (el: HTMLElement, type: string) => {
    const seen: Event[] = [];
    el.addEventListener(type, (event) => seen.push(event));
    return seen;
  };

  it('says nothing on the first look, however close to an edge that is', async () => {
    /*
      The bug this exists for, and it cost a whole extra page on every open. A list at rest is
      already against one of its ends, so a latch seeded `false` reports an approach nobody made the
      instant anything is first measured.

      It was worse in the app: `pin` is a reactive prop and arrives AFTER the first render, so until
      it did, a pinned list still read its position the ordinary way round — `scrollTop` of zero,
      which is the *start* — and every transcript fetched a second page before the reader touched
      anything. That is the scrollbar thumb dropping twice while a transcript loads.
    */
    const { el, scrollFromStart } = await mount({ pin: 'end', nearStart: 400 });
    const seen = heard(el, 'nearstart');

    // Mounted sitting inside the threshold. Observing that is not an approach.
    scrollFromStart(0);
    expect(seen).toHaveLength(0);

    // Leaving and coming back is.
    scrollFromStart(900);
    scrollFromStart(100);
    expect(seen).toHaveLength(1);
  });

  it('watches the far end too, which is how a list read from its start goes on', async () => {
    const { el, scrollFromEnd } = await mount({ nearEnd: 400 });
    const seen = heard(el, 'nearend');

    scrollFromEnd(900);
    scrollFromEnd(100);
    expect(seen).toHaveLength(1);

    // Once per approach, exactly as the other end.
    scrollFromEnd(50);
    expect(seen).toHaveLength(1);
  });

  it('keeps the two independent, so one firing does not arm the other', async () => {
    const { el, scrollFromStart, scrollFromEnd } = await mount({ nearStart: 400, nearEnd: 400 });
    const starts = heard(el, 'nearstart');
    const ends = heard(el, 'nearend');

    scrollFromStart(900);
    scrollFromStart(100);
    expect([starts.length, ends.length]).toEqual([1, 0]);

    scrollFromEnd(100);
    expect([starts.length, ends.length]).toEqual([1, 1]);
  });

  it('answers the same way round in a pinned list, where the coordinates are inverted', async () => {
    const { el, scrollFromEnd } = await mount({ pin: 'end', nearEnd: 400 });
    const seen = heard(el, 'nearend');

    scrollFromEnd(900);
    scrollFromEnd(100);
    expect(seen).toHaveLength(1);
  });
});
