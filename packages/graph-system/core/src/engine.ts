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
  GraphEvent,
  GraphNode,
  GraphSpec,
  Layout,
  Placement,
  Point,
} from '@we/graph-protocol';
import { addressKind } from '@we/graph-protocol';

import { ExpansionState, SEED_OPENER } from './expansion';
import { bowOffsets, distanceToEdge, edgeBounds, groupByEndpoints, normaliseCurve, routeEdge } from './geometry';
import { PluginRegistry } from './registry';
import { SpatialIndex } from './spatial';
import { GraphStore } from './store';
import { nodeVisual, resolveStyle } from './style';
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
export type ChangeReason = 'graph' | 'positions' | 'viewport' | 'selection' | 'status';

export interface EngineStatus {
  loading: boolean;
  /** Set when expansion stopped because the node budget was reached. */
  budgetReached: boolean;
  /** Non-fatal problems worth surfacing — an expander that could not answer, a dropped ref. */
  warnings: string[];
}

/** Metrics deliberately do not participate in hit-testing — see `hitRadius`. */
const NO_METRICS = new Map<string, ReadonlyMap<string, number>>();

/**
 * Metric ids a rule set actually references.
 *
 * Computed metrics are cheap but not free, and a graph whose rules mention none should pay nothing —
 * so the engine runs exactly the metrics the style asks for and no others.
 */
function referencedMetrics(rules: readonly { style: Record<string, unknown> }[] | undefined): string[] {
  const found = new Set<string>();
  for (const rule of rules ?? []) {
    for (const value of Object.values(rule.style ?? {})) {
      if (value && typeof value === 'object' && 'metric' in value) {
        found.add(String((value as { metric: unknown }).metric));
      }
    }
  }
  return [...found];
}

const DEFAULT_MAX_NODES = 2000;
const DEFAULT_EXPAND_LIMIT = 50;

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
  private status: EngineStatus = { loading: false, budgetReached: false, warnings: [] };
  private inFlight = 0;
  private disposed = false;
  /** A fit was asked for before there was a surface to fit into. Applied on the next real resize. */
  private pendingFit = false;
  /** Whether the user may move nodes. See `isLocked`. */
  private locked = false;
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
      ...referencedMetrics(this.spec.nodeStyle as { style: Record<string, unknown> }[] | undefined),
      ...referencedMetrics(this.spec.edgeStyle as { style: Record<string, unknown> }[] | undefined),
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
    this.selected.clear();
    this.status = { loading: false, budgetReached: false, warnings: [] };

    const seeds = this.spec.seeds ? (Array.isArray(this.spec.seeds) ? this.spec.seeds : [this.spec.seeds]) : [];
    this.beginLoading();
    try {
      for (const seed of seeds) {
        const fragment =
          'literal' in seed
            ? { nodes: seed.nodes, edges: seed.edges }
            : await this.registry
                .seed(seed.source)
                ?.seed(seed.options ?? {}, this.context)
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
        this.store.merge(fragment);
        this.expansion.attribute(
          SEED_OPENER,
          fragment.nodes.map((n) => n.id),
          fragment.edges.map((e) => e.id),
        );
      }
    } finally {
      this.endLoading();
    }

    await this.runAutoExpansion();
    this.recomputeMetrics();
    this.relayout({ fit: true });
    this.notify('graph');
  }

  dispose(): void {
    this.disposed = true;
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
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
  async expand(id: string, direction?: ExpandDirection): Promise<void> {
    const node = this.store.node(id);
    if (!node) return;
    if (this.expansion.isExpanded(id) && !this.expansion.hasMore(id)) return;
    // Refusing because the graph is full is itself worth saying. Landing exactly on the ceiling used
    // to stop expansion without ever tripping the flag, so the map went quiet with no explanation —
    // which is the precise failure the budget exists to prevent.
    if (this.atBudget()) {
      this.reportBudgetReached();
      return;
    }

    const spec = this.spec.expansion ?? {};
    const expanders = this.registry.expandersFor(node.kind, node.type, spec.expanders);
    if (!expanders.length) {
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

    this.beginLoading();
    let added = 0;
    let total: number | undefined;
    let cursor: string | undefined;

    try {
      for (const expander of expanders) {
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
      this.endLoading();
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

  private async runAutoExpansion(): Promise<void> {
    const spec = this.spec.expansion;
    const depth = spec?.defaultDepth ?? 0;
    const rules = spec?.auto ?? [];
    if (!depth && !rules.length) return;

    // Breadth-first by depth, so a shallow rule never gets starved by a deep one, and each level is
    // fully open before the next begins — otherwise the graph grows down one arm while the user waits.
    let frontier = [...this.store.nodes()].map((n) => n.id);
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
    return this.spec.expansion?.maxNodes ?? DEFAULT_MAX_NODES;
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
    });
    for (const warning of result.warnings ?? []) this.warn(warning);
    this.fitUntilSettled = !!options?.fit && !!result.running;
    this.applyPositions(result.positions, options?.fit);
    // A fit that could not run yet (no surface measured) is remembered, not dropped.
    if (options?.fit && !this.positions.size) this.pendingFit = true;
    if (result.running) this.scheduleTick();
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
  private hitArea(node: GraphNode): { radius: number; halfWidth?: number; halfHeight?: number } {
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
        // Stop short of the node's centre, so an arrowhead lands on it rather than inside it. The
        // radius comes from the same place the renderer gets its size, so the two cannot disagree.
        // *Where* on the node it lands is the route's decision, not this one — a curve that arrives
        // along an axis does not meet the node where the straight line between centres would.
        const radius = targetNode ? this.hitArea(targetNode).radius : 14;
        const geometry = routeEdge(edge.id, from, to, normaliseCurve(style.curve), offsets[index], radius + 6);
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

  isPinned(id: string): boolean {
    return this.positions.get(id)?.fixed === true;
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
        if (at.fixed) continue;
        this.positions.set(id, { x: at.x, y: at.y, fixed: true });
        this.layout?.fix?.(id, { x: at.x, y: at.y });
      } else {
        if (!at.fixed) continue;
        this.positions.set(id, { x: at.x, y: at.y });
        this.layout?.fix?.(id, null);
      }
      changed = true;
    }
    if (changed) this.positionsChanged();
  }

  pin(id: string, at: Point | null): void {
    if (at) this.positions.set(id, { ...at, fixed: true });
    else {
      const existing = this.positions.get(id);
      if (existing) this.positions.set(id, { x: existing.x, y: existing.y });
    }
    this.layout?.fix?.(id, at);
    this.positionsChanged();
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
      emit: (event) => this.emit(event),
    };
  }

  emit(event: GraphEvent): void {
    this.onEvent?.(event);
  }

  // ─── Status ──────────────────────────────────────────────────────────────────

  private beginLoading(): void {
    this.inFlight += 1;
    if (this.inFlight === 1) {
      this.status = { ...this.status, loading: true };
      this.notify('status');
    }
  }

  private endLoading(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (this.inFlight === 0) {
      this.status = { ...this.status, loading: false };
      this.notify('status');
    }
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
