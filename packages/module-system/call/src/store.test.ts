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

import { createCallStore, STAGE_GAP_PX, STAGE_PADDING_PX } from './store';

/** The reactivity a host lends a module, reduced to the smallest thing that satisfies it. */
function makeStore() {
  const signal = <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    return [() => value, (next: T) => (value = next)];
  };
  return createCallStore({ signal }) as ReturnType<typeof createCallStore> & Record<string, () => unknown>;
}

describe('what the call still decides about its own video', () => {
  it('separates whether the video shows from how much of the screen it has', () => {
    // One button used to cycle visibility, placement and size together, so it could not have a clear
    // icon and any given state took up to three clicks through states nobody wanted.
    const store = makeStore();
    expect(store.stageOpen()).toBe(false);

    store.toggleStage();
    expect(store.stageOpen()).toBe(true);
    store.toggleStage();
    expect(store.stageOpen()).toBe(false);
  });

  it('asks for no room until it is opened', () => {
    // A call you have just joined must not shrink the app on its own. `null` is how the dock says
    // "not placed", which is the same key the host reads for *where* — one question, one answer.
    expect(makeStore().dockEdge()).toBeNull();
  });

  it('always overlays, and leaves everything else about the panel to the host', () => {
    // The module's whole statement about layout, and it is now one sentence: a card, floating, when
    // it opens. Position, size, whether it displaces content and whether it covers the screen are all
    // the host's, on the panel's own titlebar.
    const store = makeStore();
    store.toggleStage();

    expect(store.dockFloat()).toBe(true);
    expect(store.dockSize()).toBe('sm');
  });

  it('no longer offers a placement, a size, or a full screen', () => {
    // The four edges became eight snap targets any panel can use, the three size presets became a
    // drag, and full screen became a button on the panel's own titlebar. Asserted so that
    // reintroducing any of them here is a deliberate decision rather than a reflex.
    const store = makeStore() as unknown as Record<string, unknown>;
    expect(store.placementOptions).toBeUndefined();
    expect(store.setPlacement).toBeUndefined();
    expect(store.setDockSize).toBeUndefined();
    expect(store.dockSizeOptions).toBeUndefined();
    expect(store.cycleStage).toBeUndefined();
    expect(store.toggleFullscreen).toBeUndefined();
    expect(store.stageFull).toBeUndefined();
    // The bar used to swap ends to dodge a top-docked stage. It cannot know where the stage is now.
    expect(store.barAtBottom).toBeUndefined();
  });
});

describe('tile packing', () => {
  it('no longer decides its own columns', () => {
    // The columns used to come from the head count alone, with the panel's shape — the one thing the
    // user controls directly — not an input at all. `Grid`'s `childAspect` solves it against the
    // measured box and reports back; this module reads the answer rather than guessing it.
    const store = makeStore();

    expect(store.stageStyle).toBeUndefined();
    expect(store.arrangement()).toEqual({ columns: 1, rows: 1 });
  });

  it('takes the arrangement the stage settled on', () => {
    const store = makeStore();
    store.setArrangement({ columns: 3, rows: 2 });
    expect(store.arrangement()).toEqual({ columns: 3, rows: 2 });
  });

  it('fits each picture to its cell by measuring the cell', () => {
    // `container-type: size` on the cell is what `100cqh` measures, and it is unconditional now: the
    // one shape it would have collapsed — a row sized from the column width — is no longer reachable.
    expect(makeStore().pictureStyle().width).toContain('cqh');
  });

  it('places nobody when nobody is in the call', () => {
    expect(makeStore().tileCells()).toEqual([]);
  });

  it('publishes its own padding and gaps with the shape it wants', () => {
    // The host solves `(width - insetX) / ratio + insetY` for "fit to content", so the insets are
    // what stop the answer coming out short — which the tiles then answered by shrinking to the
    // height and leaving a gap down each side, a fit that looked wrong in the other axis.
    const aspect = makeStore().dockAspect() as { ratio: number; insetX: number; insetY: number };

    expect(aspect.ratio).toBeCloseTo(16 / 9);
    expect(aspect.insetX).toBe(STAGE_PADDING_PX * 2);
    expect(aspect.insetY).toBe(STAGE_PADDING_PX * 2);
  });

  it('fits to the arrangement it is in, rather than solving a new one', () => {
    // With the width fixed, any column count can be made to fit perfectly — so a "fit" that
    // re-solved could rearrange the call under a click that only asked to remove the empty band.
    const store = makeStore();
    store.setArrangement({ columns: 3, rows: 2 });
    const aspect = store.dockAspect() as { ratio: number; insetX: number; insetY: number };

    expect(aspect.ratio).toBeCloseTo((3 * 16) / (2 * 9));
    expect(aspect.insetX).toBe(STAGE_PADDING_PX * 2 + 2 * STAGE_GAP_PX);
    expect(aspect.insetY).toBe(STAGE_PADDING_PX * 2 + 1 * STAGE_GAP_PX);
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

/**
 * The spotlight is a layout, not a bigger cell.
 *
 * It used to be a span in the grid solved for equal tiles, so the focused tile could only ever be
 * two of N — two thirds of the stage at three people and one third at six, which is not a spotlight.
 * These check the two decisions that replaced it: that writing tracks stands the equal-tile solver
 * down, and that the strip lands on the axis with room to spare.
 *
 * Tiles are unreachable without a call, so the strip always holds one here. What varies with the
 * count is inside the track strings, which is why they are asserted as strings.
 */
describe('the spotlight', () => {
  const wide = { width: 1920, height: 900 };
  const tall = { width: 700, height: 1200 };

  const spotlit = (box: { width: number; height: number }) => {
    const store = makeStore();
    store.setStageBox(box);
    store.focusTile('someone');
    return store;
  };

  it('hands the grid back its own solve when nobody is focused', () => {
    // The whole mode switch: `template` takes precedence over `childAspect`, so absent means the
    // equal-tile solver is in charge and present means it stands down. No mode flag to keep in step.
    const store = makeStore();
    expect(store.stageTemplate()).toBeUndefined();
    expect(store.stageRows()).toBeUndefined();
  });

  it('runs the strip down the side of a panel wider than a tile', () => {
    // A 16:9 spotlight in a wider panel is limited by the height, so the spare room is horizontal.
    // The strip is the second *column*; the rows are one per strip tile.
    const store = spotlit(wide);
    expect(store.stageTemplate()).toBe(`1fr ${wide.width * 0.25}px`);
    expect(store.stageRows()).toBe('repeat(1, 1fr)');
  });

  it('runs it underneath a panel that is not', () => {
    const store = spotlit(tall);
    expect(store.stageRows()).toBe(`1fr ${tall.height * 0.25}px`);
    expect(store.stageTemplate()).toBe('repeat(1, 1fr)');
  });

  it('is measured in pixels, not container-query units', () => {
    /*
      A `cq` unit in a container's *own* properties resolves against its ancestor container rather
      than itself — so the stage sizing its own track in `cqw` got a quarter of whatever happened to
      be above it, or of the viewport when nothing was. Verified in Chrome; it is the same
      self-reference the tier sentinel exists for, in the units rather than the queries.
    */
    const store = spotlit(wide);
    expect(store.stageTemplate()).not.toContain('cq');
    expect(store.stageRows()).not.toContain('cq');
  });

  it('leaves a strip that fits alone', () => {
    // The ordinary case is untouched: tiles take a share each, nothing scrolls, and the stage keeps
    // the `overflow: hidden` that makes an overflowing grid a bug to be seen.
    const store = spotlit(wide);
    expect(store.stageOverflow()).toEqual({ overflow: 'hidden' });
    expect(store.stageRows()).toBe('repeat(1, 1fr)');
  });

  it('caps the strip, so one other participant is not half the stage', () => {
    // The natural thickness makes the strip tiles 16:9 along their axis, which for a single tile is
    // most of the panel — the arrangement spotlight exists to get away from.
    const store = spotlit(wide);
    const aspect = store.dockAspect() as { ratio: number; insetX: number; insetY: number };

    expect(aspect.ratio).toBeCloseTo(16 / 9);
    expect(aspect.insetX).toBe(STAGE_PADDING_PX * 2 + wide.width * 0.25 + STAGE_GAP_PX);
    expect(aspect.insetY).toBe(STAGE_PADDING_PX * 2);
  });

  it('gives the whole stage to solo, on the axis the strip was on', () => {
    const store = spotlit(wide);
    store.toggleSolo();

    expect(store.solo()).toBe(true);
    expect(store.stageTemplate()).toBe('1fr');
    expect(store.stageRows()).toBe('1fr');
    // Nothing beside the picture any more, so the fit is the tile's own shape and the padding.
    const aspect = store.dockAspect() as { insetX: number; insetY: number };
    expect(aspect.insetX).toBe(STAGE_PADDING_PX * 2);
  });

  it('ends solo when the spotlight does', () => {
    // It is a property of *having* a spotlight. Left armed, it would take effect on whoever was
    // focused next, which nobody asked for.
    const store = spotlit(wide);
    store.toggleSolo();
    store.focusTile('someone');

    expect(store.solo()).toBe(false);
    expect(store.stageTemplate()).toBeUndefined();
  });

  it('refuses solo with nothing to apply it to', () => {
    // The bar only offers it while something is focused, but a store method is reachable by anything
    // a template can write.
    const store = makeStore();
    store.toggleSolo();
    expect(store.solo()).toBe(false);
  });
});
