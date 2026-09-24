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
  pointForAnchor,
  REGION_FRESH_MS,
  regionFor,
  reportPointer,
  requestRegion,
  routeSurface,
  scrollAnchor,
} from '@shared/liveView';
import { RECORD_ATTR } from '@we/design-utils';
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
    expect(composeFrame(state, '/space/a/canvas?call=x', CONTENT)).toEqual({
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
    expect(composeFrame(state, '/kanban', CONTENT)).toEqual({
      path: '/kanban',
      surface: 'route:/kanban',
      anchor: { record: 'top', offset: 0.25 },
    });
  });

  it('ignores a canvas that is registered but has never reported a camera', () => {
    const state = createLiveViewState();
    state.surfaces.set(canvasSurface('c1'), { key: canvasSurface('c1') });
    // Before the first measurement there is no camera worth describing, and a region of nothing at the
    // origin would frame a follower on empty space.
    expect(composeFrame(state, '/x', CONTENT).region).toBeUndefined();
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
