/**
 * One registry mechanism.
 *
 * ## Why
 *
 * The shell holds thirteen registries — components, slots, docks, modules, themes, templates,
 * views, host services, the editor's and the shell's docks, the block registry, the graph catalog,
 * the globe layers — and they were thirteen hand-rolled `Map`s with thirteen conventions. Every one
 * of them is the same shape: entries keyed by id, replaced on re-registration, read back in a
 * stable order. And every one of them is a place to forget the registration step, which the
 * contribution guide already names as the step whose omission fails silently.
 *
 * The cost was not only tidiness. `dockRegistry` had to grow an `announce`/listener pair because a
 * plain object cannot be depended on reactively: the shell computed dock geometry before the editor
 * store existed, the memo doing the looking registered no dependency, and the theme panel could not
 * be opened at all — opening any *other* panel fixed it. `slotRegistry` then grew the same pair for
 * the same reason when templates started declaring panels after the shell was built. Two copies of
 * one mechanism, each discovered by a bug.
 *
 * So: entries by id, a stable order, and a change channel — once. A registry built here is
 * observable from the start, so the third registry to need reactivity will not need a third bug.
 *
 * ## What it is not
 *
 * Not a store. Framework-neutral on purpose — this file is shared — so it publishes a subscription
 * and lets the host turn that into whatever reactive primitive it uses (the shell wraps
 * `subscribe` in a signal). And not a marketplace: an entry is whatever the host registered, and
 * what may be registered is decided where `register` is called.
 *
 * For an ecosystem the sameness matters more than it does for the product: every registry is an
 * install path, and a marketplace that installs into thirteen registries has thirteen ways to
 * half-install something. One shape is one install path.
 */

export interface RegistryEntry {
  /** Unique within the registry. Re-registering an id replaces the entry. */
  id: string;
  /** Position among entries, lower first. Ties break on id, so registration order never leaks. */
  order?: number;
}

export interface Registry<T extends RegistryEntry> {
  /** Add or replace. Announces. */
  register(entry: T): void;
  /** Remove by id. Announces only when something was there — removing nothing is not a change. */
  remove(id: string): boolean;
  get(id: string): T | undefined;
  has(id: string): boolean;
  /** Every entry, in registration order. */
  all(): T[];
  /**
   * Every entry in a stable order: the registry's own comparator, else `order` then id.
   *
   * The id tiebreak is not cosmetic. Entries come out of a `Map`, so equal-order entries would
   * otherwise follow registration order — and chrome would silently rearrange depending on which
   * module happened to load first.
   */
  ordered(): T[];
  /** Subscribe to changes. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  /**
   * Tell subscribers something changed that is not an entry — a side table the registry's
   * consumers also read, such as the host stores a dock resolves its keys against.
   */
  announce(): void;
  /** Remove everything. Announces once. */
  clear(): void;
}

export interface RegistryOptions<T extends RegistryEntry> {
  /** Overrides the default `order`-then-id ordering. */
  compare?: (a: T, b: T) => number;
}

export function byOrderThenId<T extends RegistryEntry>(a: T, b: T): number {
  return (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);
}

export function createRegistry<T extends RegistryEntry>(options: RegistryOptions<T> = {}): Registry<T> {
  const entries = new Map<string, T>();
  const listeners = new Set<() => void>();
  const compare = options.compare ?? byOrderThenId;

  const announce = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    register(entry) {
      entries.set(entry.id, entry);
      announce();
    },
    remove(id) {
      const removed = entries.delete(id);
      if (removed) announce();
      return removed;
    },
    get: (id) => entries.get(id),
    has: (id) => entries.has(id),
    all: () => [...entries.values()],
    ordered: () => [...entries.values()].sort(compare),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    announce,
    clear() {
      if (entries.size === 0) return;
      entries.clear();
      announce();
    },
  };
}
