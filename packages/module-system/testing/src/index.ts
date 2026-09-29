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
import type { Activity, EphemeralPort, Peer, PublishResult } from '@we/backend-shared';
import { createInMemoryEphemeralPort, InMemoryBus } from '@we/backend-shared';
import type {
  AgentDataKernel,
  ComposedDocument,
  CopiedIn,
  DocumentAccess,
  LiveAnchor,
  LiveDecoration,
  ModuleDefinition,
  ModuleStoreDeps,
  PresenceKernel,
  RecordQuery,
  RecordsKernel,
  ViewFrame,
  ViewKernel,
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

/** A document the fake holds: what was written, the kind it was written as, and a reference. */
export interface FakeDocument {
  id: string;
  kind: string;
  document: ComposedDocument;
  ref: string;
}

/**
 * Composed documents as a map. `read` hands back exactly what was written, which is the whole of what
 * a module can observe — resolving files and dropping keys is the host's, and is tested there.
 */
export function fakeDocuments(options: { datasetKey?: string } = {}) {
  const key = options.datasetKey ?? 'p:test';
  const documents = new Map<string, FakeDocument>();
  const writes: { op: 'create' | 'update' | 'remove'; id: string }[] = [];
  let next = 0;
  const access: DocumentAccess = {
    create: async (document, opts) => {
      const id = `doc-${++next}`;
      const ref = `we:${key}/CollectionBlock/${id}`;
      documents.set(id, { id, kind: opts?.kind ?? 'post', document, ref });
      writes.push({ op: 'create', id });
      return { id, ref };
    },
    update: async (id, document) => {
      const existing = documents.get(id);
      if (existing) documents.set(id, { ...existing, document });
      writes.push({ op: 'update', id });
    },
    remove: async (id) => {
      documents.delete(id);
      writes.push({ op: 'remove', id });
    },
    read: async (id) => documents.get(id)?.document ?? null,
  };
  return { documents, writes, access };
}

/**
 * An in-memory records kernel: an array per entity, `where` by equality, `order` by one key,
 * `limit`/`offset`, and live `subscribe` that fires again after every write. Records the target each
 * write named, so a test can assert a module wrote where it meant to. `documents` is a
 * {@link fakeDocuments} with a neighbourhood's key.
 */
export function fakeRecords(options: { author?: string; datasetKey?: string } = {}) {
  const author = options.author ?? 'did:test:me';
  const rows: FakeRow[] = [];
  const writes: { op: 'create' | 'update' | 'remove' | 'link'; entity: string; id?: string; dataset?: string }[] = [];
  const subscriptions = new Set<() => void>();
  let next = 0;
  const notify = () => {
    for (const fire of subscriptions) fire();
  };
  const documents = fakeDocuments({ datasetKey: options.datasetKey ?? 'n:test-space' });
  const copiedIn = new Set<(event: CopiedIn) => void>();

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
    documents: documents.access,
    onCopiedIn: (cb) => {
      copiedIn.add(cb);
      return () => copiedIn.delete(cb);
    },
  };

  return {
    /** Every row written, whatever its entity. `__entity` says which. */
    rows,
    /** Every write, in order, with the dataset it named. */
    writes,
    /** Every composed document written through `kernel.documents`, by id. */
    documents: documents.documents,
    /** Announce a post arriving from elsewhere, as the host does after a drop. */
    copyIn: (event: CopiedIn) => {
      for (const cb of copiedIn) cb(event);
    },
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

/**
 * The agent's personal space, as an array. The same fake with the `AgentDataKernel` shape; its
 * documents carry a personal key, as the real ones do.
 */
export function fakeAgentData(options: { author?: string; ready?: boolean } = {}) {
  const inner = fakeRecords({ ...options, datasetKey: 'p:personal' });
  const kernel: AgentDataKernel = {
    ready: () => options.ready ?? true,
    refKey: () => 'p:personal',
    create: (entity, fields, opts) => inner.kernel.create(entity, fields, opts),
    find: (entity, query) => inner.kernel.find(entity, query),
    update: (entity, id, fields) => inner.kernel.update(entity, id, fields),
    remove: (entity, id) => inner.kernel.remove(entity, id),
    documents: inner.kernel.documents,
  };
  return { rows: inner.rows, writes: inner.writes, documents: inner.documents, seed: inner.seed, kernel };
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
 * A transport two fake agents share, so a test can drive both ends of a protocol.
 *
 * Wraps `createInMemoryEphemeralPort` from the backend contract rather than reimplementing it, which
 * is the point: that port is the reference implementation every backend copies, so a protocol tested
 * against it is tested against the shape the real one has to satisfy. What this adds is the two
 * things a module test needs and the reference does not provide — a second agent to talk to, and a
 * dataset handle to scope by.
 *
 * ```ts
 * const wire = fakeEphemeral();
 * const store = buildStore(liveModule, fakeDeps({ kernels: { ephemeral: wire.port } }));
 * const them = wire.agent('did:test:ana');
 * them.channel('live').publish({ … });      // arrives at the store
 * expect(wire.sent('live')).toHaveLength(1); // what the store published
 * ```
 *
 * Note the reference port's capabilities are deliberately the *opposite* of AD4M's on every axis —
 * native unicast, at-least-once, no heartbeat needed — so a consumer that only ever ran against this
 * would have its degraded paths untested. A test about behaviour under loss should say so by driving
 * `drop` rather than by trusting the default.
 */
export function fakeEphemeral(options: { self?: string; dataset?: unknown } = {}) {
  const self = options.self ?? 'did:test:me';
  const bus = new InMemoryBus();
  // One handle stands for one space. Identity is by reference, exactly as the real port keys it.
  const dataset = (options.dataset ?? { id: 'fake-dataset' }) as never;
  const sent: { tag: string; payload: unknown; to?: string }[] = [];
  let dropping = false;
  /** Listeners per channel tag, so `report` can answer only the channel a test means. */
  const resultListeners = new Map<string, Set<(result: PublishResult) => void>>();
  let reports = false;

  const portFor = (agentId: string) => createInMemoryEphemeralPort(bus, agentId);

  /**
   * The module's own port, wrapped so a test can see what it published and refuse to deliver.
   *
   * Recording sits here rather than on the bus because "what did the module say" is the question a
   * protocol test asks, and reading it off a shared medium would also catch whatever the test itself
   * injected from the other side.
   */
  const port: EphemeralPort = (handle) => {
    const scope = portFor(self)(handle);
    if (!scope) return null;
    return {
      capabilities: scope.capabilities,
      channel: (tag, opts) => {
        const channel = scope.channel(tag, opts);
        return {
          ...channel,
          publish: (payload, to) => {
            sent.push({ tag, payload, to: to?.agentId });
            if (!dropping) channel.publish(payload, to);
          },
          /*
            Present only once a test has asked for it, because ABSENT IS A DISTINCT ANSWER.

            A transport that cannot tell how its sends went must not pretend to, and a consumer is
            required to treat the absence as "no idea" rather than as success. A fake that always
            offered the hook would make the one branch nobody writes by hand impossible to test.
          */
          ...(reports
            ? {
                onPublishResult: (cb: (result: PublishResult) => void) => {
                  const listeners = resultListeners.get(tag) ?? new Set();
                  listeners.add(cb);
                  resultListeners.set(tag, listeners);
                  return () => listeners.delete(cb);
                },
              }
            : {}),
        };
      },
      dispose: () => scope.dispose(),
    };
  };

  return {
    port,
    dataset,
    /** Every message the module published, in order, with the tag it went out on. */
    sent: (tag?: string) => (tag ? sent.filter((m) => m.tag === tag) : sent),
    /** Another agent on the same medium, for a test to publish as. */
    agent: (agentId: string) => {
      const scope = portFor(agentId)(dataset);
      if (!scope) throw new Error('fakeEphemeral: the dataset handle has no scope');
      return scope;
    },
    /**
     * Stop delivering what the module publishes, while still recording it — a lossy transport, which
     * is the case every protocol here has to survive and the one a fake makes too easy to forget.
     */
    drop: (on = true) => void (dropping = on),
    /**
     * Make the channels report how their sends went. Off by default — see the hook itself.
     *
     * Call it before the store attaches, since a consumer subscribes when it opens the channel.
     */
    reportsResults: (on = true) => void (reports = on),
    /**
     * Tell whoever is listening on `tag` how a send went, as a stalled or healthy executor would.
     *
     * Results are deliberately not correlated with individual messages: this traffic is
     * last-write-wins, so the only question worth asking is how the most recent send went.
     */
    report: (tag: string, result: PublishResult) => {
      for (const cb of resultListeners.get(tag) ?? []) cb(result);
    },
  };
}

/**
 * The screen as a test sets it: a pointer and a frame a test moves, and a record of what the module
 * asked to draw or to go to.
 *
 * `decorations()` reads the module's own accessor each time it is called rather than caching, so a
 * test sees what the host would see on its next read — which is what makes an assertion about a
 * cursor moving mean anything.
 */
export function fakeView(options: { frame?: ViewFrame } = {}) {
  const pointerListeners = new Set<(at: LiveAnchor | null) => void>();
  let frame: ViewFrame = options.frame ?? { path: '/' };
  const applied: ViewFrame[] = [];
  let read: (() => LiveDecoration[]) | null = null;

  const kernel: ViewKernel = {
    onPointer: (cb) => {
      pointerListeners.add(cb);
      return () => pointerListeners.delete(cb);
    },
    frame: () => frame,
    apply: (next) => void applied.push(next),
    decorate: (get) => {
      read = get;
      return () => void (read = null);
    },
  };

  return {
    kernel,
    /** Every frame the module asked this agent to be shown — what following somebody does. */
    applied,
    /** What the module currently wants drawn, read fresh. Empty when it has registered nothing. */
    decorations: () => read?.() ?? [],
    /** Whether the module is asking to draw at all — a registered accessor, however empty. */
    decorating: () => read !== null,
    /** Move this agent's pointer, or take it off the screen with `null`. */
    move: (at: LiveAnchor | null) => {
      for (const cb of pointerListeners) cb(at);
    },
    /** Put this agent somewhere else, as navigating or panning does. */
    setFrame: (next: ViewFrame) => void (frame = next),
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
