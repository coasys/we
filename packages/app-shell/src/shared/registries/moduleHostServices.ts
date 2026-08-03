/**
 * The host services a module store may borrow, bound late.
 *
 * ## Why this exists at all
 *
 * Modules are registered in `PlatformProvider`, which sits *above* `StoreProvider` — the launcher
 * template has to be in the registry before the stores render, so registration cannot wait. But the
 * ports a module wants (transport, presence, the current dataset) all live in stores that do not
 * exist yet at that moment.
 *
 * Rather than reorder the tree, the deps handed to a module store are **stable objects whose methods
 * dereference at call time**. A module holds `deps.presence` forever; what it points at is filled in
 * when `PresenceStoreProvider` mounts. Every accessor answers safely before then — `peers()` returns
 * an empty array, `ephemeral()` returns `null` — which is the same degrade-don't-throw contract the
 * ports already require for a personal space with no neighbourhood.
 *
 * The alternative — activating modules after the stores mount — was rejected because it splits
 * registration into two phases with different capabilities, and "which phase am I in" is exactly the
 * kind of implicit state the last round of seam bugs came from.
 */
import type { Activity, DatasetHandle, EphemeralPort, Peer } from '@we/backend-shared';
import type { ModuleStoreDeps } from '@we/module-shared';

/** What a store publishes here once it is live. All optional: a host need not provide any of it. */
export interface ModuleHostServices {
  dataset?: () => DatasetHandle | null;
  datasetUri?: () => string | null;
  rootDataset?: () => DatasetHandle | null;
  connection?: () => { url?: string; port?: number; token?: string } | null;
  selfId?: () => string | null;
  ephemeral?: EphemeralPort;
  presence?: {
    peers: () => Peer[];
    setActivity: (activity: Activity) => void;
    clearActivity: (type: string, id?: string) => void;
  };
}

const services: ModuleHostServices = {};

/**
 * Publish a slice of host services to registered modules.
 *
 * Merges rather than replaces, because the slices arrive from different stores at different times —
 * `DatasetStore`/`SessionStore` have the dataset and the transport, `PresenceStore` has the roster.
 */
export function provideModuleHostServices(slice: ModuleHostServices): void {
  Object.assign(services, slice);
}

/** Test seam: drop everything between cases so one test's bindings cannot leak into the next. */
export function resetModuleHostServices(): void {
  for (const key of Object.keys(services)) delete services[key as keyof ModuleHostServices];
}

/**
 * Build the deps bag handed to every module store.
 *
 * `signal` and `effect` come from the framework, because only the host knows which one it is running.
 * Everything else reads through the late-bound registry above.
 */
export function createModuleStoreDeps(framework: {
  signal: <T>(initial: T) => [() => T, (next: T) => void];
  effect: (fn: () => void) => void;
}): ModuleStoreDeps {
  return {
    signal: framework.signal,
    effect: framework.effect,

    dataset: () => services.dataset?.() ?? null,
    datasetUri: () => services.datasetUri?.() ?? null,
    rootDataset: () => services.rootDataset?.() ?? null,
    connection: () => services.connection?.() ?? null,
    selfId: () => services.selfId?.() ?? null,

    // A stable function that forwards, so a module capturing `deps.ephemeral` at construction still
    // reaches the real port once one exists.
    ephemeral: (handle) => services.ephemeral?.(handle) ?? null,

    presence: {
      peers: () => services.presence?.peers() ?? [],
      setActivity: (activity) => services.presence?.setActivity(activity),
      clearActivity: (type, id) => services.presence?.clearActivity(type, id),
    },
  };
}
