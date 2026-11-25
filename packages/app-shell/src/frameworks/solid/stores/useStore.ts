/**
 * The host's stores, as Solid components reach them.
 *
 * The stores are composed once, at `BootController`, into a `StoreRegistry` (`shared/stores/storeRegistry.ts`).
 * A component asks for one by name — `useStore('spaceStore')` — and gets it typed. This hook and its
 * context are the only things here that are Solid's; a host on another framework writes its own
 * over the same composed instances.
 */
import type { StoreKey, StoreRegistry } from '@shared/stores/storeRegistry';
import { createContext, useContext } from 'solid-js';

/**
 * The composed stores. Partial in its type so a test can hand a component only the stores it
 * reads; `BootController` hands it every one, and its own type checks that it does.
 */
export const StoreRegistryContext = createContext<Partial<StoreRegistry>>();

/** The store named `key`, from the registry `BootController` composed. */
export function useStore<K extends StoreKey>(key: K): StoreRegistry[K] {
  const store = useContext(StoreRegistryContext)?.[key];
  if (!store) throw new Error(`useStore('${key}') has no ${key} to give: it is composed at BootController`);
  return store;
}
