/**
 * The call module's contributions, and the per-space gate now wrapping every module's chrome.
 *
 * The mesh and the media controller are tested in `@we/module-call` itself, against a fake
 * `RTCPeerConnection` and the in-memory bus. What is checked here is the *host* side: that the module
 * registers, that its chrome is gated on the space's enabled set, and that it declares the coupling
 * it actually has.
 */
import { callModule } from '@we/module-call';
import { checkModuleCompatibility, moduleCapabilities } from '@we/module-shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { dockRegistry } from '../src/shared/registries/dockRegistry';
import { createModuleStoreDeps } from '../src/shared/registries/moduleHostServices';
import { moduleRegistry, moduleStores } from '../src/shared/registries/moduleRegistry';
import { registerCoreSlots, slotRegistry } from '../src/shared/registries/slotRegistry';

const host = { backend: 'ad4m', framework: 'solid' };
const storeDeps = createModuleStoreDeps({
  signal: <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    return [() => value, (next: T) => void (value = next)];
  },
  effect: (fn: () => void) => fn(),
});

const launcher = () => callModule.contributes!.launchers![0];
const stage = () => callModule.contributes!.panels!.find((panel) => panel.name === 'stage')!;

beforeEach(() => {
  for (const entry of slotRegistry.ordered()) slotRegistry.remove(entry.id);
  for (const { definition } of moduleRegistry.all()) moduleRegistry.unregister(definition.manifest.id);
  registerCoreSlots();
});

describe('call module — declared coupling', () => {
  it('declares neither a backend nor a framework', () => {
    // Signalling goes through the ephemeral kernel, so any backend implementing one will do; every
    // piece of UI is a fragment, so any renderer will do.
    expect(callModule.manifest.requires?.backends).toBeUndefined();
    expect(callModule.manifest.requires?.frameworks).toBeUndefined();
    expect(callModule.contributes?.components).toBeUndefined();
  });

  it('runs on a host with a different backend and framework', () => {
    expect(checkModuleCompatibility(callModule, { backend: 'nextgraph', framework: 'react' })).toEqual({
      compatible: true,
      problems: [],
    });
  });

  it('names the kernels it reaches, so a host without them refuses it with a reason', () => {
    const kernels = callModule.manifest.requires?.kernels ?? [];
    expect(kernels).toEqual(expect.arrayContaining(['presence', 'ephemeral', 'peerConnection', 'media']));
    const plan = checkModuleCompatibility(callModule, { ...host, kernels: ['records'] });
    expect(plan.compatible).toBe(false);
    expect(plan.problems[0]).toContain('kernel');
  });

  it('is described to a person by the permissions it asks for', () => {
    // A call module is the clearest case for why an install screen should say something.
    const caps = moduleCapabilities(callModule);
    expect(caps).toEqual(expect.arrayContaining(['microphone', 'camera', 'screen-share', 'dock']));
  });

  it('owns no durable entities', () => {
    // A call is entirely ephemeral: membership is a presence activity that expires on TTL, and
    // signalling is transport. Nothing is worth writing down, so nothing is.
    expect(callModule.contributes?.entities).toBeUndefined();
  });

  it('declares the shape of the activity it publishes', () => {
    // Transcribe reads `record` and `continued` off a call's activity. The second module to
    // cooperate with the call reads them from this declaration rather than from a test.
    const shape = callModule.contributes?.activities?.call ?? {};
    expect(Object.keys(shape)).toEqual(expect.arrayContaining(['id', 'record', 'continued']));
  });
});

describe('call module — contributions', () => {
  it('registers a store and docks its bar at the bottom', () => {
    const result = moduleRegistry.register(callModule, host, storeDeps);
    expect(result.registered).toBe(true);
    expect(moduleStores.call).toBeDefined();
    expect(slotRegistry.get('call:0')?.anchor).toBe('dock-bottom');
  });

  it('is reachable without any template cooperating, through a launcher that is not a panel’s', () => {
    // The rail button means "start a call" before there is one and "go to the call" after — two acts
    // one panel button could not carry, which is why this is a declared launcher.
    expect(launcher()).toEqual({
      icon: 'phone-call',
      label: 'Start call',
      activeLabel: 'Go to the call',
      action: 'goToCall',
      activeWhen: 'active',
      availableWhen: 'canCall',
    });
  });

  it('never points the rail at an action that could end a call', () => {
    expect(launcher().action).not.toBe('joinCall');
    expect(launcher().action).not.toBe('startCall');
    expect(launcher().action).not.toBe('joinAnchoredCall');
  });

  it('names launcher store keys its own store actually has', () => {
    moduleRegistry.register(callModule, host, storeDeps);
    const store = moduleStores.call as Record<string, unknown>;
    expect(typeof store[launcher().action]).toBe('function');
    expect(typeof store[launcher().availableWhen!]).toBe('function');
    expect(typeof store[launcher().activeWhen!]).toBe('function');
  });

  it('holds its chrome on screen while a call runs, by a key that goes false when it ends', () => {
    moduleRegistry.register(callModule, host, storeDeps);
    const store = moduleStores.call as Record<string, () => unknown>;
    expect(callModule.contributes?.holds).toBe('active');
    expect(store.active()).toBe(false);
  });

  it('reports the band its bar occupies, so panels can keep clear of it', () => {
    // Declared as `reserve`, so the shell reads a key the module named rather than scanning for one.
    moduleRegistry.register(callModule, host, storeDeps);
    const store = moduleStores.call as Record<string, unknown>;
    const key = callModule.contributes?.reserve;
    expect(key).toBeTruthy();
    expect(typeof store[key!]).toBe('function');
    // Zero with no call running, since the bar is not drawn then.
    expect((store[key!] as () => { bottom: number })()).toEqual({ bottom: 0 });
  });

  it('keeps volatile state off the tile, so a mute cannot remount the video', () => {
    const tile = JSON.stringify(moduleRegistry.parts()['call.tile'] ?? callModule.contributes?.parts?.tile);
    for (const volatile of ['audioEnabled', 'videoEnabled', 'isScreen', 'connection', 'hasPicture']) {
      expect(tile).not.toContain(`tile.${volatile}`);
    }
    for (const looked of ['audioEnabled', 'isScreen', 'connection', 'hasPicture']) {
      expect(tile).toContain(`find(modules.call.tileStates, { id: tile.id }).${looked}`);
    }
    expect(tile).toContain('tile.stream');
  });

  it('contributes the stage as a panel that owns its own openness', () => {
    // Whether the stage is up is a fact about the call, not about the screen — so this is the one
    // bundled panel that claims the flag, and it therefore has to say how it is shown and closed.
    moduleRegistry.register(callModule, host, storeDeps);
    const panel = stage();
    expect(panel.open).toBeTruthy();
    expect(panel.show).toBeTruthy();
    expect(panel.close).toBeTruthy();
    expect(dockRegistry.get('call:stage')?.moduleId).toBe('call');
    expect(slotRegistry.get('dock:call:stage')).toBeDefined();
    expect(moduleRegistry.panel('call:stage')?.hostOwned).toBe(false);
  });

  it('names panel keys its own store actually has, and starts closed', () => {
    moduleRegistry.register(callModule, host, storeDeps);
    const store = moduleStores.call as Record<string, unknown>;
    const panel = stage();
    for (const key of [panel.open, panel.show, panel.close, typeof panel.bid === 'string' ? panel.bid : undefined]) {
      if (key) expect(typeof store[key], key).toBe('function');
    }
    // Closed until asked for: a call you have just joined must not shrink the app on its own.
    const entry = dockRegistry.get('call:stage')!;
    expect((entry.store!.edge as () => unknown)()).toBeNull();
  });

  it('publishes what templates read, and keeps its plumbing private', () => {
    moduleRegistry.register(callModule, host, storeDeps);
    const surface = moduleRegistry.storeSurface('call');
    for (const name of ['canCall', 'active', 'callRecordId', 'liveCalls', 'tiles', 'tileStates']) {
      expect(surface[name]?.kind, name).toBe('state');
    }
    for (const name of ['goToCall', 'startCall', 'continueCall', 'leave']) {
      expect(surface[name]?.kind, name).toBe('action');
    }
    expect(surface[stage().bid as string]).toBeUndefined();
  });

  it('distinguishes waiting for a connection from a camera that is off', () => {
    // Both render as a bare avatar, so without this the first seconds of a working call look exactly
    // like a broken one.
    const tile = JSON.stringify(moduleRegistry.parts()['call.tile'] ?? callModule.contributes?.parts?.tile);
    expect(tile).toContain('find(modules.call.tileStates, { id: tile.id }).connecting');
    expect(tile).toContain('find(modules.call.tileStates, { id: tile.id }).failed');
    expect(tile).toContain('we-spinner');
    expect(tile).toContain("Couldn't connect");
  });

  it('looks a participant up by id for their face, so a profile arriving cannot remount their video', () => {
    const tile = JSON.stringify(moduleRegistry.parts()['call.tile'] ?? callModule.contributes?.parts?.tile);
    for (const late of ['name', 'avatar']) expect(tile).not.toContain(`tile.${late}`);
    for (const field of ['image', 'hash', 'name']) {
      expect(tile).toContain(`find(modules.call.tileFaces, { id: tile.id }).${field}`);
    }
    expect(tile).toContain('tile.isSelf');
  });

  it('exposes a launcher a template can place on any node', () => {
    moduleRegistry.register(callModule, host, storeDeps);
    expect(moduleRegistry.parts()['call.anchoredCallButton']).toBeDefined();
    expect(moduleRegistry.parts()['call.startCallButton']).toBeDefined();
  });

  it('degrades to a problem message rather than throwing without any kernels', () => {
    // Everything past `signal`, `state` and `action` is optional, so a host with no transport must
    // still be able to construct the store — the module simply cannot do anything.
    moduleRegistry.register(callModule, host, { ...storeDeps, kernels: {} });
    const store = moduleStores.call as { active: () => boolean; startCall: () => Promise<void> };
    expect(store.active()).toBe(false);
    expect(() => store.startCall()).not.toThrow();
  });
});

describe('per-space module gate', () => {
  it('wraps module chrome in a condition on the space enabled set, or the call running', () => {
    moduleRegistry.register(callModule, host, storeDeps);
    const node = slotRegistry.get('call:0')?.node as { type?: string; props?: { condition?: unknown; then?: unknown } };
    expect(node.type).toBe('$if');
    // `activeModules`, not `enabledModules`: the intersection of the layers. Or the call is running,
    // in which case its chrome follows the user out of the space it started in — see `holds`.
    expect(node.props?.condition).toEqual({ $: "'call' in spaceStore.activeModules || modules.call.active" });
    expect(node.props?.then).toBeDefined();
  });

  it('leaves core chrome ungated', () => {
    for (const id of ['core:sidebar', 'core:bootScreen', 'core:templateEditor']) {
      const node = slotRegistry.get(id)?.node as { props?: { condition?: unknown } };
      expect(JSON.stringify(node.props?.condition ?? null)).not.toContain('activeModules');
    }
  });

  it('removes every gated slot and the panel on unregister', () => {
    moduleRegistry.register(callModule, host, storeDeps);
    expect(slotRegistry.get('call:0')).toBeDefined();
    moduleRegistry.unregister('call');
    expect(slotRegistry.get('call:0')).toBeUndefined();
    expect(slotRegistry.get('call:1')).toBeUndefined();
    expect(slotRegistry.get('call:2')).toBeUndefined();
    // A panel left in `dockRegistry` after its module withdrew would keep contributing an inset.
    expect(slotRegistry.get('dock:call:stage')).toBeUndefined();
    expect(dockRegistry.get('call:stage')).toBeUndefined();
  });
});
