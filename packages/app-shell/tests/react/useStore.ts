/**
 * A React binding for WE's stores, as small as one can be: what a second host on another framework
 * writes over the same composed stores. Test-only — it exists to show the cost, and that nothing in
 * the stores has to change to pay it.
 *
 * A store hands out accessors on the reactivity port. React asks two things of an outside value:
 * how to read it now, and how to hear that it changed. `useSyncExternalStore` takes exactly that, so
 * the binding is an effect in a root of its own that reads the accessor and tells React, and an
 * untracked read for the snapshot.
 *
 * The accessor is the store's own member (`navigation.currentPath`), which is the same function on
 * every render, so React subscribes once per mount. A memo or signal hands back the value it holds
 * until it changes, which is the stable snapshot React requires.
 */
import type { ReactivityPort } from '@we/reactivity';
import { createContext, createElement, type ReactNode, useCallback, useContext, useSyncExternalStore } from 'react';

import type { StoreRegistry } from '../../src/shared/stores/storeRegistry';

type Registry = Partial<StoreRegistry>;

const Stores = createContext<{ stores: Registry; reactivity: ReactivityPort } | null>(null);

/** Hand a composed registry, and the engine its stores run on, to everything below. */
export function StoresProvider(props: { stores: Registry; reactivity: ReactivityPort; children?: ReactNode }) {
  return createElement(
    Stores.Provider,
    { value: { stores: props.stores, reactivity: props.reactivity } },
    props.children,
  );
}

function useHost() {
  const host = useContext(Stores);
  if (!host) throw new Error('useStore needs a StoresProvider above it');
  return host;
}

/** A store by its registry name, as Solid's `useStore` hands one out. */
export function useStore<K extends keyof StoreRegistry>(key: K): StoreRegistry[K] {
  const store = useHost().stores[key];
  if (!store) throw new Error(`No ${String(key)} in this registry`);
  return store as StoreRegistry[K];
}

/** An accessor's value, re-rendering when it changes. */
export function useValue<T>(read: () => T): T {
  const { reactivity } = useHost();
  const subscribe = useCallback(
    (changed: () => void) => reactivity.root(() => reactivity.effect(() => (read(), changed()))),
    [reactivity, read],
  );
  return useSyncExternalStore(subscribe, () => reactivity.untrack(read));
}
