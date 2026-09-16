/**
 * Test a feature module without a host.
 *
 * A module's store is built from injected deps, which is what makes it testable at all: hand it a
 * signal that is a closure, a records kernel that is an array, and it runs under vitest with no
 * renderer, no backend and no shell. Every bundled module wrote its own version of these fakes; this
 * is the one to copy from instead, plus the contract's own lint so a definition is judged in a test
 * exactly as the registry will judge it.
 *
 * ```ts
 * import { fakeDeps, fakeRecords, lintModule } from '@we/module-testing';
 *
 * const records = fakeRecords();
 * const store = createMyStore(fakeDeps({ kernels: { records: records.kernel } }));
 * await store.vote('poll-1', 'tea');
 * expect(records.rows).toHaveLength(1);
 * expect(lintModule(myModule).problems).toEqual([]);
 * ```
 */
import type { Activity, Peer } from '@we/backend-shared';
import type {
  AgentDataKernel,
  ModuleDefinition,
  ModuleStoreDeps,
  PresenceKernel,
  RecordQuery,
  RecordsKernel,
} from '@we/module-shared';
import { lintModule, markAction, markState, storeSurface } from '@we/module-shared';

export { lintModule, markAction, markState, storeSurface };
export type { ModuleLint } from '@we/module-shared';

/** A signal as a plain closure — the smallest thing that satisfies the port. */
export function plainSignal<T>(initial: T): [() => T, (next: T) => void] {
  let value = initial;
  return [() => value, (next: T) => void (value = next)];
}

/**
 * The deps a store is built with, defaulted to the degraded host every store must survive: closures
 * for signals, an effect that runs once, no kernels, no dataset, no agent. Override what the test is
 * about and leave the rest.
 */
export function fakeDeps(overrides: Partial<ModuleStoreDeps> = {}): ModuleStoreDeps {
  return {
    signal: plainSignal,
    effect: (fn) => {
      try {
        fn();
      } catch {
        // A degraded host: an effect that reaches something absent is the case being tested.
      }
    },
    onDispose: () => {},
    state: markState,
    action: markAction,
    settings: () => ({}),
    kernels: {},
    ...overrides,
  };
}

/** A row as the fake stores it: whatever was written, plus `id` and `author`. */
export type FakeRow = Record<string, unknown> & { id: string; author: string };

/** What a query's `where` may say against the fake — equality per key, and `in` for a list. */
function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  return Object.entries(where ?? {}).every(([key, value]) => {
    if (Array.isArray(value)) return value.includes(row[key]);
    if (value && typeof value === 'object' && 'not' in (value as object))
      return row[key] !== (value as { not: unknown }).not;
    return row[key] === value;
  });
}

function select(rows: FakeRow[], query: RecordQuery | undefined): FakeRow[] {
  let out = rows.filter((row) => matches(row, query?.where));
  const order = Object.entries(query?.order ?? {})[0];
  if (order) {
    const [field, direction] = order;
    out = [...out].sort((a, b) => {
      const x = String(a[field] ?? '');
      const y = String(b[field] ?? '');
      return direction === 'desc' ? y.localeCompare(x) : x.localeCompare(y);
    });
  }
  if (query?.offset) out = out.slice(query.offset);
  if (query?.limit !== undefined) out = out.slice(0, query.limit);
  return out;
}

/**
 * An in-memory records kernel: an array per entity, `where` by equality, `order` by one key,
 * `limit`/`offset`, and live `subscribe` that fires again after every write. Records the target each
 * write named, so a test can assert a module wrote where it meant to.
 */
export function fakeRecords(options: { author?: string } = {}) {
  const author = options.author ?? 'did:test:me';
  const rows: FakeRow[] = [];
  const writes: { op: 'create' | 'update' | 'remove' | 'link'; entity: string; id?: string; dataset?: string }[] = [];
  const subscriptions = new Set<() => void>();
  let next = 0;
  const notify = () => {
    for (const fire of subscriptions) fire();
  };

  const kernel: RecordsKernel = {
    create: async (entity, fields, options) => {
      const id = `${entity}-${++next}`;
      rows.push({ ...fields, id, author, __entity: entity });
      writes.push({ op: 'create', entity, id, dataset: options?.dataset });
      notify();
      return id;
    },
    link: async (entity, id, relation, value, target) => {
      const row = rows.find((r) => r.id === id);
      if (row) row[relation] = [...((row[relation] as unknown[]) ?? []), value];
      writes.push({ op: 'link', entity, id, dataset: target?.dataset });
      notify();
    },
    update: async (entity, id, fields, target) => {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, fields);
      writes.push({ op: 'update', entity, id, dataset: target?.dataset });
      notify();
    },
    remove: async (entity, id, target) => {
      const at = rows.findIndex((r) => r.id === id);
      if (at >= 0) rows.splice(at, 1);
      writes.push({ op: 'remove', entity, id, dataset: target?.dataset });
      notify();
    },
    find: async (entity, query) =>
      select(
        rows.filter((r) => r.__entity === entity),
        query,
      ),
    subscribe: (entity, query, cb) => {
      const fire = () =>
        cb(
          select(
            rows.filter((r) => r.__entity === entity),
            query,
          ),
        );
      subscriptions.add(fire);
      fire();
      return () => subscriptions.delete(fire);
    },
  };

  return {
    /** Every row written, whatever its entity. `__entity` says which. */
    rows,
    /** Every write, in order, with the dataset it named. */
    writes,
    kernel,
    /** Seed a row without recording a write. */
    seed: (entity: string, fields: Record<string, unknown>, rowAuthor = author): FakeRow => {
      const row: FakeRow = {
        ...fields,
        id: (fields.id as string) ?? `${entity}-${++next}`,
        author: rowAuthor,
        __entity: entity,
      };
      rows.push(row);
      return row;
    },
  };
}

/** The agent's own dataset, as an array. The same fake with the `AgentDataKernel` shape. */
export function fakeAgentData(options: { author?: string; ready?: boolean } = {}) {
  const inner = fakeRecords(options);
  const kernel: AgentDataKernel = {
    ready: () => options.ready ?? true,
    create: (entity, fields, opts) => inner.kernel.create(entity, fields, opts),
    find: (entity, query) => inner.kernel.find(entity, query),
    update: (entity, id, fields) => inner.kernel.update(entity, id, fields),
    remove: (entity, id) => inner.kernel.remove(entity, id),
  };
  return { rows: inner.rows, writes: inner.writes, seed: inner.seed, kernel };
}

/**
 * Presence as a roster a test sets. `publish(peer, activity)` puts an activity on a peer as if it had
 * arrived over the wire; `setActivity` records what the module published as its own.
 */
export function fakePresence(options: { self?: string } = {}) {
  const self = options.self ?? 'did:test:me';
  const peers = new Map<string, Peer>();
  const published: Activity[] = [];
  const cleared: { type: string; id?: string }[] = [];
  const peer = (agentId: string): Peer =>
    peers.get(agentId) ??
    (peers.set(agentId, { agentId, liveness: 'active', activities: [] } as unknown as Peer), peers.get(agentId)!);

  const kernel: PresenceKernel = {
    peers: () => [...peers.values()],
    setActivity: (activity) => {
      published.push(activity);
      const me = peer(self) as unknown as { activities: Activity[] };
      const idOf = (a: Activity) => (a as { id?: string }).id;
      me.activities = [
        ...me.activities.filter((a) => a.type !== activity.type || idOf(a) !== idOf(activity)),
        activity,
      ];
    },
    clearActivity: (type, id) => {
      cleared.push({ type, id });
      const me = peer(self) as unknown as { activities: Activity[] };
      me.activities = me.activities.filter(
        (a) => a.type !== type || (id !== undefined && (a as { id?: string }).id !== id),
      );
    },
  };

  return {
    kernel,
    published,
    cleared,
    /** Put an activity on a peer, as if it had arrived. */
    publish: (agentId: string, activity: Activity) => {
      const row = peer(agentId) as unknown as { activities: Activity[] };
      row.activities = [...row.activities, activity];
    },
    /** Take a peer off the roster — a heartbeat that stopped. */
    leave: (agentId: string) => void peers.delete(agentId),
  };
}

/**
 * Build a module's store the way the registry does — with the kernels it declared and no others — so
 * a test cannot pass while the manifest forgets one.
 *
 * Every kernel handed in is checked against `manifest.requires.kernels`; one the manifest does not
 * name is dropped, exactly as the registry drops it, and the test sees the degraded path it would
 * see in the app.
 */
export function buildStore(definition: ModuleDefinition, deps: ModuleStoreDeps = fakeDeps()) {
  const wanted = new Set(definition.manifest.requires?.kernels ?? []);
  const kernels = Object.fromEntries(Object.entries(deps.kernels).filter(([name]) => wanted.has(name as never)));
  return definition.createStore?.({ ...deps, kernels }) ?? {};
}
