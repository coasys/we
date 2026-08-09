/**
 * The stage — what the call asks the host for, and how the tiles pack once it gets it.
 *
 * Tested against `signal` alone, with no transport and no presence, because that is the degradation
 * mode the contract promises and it is also the only part of this file that needs a browser. What is
 * checked here is the arithmetic: the mode progression, the three keys the host reads off it, and
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

describe('stage modes', () => {
  it('walks hidden → strip → dock → max and back round', () => {
    const store = makeStore();
    const modes = ['strip', 'dock', 'max', 'hidden'];

    expect(store.stageMode()).toBe('hidden');
    for (const expected of modes) {
      store.cycleStage();
      expect(store.stageMode()).toBe(expected);
    }
  });

  it('asks for no room until it is opened', () => {
    // A call you have just joined must not shrink the app on its own. `null` is how the dock says
    // "not placed", which is the same key the host reads for *where* — one question, one answer.
    const store = makeStore();
    expect(store.dockEdge()).toBeNull();
  });

  it('overlays at both ends of the size range and insets only in between', () => {
    const store = makeStore();

    store.cycleStage(); // strip — too small to be worth shrinking the app for
    expect(store.dockFloat()).toBe(true);
    expect(store.dockSize()).toBe('sm');

    store.cycleStage(); // dock — the one mode that takes room
    expect(store.dockFloat()).toBe(false);
    expect(store.dockSize()).toBe('md');

    store.cycleStage(); // max — insetting to full size would leave a viewport of zero width
    expect(store.dockFloat()).toBe(true);
    expect(store.dockSize()).toBe('full');
  });

  it('keeps the edge preference live through the modes that ignore it', () => {
    // Cycling through a floating mode and back must return the panel where the user left it. Read
    // through the options rather than `dockEdge`, which reports `null` outside a call however the
    // preference is set — see the next test.
    const store = makeStore();
    store.setDockEdge('bottom');
    store.cycleStage();
    store.cycleStage();

    expect(store.stageMode()).toBe('dock');
    expect(store.dockEdgeOptions().find((option) => option.active)?.id).toBe('bottom');
  });

  it('places nothing while there is no call, whatever the stage was left at', () => {
    // `dockEdge` answers "where is this panel" for the host, and a panel with nothing in it has no
    // answer. Without the guard, state left over from a call that ended would dock an empty box.
    const store = makeStore();
    store.cycleStage();
    store.cycleStage();

    expect(store.active()).toBe(false);
    expect(store.dockEdge()).toBeNull();
  });

  it('offers size and edge controls only where they act', () => {
    const store = makeStore();
    expect(store.stageDocked()).toBe(false);

    store.cycleStage();
    expect(store.stageDocked()).toBe(false); // a strip has no size to choose
    store.cycleStage();
    expect(store.stageDocked()).toBe(true);
  });
});

describe('tile packing', () => {
  it('divides a definite box rather than growing to fit its content', () => {
    // The invariant the whole layout exists for. A wrapping flex row derives its line height from
    // content and can only grow, so a declared stage height was a floor; grid tracks of `1fr` divide
    // what they are given and cannot overflow it.
    const store = makeStore();
    store.cycleStage();
    store.cycleStage();

    const style = store.stageStyle();
    expect(style.display).toBe('grid');
    expect(style['grid-auto-rows']).toBe('1fr');
    expect(style['grid-template-columns']).toBe('repeat(1, 1fr)');
  });

  it('flows a strip along one row so its width follows the headcount', () => {
    const store = makeStore();
    store.cycleStage();

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
