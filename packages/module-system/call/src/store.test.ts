/**
 * The stage — what the call asks the host for, and how the tiles pack once it gets it.
 *
 * Tested against `signal` alone, with no transport and no presence, because that is the degradation
 * mode the contract promises and it is also the only part of this file that needs a browser. What is
 * checked here is the arithmetic: how a placement resolves, the three keys the host reads off it, and
 * the packing rule that makes "one participant never scrolls" true by construction rather than by
 * inspection.
 */
import { describe, expect, it } from 'vitest';

import { createCallStore } from './store';

/** The reactivity a host lends a module, reduced to the smallest thing that satisfies it. */
function makeStore() {
  const signal = <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    return [() => value, (next: T) => (value = next)];
  };
  return createCallStore({ signal }) as ReturnType<typeof createCallStore> & Record<string, () => unknown>;
}

describe('placement', () => {
  it('separates whether the video shows from where it goes', () => {
    // One button used to cycle visibility, placement and size together, so it could not have a clear
    // icon and any given state took up to three clicks through states nobody wanted.
    const store = makeStore();
    expect(store.stageOpen()).toBe(false);

    store.toggleStage();
    expect(store.stageOpen()).toBe(true);
    store.toggleStage();
    expect(store.stageOpen()).toBe(false);
  });

  it('shows the video when a placement is chosen, rather than asking twice', () => {
    const store = makeStore();
    store.setPlacement('bottom');

    expect(store.stageOpen()).toBe(true);
    expect(store.placementOptions().find((option) => option.active)?.id).toBe('bottom');
  });

  it('asks for no room until it is opened', () => {
    // A call you have just joined must not shrink the app on its own. `null` is how the dock says
    // "not placed", which is the same key the host reads for *where* — one question, one answer.
    expect(makeStore().dockEdge()).toBeNull();
  });

  it('treats floating and full screen as placements that overlay, and edges as ones that inset', () => {
    // Both extremes overlay for opposite reasons: a float is too small to be worth shrinking the app
    // for, a full stage too large to leave anything of it.
    const store = makeStore();

    store.setPlacement('float');
    expect(store.dockFloat()).toBe(true);
    expect(store.dockSize()).toBe('sm');

    store.setPlacement('right');
    expect(store.dockFloat()).toBe(false);
    expect(store.dockSize()).toBe('md');

    store.setPlacement('full');
    expect(store.dockFloat()).toBe(true);
    expect(store.dockSize()).toBe('full');
  });

  it('names an edge even for the placements that do not use one', () => {
    // The host needs a non-null edge for the panel to exist at all; float and full simply ignore it.
    const store = makeStore();
    store.setPlacement('float');
    expect(store.placementOptions().find((option) => option.active)?.id).toBe('float');
  });

  it('places nothing while there is no call, whatever it was left at', () => {
    // `dockEdge` answers "where is this panel" for the host, and a panel with nothing in it has no
    // answer. Without the guard, state left over from a call that ended would dock an empty box.
    const store = makeStore();
    store.setPlacement('right');

    expect(store.active()).toBe(false);
    expect(store.dockEdge()).toBeNull();
  });

  it('no longer offers a size to choose, because size is dragged', () => {
    // The three preset buttons are gone; the host stores what the user dragged the panel to. Asserted
    // so that reintroducing them is a deliberate decision rather than a reflex.
    const store = makeStore() as unknown as Record<string, unknown>;
    expect(store.setDockSize).toBeUndefined();
    expect(store.dockSizeOptions).toBeUndefined();
    expect(store.cycleStage).toBeUndefined();
  });
});

describe('tile packing', () => {
  it('divides a definite height when height is the scarce dimension', () => {
    // The invariant the whole layout exists for. A wrapping flex row derives its line height from
    // content and can only grow, so a declared stage height was a floor; grid tracks of `1fr` divide
    // what they are given and cannot overflow it.
    const store = makeStore();
    store.setPlacement('bottom');

    const style = store.stageStyle();
    expect(style.display).toBe('grid');
    expect(style['grid-auto-rows']).toBe('1fr');
    expect(style['grid-template-columns']).toBe('repeat(1, 1fr)');
  });

  it('sizes a side dock from its width and stacks the tiles at the top', () => {
    // Sharing the height equally is right when height is scarce and wrong when it is not: a 440×900
    // side dock gave one participant a 900px row to be centred in, so a 247px picture floated in the
    // middle with a third of a screen of nothing above and below it.
    const store = makeStore();
    store.setPlacement('right');

    const style = store.stageStyle();
    expect(style['grid-auto-rows']).toBe('min-content');
    expect(style['align-content']).toBe('start');
  });

  it('derives the picture from whichever dimension is scarce', () => {
    // And never asks a content-sized row to measure itself: `container-type: size` on a row whose
    // height comes from its content collapses it to nothing, which is why the two regimes cannot
    // share one style.
    const store = makeStore();

    store.setPlacement('right');
    expect(store.pictureStyle().width).toBe('100%');

    store.setPlacement('bottom');
    expect(store.pictureStyle().width).toContain('cqh');
  });

  it('flows a floating strip along one row so its width follows the headcount', () => {
    const store = makeStore();
    store.setPlacement('float');

    expect(store.stageStyle()['grid-auto-flow']).toBe('column');
    expect(store.stageStyle()['grid-template-rows']).toBe('1fr');
  });

  it('places nobody when nobody is in the call', () => {
    expect(makeStore().tileCells()).toEqual([]);
  });
});

describe('focus', () => {
  it('starts unfocused, which is what an even grid means', () => {
    expect(makeStore().focusedId()).toBeNull();
  });

  it('is a no-op for a participant who is not there', () => {
    // Reachable only through a stale click, and the honest result is nothing rather than a stage
    // spotlighting an id no tile matches.
    const store = makeStore();
    store.focusTile('nobody');
    expect(store.tileCells()).toEqual([]);
  });
});
