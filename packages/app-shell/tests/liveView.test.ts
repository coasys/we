/**
 * The frame maths, which is where a live cursor is right or silently wrong.
 *
 * Every case here has the same shape of failure: the sender cannot see it. Their own cursor is always
 * in the right place, so a fraction measured against the wrong box, a marker with no box, or a record
 * that is not on screen all look perfect from the one screen that can check them.
 */
import {
  allMarks,
  anchorForPoint,
  boxOf,
  canvasSurface,
  composeFrame,
  createLiveViewState,
  currentPointer,
  markerFor,
  placementIn,
  pointForAnchor,
  REGION_FRESH_MS,
  regionFor,
  reportPointer,
  requestRegion,
  routeSurface,
  scrollAnchor,
  scrollerFor,
  scrollPlan,
} from '@shared/liveView';
import { RECORD_ATTR } from '@we/design-utils';
import type { LiveAnchor } from '@we/module-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const CONTENT = { x: 0, y: 0, width: 1000, height: 800 };

/**
 * An element with a box, since jsdom gives everything a zero rect.
 *
 * Stubbing `getBoundingClientRect` rather than laying anything out: what is under test is the
 * arithmetic over boxes and the rule for finding them, and jsdom has no layout to measure either way.
 */
function boxed(box: { x: number; y: number; width: number; height: number }, tag = 'div'): HTMLElement {
  const el = document.createElement(tag);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    ...box,
    top: box.y,
    left: box.x,
    right: box.x + box.width,
    bottom: box.y + box.height,
    toJSON: () => box,
  } as DOMRect);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('finding the box a record stands for', () => {
  it('measures the marker when it has a box', () => {
    const card = boxed({ x: 10, y: 20, width: 100, height: 50 });
    expect(boxOf(card)?.width).toBe(100);
  });

  it('falls through to the first child with a box, for a display:contents marker', () => {
    // `we-draggable` is `display: contents` by design, so this is the ordinary case rather than an
    // edge one. Measuring the marker blindly returns a zero rect, and every fraction computed against
    // it collapses into the card's top-left corner — which reads as every cursor stacking there.
    const wrapper = boxed({ x: 0, y: 0, width: 0, height: 0 }, 'we-draggable');
    wrapper.append(boxed({ x: 10, y: 20, width: 100, height: 50 }));
    expect(boxOf(wrapper)).toMatchObject({ x: 10, width: 100 });
  });

  it('answers nothing where neither has a box, rather than a zero rect', () => {
    const wrapper = boxed({ x: 0, y: 0, width: 0, height: 0 });
    wrapper.append(boxed({ x: 0, y: 0, width: 0, height: 0 }));
    expect(boxOf(wrapper)).toBeNull();
  });
});

describe('anchoring a point', () => {
  it('prefers a record, as a fraction of its own box', () => {
    const card = boxed({ x: 100, y: 100, width: 200, height: 100 });
    card.setAttribute(RECORD_ATTR, 'post-1');
    document.body.append(card);

    const anchor = anchorForPoint(routeSurface('/kanban'), { x: 150, y: 150 }, card, CONTENT);
    expect(anchor).toEqual({ surface: 'route:/kanban', kind: 'record', record: 'post-1', x: 0.25, y: 0.5 });
  });

  it('survives the same card being a different width on the other screen', () => {
    const mine = boxed({ x: 0, y: 0, width: 200, height: 100 });
    mine.setAttribute(RECORD_ATTR, 'post-1');
    const anchor = anchorForPoint(routeSurface('/k'), { x: 50, y: 50 }, mine, CONTENT)!;

    // The same record, drawn narrower and further down. The fraction resolves to the same place *on
    // the card*, which is the whole reason a record anchor exists.
    document.body.append(Object.assign(boxed({ x: 400, y: 300, width: 100, height: 50 }), {}));
    const theirs = document.body.firstElementChild as HTMLElement;
    theirs.setAttribute(RECORD_ATTR, 'post-1');

    expect(pointForAnchor(anchor, CONTENT)).toEqual({ x: 425, y: 325 });
  });

  it('falls back to a fraction of the content box with no record under the pointer', () => {
    const anchor = anchorForPoint(routeSurface('/x'), { x: 500, y: 200 }, document.body, CONTENT);
    expect(anchor).toEqual({ surface: 'route:/x', kind: 'viewport', x: 0.5, y: 0.25 });
  });

  it('says nothing for a point outside the content box', () => {
    // Over a docked panel or the sidebar. A fraction outside 0..1 would be drawn off the edge of
    // somebody else's content as though it meant something.
    expect(anchorForPoint(routeSurface('/x'), { x: -20, y: 200 }, document.body, CONTENT)).toBeNull();
    expect(anchorForPoint(routeSurface('/x'), { x: 500, y: 900 }, document.body, CONTENT)).toBeNull();
  });

  it('draws nothing for a record that is not on this screen', () => {
    const anchor = { surface: 'route:/k', kind: 'record' as const, record: 'not-here', x: 0.5, y: 0.5 };
    // The ordinary case for a peer looking at something else, and drawing nothing is the answer.
    expect(pointForAnchor(anchor, CONTENT)).toBeNull();
  });

  it('leaves a world point to the canvas that owns it', () => {
    const anchor = { surface: canvasSurface('c1'), kind: 'world' as const, x: 40, y: 90 };
    expect(pointForAnchor(anchor, CONTENT)).toBeNull();
  });

  it('survives a record id that is not a bare word', () => {
    const card = boxed({ x: 0, y: 0, width: 100, height: 100 });
    // An id is a uri in some backends. Unescaped, this is a thrown SyntaxError inside a pointer handler.
    card.setAttribute(RECORD_ATTR, 'we://node/"odd"');
    document.body.append(card);
    const anchor = { surface: 'route:/x', kind: 'record' as const, record: 'we://node/"odd"', x: 0, y: 0 };
    expect(() => pointForAnchor(anchor, CONTENT)).not.toThrow();
  });
});

describe('placing a mark inside the layer', () => {
  /*
    The one assertion that keeps the jitter fixed, and the only one that can.

    A resize changes the content box on every pointer move. Whatever part of a mark's position is
    measured against that box is a value a transition will animate — so with the position in pixels, a
    drag made every eased mark chase the layout, each transition restarting before it finished, and the
    mark shook in place. Suspending the easing for the drag swapped that for the other half of the same
    problem: the mark's own twelve-hertz motion stopped being smoothed and became visible hops.

    A percentage is what separates the two, and it is only correct for as long as the placement does not
    consult the box. So the test is not "the number is right" — it is that TWO DIFFERENT BOXES GIVE THE
    SAME ANSWER. Go back to pixels, however carefully, and this fails.
  */
  it('places a viewport mark without consulting the box at all', () => {
    const anchor: LiveAnchor = { surface: routeSurface('/kanban'), kind: 'viewport', x: 0.25, y: 0.5 };

    const wide = placementIn(anchor, { x: 0, y: 0, width: 1000, height: 800 });
    const narrow = placementIn(anchor, { x: 320, y: 56, width: 400, height: 300 });

    expect(wide).toEqual({ left: '25%', top: '50%' });
    // The panel has been dragged 320px inboard and the mark's own style has not changed. The layer moved.
    expect(narrow).toEqual(wide);
  });

  it('places a record mark in pixels, measured from the layer’s own corner', () => {
    const card = boxed({ x: 500, y: 300, width: 200, height: 100 });
    card.setAttribute(RECORD_ATTR, 'post-1');
    document.body.append(card);
    const anchor: LiveAnchor = { surface: routeSurface('/k'), kind: 'record', record: 'post-1', x: 0.5, y: 0.5 };

    /*
      Pixels, because a record's box is not the layer and cannot be made into one. Sound only because
      such a mark is never eased — it is where its card is — so there is no transition to mislead.
      Relative to the layer's corner, since the layer is no longer the window.
    */
    expect(placementIn(anchor, { x: 320, y: 56, width: 600, height: 700 })).toEqual({ left: '280px', top: '294px' });
  });

  it('places nothing for a record that is not on this screen', () => {
    const anchor: LiveAnchor = { surface: routeSurface('/k'), kind: 'record', record: 'elsewhere', x: 0.5, y: 0.5 };
    expect(placementIn(anchor, CONTENT)).toBeNull();
  });

  it('places nothing for a canvas mark, which the graph draws itself', () => {
    const anchor: LiveAnchor = { surface: 'canvas:c1', kind: 'world', x: 40, y: 90 };
    expect(placementIn(anchor, CONTENT)).toBeNull();
  });
});

describe('the scroll anchor', () => {
  it('names the first record still in view, and how far it is scrolled past', () => {
    const gone = boxed({ x: 0, y: -200, width: 100, height: 100 });
    gone.setAttribute(RECORD_ATTR, 'scrolled-away');
    const first = boxed({ x: 0, y: -50, width: 100, height: 100 });
    first.setAttribute(RECORD_ATTR, 'at-the-top');
    document.body.append(gone, first);

    // Half of `at-the-top` is above the top edge, so the offset is half its own height — a fraction,
    // because the follower's copy of that card is a different number of pixels tall.
    expect(scrollAnchor(CONTENT)).toEqual({ record: 'at-the-top', offset: 0.5 });
  });

  it('answers nothing when there are no records to anchor to', () => {
    expect(scrollAnchor(CONTENT)).toBeUndefined();
  });
});

describe('what a scroll anchor scrolls', () => {
  /** A scrollable box: a scrolling overflow AND something to scroll, since either alone is not one. */
  function scroller(box: { x: number; y: number; width: number; height: number }, content: number): HTMLElement {
    const el = boxed(box);
    el.style.overflowY = 'auto';
    Object.defineProperty(el, 'clientHeight', { value: box.height, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: content, configurable: true });
    return el;
  }

  it('scrolls the record’s own container, not the window', () => {
    /*
      The case that silently did nothing. Half of what a person reads in WE does not scroll the page: a
      transcript scrolls inside its panel, a column inside itself, a thread inside a card. `window.scrollBy`
      was the whole implementation, so following somebody reading any of those scrolled nothing at all.
    */
    const panel = scroller({ x: 0, y: 100, width: 300, height: 400 }, 2_000);
    const card = boxed({ x: 0, y: 260, width: 300, height: 80 });
    card.setAttribute(RECORD_ATTR, 'utterance-7');
    panel.append(card);
    document.body.append(panel);

    const plan = scrollPlan(card, { y: 260 }, { y: 0 });
    expect(plan.scroller).toBe(panel);
    // Measured to the PANEL's top edge, because that is where the top of what you can see is inside it.
    expect(plan.top).toBe(160);
  });

  it('falls back to the window for content that scrolls the page', () => {
    const card = boxed({ x: 0, y: 500, width: 600, height: 100 });
    card.setAttribute(RECORD_ATTR, 'post-9');
    document.body.append(card);

    const plan = scrollPlan(card, { y: 500 }, { y: 56 });
    // Null means the window, and the target is the content box's own top rather than an element's.
    expect(plan.scroller).toBeNull();
    expect(plan.top).toBe(444);
  });

  it('ignores a container that declares a scrolling overflow but has nothing to scroll', () => {
    /*
      Both halves of the test matter. Scrolling such a box is a no-op, so believing it would swallow the
      scroll and leave the follower where they were — the same silent nothing, one layer along.
    */
    const box = scroller({ x: 0, y: 0, width: 300, height: 400 }, 400);
    const card = boxed({ x: 0, y: 40, width: 300, height: 80 });
    card.setAttribute(RECORD_ATTR, 'post-1');
    box.append(card);
    document.body.append(box);

    expect(scrollerFor(card)).toBeNull();
  });

  it('ignores a container with overflowing content that does not scroll', () => {
    // Overflowing with `overflow: visible` is the page scrolling, not the box.
    const box = boxed({ x: 0, y: 0, width: 300, height: 400 });
    Object.defineProperty(box, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(box, 'scrollHeight', { value: 3_000, configurable: true });
    const card = boxed({ x: 0, y: 40, width: 300, height: 80 });
    card.setAttribute(RECORD_ATTR, 'post-2');
    box.append(card);
    document.body.append(box);

    expect(scrollerFor(card)).toBeNull();
  });

  it('finds a record by an id that would break a selector', () => {
    // A record id is a uri in some backends; a stray quote turns a lookup into a thrown SyntaxError.
    const card = boxed({ x: 0, y: 0, width: 10, height: 10 });
    card.setAttribute(RECORD_ATTR, 'we://node/"odd"');
    document.body.append(card);
    expect(markerFor('we://node/"odd"')).toBe(card);
    expect(markerFor('')).toBeNull();
  });
});

describe('which pointer wins', () => {
  it('prefers a canvas over the document, since both see the same move', () => {
    const state = createLiveViewState();
    const key = canvasSurface('c1');
    reportPointer(state, 'document', { surface: 'route:/x', kind: 'viewport', x: 0.5, y: 0.5 });
    reportPointer(state, key, { surface: key, kind: 'world', x: 10, y: 20 });
    // World coordinates in the space the content is stored in beat a fraction of a box that happens
    // to contain a canvas.
    expect(currentPointer(state)).toMatchObject({ kind: 'world', x: 10 });
  });

  it('falls back to the document once the canvas reports nothing', () => {
    const state = createLiveViewState();
    const key = canvasSurface('c1');
    reportPointer(state, key, { surface: key, kind: 'world', x: 10, y: 20 });
    reportPointer(state, 'document', { surface: 'route:/x', kind: 'viewport', x: 0.5, y: 0.5 });
    reportPointer(state, key, null);
    expect(currentPointer(state)).toMatchObject({ kind: 'viewport' });
  });

  it('keeps telling the other listeners when one of them throws', () => {
    const state = createLiveViewState();
    const heard: unknown[] = [];
    state.pointerListeners.add(() => {
      throw new Error('a module misbehaving');
    });
    state.pointerListeners.add((at) => void heard.push(at));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // One module throwing must not deafen another, and must not unwind into a pointer handler.
    expect(() => reportPointer(state, 'document', null)).not.toThrow();
    expect(heard).toEqual([null]);
  });
});

describe('what this agent has in view', () => {
  it('names the canvas and its region when one has reported a camera', () => {
    const state = createLiveViewState();
    const key = canvasSurface('c1');
    state.surfaces.set(key, { key, region: { x: 1, y: 2, width: 3, height: 4 } });
    expect(composeFrame(state, { path: '/space/a/canvas?call=x', pathname: '/space/a/canvas' }, CONTENT)).toEqual({
      path: '/space/a/canvas?call=x',
      surface: key,
      region: { x: 1, y: 2, width: 3, height: 4 },
    });
  });

  it('falls back to the route and a scroll anchor with no canvas', () => {
    const state = createLiveViewState();
    const card = boxed({ x: 0, y: -25, width: 100, height: 100 });
    card.setAttribute(RECORD_ATTR, 'top');
    document.body.append(card);
    expect(composeFrame(state, { path: '/kanban', pathname: '/kanban' }, CONTENT)).toEqual({
      path: '/kanban',
      surface: 'route:/kanban',
      anchor: { record: 'top', offset: 0.25 },
    });
  });

  it('keeps the query out of the surface key, and in the path', () => {
    const state = createLiveViewState();
    const frame = composeFrame(state, { path: '/space/a/kanban?call=xyz', pathname: '/space/a/kanban' }, CONTENT);

    /*
      Two halves of one address, and not interchangeable. `path` is what a follower has to reproduce, and
      in WE half of what a page shows lives in the query. The *surface* is screen geometry, which two
      people with different view state share — so a key built from the full address disagrees with the
      publisher and the overlay, both of which key on the pathname. Everything whose surface came from
      here was then dropped, while real cursors between two peers carried on working: the development
      harness drew nothing at all and nothing else looked wrong.
    */
    expect(frame.path).toBe('/space/a/kanban?call=xyz');
    expect(frame.surface).toBe(routeSurface('/space/a/kanban'));
    expect(frame.surface).not.toContain('?');
  });

  it('ignores a canvas that is registered but has never reported a camera', () => {
    const state = createLiveViewState();
    state.surfaces.set(canvasSurface('c1'), { key: canvasSurface('c1') });
    // Before the first measurement there is no camera worth describing, and a region of nothing at the
    // origin would frame a follower on empty space.
    expect(composeFrame(state, { path: '/x', pathname: '/x' }, CONTENT).region).toBeUndefined();
  });
});

describe('a region a follower was asked to frame', () => {
  it('is handed over while it is fresh, and expires rather than lingering', () => {
    const state = createLiveViewState();
    const key = canvasSurface('c1');
    requestRegion(state, key, { x: 0, y: 0, width: 10, height: 10 }, 1_000);

    expect(regionFor(state, key, 1_500)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    /*
      The expiry is the point. A held region would re-frame a canvas that remounts — a tab switched
      away from and back — long after anybody stopped following, dragging the reader somewhere they
      never asked to go. A follower who lands too late simply gets the driver's next publish.
    */
    expect(regionFor(state, key, 1_000 + REGION_FRESH_MS + 1)).toBeNull();
  });

  it('answers nothing for a surface nobody asked about', () => {
    expect(regionFor(createLiveViewState(), canvasSurface('c1'))).toBeNull();
  });
});

describe('collecting marks', () => {
  it('gathers from every accessor, and keeps going when one throws', () => {
    const state = createLiveViewState();
    const at = { surface: 'route:/x', kind: 'viewport' as const, x: 0, y: 0 };
    state.marks.add(() => [{ id: 'a', at, node: { type: 'we-live-cursor' } }]);
    state.marks.add(() => {
      throw new Error('a module misbehaving');
    });
    state.marks.add(() => [{ id: 'b', at, node: { type: 'we-live-cursor' } }]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(allMarks(state).map((mark) => mark.id)).toEqual(['a', 'b']);
  });
});
