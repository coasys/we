/**
 * The call module's contributions, and the per-space gate now wrapping every module's chrome.
 *
 * The mesh and the media controller are tested in `@we/module-call` itself, against a fake
 * `RTCPeerConnection` and the in-memory bus. What is checked here is the *host* side: that the module
 * registers, that its chrome is gated on the space's enabled set, and that it declares the coupling
 * it actually has.
 */
import { callModule } from '@we/module-call';
import { checkModuleCompatibility } from '@we/module-shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { dockRegistry } from '../src/shared/registries/dockRegistry';
import { moduleRegistry, moduleStores } from '../src/shared/registries/moduleRegistry';
import { registerCoreSlots, slotRegistry } from '../src/shared/registries/slotRegistry';

const host = { backend: 'ad4m', framework: 'solid' };
const storeDeps = {
  signal: <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    return [() => value, (next: T) => (value = next)];
  },
  effect: (fn: () => void) => fn(),
};

beforeEach(() => {
  for (const entry of slotRegistry.ordered()) slotRegistry.remove(entry.id);
  for (const { definition } of moduleRegistry.all()) moduleRegistry.unregister(definition.id);
  registerCoreSlots();
});

describe('call module — declared coupling', () => {
  it('declares neither a backend nor a framework', () => {
    // The point of the module. Signalling goes through the ephemeral port, so any backend
    // implementing one will do; every piece of UI is a fragment, so any renderer will do. The
    // imperative part — binding a MediaStream to a <video> — lives in the `we-video` primitive.
    expect(callModule.backends).toBeUndefined();
    expect(callModule.frameworks).toBeUndefined();
    expect(callModule.components).toBeUndefined();
  });

  it('runs on a host with a different backend and framework', () => {
    expect(checkModuleCompatibility(callModule, { backend: 'nextgraph', framework: 'react' })).toEqual({
      compatible: true,
      problems: [],
    });
  });

  it('declares the capabilities a user should think twice about', () => {
    // Declared, never enforced — they exist to be shown at install. A call module is the clearest
    // case for why that matters.
    expect(callModule.capabilities).toContain('microphone');
    expect(callModule.capabilities).toContain('camera');
    expect(callModule.capabilities).toContain('screen-share');
  });

  it('owns no durable entities', () => {
    // A call is entirely ephemeral: membership is a presence activity that expires on TTL, and
    // signalling is transport. Nothing is worth writing down, so nothing is.
    expect(callModule.models).toBeUndefined();
  });
});

describe('call module — contributions', () => {
  it('registers a store and docks its chrome at the bottom', () => {
    const result = moduleRegistry.register(callModule, host, storeDeps);
    expect(result.registered).toBe(true);

    expect(moduleStores.call).toBeDefined();
    expect(slotRegistry.get('call:0')?.anchor).toBe('dock-bottom');
  });

  it('is reachable without any template cooperating', () => {
    // The same bug the notes module shipped one PR ago: chrome that only renders once somebody is
    // already using the feature leaves no way to start using it. Both modules first solved it by
    // drawing their own floating button, in different corners — so the entry point is now declared
    // and the host's rail draws it.
    expect(callModule.launcher).toEqual({
      icon: 'phone-call',
      label: 'Start call',
      activeLabel: 'Go to the call',
      action: 'goToCall',
      activeWhen: 'active',
      availableWhen: 'canCall',
    });
  });

  it('never points the rail at an action that could end a call', () => {
    /*
      The reason `goToCall` exists rather than the rail calling `joinCall`/`startCall` directly. `join`
      returns early on a matching id and tears the current call down on any other, so wiring the rail
      to it made one button silently dead in the space call and a silent hang-up in every other —
      including a call running in a different space, reached by a button the user pressed to *look*
      at it.

      Asserted on the declaration because that is the whole of the coupling: it is a string, and
      nothing else would notice it being changed back.
    */
    expect(callModule.launcher!.action).not.toBe('joinCall');
    expect(callModule.launcher!.action).not.toBe('startCall');
    expect(callModule.launcher!.action).not.toBe('joinAnchoredCall');
  });

  it('lights the rail while a call is running, and renames itself when it does', () => {
    // The rail is the only chrome that is always on screen, so it is where "am I in a call" belongs.
    // `activeLabel` goes with it: the tooltip is the button's only name, and "Start call" on a button
    // that no longer starts one is worse than no tooltip.
    expect(callModule.launcher!.activeWhen).toBe('active');
    expect(callModule.launcher!.activeLabel).toBeTruthy();
  });

  it('names launcher store keys its own store actually has', () => {
    // The declaration is a string, so nothing but a test connects it to the method. Getting it wrong
    // would produce a rail tab that silently does nothing — the `$action` depth bug again, one layer up.
    moduleRegistry.register(callModule, host, storeDeps);
    const store = moduleStores.call as Record<string, unknown>;

    expect(typeof store[callModule.launcher!.action]).toBe('function');
    expect(typeof store[callModule.launcher!.availableWhen!]).toBe('function');
    // `activeWhen` is read the same way, and a rename here fails silently in the same direction: the
    // tab simply never lights, which looks exactly like not being in a call.
    expect(typeof store[callModule.launcher!.activeWhen!]).toBe('function');
  });

  it('reports the band its bar occupies, so panels can keep clear of it', () => {
    /*
      The contract behind `ShellStore.floatChrome`, and it is a string on both ends: the shell reads
      `chromeReserve` off every module store by name, so a rename here does not fail a build — it
      makes the reserved band silently zero, and a panel snapped to the top centre lands under the
      call bar with its own grip underneath it.

      Zero with no call running, since the bar is not drawn then. The shell used to reserve this
      band unconditionally, as a constant, whether or not anything was up there.
    */
    moduleRegistry.register(callModule, host, storeDeps);
    const store = moduleStores.call as Record<string, unknown>;

    expect(typeof store.chromeReserve).toBe('function');
    expect((store.chromeReserve as () => { bottom: number })()).toEqual({ bottom: 0 });
  });

  it('keeps volatile state off the tile, so a mute cannot remount the video', () => {
    // `$each` renders through a reference-keyed `<For>`, so any change to a tile object remounts that
    // row — and a remounted row builds a new `<video>`, dropping and re-attaching `srcObject`. Muting
    // your microphone blanked your own video.
    //
    // Volatile flags are therefore looked up with `find()` over `modules.call.tileStates` rather than
    // read off `tile`. Asserted on the serialised fragment because nothing else would catch someone
    // reasonably "simplifying" a `find()` back into a row read.
    const tile = JSON.stringify(moduleRegistry.schemas()['call.tile'] ?? callModule.schemas?.tile);

    // Never off `tile`, for every volatile flag — the invariant that matters, and the one a
    // well-meaning simplification breaks.
    for (const volatile of ['audioEnabled', 'videoEnabled', 'isScreen', 'connection', 'hasPicture']) {
      expect(tile).not.toContain(`tile.${volatile}`);
    }
    // Looked up for the ones the fragment reads. `videoEnabled` is deliberately absent: deciding
    // whether there is a picture needs the live track as well as the sender's flag, so the store
    // combines them into `hasPicture` and the fragment asks that one question instead.
    for (const looked of ['audioEnabled', 'isScreen', 'connection', 'hasPicture']) {
      expect(tile).toContain(`find(modules.call.tileStates, { id: tile.id }).${looked}`);
    }
    // Identity and stream stay on the tile: both genuinely require a remount when they change.
    expect(tile).toContain('tile.stream');
  });

  it('contributes the stage as a dock rather than as chrome that places itself', () => {
    // The bar overlays and the stage insets, and that difference is the whole reason `docks` exists
    // alongside `slots`. Asserted because the previous stage was a `position: fixed` overlay carrying
    // `right: '72px'` — a hardcoded copy of the module rail's width that nothing kept in step.
    moduleRegistry.register(callModule, host, storeDeps);

    expect(callModule.docks).toHaveLength(1);
    expect(dockRegistry.get('call:0')?.moduleId).toBe('call');
    // The frame the host wraps it in is ordinary chrome once built, so it renders through the slot
    // registry under its own namespace.
    expect(slotRegistry.get('dock:call:0')).toBeDefined();
  });

  it('names dock state keys its own store actually has', () => {
    // Same class of bug as the launcher action above, and invisible in the same way: these are
    // strings the host reads off the store, so a rename would silently produce a panel that never
    // appears rather than an error anyone could trace.
    moduleRegistry.register(callModule, host, storeDeps);
    const store = moduleStores.call as Record<string, unknown>;
    const dock = callModule.docks![0];

    for (const key of [dock.edge, dock.size, dock.float]) {
      expect(typeof store[key!]).toBe('function');
    }
    // Closed until asked for: a call you have just joined must not shrink the app on its own.
    expect((store[dock.edge] as () => unknown)()).toBeNull();
  });

  it('distinguishes waiting for a connection from a camera that is off', () => {
    // Both render as a bare avatar, so without this the first seconds of a working call look exactly
    // like a broken one. `connecting` is derived from the absence of a stream rather than from the
    // connection state, because `peerStates` is empty until the first negotiation — which is the
    // very window that showed nothing.
    const tile = JSON.stringify(moduleRegistry.schemas()['call.tile'] ?? callModule.schemas?.tile);

    expect(tile).toContain('find(modules.call.tileStates, { id: tile.id }).connecting');
    expect(tile).toContain('find(modules.call.tileStates, { id: tile.id }).failed');
    // A failure must not animate like progress.
    expect(tile).toContain('we-spinner');
    expect(tile).toContain("Couldn't connect");
  });

  it('looks a participant up by id for their face, so a profile arriving cannot remount their video', () => {
    // The same hazard as the volatile flags above, with a stranger symptom: a profile is fetched
    // after the tile exists, so folding it onto the tile object would blank that person's video at
    // the exact moment their avatar loaded. `tile.name` and `tile.avatar` used to be declared on
    // `CallTile`, were never set by anything, and were read here — an invitation to "fix" it the
    // wrong way.
    const tile = JSON.stringify(moduleRegistry.schemas()['call.tile'] ?? callModule.schemas?.tile);

    for (const late of ['name', 'avatar']) {
      expect(tile).not.toContain(`tile.${late}`);
    }
    for (const field of ['image', 'hash', 'name']) {
      expect(tile).toContain(`find(modules.call.tileFaces, { id: tile.id }).${field}`);
    }
    // Identity that cannot change is still read straight off the tile — nothing to gain by hiding it.
    expect(tile).toContain('tile.isSelf');
  });

  it('exposes a launcher a template can place on any node', () => {
    moduleRegistry.register(callModule, host, storeDeps);
    // Anchored calls need a per-node trigger, and only a template knows what a node is.
    expect(moduleRegistry.schemas()['call.anchoredCallButton']).toBeDefined();
    expect(moduleRegistry.schemas()['call.startCallButton']).toBeDefined();
  });

  it('degrades to a problem message rather than throwing without any ports', () => {
    // `ModuleStoreDeps` past `signal` is all optional, so a host with no transport must still be
    // able to construct the store — the module simply cannot do anything.
    moduleRegistry.register(callModule, host, { signal: storeDeps.signal });
    const store = moduleStores.call as { active: () => boolean; startCall: () => Promise<void> };

    expect(store.active()).toBe(false);
    expect(() => store.startCall()).not.toThrow();
  });
});

describe('per-space module gate', () => {
  it('wraps module chrome in a condition on the space enabled set', () => {
    moduleRegistry.register(callModule, host, storeDeps);
    const node = slotRegistry.get('call:0')?.node as {
      type?: string;
      props?: { condition?: unknown; then?: unknown };
    };

    expect(node.type).toBe('$if');
    /*
      `activeModules`, not `enabledModules`: what the space turned on is only one of the three
      layers. A module the community enabled but this agent has not installed, or has muted here,
      must not render — and only the intersection knows that.

      Or the call is running, in which case its chrome follows the user out of the space it started
      in — see `holdsWhen`. That disjunct is this module's alone: the space's decision is still the
      whole condition for every module that is not holding something live.
    */
    expect(node.props?.condition).toEqual({ $: "'call' in spaceStore.activeModules || modules.call.active" });
    // The module's own node survives underneath, so gating composes with whatever visibility rules
    // the module already had rather than replacing them.
    expect(node.props?.then).toBeDefined();
  });

  it('leaves core chrome ungated', () => {
    // The sidebar and boot screen are the host's, not a module's — a space cannot switch them off.
    //
    // Asserted on the *condition*, not on the node type: the sidebar's own node is already an `$if`
    // (it hides itself on the boot screen), so "is it an $if" would pass whether or not it had been
    // gated. Every core slot is checked, because the gate is applied per registration and a partial
    // application is exactly the bug worth catching.
    for (const id of ['core:sidebar', 'core:bootScreen', 'core:templateEditor']) {
      const node = slotRegistry.get(id)?.node as { props?: { condition?: unknown } };
      expect(node.props?.condition).not.toEqual({ $in: [expect.anything(), { $: 'spaceStore.enabledModules' }] });
    }
  });

  it('removes every gated slot on unregister', () => {
    moduleRegistry.register(callModule, host, storeDeps);
    expect(slotRegistry.get('call:0')).toBeDefined();

    moduleRegistry.unregister('call');

    expect(slotRegistry.get('call:0')).toBeUndefined();
    expect(slotRegistry.get('call:1')).toBeUndefined();
    expect(slotRegistry.get('call:2')).toBeUndefined();
    // Docks too, from both registries. A dock left in `dockRegistry` after its module withdrew would
    // keep contributing an inset — the app would stay shrunk around a panel that no longer exists.
    expect(slotRegistry.get('dock:call:0')).toBeUndefined();
    expect(dockRegistry.get('call:0')).toBeUndefined();
  });
});
