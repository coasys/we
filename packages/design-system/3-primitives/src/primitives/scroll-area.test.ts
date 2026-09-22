/**
 * `we-scroll-area`'s tail pinning — and, mostly, when it refuses to.
 *
 * The decision under test is one boolean: was the reader at the end when the content changed. Every
 * bug this feature can have is that boolean being wrong, so the tests drive it directly — scroll the
 * element, add a row, assert whether the view moved — rather than through a real browser.
 *
 * jsdom reports every scroll metric as zero and never lays anything out, so `scrollHeight` and
 * `clientHeight` are stubbed per test. That is honest here: the arithmetic is one subtraction, and
 * what matters is which branch it selects.
 */
import './scroll-area';

import { describe, expect, it } from 'vitest';

interface ScrollAreaEl extends HTMLElement {
  pin: '' | 'end';
  jump: '' | 'start' | 'end' | 'both';
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
 * `scrollHeight` and `clientHeight` are defined as configurable getters because jsdom's own are
 * zero and read-only-ish; `scrollTop` stays a plain property so the element can write it and the
 * test can read back what it wrote. `scrollHeight` reads through a variable rather than being
 * fixed, because the bug this file exists to pin down is content growing between one measurement
 * and the next.
 */
async function mount(options: {
  pin?: 'end';
  jump?: 'start' | 'end' | 'both';
  scrollHeight?: number;
  clientHeight?: number;
}) {
  const el = document.createElement('we-scroll-area') as ScrollAreaEl;
  if (options.pin) el.pin = options.pin;
  if (options.jump) el.jump = options.jump;
  document.body.appendChild(el);
  await el.updateComplete;

  let scrollHeight = options.scrollHeight ?? 1000;
  const clientHeight = options.clientHeight ?? 200;

  const base = el.shadowRoot!.querySelector('[part="base"]') as HTMLElement;
  Object.defineProperty(base, 'scrollHeight', { get: () => scrollHeight, configurable: true });
  Object.defineProperty(base, 'clientHeight', { value: clientHeight, configurable: true });
  base.scrollTop = 0;

  /** Put the reader at a scroll offset and let the element notice. */
  const scrollTo = (top: number) => {
    base.scrollTop = top;
    base.dispatchEvent(new Event('scroll'));
  };

  /** Add a row to the light DOM, which is what the mutation observer is watching. */
  const addRow = async () => {
    el.appendChild(document.createElement('div'));
    await settle();
  };

  /**
   * The row that just landed turns out to be a different height from when it was measured.
   *
   * Clamps on the way down, which is what a browser does and what the stub otherwise would not: a
   * scroller whose content shrinks below its current offset is moved up to the new maximum. Without
   * that, a shrink leaves `scrollTop` past the end, `#toEnd` reads it as already there and returns,
   * and the test concludes the element failed to follow something no browser would have shown it.
   */
  const grow = (by: number) => {
    scrollHeight += by;
    const max = Math.max(0, scrollHeight - clientHeight);
    if (base.scrollTop > max) base.scrollTop = max;
  };

  /** The scroll event the browser queues for a write we made, delivered after the frame's layout. */
  const deliverOurScroll = () => base.dispatchEvent(new Event('scroll'));

  /** Which jump controls are currently drawn. Lit re-renders on the state they are gated on. */
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

  return {
    el,
    base,
    scrollTo,
    addRow,
    grow,
    deliverOurScroll,
    controls,
    press,
    end: () => scrollHeight - clientHeight,
  };
}

describe('we-scroll-area pin="end"', () => {
  it('follows the end when the reader is already there', async () => {
    const { base, scrollTo, addRow } = await mount({ pin: 'end' });

    // 1000 - 800 - 200 = 0, so squarely at the end.
    scrollTo(800);
    await addRow();

    expect(base.scrollTop).toBe(800);
  });

  it('holds position when the reader has scrolled up', async () => {
    const { base, scrollTo, addRow } = await mount({ pin: 'end' });

    scrollTo(100);
    await addRow();

    // The whole point: somebody re-reading is not yanked to the bottom by an arriving line.
    expect(base.scrollTop).toBe(100);
  });

  it('counts a few pixels short of the bottom as the bottom', async () => {
    const { base, scrollTo, addRow } = await mount({ pin: 'end' });

    // 1000 - 790 - 200 = 10, inside AT_END_PX. Fractional pixels and sub-pixel line heights land
    // here constantly, and an exact comparison would read this as "scrolled away".
    scrollTo(790);
    await addRow();

    expect(base.scrollTop).toBe(800);
  });

  it('re-arms once the reader returns to the end', async () => {
    const { base, scrollTo, addRow } = await mount({ pin: 'end' });

    scrollTo(100);
    await addRow();
    expect(base.scrollTop).toBe(100);

    scrollTo(800);
    await addRow();
    expect(base.scrollTop).toBe(800);
  });

  it('does nothing at all without the prop', async () => {
    const { base, scrollTo, addRow } = await mount({});

    scrollTo(800);
    await addRow();

    // Not opted in, so an ordinary scroll area must keep behaving like one.
    expect(base.scrollTop).toBe(800);
  });

  it('keeps following after a row turns out to be several lines tall', async () => {
    const { base, scrollTo, addRow, grow, deliverOurScroll, end } = await mount({ pin: 'end' });

    scrollTo(800);

    // A row lands and is followed. It then renders its own content — a Lit element's shadow render
    // is a microtask later — and turns out to be four lines rather than one, so the end moves down
    // again after we measured it.
    await addRow();
    expect(base.scrollTop).toBe(800);
    grow(240);

    // Only now does the browser deliver the scroll event our write queued. It reports a position
    // 240px short of an end that has moved since, which is the reading that used to latch the
    // element out of following for good.
    deliverOurScroll();

    await addRow();
    expect(base.scrollTop).toBe(end());
  });

  it('still lets go when the reader scrolls away after that', async () => {
    const { base, scrollTo, addRow, grow, deliverOurScroll } = await mount({ pin: 'end' });

    scrollTo(800);
    await addRow();
    grow(240);
    deliverOurScroll();

    // The guard is "this is the position we wrote", not "ignore everything" — a reader moving
    // anywhere else is still a reader moving.
    scrollTo(300);
    await addRow();
    expect(base.scrollTop).toBe(300);
  });

  it('re-arms following when the reader presses jump-to-end', async () => {
    const { base, scrollTo, addRow, press } = await mount({ pin: 'end', jump: 'end' });

    scrollTo(100);
    await addRow();
    expect(base.scrollTop).toBe(100);

    await press('end');
    expect(base.scrollTop).toBe(800);

    // The press is worth more than one scroll: the list carries the reader again from here.
    await addRow();
    expect(base.scrollTop).toBe(800);
  });

  it('scrolls to the end the prop asks for, even when the prop is set late', async () => {
    const { el, base } = await mount({});

    // A framework binding `pin` inside an effect can set it after Lit has rendered, so the opening
    // jump has to survive arriving a beat after first paint.
    el.pin = 'end';
    await el.updateComplete;

    expect(base.scrollTop).toBe(800);
  });
});

describe('we-scroll-area jump', () => {
  it('offers neither control without the prop', async () => {
    const { scrollTo, controls } = await mount({});

    scrollTo(400);

    expect(await controls()).toEqual({ start: false, end: false });
  });

  it('offers only the direction there is somewhere to go in', async () => {
    const { scrollTo, controls } = await mount({ jump: 'both' });

    scrollTo(0);
    expect(await controls()).toEqual({ start: false, end: true });

    scrollTo(400);
    expect(await controls()).toEqual({ start: true, end: true });

    scrollTo(800);
    expect(await controls()).toEqual({ start: true, end: false });
  });

  it('honours which directions were asked for', async () => {
    const { scrollTo, controls } = await mount({ jump: 'end' });

    scrollTo(400);

    expect(await controls()).toEqual({ start: false, end: true });
  });

  it('draws nothing at all when there is nothing to scroll', async () => {
    const { scrollTo, controls } = await mount({ jump: 'both', scrollHeight: 210, clientHeight: 200 });

    scrollTo(0);

    // 10px of overflow is within AT_END_PX — a button to cross it would be chrome for its own sake.
    expect(await controls()).toEqual({ start: false, end: false });
  });

  it('appears when the content grows past a reader who has not moved', async () => {
    const { scrollTo, addRow, grow, controls } = await mount({ jump: 'end', scrollHeight: 200 });

    scrollTo(0);
    expect(await controls()).toEqual({ start: false, end: false });

    // Nobody scrolled; the end moved. This is the moment the control is worth offering, and an
    // answer computed only from scroll events would never notice it.
    grow(600);
    await addRow();

    expect(await controls()).toEqual({ start: false, end: true });
  });

  it('becomes the containing block for its controls, and only then', async () => {
    // `position` is DS-covered on :host, so it can only arrive through the prop merge — hardcoding
    // it in the component's own CSS is reverted the moment an instance renders. And an ordinary
    // scroll area must not become a stacking context for nothing: something absolutely positioned
    // in slotted content would quietly start resolving against it.
    const plain = await mount({});
    expect(plain.el.style.getPropertyValue('--we-scroll-area-position')).toBe('');

    const withControls = await mount({ jump: 'end' });
    expect(withControls.el.style.getPropertyValue('--we-scroll-area-position')).toBe('relative');
  });

  it('takes the reader back to the start, without re-arming the pin', async () => {
    const { base, scrollTo, addRow, press } = await mount({ pin: 'end', jump: 'both' });

    scrollTo(800);
    await press('start');
    expect(base.scrollTop).toBe(0);

    // Pressing it is a decision to be somewhere else, so an arriving line must not undo it.
    await addRow();
    expect(base.scrollTop).toBe(0);
  });
});

/**
 * The settle pass: following keeps checking until the end stops moving.
 *
 * One frame used to be the whole budget, and content is not on a budget. A page of rows arriving at
 * once is a hundred-odd custom elements each rendering their own shadow content, and when that does
 * not finish inside a single frame the follow measures a list mid-layout and lands short of a bottom
 * that keeps moving. That is a transcript opening with its last couple of lines under the edge of
 * the panel, which is exactly what was reported.
 *
 * Driven by hand rather than through real frames: `frame()` is one turn of the pass, which is what
 * the rAF callback would have done.
 */
describe('we-scroll-area follows content that is still laying out', () => {
  /** Run the pending settle frame, if there is one, and let its follow land. */
  const frame = async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await Promise.resolve();
  };

  it('keeps following while the content is still growing', async () => {
    const { base, scrollTo, addRow, grow, end } = await mount({ pin: 'end' });

    scrollTo(800);
    await addRow();

    // Three frames of a list that is still rendering itself. Under the old single-frame pass only
    // the first of these was followed, and the view stayed wherever that left it.
    for (const by of [240, 180, 90]) {
      grow(by);
      await frame();
    }

    expect(base.scrollTop).toBe(end());
  });

  it('stops once two frames agree, rather than spinning for its whole budget', async () => {
    const { base, scrollTo, addRow, grow, end } = await mount({ pin: 'end' });

    scrollTo(800);
    await addRow();
    grow(240);
    await frame();
    // Settled: the next frame measures the same height and schedules nothing further.
    await frame();
    const settledAt = base.scrollTop;
    expect(settledAt).toBe(end());

    // Growth after the pass has stopped is NOT chased — that is the reflow-arriving-late case the
    // element deliberately leaves alone, since by then the reader is looking at it.
    grow(500);
    await frame();
    expect(base.scrollTop).toBe(settledAt);
  });

  it('gives the scroller back the moment the reader touches it', async () => {
    const { el, base, scrollTo, addRow, grow } = await mount({ pin: 'end' });

    scrollTo(800);
    await addRow();
    const before = base.scrollTop;

    // A gesture mid-settle. Finishing a movement the reader did not ask for is the whole job; doing
    // it through their gesture is the yanking `pin` exists to avoid.
    el.dispatchEvent(new Event('wheel'));
    grow(240);
    await frame();

    expect(base.scrollTop).toBe(before);
  });
});

/**
 * `nearStart`: say when the reader is within reach of the top, and keep their place across what
 * lands above them.
 *
 * The event is what replaces a "show earlier" button — reaching the edge of a list IS the request.
 * The hold is what makes that bearable: content added above moves everything the reader is looking
 * at down by its own height, so without it, asking for more is punished by losing your place, on
 * every load, while scrolling.
 */
describe('we-scroll-area nearStart', () => {
  const nearStarts = (el: HTMLElement) => {
    const seen: Event[] = [];
    el.addEventListener('nearstart', (event) => seen.push(event));
    return seen;
  };

  it('says nothing unless a distance was asked for', async () => {
    const { el, scrollTo } = await mount({ pin: 'end' });
    const seen = nearStarts(el);

    scrollTo(0);
    expect(seen).toHaveLength(0);
  });

  it('fires once per approach, not once per scroll event', async () => {
    const { el, scrollTo } = await mount({ pin: 'end' });
    (el as unknown as { nearStart: number }).nearStart = 400;
    const seen = nearStarts(el);

    scrollTo(300);
    scrollTo(200);
    scrollTo(100);
    // A consumer's handler is "fetch the next page", not "fetch the next page unless I already am".
    expect(seen).toHaveLength(1);

    // Scrolling back out past the threshold re-arms it.
    scrollTo(700);
    scrollTo(100);
    expect(seen).toHaveLength(2);
  });

  it('says nothing on a list with nothing to scroll', async () => {
    // Without this a short list fires on mount: a scroller with no overflow sits at zero, which is
    // inside any threshold.
    const { el, scrollTo } = await mount({ pin: 'end', scrollHeight: 200, clientHeight: 200 });
    (el as unknown as { nearStart: number }).nearStart = 400;
    const seen = nearStarts(el);

    scrollTo(0);
    expect(seen).toHaveLength(0);
  });

  it('puts the reader back where they were once the earlier rows arrive', async () => {
    const { el, base, scrollTo, addRow, grow } = await mount({ pin: 'end' });
    (el as unknown as { nearStart: number }).nearStart = 400;

    scrollTo(100);
    // 1000 - 100 = 900 from the bottom, which is the distance that has to survive.
    grow(600);
    await addRow();

    expect(base.scrollHeight - base.scrollTop).toBe(900);
    expect(base.scrollTop).toBe(700);
  });

  it('leaves a line arriving at the tail alone, which is not a prepend', async () => {
    const { el, base, scrollTo, addRow, grow } = await mount({ pin: 'end' });
    const seen = nearStarts(el);

    // Never went near the top, so nothing is held and an ordinary live line moves nobody.
    (el as unknown as { nearStart: number }).nearStart = 400;
    scrollTo(500);
    grow(60);
    await addRow();

    expect(seen).toHaveLength(0);
    expect(base.scrollTop).toBe(500);
  });
});

/**
 * The `jump-start` slot: the scroller decides whether there is anywhere to go, the consumer decides
 * what going there means.
 *
 * For a windowed list the top of what is LOADED is not the beginning of anything, so a
 * scroll-to-top would say "start" and deliver "as far back as we happened to fetch". Reaching the
 * real beginning is a different query and only the consumer can run it — but where the control sits
 * and when it is worth offering are still the scroller's to answer, so only the action is handed
 * back.
 */
describe('we-scroll-area jump-start slot', () => {
  it('draws its own button when nothing is slotted', async () => {
    const { el, scrollTo, controls } = await mount({ jump: 'both' });
    scrollTo(500);
    expect((await controls()).start).toBe(true);
    expect(el.shadowRoot!.querySelector('[part="jump-start"] we-button')).not.toBeNull();
  });

  it('is still gated on there being somewhere to go', async () => {
    // Visibility is not handed back. A consumer supplying a control does not get to show it at the
    // top of the list, where "back to the start" means nothing.
    const { el, controls } = await mount({ jump: 'both' });
    el.innerHTML = '<button slot="jump-start">Beginning</button>';
    await settle();
    expect((await controls()).start).toBe(false);
  });

  it('renders the consumer control in place of its own once there is', async () => {
    const { el, scrollTo, controls } = await mount({ jump: 'both' });
    el.innerHTML = '<button slot="jump-start">Beginning</button>';
    scrollTo(500);
    await settle();

    expect((await controls()).start).toBe(true);
    const slot = el.shadowRoot!.querySelector('[part="jump-start"] slot') as HTMLSlotElement;
    expect(slot.assignedElements()).toHaveLength(1);
  });
});

/**
 * Opening is instant; everything after it animates.
 *
 * The rule as a reader states it: a list opens already in the right place, and *moves* only in
 * response to something happening. Both halves matter — a transcript that slides up from the top
 * when a panel opens reads as broken, and one that teleports every time somebody speaks loses the
 * only cue saying which way the content went.
 *
 * What made this hard is that an opening is not one scroll. The content mounts, is measured, is
 * replaced and settles at a different height, with the scroller reset to zero in between — measured
 * in a real browser as `instant 0→720`, `smooth 0→412`, `smooth 0→412`. So a flag set on the first
 * scroll is set three scrolls too early, which is what left the last lines under the edge of the
 * panel for a few hundred milliseconds.
 *
 * `scrollTo` is stubbed because that is the only thing separating the two paths: a smooth follow
 * calls it, an instant one assigns `scrollTop`. jsdom has no `scrollTo` at all, so without the stub
 * every follow here would take the instant branch and the distinction would be untestable.
 */
describe('we-scroll-area opens without animating', () => {
  const frame = async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await Promise.resolve();
  };

  /** Mount with `scrollTo` recorded, so a case can tell a smooth follow from an instant one. */
  const mountAnimatable = async () => {
    const harness = await mount({ pin: 'end' });
    const smoothScrolls: number[] = [];
    (harness.base as unknown as { scrollTo: (o: { top: number }) => void }).scrollTo = (o) => {
      smoothScrolls.push(o.top);
      harness.base.scrollTop = o.top;
    };
    return { ...harness, smoothScrolls };
  };

  it('does not animate any part of the opening, however many passes it takes', async () => {
    const { base, addRow, grow, smoothScrolls, end } = await mountAnimatable();

    // The opening, in the shape a real one has: content arrives, is followed, and then turns out to
    // be a different height — more than once.
    await addRow();
    grow(300);
    await frame();
    grow(-500);
    await frame();

    expect(smoothScrolls).toEqual([]);
    expect(base.scrollTop).toBe(end());
  });

  it('animates once the list has settled and something new arrives', async () => {
    const { addRow, grow, smoothScrolls } = await mountAnimatable();

    // Open, and let it settle — two frames at the same height is what says the opening is over.
    await addRow();
    await frame();
    await frame();
    expect(smoothScrolls).toEqual([]);

    // Now a line arrives. This is the case the animation exists for, and it has to survive the fix.
    grow(40);
    await addRow();
    expect(smoothScrolls).toHaveLength(1);
  });

  it('still jumps rather than animating when the catch-up is a whole backlog', async () => {
    // The distance cap is untouched by any of this: a follow longer than SMOOTH_MAX_PX is a change
    // of place rather than a movement, whether or not the list has opened.
    const { addRow, grow, smoothScrolls } = await mountAnimatable();

    await addRow();
    await frame();
    await frame();

    grow(4000);
    await addRow();
    expect(smoothScrolls).toEqual([]);
  });
});
