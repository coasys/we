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

describe('transport and device lifetime', () => {
  /**
   * Two leaks with the same shape: something acquired on join that nothing gave back.
   *
   * `EphemeralScope` is refcounted, so ten joins left ten refs outstanding and the backend's signal
   * handler for that perspective was never removed. And with no teardown in the module contract,
   * unregistering during a call — which a hot reload does — dropped the only reference to the live
   * peer connections and the media stream, leaving the camera on with nothing able to close it.
   */
  function callable() {
    const signal = <T>(initial: T): [() => T, (next: T) => void] => {
      let value = initial;
      return [() => value, (next: T) => (value = next)];
    };

    let disposed = 0;
    const scope = {
      capabilities: { unicast: 'emulated', broadcast: true, coalesce: true, confidential: false },
      channel: () => ({ publish: () => {}, onMessage: () => () => {} }),
      dispose: () => (disposed += 1),
    };

    const disposers: Array<() => void> = [];
    const store = createCallStore({
      signal,
      dataset: () => ({ id: 'ds' }),
      datasetUri: () => 'inmemory://ds',
      selfId: () => 'did:test:me',
      ephemeral: () => scope,
      presence: { peers: () => [], setActivity: () => {}, clearActivity: () => {} },
      onDispose: (fn: () => void) => disposers.push(fn),
      createPeerConnection: () => ({}) as RTCPeerConnection,
    } as never) as ReturnType<typeof createCallStore> & Record<string, (...args: unknown[]) => unknown>;

    return { store, scopeDisposals: () => disposed, disposers };
  }

  it('shows the video when the call starts', async () => {
    // Nothing did this, so pressing the call button produced a control bar and no picture: `dockEdge`
    // is null while the stage is closed and the host renders no dock for a null edge, so the only
    // routes to a visible stage were controls that read as ways to change something already there.
    const { store } = callable();

    store.joinSpaceCall();
    await Promise.resolve();

    expect(store.stageOpen()).toBe(true);
    // Floating, so showing it costs the space behind it nothing — the two questions stay separate.
    expect(store.dockFloat()).toBe(true);
    expect(store.dockEdge()).not.toBeNull();
  });

  it('stops showing it when the call ends', async () => {
    // "This call is showing", not a preference that outlives the call it was made in.
    const { store } = callable();

    store.joinSpaceCall();
    await Promise.resolve();
    store.leave();

    expect(store.stageOpen()).toBe(false);
    expect(store.dockEdge()).toBeNull();
  });

  it('gives the transport scope back when the call ends', async () => {
    const { store, scopeDisposals } = callable();

    store.joinSpaceCall();
    await Promise.resolve();
    expect(scopeDisposals()).toBe(0);

    store.leave();
    expect(scopeDisposals()).toBe(1);
  });

  it('does not accumulate scopes across repeated joins', async () => {
    const { store, scopeDisposals } = callable();

    store.joinSpaceCall();
    store.joinAnchoredCall('node-a');
    store.joinAnchoredCall('node-b');
    await Promise.resolve();
    store.leave();

    // Each join released the previous one's scope; without that, ten joins leak ten refs and the
    // backend's handler for the perspective outlives every one of them.
    expect(scopeDisposals()).toBe(3);
  });

  it('tears the call down when the module is disposed', async () => {
    const { store, scopeDisposals, disposers } = callable();

    store.joinSpaceCall();
    await Promise.resolve();
    expect(disposers).toHaveLength(1);

    for (const dispose of disposers) dispose();

    // The camera-stays-on case: unregistering during a call must close what the call holds.
    expect(scopeDisposals()).toBe(1);
    expect(store.callId()).toBeNull();
  });
});
