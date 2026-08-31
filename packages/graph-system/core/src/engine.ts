/**
 * The engine — seeds, expansion, layout and the scene, driven from one place.
 *
 * Framework-neutral by construction: it holds state, mutates it, and tells subscribers something
 * changed. A Solid adapter turns that into signals; a React one would turn it into a store. Nothing
 * here imports a framework or a backend, so the whole engine is testable with a fake expander and no
 * DOM — which is how the collapse and budget logic gets tested at all, since both are invisible until
 * they go wrong.
 */
import type {
  BehaviourContext,
  EdgeGeometry,
  ExpandDirection,
  ExpanderContext,
  GraphEdge,
  GraphEvent,
  GraphFragment,
  GraphNode,
  GraphSpec,
  GraphValue,
  Layout,
  Placement,
  Point,
  StyleRules,
  WatchQuery,
} from '@we/graph-protocol';
import { addressKind } from '@we/graph-protocol';

import { ExpansionState, SEED_OPENER } from './expansion';
import type { EdgeClearance } from './geometry';
import { bowOffsets, distanceToEdge, edgeBounds, groupByEndpoints, normaliseCurve, routeEdge } from './geometry';
import { PluginRegistry } from './registry';
import { SpatialIndex } from './spatial';
import { GraphStore } from './store';
import { flattenRules, nodeVisual, resolveStyle } from './style';
import { boundsOf, Viewport } from './viewport';

export interface EngineOptions {
  spec: GraphSpec;
  registry: PluginRegistry;
  /** What expanders reach the data layer through. */
  context: ExpanderContext;
  /** Where graph events go — a template's `onNodeClick` and friends. */
  onEvent?: (event: GraphEvent) => void;
}

/** What changed, so a renderer can decide how much to redo. */
export type ChangeReason =
  | 'graph'
  | 'positions'
  | 'viewport'
  | 'selection'
  | 'status'
  /**
   * The line being drawn during a connect gesture moved.
   *
   * Its own reason rather than `positions`, which is the channel it looks most like. `positions`
   * legitimately re-runs the node and edge projections — the nodes have moved — and this changes
   * one straight segment while every node stays exactly where it was. Sharing the channel would
   * make dragging a connection across a settled graph re-derive the whole scene on every pointer
   * move, which is the most expensive way to draw a line anybody has thought of.
   */
  | 'connection';

export interface EngineStatus {
  loading: boolean;
  /**
   * The *whole* graph is being replaced — a {@link GraphEngine.start}, not an expansion or a refresh.
   *
   * A separate flag rather than a shade of `loading` because the two want opposite treatment. An
   * expansion loads beside a graph that stays on screen and stays usable, so it belongs in a corner;
   * a reload means everything currently drawn is about to be thrown away, and a renderer that cannot
   * tell them apart has to pick one and be wrong about the other. It matters most where it is least
   * visible: `start` clears the store and only notifies at the end, so the *previous* graph stays
   * painted for the whole load — announcing that in a footnote is how a stale board reads as a live one.
   */
  reloading: boolean;
  /** Set when expansion stopped because the node budget was reached. */
  budgetReached: boolean;
  /** Non-fatal problems worth surfacing — an expander that could not answer, a dropped ref. */
  warnings: string[];
}

/**
 * How much of the graph a load covers.
 *
 * `reload` is the whole graph; `partial` is anything that lands beside what is already there — a
 * seed refresh, an expansion. Only the caller can tell them apart: `loadSeeds` runs under both.
 */
type LoadScope = 'reload' | 'partial';

/** Metrics deliberately do not participate in hit-testing — see `hitRadius`. */
const NO_METRICS = new Map<string, ReadonlyMap<string, number>>();

/**
 * Metric ids a rule set actually references.
 *
 * Computed metrics are cheap but not free, and a graph whose rules mention none should pay nothing —
 * so the engine runs exactly the metrics the style asks for and no others.
 */
function referencedMetrics(rules: StyleRules<Record<string, unknown>> | undefined): string[] {
  const found = new Set<string>();
  // Through the nesting, so a metric named by a rule a `$map` produced is still computed. Missing it
  // would leave that rule resolving to its fallback — a graph that draws, plainly, for no visible reason.
  for (const rule of flattenRules(rules)) {
    for (const value of Object.values(rule.style ?? {})) {
      if (value && typeof value === 'object' && 'metric' in value) {
        found.add(String((value as { metric: unknown }).metric));
      }
    }
  }
  return [...found];
}

const DEFAULT_MAX_NODES = 2000;

/**
 * The most nodes any spec may ask for, whatever it says.
 *
 * `maxNodes` is set by the *template*, which is data a stranger can write, and it is the only thing
 * standing between an expansion and unbounded work: each node is a query, a layout body and a
 * rendered mark. A template asking for a million is not a template with an ambitious map, it is a
 * template that hangs the tab of everybody who opens the space it is installed in.
 *
 * Well above anything legible — a force graph is already unreadable at a few thousand marks — so the
 * clamp is a backstop rather than a design constraint. It costs a template nothing it could have
 * used, which is what makes it the right shape for a host limit.
 */
const HOST_MAX_NODES = 20000;
const DEFAULT_EXPAND_LIMIT = 50;

/**
 * How long a change waits for company before the graph re-reads.
 *
 * One user action is many writes — composing a post creates a collection and every block in it — and
 * each arrives as its own notification. Long enough to collapse that into one pass, short enough
 * that a record someone just created appears while they are still looking at where it should be.
 */
const WATCH_DEBOUNCE_MS = 250;

/**
 * What the seeds read, and so what is worth watching — the read itself, not merely its type.
 *
 * A host subscribes to what it is given, and a backend that reports "this query's answer changed"
 * can only report about a query somebody asked. See `ExpanderContext.watch` for what the coarse
 * form cost: a board whose records arrived behind an existing one was never told.
 */
type WatchTarget = WatchQuery;

/**
 * Identity of a watch. Only ever compared, never parsed back — the target is carried alongside it.
 *
 * Two spellings of one filter (the same keys in a different order) key as two watches. Harmless:
 * duplicates cost a subscription and answer identically, where a key that tried to canonicalise
 * would have to know what every field of a read means.
 */
function watchKey(target: WatchTarget): string {
  return JSON.stringify([
    target.entity,
    target.dataset ?? '',
    target.scope ?? null,
    target.where ?? null,
    target.order ?? null,
    target.limit ?? null,
    target.offset ?? null,
    target.include ?? null,
  ]);
}

export class GraphEngine {
  readonly store = new GraphStore();
  readonly expansion = new ExpansionState();
  readonly viewport = new Viewport();
  readonly index = new SpatialIndex();

  private readonly registry: PluginRegistry;
  private readonly context: ExpanderContext;
  private readonly onEvent?: (event: GraphEvent) => void;
  private spec: GraphSpec;

  private positions = new Map<string, Placement>();
  private selected = new Set<string>();
  private layout?: Layout;
  /** Type *and* options of the live layout, so a re-tuned layout is rebuilt rather than reused. */
  private layoutKey?: string;
  private layoutTimer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<(reason: ChangeReason) => void>();
  private status: EngineStatus = { loading: false, reloading: false, budgetReached: false, warnings: [] };
  private inFlight = 0;
  /** Of those, how many cover the whole graph. See {@link EngineStatus.reloading}. */
  private reloadsInFlight = 0;
  private disposed = false;
  /** What the layout last complained about, so a new arrangement can retire it. */
  private layoutWarnings: string[] = [];
  /** A refresh is running. See {@link refresh} for why a second one queues rather than joining in. */
  private refreshing = false;
  private refreshPending = false;
  /** Live watches held on the types the seeds read, keyed by entity and dataset. */
  private readonly watchers = new Map<string, () => void>();
  private watchTimer?: ReturnType<typeof setTimeout>;
  /** What the last seed load read, so watches can be re-synced without re-running the queries. */
  private lastSeedReads: ReadonlyMap<string, WatchTarget> = new Map();
  /** A fit was asked for before there was a surface to fit into. Applied on the next real resize. */
  private pendingFit = false;
  /** Whether the user may move nodes. See `isLocked`. */
  private locked = false;
  /**
   * Nodes the user has asked to hold, owned here rather than read back off the layout.
   *
   * A layout is told about a pin and reports positions, and the two are not the same thing: every
   * `tick` replaces the position map wholesale, so a layout that does not think to re-report `fixed`
   * silently drops it. The force layout survives by re-deriving it, which is luck rather than
   * contract — and a request the *user* made should not be something a plugin can forget.
   */
  private pinnedIds = new Set<string>();
  /**
   * Keep framing until a running layout stops moving.
   *
   * A fit applied once at `init` frames the positions a force simulation *starts* from, and it then
   * spends a second or two spreading out from under the camera — which reads as the graph wandering
   * off into a corner. Following it until it settles costs nothing for a layout that computes in one
   * pass, since those never report themselves as running.
   */
  private fitUntilSettled = false;
  /** Computed metric values, by metric id then node id. Recomputed when the graph changes. */
  private metrics: Map<string, ReadonlyMap<string, number>> = new Map();
  /** Where every edge runs, recomputed with positions. Read by the renderer and by edge picking. */
  private edgeGeometry = new Map<string, EdgeGeometry>();
  /** Bounds per edge, so picking rejects most edges without measuring them. */
  private edgeBoxes = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  /** The connect gesture in progress — see {@link getPendingConnection}. */
  private pendingConnection: { from: string; to: Point } | null = null;

  constructor(options: EngineOptions) {
    this.spec = options.spec;
    this.registry = options.registry;
    this.onEvent = options.onEvent;
    // Warnings arrive from expanders, which must degrade rather than throw: a source that cannot
    // answer should leave the rest of the graph standing and say why.
    this.context = { ...options.context, warn: (message) => this.warn(message) };
  }

  // ─── Subscription ────────────────────────────────────────────────────────────

  subscribe(listener: (reason: ChangeReason) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(reason: ChangeReason): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(reason);
  }

  // ─── State readers ───────────────────────────────────────────────────────────

  getPositions(): ReadonlyMap<string, Placement> {
    return this.positions;
  }

  getSelection(): string[] {
    return [...this.selected];
  }

  getStatus(): Readonly<EngineStatus> {
    return this.status;
  }

  getSpec(): Readonly<GraphSpec> {
    return this.spec;
  }

  /**
   * Where each edge runs, in world units.
   *
   * The renderer draws from this rather than deriving its own, for the same reason node geometry has
   * one source: two derivations of the same thing drift, and here the second consumer is hit-testing,
   * where drift means clicking an edge that is not the one under the cursor.
   */
  getEdgeGeometry(): ReadonlyMap<string, EdgeGeometry> {
    return this.edgeGeometry;
  }

  /** Computed metric values, for a renderer resolving `MetricRef` styles. */
  getMetrics(): ReadonlyMap<string, ReadonlyMap<string, number>> {
    return this.metrics;
  }

  /**
   * Recompute whatever the current style rules reference.
   *
   * Structure-dependent by definition — degree changes when an edge arrives, communities change when
   * a cluster grows — so this runs on graph change rather than on a timer, and never per frame.
   */
  private recomputeMetrics(): void {
    const wanted = [
      ...referencedMetrics(this.spec.nodeStyle as StyleRules<Record<string, unknown>> | undefined),
      ...referencedMetrics(this.spec.edgeStyle as StyleRules<Record<string, unknown>> | undefined),
    ];
    if (!wanted.length) {
      if (this.metrics.size) this.metrics = new Map();
      return;
    }

    const snapshot = {
      nodes: [...this.store.nodes()].map((node) => ({ id: node.id })),
      edges: [...this.store.edges()].map((edge) => ({ source: edge.source, target: edge.target })),
    };

    const next = new Map<string, ReadonlyMap<string, number>>();
    for (const id of new Set(wanted)) {
      const metric = this.registry.metric(id);
      if (!metric) {
        this.warn(`no metric registered as "${id}"`);
        continue;
      }
      try {
        next.set(id, metric.compute(snapshot));
      } catch (error) {
        // A metric that throws must not take the graph down with it — the map still draws, just
        // without that dimension.
        this.warn(`metric "${id}" failed: ${describe(error)}`);
      }
    }
    this.metrics = next;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Replace the spec.
   *
   * Does not restart on its own — the caller decides whether the change warrants re-running the
   * queries. Changing a colour rule must not re-fetch a graph, and an adapter that could only swap the
   * whole spec would have no way to express that difference.
   */
  setSpec(spec: GraphSpec): void {
    this.spec = spec;
  }

  /**
   * Load the seeds and open whatever the auto-expand rules ask for.
   *
   * Re-running is a full reset rather than a merge: `start` means "this is a different graph now",
   * which happens when the template's spec changes, and carrying the old expansion state into a new
   * seed set would leave nodes on screen that nothing can account for.
   */
  async start(): Promise<void> {
    this.store.clear();
    this.expansion.reset();
    this.positions = new Map();
    // A different graph cannot inherit holds on nodes it does not contain.
    this.pinnedIds.clear();
    this.selected.clear();
    this.status = { loading: false, reloading: false, budgetReached: false, warnings: [] };
    this.layoutWarnings = [];

    /*
      Held across the whole method, not just the seed load.

      What follows the seeds — auto-expansion, metrics, the first layout — is still the graph
      arriving, and `loadSeeds` releasing its own count between the two phases would report a settled
      frame in the middle of a load. Held here, `reloading` covers the gap and the renderer never sees
      an empty graph claim to be finished.
    */
    this.beginLoading('reload');
    try {
      const fragment = await this.loadSeeds();
      this.store.merge(fragment);
      this.expansion.attribute(
        SEED_OPENER,
        fragment.nodes.map((n) => n.id),
        fragment.edges.map((e) => e.id),
      );

      await this.runAutoExpansion();
      this.recomputeMetrics();
      this.relayout({ fit: true });
      // Before the count is released, so the nodes are on screen by the time the load reports itself
      // finished. The other order hands the renderer one frame of "settled, and empty".
      this.notify('graph');
    } finally {
      this.endLoading('reload');
    }
  }

  /**
   * Re-run the seed sources and reconcile the result into the graph already on screen.
   *
   * The counterpart to {@link start}, and the difference is the entire point: `start` says "this is a
   * different graph now" and resets everything, while this says "the same graph, with newer data".
   * Positions, pins, the selection, the camera and every open node survive — so a record created in a
   * modal appears as one more node among the ones the user arranged, and a peer's edit arriving over
   * the network does not rearrange a board somebody is working on.
   *
   * Rows that have gone are removed, but only where the seeds were the *only* thing holding them:
   * a node the user reached by expanding something else is theirs, not the seed query's, and it stays
   * until they close what opened it.
   *
   * Deliberately does **not** fit the camera. A refresh is usually not something the user asked for —
   * it can arrive from a subscription while they are reading — and a viewport that jumps whenever a
   * peer writes something would make a shared graph unusable.
   */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    // A second request while one is running becomes one more pass at the end, rather than a
    // concurrent pair racing to reconcile against each other's half-applied state.
    if (this.refreshing) {
      this.refreshPending = true;
      return;
    }
    this.refreshing = true;
    try {
      do {
        this.refreshPending = false;
        await this.refreshOnce();
      } while (this.refreshPending && !this.disposed);
    } finally {
      this.refreshing = false;
    }
  }

  private async refreshOnce(): Promise<void> {
    const fragment = await this.loadSeeds();
    if (this.disposed) return;

    const nodes = this.trimToBudget(fragment.nodes);
    const seedNodes = new Set(nodes.map((n) => n.id));
    const seedEdges = new Set(fragment.edges.map((e) => e.id));

    // Claimed before anything is released, so a node that was previously held only by an expansion
    // and now also answers the seed query is not briefly unheld.
    const change = this.store.merge({ nodes, edges: fragment.edges });
    this.expansion.attribute(SEED_OPENER, seedNodes, seedEdges);

    const released = this.expansion.releaseFrom(SEED_OPENER, seedNodes, seedEdges);
    if (released.edges.length) this.store.removeEdges(released.edges);
    if (released.nodes.length) {
      this.store.removeNodes(released.nodes);
      for (const id of released.nodes) {
        this.positions.delete(id);
        this.selected.delete(id);
        this.pinnedIds.delete(id);
      }
    }

    // Only the arrivals are auto-expanded. Running the rules over the whole graph would re-open every
    // node the user had deliberately collapsed, on every refresh — the map would keep growing back.
    if (change.addedNodes.length) await this.runAutoExpansion(change.addedNodes);

    // Rows going away can bring a blocked graph back under the ceiling; leaving the flag set would
    // make the next expansion refuse with no visible reason.
    if (this.status.budgetReached && !this.atBudget()) {
      this.status = { ...this.status, budgetReached: false };
      this.notify('status');
    }

    this.recomputeMetrics();
    this.relayout();
    this.notify('graph');
  }

  /**
   * Run every seed source and return what they produced as one fragment.
   *
   * Shared by {@link start} and {@link refresh} so the two can never disagree about what the seeds
   * *are* — the difference between them is entirely what happens to the result.
   *
   * Also the one place that learns *what the seeds read*. The seed sources are given a context whose
   * `query` records the entity and dataset of every read, which is how the engine can watch the right
   * types without understanding a single seed source's options. A seed plugin nobody has written yet
   * becomes live for free; the alternative — the engine parsing `options.entity` — would work for
   * exactly the sources that happen to spell it that way and silently fail for the rest.
   */
  private async loadSeeds(): Promise<GraphFragment> {
    const specs = this.spec.seeds ? (Array.isArray(this.spec.seeds) ? this.spec.seeds : [this.spec.seeds]) : [];
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const read = new Map<string, WatchTarget>();

    const recording: ExpanderContext = {
      ...this.context,
      query: (request) => {
        // The whole read, less the signal — a standing watch must not hold the abort signal of the
        // load that happened to make the read.
        const { signal: _signal, ...target } = request;
        read.set(watchKey(target), target);
        return this.context.query(request);
      },
    };

    this.beginLoading('partial');
    try {
      for (const seed of specs) {
        const fragment =
          'literal' in seed
            ? { nodes: seed.nodes, edges: seed.edges }
            : await this.registry
                .seed(seed.source)
                ?.seed(seed.options ?? {}, recording)
                .catch((error: unknown) => {
                  this.warn(`seed "${seed.source}" failed: ${describe(error)}`);
                  return undefined;
                });
        if (!fragment) {
          if (!('literal' in seed) && !this.registry.seed(seed.source)) {
            this.warn(`no seed source registered as "${seed.source}"`);
          }
          continue;
        }
        nodes.push(...fragment.nodes);
        edges.push(...fragment.edges);
      }
    } finally {
      this.endLoading('partial');
    }

    this.lastSeedReads = read;
    this.syncWatchers(read);
    return { nodes, edges };
  }

  // ─── Following the data ──────────────────────────────────────────────────────

  /**
   * Turn following the data on or off without reloading.
   *
   * Its own entry point rather than a `setSpec` field the caller then has to know to act on, because
   * the two spec paths already mean different things — one reloads, one restyles — and this is a
   * third: nothing about the graph changes, only whether it keeps listening.
   */
  setLive(live: boolean): void {
    if ((this.spec.live !== false) === live) return;
    this.spec = { ...this.spec, live };
    this.syncWatchers(this.lastSeedReads);
  }

  /**
   * Hold a watch on exactly the types the seeds just read — no more, and no fewer.
   *
   * Recomputed after every load rather than set up once, because what the seeds read can change: a
   * schema seed reads whatever classes the space now has, and a `$local`-driven entity picker reads a
   * different type every time somebody uses it. Watches nothing when the host cannot report changes,
   * or when the template asked for a graph that does not move.
   */
  private syncWatchers(read: ReadonlyMap<string, WatchTarget>): void {
    const enabled = this.spec.live !== false && typeof this.context.watch === 'function';
    const wanted = enabled ? read : new Map<string, WatchTarget>();

    for (const [key, stop] of this.watchers) {
      if (wanted.has(key)) continue;
      stop();
      this.watchers.delete(key);
    }

    for (const [key, target] of wanted) {
      if (this.watchers.has(key)) continue;
      this.watchers.set(
        key,
        this.context.watch!(target, () => this.onDataChanged()),
      );
    }
  }

  /**
   * Something changed underneath. Coalesce and re-read.
   *
   * Debounced because one user action is many writes: composing a post creates the collection and
   * every block inside it, and a graph that re-queried on each link would run a dozen rounds of
   * queries to arrive at the state the last one already had. The delay is short enough to read as
   * immediate and long enough to collapse a batch.
   */
  private onDataChanged(): void {
    if (this.disposed) return;
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = setTimeout(() => {
      this.watchTimer = undefined;
      void this.refresh();
    }, WATCH_DEBOUNCE_MS);
  }

  dispose(): void {
    this.disposed = true;
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    if (this.watchTimer) clearTimeout(this.watchTimer);
    // A leaked watch outlives the graph and keeps a whole engine — store, index, layout — reachable
    // from a backend subscription, which is the shape of leak that only shows up as a slow app.
    for (const stop of this.watchers.values()) stop();
    this.watchers.clear();
    this.layout?.stop?.();
    this.listeners.clear();
  }

  // ─── Expansion ───────────────────────────────────────────────────────────────

  /**
   * Open a node, or fetch its next page if it is already open and has more.
   *
   * Clicking an exhausted node is a no-op rather than a re-fetch: an expansion that silently repeats
   * itself looks identical to one that is broken.
   */
  async expand(id: string, direction?: ExpandDirection, expanders?: string[]): Promise<void> {
    const node = this.store.node(id);
    if (!node) return;
    /*
      An override reopens a node that is already open.

      "Open its relations" and "open its properties" are different questions about the same node,
      and the ordinary guard — an exhausted node ignores a second click — would answer the second
      one with silence. Only when the caller names the expanders, so double-clicking an exhausted
      node still does nothing, which is what stops a repeat expansion looking like a broken one.
    */
    if (!expanders && this.expansion.isExpanded(id) && !this.expansion.hasMore(id)) return;
    // Refusing because the graph is full is itself worth saying. Landing exactly on the ceiling used
    // to stop expansion without ever tripping the flag, so the map went quiet with no explanation —
    // which is the precise failure the budget exists to prevent.
    if (this.atBudget()) {
      this.reportBudgetReached();
      return;
    }

    const spec = this.spec.expansion ?? {};
    const chosen = this.registry.expandersFor(node.kind, node.type, expanders ?? spec.expanders);
    if (!chosen.length) {
      this.warn(`nothing can expand a ${node.kind}/${node.type} node`);
      return;
    }

    // Retract the bundles this node's own collapse produced — the real edges are coming back.
    const staleBundles = this.expansion.bundlesFor(id);
    if (staleBundles.length) {
      this.store.removeEdges(staleBundles);
      this.expansion.clearBundles(id);
    }

    const page = this.expansion.pageState(id);
    const request = {
      id,
      direction: direction ?? spec.direction ?? 'both',
      limit: spec.limit ?? DEFAULT_EXPAND_LIMIT,
      cursor: page?.cursor,
      edgeTypes: spec.edgeTypes,
    } as const;

    this.beginLoading('partial');
    let added = 0;
    let total: number | undefined;
    let cursor: string | undefined;

    try {
      for (const expander of chosen) {
        const result = await expander.expand({ ...request }, this.context).catch((error: unknown) => {
          this.warn(`expander "${expander.id}" failed on ${id}: ${describe(error)}`);
          return undefined;
        });
        if (!result) continue;

        const trimmed = this.trimToBudget(result.nodes);
        const change = this.store.merge({ nodes: trimmed, edges: result.edges });
        // Attribute every node the expander returned, not only the newly added ones: a second opener
        // on a node that was already present is precisely what stops a later collapse removing it.
        this.expansion.attribute(
          id,
          trimmed.map((n) => n.id),
          result.edges.map((e) => e.id),
        );
        added += change.addedNodes.length;
        if (result.total !== undefined) total = (total ?? 0) + result.total;
        cursor = cursor ?? result.cursor;
      }
    } finally {
      this.endLoading('partial');
    }

    this.expansion.markExpanded(id, { cursor, total, added });
    this.emit({ type: 'expanded', id, added, total });
    this.recomputeMetrics();
    this.relayout();
    this.notify('graph');
  }

  /** Close a node: drop what only it was holding, and bundle what crossed the boundary. */
  collapse(id: string): void {
    const result = this.expansion.collapse(id, this.store);
    if (!result.removedNodes.length && !result.bundles.length) return;

    this.store.removeNodes(result.removedNodes);
    for (const nodeId of result.removedNodes) {
      this.positions.delete(nodeId);
      this.selected.delete(nodeId);
    }
    if (result.bundles.length) this.store.merge({ nodes: [], edges: result.bundles });

    // Removing nodes can bring a budget-blocked graph back under the ceiling, and leaving the flag
    // set would make the next expansion silently refuse for no visible reason.
    if (this.status.budgetReached && !this.atBudget()) {
      this.status = { ...this.status, budgetReached: false };
    }
    this.recomputeMetrics();
    this.relayout();
    this.notify('graph');
  }

  toggle(id: string, direction?: ExpandDirection): void {
    if (this.expansion.isExpanded(id) && !this.expansion.hasMore(id)) this.collapse(id);
    else void this.expand(id, direction);
  }

  /**
   * Open what the depth and the auto rules ask for.
   *
   * `from` narrows the starting frontier, which is what a refresh passes: the rules should reach the
   * nodes that have just arrived and nothing else. Omitted — the case `start` uses — it begins at
   * every node in the store.
   */
  private async runAutoExpansion(from?: string[]): Promise<void> {
    const spec = this.spec.expansion;
    const depth = spec?.defaultDepth ?? 0;
    const rules = spec?.auto ?? [];
    if (!depth && !rules.length) return;

    // Breadth-first by depth, so a shallow rule never gets starved by a deep one, and each level is
    // fully open before the next begins — otherwise the graph grows down one arm while the user waits.
    let frontier = from ?? [...this.store.nodes()].map((n) => n.id);
    for (let level = 0; level < Math.max(depth, ...rules.map((r) => r.depth), 0); level += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        // Same reasoning as in `expand`: auto-expansion stopping because the graph is full is a fact
        // the user needs, not a silent early return.
        if (this.atBudget()) {
          this.reportBudgetReached();
          return;
        }
        const node = this.store.node(id);
        if (!node) continue;
        const rule = rules.find((r) => matchesAuto(node, r.when));
        const allowed = rule ? level < rule.depth : level < depth;
        if (!allowed || this.expansion.isExpanded(id)) continue;
        await this.expand(id, rule?.direction);
        next.push(...this.store.neighbours(id));
      }
      frontier = [...new Set(next)];
      if (!frontier.length) break;
    }
  }

  // ─── Budget ──────────────────────────────────────────────────────────────────

  private maxNodes(): number {
    // Clamped, and floored at 1: a spec asking for zero or a negative would make every expansion a
    // no-op with no way to tell that from an empty graph. See `HOST_MAX_NODES`.
    const asked = this.spec.expansion?.maxNodes ?? DEFAULT_MAX_NODES;
    return Math.max(1, Math.min(asked, HOST_MAX_NODES));
  }

  private atBudget(): boolean {
    return this.store.nodeCount >= this.maxNodes();
  }

  /**
   * Cut an incoming batch to what the budget allows, and say so.
   *
   * Truncating silently is the failure mode this exists to avoid: a map that quietly stops growing
   * reads as complete, and every conclusion drawn from it is wrong.
   */
  private trimToBudget(nodes: GraphNode[]): GraphNode[] {
    const room = this.maxNodes() - this.store.nodeCount;
    if (nodes.length <= room) return nodes;
    this.reportBudgetReached();
    return nodes.slice(0, Math.max(0, room));
  }

  private reportBudgetReached(): void {
    if (this.status.budgetReached) return;
    this.status = { ...this.status, budgetReached: true };
    this.emit({ type: 'budgetReached', limit: this.maxNodes() });
    this.notify('status');
  }

  // ─── Layout ──────────────────────────────────────────────────────────────────

  /**
   * Re-run the layout over the current graph, keeping what is already placed.
   *
   * Warm start is not an optimisation. Nodes arrive continuously — from expansion, and from live
   * queries while the user watches — and a layout that restarts from scratch each time makes the
   * whole map jump every few seconds.
   */
  relayout(options?: { fit?: boolean }): void {
    const spec = this.spec.layout ?? { type: 'force' };
    /*
      Keyed on the options as well as the type.

      A layout is constructed with its options and holds them, so comparing only the type reused a
      live instance whenever a spec re-tuned a layout without swapping it. Everything downstream
      looked correct — the spec updated, `relayout` ran, positions were reapplied — and the graph
      simply did not move, because it had been laid out again by the same layout with the same
      numbers. It showed up as a picker that worked from every layout except the one the graph was
      already using, and it would have silently ignored any template that changed `levelGap` or
      `columns` on its own.
    */
    const key = `${spec.type}:${JSON.stringify(spec.options ?? null)}`;
    if (!this.layout || this.layoutKey !== key) {
      this.layout?.stop?.();
      this.layout = this.registry.layout(spec.type, spec.options);
      if (!this.layout) {
        this.warn(`no layout registered as "${spec.type}"`);
        return;
      }
      this.layoutKey = key;
    }

    const { width, height } = this.viewport.get();
    const result = this.layout.init({
      nodes: [...this.store.nodes()],
      edges: [...this.store.edges()],
      previous: this.positions,
      containment: this.containment(),
      viewport: { width: width || 800, height: height || 600 },
      ...(width && height ? { visible: this.visibleWorldRect() } : {}),
    });
    this.setLayoutWarnings(result.warnings ?? []);
    this.fitUntilSettled = !!options?.fit && !!result.running;
    this.applyPositions(result.positions, options?.fit);
    // A fit that could not run yet (no surface measured) is remembered, not dropped.
    if (options?.fit && !this.positions.size) this.pendingFit = true;
    if (result.running) this.scheduleTick();

    /*
      The last line of the load, and the one that says which kind of empty this is.

      A graph with no nodes, a graph whose nodes never got a position, and a graph laid out three
      thousand world-units from the camera are the same blank rectangle on screen. These four numbers
      separate them, and only here are all four in one place.
    */
    this.context.trace?.('layout', {
      layout: spec.type,
      nodes: this.store.nodeCount,
      edges: [...this.store.edges()].length,
      positioned: this.positions.size,
      viewport: { width, height },
    });
  }

  /**
   * The world rectangle currently on screen.
   *
   * Handed to a layout that has to *put* a node somewhere rather than derive where it goes. Computed
   * here rather than by the layout because the camera is the engine's, and a layout that reached for
   * it would be a layout that knew about a viewport it is not supposed to own.
   *
   * Only when there is a surface to measure: before the first resize the numbers are zero, and a
   * rectangle of nothing at the origin is worse than no answer at all.
   */
  private visibleWorldRect(): { x: number; y: number; width: number; height: number } {
    const { width, height } = this.viewport.get();
    const topLeft = this.viewport.toWorld({ x: 0, y: 0 });
    const bottomRight = this.viewport.toWorld({ x: width, y: height });
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }

  private scheduleTick(): void {
    if (this.layoutTimer || this.disposed) return;
    this.layoutTimer = setTimeout(() => {
      this.layoutTimer = undefined;
      const result = this.layout?.tick?.();
      if (!result) {
        this.fitUntilSettled = false;
        return;
      }
      this.applyPositions(result.positions, this.fitUntilSettled);
      if (result.running) this.scheduleTick();
      else this.fitUntilSettled = false;
    }, 16);
  }

  private applyPositions(positions: Map<string, Placement>, fit?: boolean): void {
    // Re-asserted over whatever the layout returned — see `pinnedIds`.
    for (const id of this.pinnedIds) {
      const at = positions.get(id);
      if (at && !at.fixed) positions.set(id, { ...at, fixed: true });
    }
    this.positions = positions;
    this.reindex();
    this.routeEdges();
    if (fit && !this.fitToContent()) this.pendingFit = true;
    this.notify('positions');
  }

  /** Recompute routes after a style change — `curve` decides the shape, so it decides the geometry. */
  refreshEdgeRoutes(): void {
    this.routeEdges();
    this.notify('positions');
  }

  /**
   * Rebuild the spatial index from the current positions.
   *
   * Every path that moves a node has to call this. Missing one does not fail loudly — the node paints
   * in its new place and stays *hittable in its old one*, so it silently stops responding to hover and
   * cannot be picked up again. That is invisible under a running force simulation, which reindexes on
   * the next tick anyway, and permanent under a layout that computes once.
   */
  private reindex(): void {
    this.index.rebuild(
      [...this.store.nodes()].flatMap((node) => {
        const position = this.positions.get(node.id);
        return position ? [{ id: node.id, x: position.x, y: position.y, ...this.hitArea(node) }] : [];
      }),
    );
  }

  /**
   * How large a node is for picking, from the same style rules that draw it.
   *
   * Resolved here rather than passed in by the renderer because the engine owns hit-testing, and a
   * radius the renderer computed separately would drift from the one it paints. A fixed radius —
   * which this used to be — gives a 6px property node an 18px grab area that swallows its neighbours,
   * and a 28px type node one smaller than it looks.
   */
  /**
   * Fields drawn over a node's own, by node id — see {@link setDataOverlay}.
   *
   * Deliberately beside the store rather than merged into it. The overlay stands for a write that
   * has not come back yet, and the host works out that it has come back by comparing the patch
   * against the node's *seeded* data — so merging would make every patch look confirmed the instant
   * it was applied, and the card would flick back to the old value.
   */
  private overlay: ReadonlyMap<string, Record<string, GraphValue>> = new Map();

  /**
   * Lay fields over nodes without touching what the seeds returned.
   *
   * This is what makes an optimistic edit *whole*. Drawing one is not enough: a card is picked by
   * the spatial index and its edges are routed to its border, and both are resolved from the same
   * style rules the drawing is. Overlay only the drawing and a resized card is picked at its old
   * size and has arrows pointing at where it used to end — a graph that disagrees with itself until
   * something else forces a re-read.
   *
   * Re-indexes and re-routes, since both are derived from it, and bumps the version so a renderer
   * watching for changes redraws.
   */
  setDataOverlay(overlay: ReadonlyMap<string, Record<string, GraphValue>>): void {
    this.overlay = overlay;
    this.reindex();
    this.routeEdges();
    // `graph` rather than `positions`: nothing moved, but a node's size, colour and shape can all
    // have changed, and those are read off the node projection rather than off the placements.
    this.notify('graph');
  }

  /** Whether anything is currently laid over the graph — so a renderer can skip clearing nothing. */
  hasDataOverlay(): boolean {
    return this.overlay.size > 0;
  }

  /** The fields laid over this node, if any. Read by a renderer so it draws from the same values. */
  overlayFor(id: string): Record<string, GraphValue> | undefined {
    return this.overlay.get(id);
  }

  /** A node as everything downstream should see it: its own fields, with the overlay in front. */
  private overlaid(node: GraphNode): GraphNode {
    const patch = this.overlay.get(node.id);
    if (!patch) return node;
    return { ...node, data: { ...node.data, ...patch } };
  }

  private hitArea(rawNode: GraphNode): { radius: number; halfWidth?: number; halfHeight?: number } {
    const node = this.overlaid(rawNode);
    // Resolved through `nodeVisual` — the same function the renderer paints from — rather than read
    // off the raw style rules. Deriving it separately is how a card ended up with an 18px hit spot in
    // the middle of a 170px box: a card sets `width`, never `size`, so the rule-reading version fell
    // through to its default and picked a dot.
    //
    // Metrics are deliberately not resolved here: they change what a node *means*, not where it is,
    // and a hit area that moved when a metric finished computing would be worse than a stale one.
    const visual = nodeVisual(node, resolveStyle(node, this.spec.nodeStyle), NO_METRICS);
    if (visual.shape === 'card' && visual.width && visual.height) {
      return { radius: visual.size, halfWidth: visual.width / 2, halfHeight: visual.height / 2 };
    }
    // A few pixels of slack, so a mark is grabbable at its edge rather than only inside it.
    return { radius: visual.size + 4 };
  }

  /**
   * A few pixels beyond the target's edge, so an arrowhead sits against it.
   *
   * A number for a round node and half-extents for a box, which is a real distinction rather than a
   * convenience: on a 45° approach a circle of radius r is r away and a square of half-extent r is
   * r√2, so treating every node as a box would push every diagonal arrow 40% too far out.
   */
  private clearanceFor(node: GraphNode | undefined): number | EdgeClearance {
    const gap = 6;
    if (!node) return 14 + gap;
    const area = this.hitArea(node);
    if (area.halfWidth === undefined || area.halfHeight === undefined) return area.radius + gap;
    return { halfWidth: area.halfWidth + gap, halfHeight: area.halfHeight + gap };
  }

  /**
   * Work out where every edge runs, and cache the bounds picking rejects against.
   *
   * Grouped by endpoint pair first, so mutual and parallel edges fan apart instead of stacking into a
   * single line that understates the graph.
   */
  private routeEdges(): void {
    this.edgeGeometry = new Map();
    this.edgeBoxes = new Map();

    for (const group of groupByEndpoints([...this.store.edges()]).values()) {
      const offsets = bowOffsets(group.length);
      group.forEach((edge, index) => {
        const from = this.positions.get(edge.source);
        const to = this.positions.get(edge.target);
        if (!from || !to) return;
        const style = resolveStyle(edge, this.spec.edgeStyle);
        const targetNode = this.store.node(edge.target);
        /*
          Stop short of the node's *edge*, so an arrowhead lands on it rather than inside it or short
          of it. Measured from the same place the renderer gets its size, so the two cannot disagree.

          Per axis, not as a radius. A radius is half the node's largest dimension, which describes a
          circle drawn around a card — right on its long side and well outside it on its short one.
          Narrowing a wide card left every arrow stopping where the old width used to be, with a gap
          no re-read could close, because the geometry was doing exactly what it had been told.

          *Where* on the node it lands is still the route's decision, not this one: a curve that
          arrives along an axis does not meet the node where the straight line between centres would.
        */
        const geometry = routeEdge(
          edge.id,
          from,
          to,
          normaliseCurve(style.curve),
          offsets[index],
          this.clearanceFor(targetNode),
        );
        this.edgeGeometry.set(edge.id, geometry);
        this.edgeBoxes.set(edge.id, edgeBounds(geometry));
      });
    }
  }

  /**
   * The edge nearest a point, within a tolerance — the engine's answer to what used to be
   * `pointer-events: stroke` on an SVG path.
   *
   * A linear scan with bounds rejection rather than a spatial structure: edges are re-routed on every
   * position change, so an index would be rebuilt as often as it is queried, and picking happens on a
   * click rather than per frame. If a graph ever holds enough edges for this to show up, the grid the
   * nodes use is the shape to copy.
   */
  hitTestEdge(at: Point, tolerance = 8): string | null {
    let nearestId: string | null = null;
    let nearest = tolerance;

    for (const [id, box] of this.edgeBoxes) {
      if (
        at.x < box.minX - tolerance ||
        at.x > box.maxX + tolerance ||
        at.y < box.minY - tolerance ||
        at.y > box.maxY + tolerance
      ) {
        continue;
      }
      const geometry = this.edgeGeometry.get(id);
      if (!geometry) continue;
      const distance = distanceToEdge(at, geometry);
      if (distance <= nearest) {
        nearest = distance;
        nearestId = id;
      }
    }
    return nearestId;
  }

  /** Frame everything currently placed. Nothing to frame is not a failure — it is an empty graph. */
  private fitToContent(): boolean {
    const bounds = boundsOf([...this.positions.values()].map((p) => ({ ...p, radius: 30 })));
    if (!bounds) return false;
    const { width, height } = this.viewport.get();
    if (!width || !height) return false;
    this.viewport.fit(bounds);
    return true;
  }

  /**
   * Tell the engine how large its surface is.
   *
   * More than a setter: the first fit is requested during `start()`, which runs before any renderer
   * has had a chance to measure itself, and `Viewport.fit` cannot frame content into a zero-sized
   * box. So a fit asked for too early is remembered and applied here, the moment there is a viewport
   * to fit into. Without this the camera stays at the origin and a graph laid out from `0,0` — every
   * deterministic layout — sits in the top-left corner with half of it off-screen.
   */
  resize(width: number, height: number): void {
    const previous = this.viewport.get();
    this.viewport.resize(width, height);
    if (!width || !height) return;

    if (this.pendingFit) {
      if (this.fitToContent()) this.pendingFit = false;
      this.notify('viewport');
      return;
    }
    // Growing from nothing is a first measurement, not a resize — anything already placed was laid
    // out against a guess, so it is worth re-framing rather than leaving off-centre.
    if (!previous.width || !previous.height) {
      this.fitToContent();
    }
    this.notify('viewport');
  }

  /**
   * Recompute hit areas after a style change.
   *
   * Public because the radius comes from `nodeStyle`, and a renderer may change styling without
   * anything moving — at which point the index is holding areas sized by the old rules.
   */
  refreshHitAreas(): void {
    this.recomputeMetrics();
    this.reindex();
    // Node size decides where an edge stops, and the edge's own shape decides how it gets there, so a
    // restyle moves the routes too.
    this.routeEdges();
    // And has to say so. Without this the new geometry sat in the map unpainted until something else
    // happened to notify — dragging a node, usually — so changing an edge's shape appeared to do
    // nothing until you touched the graph, and then applied retroactively.
    this.notify('positions');
  }

  /** Frame the graph now, or as soon as there is a surface to frame it into. */
  fit(): void {
    if (!this.fitToContent()) this.pendingFit = true;
    else this.notify('viewport');
  }

  /**
   * Parent → children, for layouts that place children inside a parent's region.
   *
   * Derived from the expansion tree rather than from the data: what *contains* what on screen is a
   * question about how the user opened things, and two graphs over the same data can legitimately
   * nest differently.
   */
  private containment(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const parent of this.expansion.expandedIds()) {
      const children = this.store.neighbours(parent, 'out');
      if (children.length) result.set(parent, children);
    }
    return result;
  }

  /**
   * Whether the user may move nodes.
   *
   * Scene state, not a spec field: a template says whether a graph is draggable at all by listing
   * `drag-node`, and this is the viewer saying "not right now" about a graph that is. Two different
   * questions, and collapsing them would mean a lock that a template could not offer without also
   * being able to take dragging away permanently.
   */
  isLocked(): boolean {
    return this.locked;
  }

  setLocked(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    this.notify('status');
  }

  /**
   * Whether being pinned means anything on this graph.
   *
   * False under a layout that reads positions from the data, where every node is placed and none is
   * held against anything — so a renderer marking pinned nodes marks all of them.
   */
  pinningIsMeaningful(): boolean {
    return this.layout?.derivesPositions !== false;
  }

  isPinned(id: string): boolean {
    return this.pinnedIds.has(id) || this.positions.get(id)?.fixed === true;
  }

  /**
   * Hold nodes where they are, or release them back to the layout.
   *
   * Batched, because pinning a selection of forty nodes one at a time would reindex and re-route
   * every edge forty times — `positionsChanged` is not cheap and it is the same work each time.
   */
  setPinned(ids: readonly string[], pinned: boolean): void {
    let changed = false;
    for (const id of ids) {
      const at = this.positions.get(id);
      if (!at) continue;
      if (pinned) {
        if (this.isPinned(id)) continue;
        this.pinnedIds.add(id);
        this.positions.set(id, { x: at.x, y: at.y, fixed: true });
        this.layout?.fix?.(id, { x: at.x, y: at.y });
      } else {
        if (!this.isPinned(id)) continue;
        this.pinnedIds.delete(id);
        this.positions.set(id, { x: at.x, y: at.y });
        this.layout?.fix?.(id, null);
      }
      changed = true;
    }
    if (!changed) return;
    this.positionsChanged();
    // Releasing especially: a node handed back to the layout should be drawn into place, not left
    // sitting where it was let go.
    this.resumeLayout();
  }

  pin(id: string, at: Point | null): void {
    if (at) {
      this.pinnedIds.add(id);
      this.positions.set(id, { ...at, fixed: true });
    } else {
      this.pinnedIds.delete(id);
      const existing = this.positions.get(id);
      if (existing) this.positions.set(id, { x: existing.x, y: existing.y });
    }
    this.layout?.fix?.(id, at);
    this.positionsChanged();
    this.resumeLayout();
  }

  /**
   * Ask a settled layout for more frames, after something gave it a reason to move.
   *
   * A force simulation re-energises itself when a node is held or released — that is what makes the
   * rest of the graph flow around the one you are dragging. But the engine stops polling once a layout
   * reports itself settled, so the reheat went nowhere: the dragged node moved and nothing else
   * responded, which makes a force layout look like a deterministic one and makes pinning look like it
   * does nothing at all.
   *
   * Costs nothing for a layout that computes in one pass — `tick` is absent, the first poll returns
   * undefined, and polling stops again.
   */
  private resumeLayout(): void {
    if (!this.layout?.tick) return;
    this.scheduleTick();
  }

  /**
   * Everything that must happen when a node moves, in one place.
   *
   * There are two consumers of a position — the spatial index and the edge routes — and both fail
   * silently when they are missed. A stale index leaves a dragged node hittable where it *started*;
   * stale routes leave its edges drawn and picked where they used to run. Both self-heal under a
   * ticking layout, which makes them look intermittent, and are permanent under one that computes
   * once. `pin` originally updated only the first, which is exactly the bug this consolidates away.
   */
  private positionsChanged(): void {
    this.reindex();
    this.routeEdges();
    this.notify('positions');
  }

  // ─── Selection ───────────────────────────────────────────────────────────────

  select(ids: string[], mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
    if (mode === 'replace') this.selected = new Set(ids);
    else {
      for (const id of ids) {
        if (mode === 'toggle' && this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
      }
    }
    this.emit({ type: 'selectionChange', ids: [...this.selected] });
    this.notify('selection');
  }

  // ─── Behaviour plumbing ──────────────────────────────────────────────────────

  /** The narrow surface a behaviour is given. Screen↔world lives here so behaviours never do maths. */
  behaviourContext(): BehaviourContext {
    return {
      hitTest: (at) => this.index.hitTest(at),
      hitTestEdge: (at, tolerance) => this.hitTestEdge(at, tolerance),
      select: (ids, mode) => this.select(ids, mode),
      selection: () => this.getSelection(),
      locked: () => this.locked,
      expand: (id, direction) => void this.expand(id, direction),
      collapse: (id) => this.collapse(id),
      pin: (id, at) => this.pin(id, at),
      positionOf: (id) => {
        const at = this.positions.get(id);
        return at ? { x: at.x, y: at.y } : null;
      },
      pan: (dx, dy) => {
        this.viewport.pan(dx, dy);
        this.notify('viewport');
      },
      zoomAt: (at, factor) => {
        this.viewport.zoomAt(at, factor);
        this.notify('viewport');
      },
      toWorld: (at) => this.viewport.toWorld(at),
      toScreen: (at) => this.viewport.toScreen(at),
      drawConnection: (from, to) => this.drawConnection(from, to),
      emit: (event) => this.emit(event),
    };
  }

  /**
   * The line currently being drawn, or null.
   *
   * Read by the renderer each frame of a connect gesture. Not an edge in the store, deliberately:
   * it stands for nothing yet, it must not be laid out, routed, hit-tested, counted against the
   * budget or seen by a metric — and putting it there would mean every one of those had to learn to
   * skip it.
   */
  getPendingConnection(): { from: Point; to: Point } | null {
    if (!this.pendingConnection) return null;
    const from = this.positions.get(this.pendingConnection.from);
    if (!from) return null;
    return { from: { x: from.x, y: from.y }, to: this.pendingConnection.to };
  }

  private drawConnection(from: string | null, to?: Point): void {
    this.pendingConnection = from && to ? { from, to } : null;
    this.notify('connection');
  }

  emit(event: GraphEvent): void {
    this.onEvent?.(event);
  }

  // ─── Status ──────────────────────────────────────────────────────────────────

  private beginLoading(scope: LoadScope): void {
    this.inFlight += 1;
    if (scope === 'reload') this.reloadsInFlight += 1;
    this.syncLoading();
  }

  private endLoading(scope: LoadScope): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (scope === 'reload') this.reloadsInFlight = Math.max(0, this.reloadsInFlight - 1);
    this.syncLoading();
  }

  /**
   * Publish both flags from the counters, rather than each call site deciding.
   *
   * A reload holds two counts at once — its own, and the seed load nested inside it — so "is anything
   * in flight" is a question about the counters and never about which call arrived last. Derived
   * together and compared before notifying, so the phases of a reload (seeds, then auto-expansion)
   * cannot flicker `loading` off and on between them and hand the renderer a spurious settled frame.
   */
  private syncLoading(): void {
    const loading = this.inFlight > 0;
    const reloading = this.reloadsInFlight > 0;
    if (loading === this.status.loading && reloading === this.status.reloading) return;
    this.status = { ...this.status, loading, reloading };
    this.notify('status');
  }

  /**
   * Replace whatever the layout last complained about.
   *
   * A layout warning describes the arrangement *as it is now* — "every node stayed where it was" —
   * so a later arrangement supersedes it rather than joining it. Left to accumulate through `warn`,
   * a complaint that was true of an empty board stayed on screen after the first drag made it
   * false, which is a worse failure than the one it was reporting: the reader has no way to tell a
   * live warning from a spent one.
   *
   * Expander and seed warnings deliberately do not work this way. Those describe an *event* — a
   * query that failed, a scan that truncated — and an event does not stop having happened.
   */
  private setLayoutWarnings(warnings: string[]): void {
    const previous = this.layoutWarnings;
    if (!previous.length && !warnings.length) return;
    this.layoutWarnings = warnings;
    const kept = this.status.warnings.filter((message) => !previous.includes(message));
    const next = [...kept, ...warnings.filter((message) => !kept.includes(message))];
    if (next.length === this.status.warnings.length && next.every((m, i) => m === this.status.warnings[i])) return;
    this.status = { ...this.status, warnings: next };
    this.notify('status');
  }

  private warn(message: string): void {
    // Deduped: a failing expander is re-hit on every expansion, and a warning list that grows
    // without bound is one nobody reads.
    if (this.status.warnings.includes(message)) return;
    this.status = { ...this.status, warnings: [...this.status.warnings, message] };
    this.notify('status');
  }
}

function matchesAuto(node: GraphNode, when?: Record<string, unknown>): boolean {
  if (!when) return true;
  for (const [key, expected] of Object.entries(when)) {
    const actual = key.startsWith('data.')
      ? node.data?.[key.slice(5)]
      : (node as unknown as Record<string, unknown>)[key];
    if (actual !== expected) return false;
  }
  return true;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Structural kind of an address, defaulting to `resource` for anything unrecognised. */
export function kindOf(address: string): string {
  return addressKind(address) ?? 'resource';
}
