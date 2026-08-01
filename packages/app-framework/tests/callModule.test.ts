/**
 * The call module's contributions, and the per-space gate now wrapping every module's chrome.
 *
 * The mesh and the media controller are tested in `@we/module-call` itself, against a fake
 * `RTCPeerConnection` and the in-memory bus. What is checked here is the *host* side: that the module
 * registers, that its chrome is gated on the space's enabled set, and that it declares the coupling
 * it actually has.
 */
import { callModule } from '@we/module-call';
import { checkModuleCompatibility } from '@we/schema-shared';
import { beforeEach, describe, expect, it } from 'vitest';

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
    const store = moduleStores.call as { active: () => boolean; joinSpaceCall: () => void };

    expect(store.active()).toBe(false);
    expect(() => store.joinSpaceCall()).not.toThrow();
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
    expect(node.props?.condition).toEqual({ $in: ['call', { $store: 'spaceStore.enabledModules' }] });
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
      expect(node.props?.condition).not.toEqual({ $in: [expect.anything(), { $store: 'spaceStore.enabledModules' }] });
    }
  });

  it('removes every gated slot on unregister', () => {
    moduleRegistry.register(callModule, host, storeDeps);
    expect(slotRegistry.get('call:0')).toBeDefined();

    moduleRegistry.unregister('call');

    expect(slotRegistry.get('call:0')).toBeUndefined();
    expect(slotRegistry.get('call:1')).toBeUndefined();
    expect(slotRegistry.get('call:2')).toBeUndefined();
  });
});
