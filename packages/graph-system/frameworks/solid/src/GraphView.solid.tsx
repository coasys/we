/**
 * The Solid adapter — a thin binding over `@we/graph-core`, and nothing else.
 *
 * The engine holds all the state and all the decisions; this file subscribes to it, converts "something
 * changed" into signals, and paints. That is the same seam the schema system uses (neutral semantics,
 * per-framework adapter), and it is why a React host would be a second file of this size rather than a
 * second implementation of the engine.
 *
 * ## What is drawn where
 *
 * Edge *lines* are SVG: a single retained-mode surface with sub-pixel curves, which SVG gives for
 * free. Everything else — nodes, node labels, edge labels — is DOM. Nodes want to be real elements,
 * since that is what lets a node hold a schema fragment, an avatar, eventually an editable block.
 *
 * Text is DOM without exception, and that is a scar rather than a preference: edge labels were SVG
 * `<text>` and jittered for seconds after a zoom, because the browser rasterises SVG text into a
 * cached texture and re-renders it at the new scale on its own schedule. HTML text is re-laid out with
 * the transform, so it simply tracks. One text pipeline, no second thing to keep in agreement.
 *
 * All of it lives inside one transformed layer, so a single camera moves everything together.
 *
 * The engine owns hit-testing rather than the DOM, so behaviours work identically whichever surface a
 * node is drawn on. That is the property that keeps a dense canvas renderer additive later.
 */
import { Column, Row } from '@we/components/solid';
import {
  DEFAULT_CONTROLS,
  defaultBehaviours,
  defaultControls,
  defaultMetrics,
  dispatchPointer,
  edgeVisual,
  GraphEngine,
  matches,
  nodeVisual,
  PluginRegistry,
  resolveStyle,
} from '@we/graph-core';
import { DEFAULT_REIFIED_EDGES, defaultExpanders } from '@we/graph-expanders';
import { defaultLayouts } from '@we/graph-layouts';
import type {
  Behaviour,
  ControlContext,
  EdgeGeometry,
  GraphNode,
  GraphValue,
  Point,
  PointerInput,
} from '@we/graph-protocol';
import { parseAddress } from '@we/graph-protocol';
import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from 'solid-js';
import { Dynamic } from 'solid-js/web';

import type { GraphViewProps, NodeContent } from './GraphView.types';
import { isSettled, patched } from './pending';
import { type Grip, HANDLES, resizeBox } from './resize';

/** Matches the engine's own floor, so a drag cannot leave a card the style layer would refuse. */
const MIN_CARD = 40;
/** Only reached by a card whose style names no size — the engine's defaults, kept in step. */
const DEFAULT_CARD_WIDTH = 160;
const DEFAULT_CARD_HEIGHT = 120;

export type * from './GraphView.types';

/** Sensible without being opinionated: look around, select things, open things. */
const DEFAULT_BEHAVIOURS = ['pan-zoom', 'select', 'expand-on-double-click'];

/**
 * A route, as an SVG path.
 *
 * The only geometry left in the renderer, and deliberately so: it converts world-space control points
 * into one syntax. A canvas renderer would write the same three cases into `ctx.quadraticCurveTo`
 * without re-deriving anything.
 */
export function pathFrom(route: EdgeGeometry, endGap = 0): string {
  const { from, control, control2, elbows } = route;
  const to = endGap > 0 ? backOff(route, endGap) : route.to;
  if (elbows) return `M ${from.x} ${from.y} ` + [...elbows, to].map((p) => `L ${p.x} ${p.y}`).join(' ');
  // The second control is what makes it cubic — a renderer needs no other signal to pick its command.
  if (control && control2) {
    return `M ${from.x} ${from.y} C ${control.x} ${control.y} ${control2.x} ${control2.y} ${to.x} ${to.y}`;
  }
  if (control) return `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`;
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

/**
 * Stop the stroke short, so an arrowhead sits at the end of the line rather than on top of it.
 *
 * The marker used to be positioned with its tip near the path end (`refX="9"` of a 10-unit viewBox),
 * which ran the line underneath almost the whole arrowhead. That is invisible until you notice the
 * arithmetic: markers scale with stroke width, so the line's half-width is a *constant* 0.83 viewBox
 * units whatever the stroke, while the triangle's half-height where the line stopped was only 0.5.
 * The line was wider than the arrow at the point it ended, so its edges showed either side of the
 * tip — always, with zoom merely magnifying it.
 *
 * With the marker's base at the path end instead, the fix is to end the path an arrowhead earlier.
 * The route itself is untouched: picking still uses the full line, because the part under the
 * arrowhead is still part of the edge as far as clicking on it is concerned.
 *
 * Backing off along the closing tangent rather than re-solving the curve is an approximation, and a
 * deliberate one — over an arrowhead's length the error is far below a pixel, and the alternative is
 * splitting a cubic at an arc length nobody can see.
 */
function backOff(route: EdgeGeometry, gap: number): Point {
  const { to, control, control2, elbows } = route;
  const previous = elbows?.[elbows.length - 1] ?? control2 ?? control ?? route.from;
  const dx = to.x - previous.x;
  const dy = to.y - previous.y;
  const length = Math.hypot(dx, dy);
  if (length <= gap || length === 0) return to;
  return { x: to.x - (dx / length) * gap, y: to.y - (dy / length) * gap };
}

/**
 * Arrowhead length, in multiples of the stroke width.
 *
 * `markerUnits` defaults to `strokeWidth`, so this scales with the line and a hairline edge does not
 * get the arrowhead of a thick one. It is also how far the stroke is shortened — one constant, so the
 * head and the gap it needs cannot drift apart.
 */
const ARROW_LENGTH = 6;

/**
 * How much of a value is worth carrying to a panel.
 *
 * Long enough for a sentence, short enough that one field cannot become the whole panel.
 */
const FIELD_MAX = 240;

/**
 * A node's scalars, as a panel can show them.
 *
 * Three things are dropped, and each for its own reason. **Nulls and blanks**, because an absent
 * property is absent and listing it states something the record does not. **File-storage blobs**,
 * which resolve to `data:<mime>;base64,…` — a card's `editorState` is a whole document encoded, and
 * it is not a field, it is the thing the card *is*; shown as one it was tens of thousands of
 * unbreakable characters in a row. **The tail of anything very long**, because a field that fills
 * the panel has stopped being scannable, which is the only reason the panel is a column.
 */
function readableFields(node: GraphNode): { name: string; value: string }[] {
  return Object.entries(node.data ?? {}).flatMap(([name, value]) => {
    if (value === null || value === '') return [];
    const text = String(value);
    if (text.startsWith('data:')) return [];
    return [{ name, value: text.length > FIELD_MAX ? `${text.slice(0, FIELD_MAX - 1)}…` : text }];
  });
}

/** Design tokens resolve against the live theme; anything else is passed through as CSS. */
function color(value: string | undefined, fallback: string): string {
  const token = value ?? fallback;
  if (!token) return fallback;
  if (/^(#|rgb|hsl|var\(|transparent$|currentcolor$)/i.test(token)) return token;
  return `var(--we-color-${token})`;
}

export function GraphView(props: GraphViewProps) {
  let surface: HTMLDivElement | undefined;

  const [version, setVersion] = createSignal(0);
  const [viewportVersion, setViewportVersion] = createSignal(0);
  const [statusVersion, setStatusVersion] = createSignal(0);
  const [connectionVersion, setConnectionVersion] = createSignal(0);
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = createSignal<string | null>(null);

  // Read once: expanders are constructed with their options, so changing `reified` needs a remount —
  // which is what a template does anyway when it swaps one graph for another.
  const registry = new PluginRegistry({
    ...defaultExpanders({ reified: props.reified ?? DEFAULT_REIFIED_EDGES }),
    layouts: defaultLayouts(),
    behaviours: defaultBehaviours(),
    metrics: defaultMetrics(),
    controls: defaultControls(),
  });

  const engine = new GraphEngine({
    spec: {},
    registry,
    context: {
      // The host binding takes a plain record: it is the seam where the graph's own query shape stops
      // and the deployment's data layer begins, so it is deliberately untyped rather than importing
      // the protocol into `app-shell`.
      query: (request) => props.host?.query({ ...request }) ?? Promise.resolve([]),
      // Present only when the host can actually report changes: the engine tests for the method to
      // decide whether a live graph is possible at all, so passing a no-op stub would tell it yes
      // and leave it waiting for notifications nothing will ever send.
      ...(props.host?.watch && {
        watch: (request, onChange) => props.host!.watch!(request, onChange),
      }),
      defaultDataset: () => props.host?.defaultDataset() ?? null,
      models: (dataset) => props.host?.models(dataset) ?? [],
      warn: () => undefined,
      // Spread like `watch`, so an expander asking whether it can trace gets the honest answer
      // rather than a stub that swallows everything.
      ...(props.host?.trace && { trace: (event, detail) => props.host!.trace!(event, detail) }),
    },
    onEvent: (event) => {
      switch (event.type) {
        case 'nodeClick': {
          // The behaviour only knows an address; the template wants the node, so it is resolved
          // here where the store is in reach.
          const node = engine.store.node(event.node.id);
          if (!node) break;
          const at = parseAddress(node.id);
          props.onNodeClick?.({
            ...node,
            ...(at?.kind === 'entity' && { recordId: at.id }),
            fields: readableFields(node),
          });
          break;
        }
        case 'nodeDoubleClick': {
          const node = engine.store.node(event.node.id);
          if (!node) break;
          // The record, resolved out of the address, as `nodeClick` does. Opening a node means
          // opening the thing it stands for, and a template has no operator that could take a
          // `we-graph://` address apart to find it.
          const opened = parseAddress(node.id);
          props.onNodeDoubleClick?.({
            ...node,
            ...(opened?.kind === 'entity' && { recordId: opened.id, recordType: opened.type }),
          });
          break;
        }
        case 'edgeClick': {
          // The behaviour only knows an id — picking is geometric now, so it never held the edge.
          const edge = engine.store.edge(event.edge.id);
          if (!edge) break;
          // A reified edge is a view of a record, and a consumer that wants to open it needs the
          // record rather than the address. Absent on an ordinary edge, which stands for a declared
          // relation and has no record of its own.
          const behind = edge.reifiedAs ? parseAddress(edge.reifiedAs) : null;
          props.onEdgeClick?.({
            ...edge,
            ...(behind?.kind === 'entity' && { recordId: behind.id, recordType: behind.type }),
          });
          break;
        }
        case 'edgeCreate': {
          // Both ends resolved from the store, as `nodeClick` does: the behaviour only ever held
          // addresses, and a template answering this needs each end's type to write the record.
          const source = engine.store.node(event.source.id);
          const target = engine.store.node(event.target.id);
          if (!source || !target) break;
          // Only entity nodes stand for records. A property, a literal or a synthetic cluster has
          // no id to write a connection against, and offering to connect one would raise a dialog
          // whose save could not succeed.
          const from = parseAddress(source.id);
          const to = parseAddress(target.id);
          if (from?.kind !== 'entity' || to?.kind !== 'entity') break;
          props.onEdgeCreate?.({
            source,
            target,
            sourceId: from.id ?? '',
            sourceType: from.type ?? source.type,
            sourceLabel: source.label ?? source.type,
            targetId: to.id ?? '',
            targetType: to.type ?? target.type,
            targetLabel: target.label ?? target.type,
          });
          break;
        }
        case 'canvasDoubleClick':
          props.onCanvasDoubleClick?.({ x: event.at.x, y: event.at.y });
          break;
        case 'selectionChange':
          props.onSelectionChange?.(event.ids);
          break;
        case 'nodeDragEnd': {
          const at = parseAddress(event.node.id);
          props.onNodeDragEnd?.({
            id: event.node.id,
            x: event.position.x,
            y: event.position.y,
            ...(at?.kind === 'entity' && { recordId: at.id, recordType: at.type }),
          });
          break;
        }
        default:
          break;
      }
    },
  });

  engine.subscribe((reason) => {
    batch(() => {
      if (reason === 'viewport') setViewportVersion((n) => n + 1);
      else if (reason === 'status') setStatusVersion((n) => n + 1);
      else if (reason === 'connection') setConnectionVersion((n) => n + 1);
      else setVersion((n) => n + 1);
    });
  });

  const behaviours = createMemo<Behaviour[]>(() => {
    const specs = props.behaviours ?? DEFAULT_BEHAVIOURS;
    return specs.flatMap((spec) => {
      const id = typeof spec === 'string' ? spec : spec.type;
      const options = typeof spec === 'string' ? undefined : spec.options;
      const behaviour = registry.behaviour(id, options);
      return behaviour ? [behaviour] : [];
    });
  });

  /**
   * The spec the engine should be holding, rebuilt from props on demand.
   *
   * `nodeStyle` is in here even though the engine never paints: it sizes the *hit area* from the same
   * rules that size the circle, so a 40px node is grabbable across its whole face and a 6px one does
   * not swallow its neighbours. Leaving it out silently reverts picking to a fixed radius.
   */
  const currentSpec = () => ({
    seeds: props.seeds,
    expansion: props.expansion,
    layout: props.layout,
    nodeStyle: props.nodeStyle,
    edgeStyle: props.edgeStyle,
    live: props.live,
  });

  // Reload when what the graph *is* changes — where it starts and how far it opens. Deliberately
  // narrow: recolouring a map must never re-run its queries, and depending on the whole prop bag
  // would do exactly that. `props.layout` is read untracked so a layout swap does not land here.
  createEffect((previous: string | undefined) => {
    /*
      Compared by value, not by identity.

      A host that rebuilds its spec object — because some unrelated control changed — hands over a new
      `seeds` every time, and reading it here re-runs whatever computed it. Tracking that alone meant
      switching the edge shape in a picker restarted the graph and threw away every node position,
      which looks like a layout bug and is really this effect firing on churn. The layout and style
      effects below already compare; this one is the reason to.
    */
    const next = JSON.stringify([props.seeds ?? null, props.expansion ?? null]);
    if (previous === next) return next;
    untrack(() => {
      engine.setSpec(currentSpec());
      void engine.start();
    });
    return next;
  });

  /*
    A revision bump re-reads the data and merges it in.

    Separate from the seeds effect above because the two mean different things: that one fires when
    the graph *becomes a different graph* and resets, while this one fires when the same graph has
    newer data behind it. Sharing a path would make creating a record throw away the arrangement the
    user was working in, which is exactly the failure that made a board impossible to build on.

    The first run only records the value — the seeds effect has already loaded, and refreshing on
    mount would run every seed query twice.
  */
  createEffect((previous: string | undefined) => {
    const next = String(props.revision ?? '');
    if (previous !== undefined && previous !== next) void engine.refresh();
    return next;
  });

  // Following the data is not part of what the graph *is*, so toggling it neither reloads nor
  // re-lays-out — it only starts or stops the listening.
  createEffect(() => engine.setLive(props.live !== false));
  /*
    What the host has floating over the canvas, so "in view" means what a reader can see.

    An effect rather than a construction argument because panels move: dragging one across the
    board changes which part of it is clear, and a card parked afterwards should land in the part
    that is clear *now*.
  */
  createEffect(() => engine.viewport.setObscured(props.host?.obscured?.()));

  /**
   * The graph's own chrome, kept out from under whatever the host has floating over the canvas.
   *
   * The status strip sits at the bottom-left of the graph's box, which on the workshop's board is
   * behind the transcript panel: a warning nobody could read, about a board that was working. Same
   * inset the layout uses, for the same reason — the box and the visible part of it are different
   * rectangles once a host floats panels over one.
   *
   * Offsets rather than a shrunken container, so the canvas keeps every pixel it had. Only the
   * chrome moves; nothing about what is drawn or where it can be dragged changes.
   */
  const clear = createMemo(() => {
    const inset = props.host?.obscured?.();
    return {
      left: inset?.left ?? 0,
      right: inset?.right ?? 0,
      top: inset?.top ?? 0,
      bottom: inset?.bottom ?? 0,
    };
  });
  /** A space token plus however many pixels are covered on that edge. */
  const past = (edge: 'left' | 'right' | 'top' | 'bottom') => `calc(var(--we-space-300) + ${clear()[edge]}px)`;

  // An expansion asked for from outside a gesture. Compared by value for the same reason `seeds` is:
  // a host that rebuilds its prop object would otherwise re-expand on every unrelated change.
  createEffect((previous: string | undefined) => {
    const request = props.expandRequest;
    const next = JSON.stringify(request ?? null);
    if (previous !== undefined && previous !== next && request?.id) {
      void engine.expand(request.id, request.direction, request.expanders);
    }
    return next;
  });

  // A layout swap rearranges what is already loaded rather than reloading it — the whole point of
  // offering several layouts is to see the same graph differently.
  createEffect((previous: string | undefined) => {
    const next = JSON.stringify(props.layout ?? {});
    if (previous !== undefined && previous !== next) {
      engine.setSpec(currentSpec());
      engine.relayout({ fit: true });
    }
    return next;
  });

  // Restyling re-sizes hit areas but must never re-run a query or move a node, so it updates the spec
  // and reindexes rather than restarting or re-laying out.
  createEffect((previous: string | undefined) => {
    const next = JSON.stringify([props.nodeStyle ?? [], props.edgeStyle ?? []]);
    if (previous !== undefined && previous !== next) {
      engine.setSpec(currentSpec());
      engine.refreshHitAreas();
    }
    return next;
  });

  onMount(() => {
    if (!surface) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      engine.resize(box.width, box.height);
      setViewportVersion((n) => n + 1);
    });
    observer.observe(surface);
    onCleanup(() => observer.disconnect());
  });

  onCleanup(() => engine.dispose());

  // ─── Reactive projections ────────────────────────────────────────────────────

  const nodes = createMemo(() => {
    version();
    const placed = engine.getPositions();
    const selected = new Set(engine.getSelection());
    return [...engine.store.nodes()].flatMap((rawNode) => {
      const at = placed.get(rawNode.id);
      if (!at) return [];
      // The overlay comes back out of the engine rather than being applied again here — see the
      // effect below. Hit-testing and edge routing resolve from the same values, so a card cannot be
      // drawn at one size and picked at another.
      const node = patched(rawNode, engine.overlayFor(rawNode.id));
      const style = resolveStyle(node, props.nodeStyle);
      return [
        {
          node,
          at,
          visual: nodeVisual(node, style, engine.getMetrics()),
          selected: selected.has(node.id),
          expanded: engine.expansion.isExpanded(node.id),
          hasMore: engine.expansion.hasMore(node.id),
        },
      ];
    });
  });

  /*
    The host's optimistic fields, handed to the engine keyed by node.

    Translated here because the host thinks in records and the engine thinks in nodes — and given to
    the engine rather than applied at paint time because drawing is only one of three things resolved
    from a node's data. Hit-testing and edge routing are the others, and a card drawn at its new size
    but picked and pointed at at its old one is a graph disagreeing with itself.
  */
  createEffect(() => {
    const pending = props.host?.pendingData?.();
    const overlay = new Map<string, Record<string, GraphValue>>();
    if (pending && Object.keys(pending).length) {
      for (const node of engine.store.nodes()) {
        const at = parseAddress(node.id);
        const patch = at?.kind === 'entity' && at.id ? pending[at.id] : undefined;
        if (patch) overlay.set(node.id, patch);
      }
    }
    // Untracked so this reads the store without re-running on every graph change — the effect is
    // about the host's map, and `version()` below is what redraws when the graph itself moves.
    if (overlay.size || engine.hasDataOverlay()) engine.setDataOverlay(overlay);
  });

  /*
    Tell the host which optimistic fields the data has caught up with.

    Here rather than where the host read the rows, because this is the only place that can see both
    at once — and the difference is visible: clearing when the *read* landed put the old value back
    for the rest of the seed, so an edit flashed to its new size, snapped back, and arrived again a
    moment later. A node whose own data already says what the patch says can lose the patch with
    nothing moving on screen.

    An effect rather than part of the memo: telling somebody something is not deriving a value, and a
    store write inside a memo would run during render.
  */
  createEffect(() => {
    const pending = props.host?.pendingData?.();
    if (!pending || !Object.keys(pending).length) return;
    const settled = nodes().flatMap((entry) => {
      const at = parseAddress(entry.node.id);
      const patch = at?.kind === 'entity' && at.id ? pending[at.id] : undefined;
      // The *raw* node, not `entry.node` — that one already carries the overlay, so asking it
      // would report every patch settled the instant it was applied.
      const raw = engine.store.node(entry.node.id);
      return patch && raw && at?.id && isSettled(raw, patch) ? [at.id] : [];
    });
    if (settled.length) props.host?.confirmPending?.(settled);
  });

  const edges = createMemo(() => {
    version();
    // Geometry comes from the engine, which routed these when it placed the nodes. Deriving it again
    // here is how the renderer and hit-testing would drift — and edge picking is now geometric, so a
    // second derivation would mean clicking an edge that is not the one under the cursor.
    const geometry = engine.getEdgeGeometry();
    const metrics = engine.getMetrics();
    return [...engine.store.edges()].flatMap((edge) => {
      const route = geometry.get(edge.id);
      if (!route) return [];
      const visual = edgeVisual(edge, resolveStyle(edge, props.edgeStyle), metrics);
      // The gap is the arrowhead's own length, in world units — the marker scales with stroke width,
      // so the stroke has to give up the same amount it takes.
      const gap = visual.arrow === 'none' ? 0 : ARROW_LENGTH * visual.width;
      return [{ edge, route, path: pathFrom(route, gap), visual }];
    });
  });

  /*
    The connect gesture's line, tracked on the positions channel.

    Its own channel rather than the one positions use: the line moves with the pointer, and
    re-running the node and edge projections on every pointer move — to draw one straight segment
    while every node stays exactly where it was — would make the gesture the most expensive thing
    on the canvas.
  */
  const pending = createMemo(() => {
    connectionVersion();
    return engine.getPendingConnection();
  });

  const transform = createMemo(() => {
    viewportVersion();
    version();
    const { x, y, zoom } = engine.viewport.get();
    return `translate(${x}px, ${y}px) scale(${zoom})`;
  });

  /**
   * The chrome buttons this graph shows.
   *
   * Resolved from the registry by name, so a module can contribute one and a template can name it —
   * the same shape as behaviours, and the reason the engine ships chrome at all rather than leaving
   * every host to rebuild a zoom button.
   */
  const controls = createMemo(() => {
    const ids = props.controls ?? (props.showControls === false ? [] : DEFAULT_CONTROLS);
    return ids.flatMap((id) => {
      const control = registry.control(id);
      if (!control) console.warn(`[graph] no control registered as "${id}"`);
      return control ? [control] : [];
    });
  });

  /** What a control is allowed to do — act on the scene, never write to the data. */
  const controlContext = (): ControlContext => ({
    zoomBy: (factor) => {
      const { width, height } = engine.viewport.get();
      engine.behaviourContext().zoomAt({ x: width / 2, y: height / 2 }, factor);
    },
    fit: () => engine.fit(),
    relayout: () => engine.relayout({ fit: true }),
    viewport: () => engine.viewport.get(),
    selection: () => engine.getSelection(),
    isPinned: (id) => engine.isPinned(id),
    setPinned: (ids, pinned) => engine.setPinned(ids, pinned),
    isLocked: () => engine.isLocked(),
    setLocked: (locked) => engine.setLocked(locked),
  });

  /** The camera scale on its own, for anything that has to divide by it. */
  const zoom = createMemo(() => {
    viewportVersion();
    version();
    return engine.viewport.get().zoom;
  });

  /**
   * The content component for a card, or nothing.
   *
   * Nothing in three cases, each of which falls back to the label: the style named none, the host
   * supplies none by that name, or the camera is below the card's `contentMinZoom`. The last is the
   * one that decides whether rich cards scale — a hundred documents rendered at once is a hundred
   * component trees, and at the zoom where a board is a wall of coloured rectangles not one of them
   * can be read.
   */
  /**
   * A card's corners, or a dot's.
   *
   * `round` is 50% on a box, which draws an ellipse rather than a circle — deliberately: the card
   * keeps whatever width and height somebody gave it, and forcing it square would silently undo a
   * resize the moment the shape was changed.
   */
  function nodeRadius(visual: { shape: string; cardShape?: string }): string {
    if (visual.shape === 'circle') return '50%';
    if (visual.shape !== 'card') return 'var(--we-radius-300)';
    if (visual.cardShape === 'square') return '0';
    if (visual.cardShape === 'round') return '50%';
    return 'var(--we-radius-300)';
  }

  const cardContent = (visual: { content?: string; contentMinZoom?: number }): NodeContent | undefined => {
    if (!visual.content) return undefined;
    if (visual.contentMinZoom !== undefined && zoom() < visual.contentMinZoom) return undefined;
    return props.host?.nodeContent?.[visual.content];
  };

  /**
   * Which of the offered controls this node gets.
   *
   * Not memoised per node: the list is a handful of entries and `matches` is a field comparison, so
   * this costs less than the map that would key it — and it is only ever called for the selection,
   * which is one node.
   */
  const actionsFor = (node: GraphNode) => (props.nodeActions ?? []).filter((action) => matches(node, action.when));

  const status = createMemo(() => {
    statusVersion();
    return engine.getStatus();
  });

  /**
   * A load with nothing usable underneath it — so it is announced in the middle of the canvas.
   *
   * The engine's `reloading` covers the case that looks least like one: `start` clears the store and
   * only notifies at the end, so the graph on screen during a board switch is the *old* graph, and
   * saying so in a corner is how a stale board gets read as a live one. `loading` with no nodes is
   * the first load, where the middle of the canvas is empty anyway and a footnote in the corner is
   * the only thing standing between the reader and a blank screen.
   *
   * Everything else — an expansion, a refresh arriving from a subscription — loads *beside* a graph
   * that stays on screen and stays usable, and belongs in the corner strip rather than over the top
   * of the node whose double-click started it.
   */
  const loadingWholeGraph = createMemo(() => status().reloading || (status().loading && !nodes().length));

  /** A load that arrives beside a graph that is still on screen and still usable. The corner case. */
  const backgroundLoading = createMemo(() => status().loading && !loadingWholeGraph());

  // ─── Pointer plumbing ────────────────────────────────────────────────────────

  /**
   * Screen coordinates relative to the surface, never the page.
   *
   * The surface is rarely at the origin — it sits inside a template with sidebars and headers — and
   * page coordinates would put every hit-test out by however much chrome precedes it.
   */
  function toInput(event: PointerEvent | WheelEvent | MouseEvent): PointerInput {
    const box = surface?.getBoundingClientRect();
    return {
      at: { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) },
      buttons: 'buttons' in event ? event.buttons : 0,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      delta: 'deltaY' in event ? event.deltaY : undefined,
    };
  }

  /*
    A resize in progress, drawn locally.

    Renderer state rather than engine state, and handles rather than a behaviour, because every part
    of the gesture is about the box on screen: the grab areas are the edges and corners of a specific
    card, which a world-space hit test knows nothing about, and the feedback is that card following
    the pointer. The engine hears about it once, on release, as an intent — one write instead of one
    per frame.

    It carries a position as well as a size, because resizing from a corner must hold the *opposite*
    corner still. A card is drawn from its centre, so keeping one edge where it is means moving the
    centre — and a gesture that grew a card in all four directions at once, whichever handle you
    pulled, is the thing that feels wrong about the naive version.
  */
  const [resizing, setResizing] = createSignal<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  /**
   * Begin a resize from one handle.
   *
   * `grip` is which way that handle pulls: `-1`, `0` or `1` per axis, so a corner moves both and an
   * edge moves one. Zero on an axis is what makes an edge handle leave the other dimension alone.
   */
  function beginResize(
    event: PointerEvent,
    entry: { node: GraphNode; at: { x: number; y: number }; visual: { width?: number; height?: number } },
    grip: Grip,
  ) {
    // Never reaches the canvas dispatcher, which would read the same press as the start of a drag —
    // the node under the handle is the node being resized, so both gestures would run at once.
    event.stopPropagation();
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture?.(event.pointerId);
    const from = { x: event.clientX, y: event.clientY };
    const width = entry.visual.width ?? DEFAULT_CARD_WIDTH;
    const height = entry.visual.height ?? DEFAULT_CARD_HEIGHT;

    const move = (moved: PointerEvent) => {
      moved.stopPropagation();
      // Screen pixels over zoom: the card is measured in world units, so a drag at 2x has to move it
      // half as far or the card runs away from the pointer.
      const scale = zoom() || 1;
      const delta = { x: (moved.clientX - from.x) / scale, y: (moved.clientY - from.y) / scale };
      const next = resizeBox({ at: entry.at, width, height }, grip, delta, MIN_CARD);
      setResizing({ id: entry.node.id, x: next.at.x, y: next.at.y, width: next.width, height: next.height });
    };
    const end = (ended: PointerEvent) => {
      ended.stopPropagation();
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      const box = resizing();
      setResizing(null);
      if (!box) return;
      /*
        Hold the card where the drag left it, exactly as dropping one does.

        Resizing from an edge moves the centre, and the engine still has the old one — so without
        this the card would jump back on the next refresh and creep to its new position only when the
        write came round. `drag-node` pins on drop for the same reason; a pin survives a refresh,
        which is what makes both gestures land where the pointer left them.
      */
      engine.behaviourContext().pin(entry.node.id, { x: box.x, y: box.y });
      const at = parseAddress(entry.node.id);
      props.onNodeResize?.({
        id: entry.node.id,
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
        ...(at?.kind === 'entity' && { recordId: at.id, recordType: at.type }),
      });
    };

    // On the handle rather than the window: the pointer is captured to it, so it sees the whole drag
    // wherever the cursor goes, and nothing else on the page has to be listened to.
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  /**
   * Where and how big a card is drawn right now — the live drag where there is one, otherwise what
   * the engine and the style rules resolved.
   *
   * Position comes through here too because a resize that anchors one edge moves the centre, so the
   * transform and the size have to be read from the same place or the card would grow around a point
   * it is no longer centred on.
   */
  function boxOf(entry: {
    node: GraphNode;
    at: { x: number; y: number };
    visual: { width?: number; height?: number };
  }) {
    const live = resizing();
    if (live && live.id === entry.node.id) return live;
    return { x: entry.at.x, y: entry.at.y, width: entry.visual.width, height: entry.visual.height };
  }

  function dispatch(phase: Parameters<typeof dispatchPointer>[1], event: PointerEvent | WheelEvent | MouseEvent) {
    dispatchPointer(behaviours(), phase, toInput(event), engine.behaviourContext());
  }

  function onPointerMove(event: PointerEvent) {
    dispatch('onPointerMove', event);
    // Hover is read straight off the index rather than from DOM enter/leave, so it behaves the same
    // whether the node is an element or a painted shape.
    const at = engine.viewport.toWorld(toInput(event).at);
    const [hit] = engine.index.hitTest(at);
    if (hit !== hovered()) setHovered(hit ?? null);
    /*
      Edges are hovered too, and nodes win — the same rule picking follows.

      Worth more here than on a node: a node is a shape you can see the boundary of, and an edge is a
      two-pixel line whose clickable width is a tolerance nobody can see. Without a hover mark the
      only way to find out whether you are on the line is to click and see what opens.
    */
    const edge = hit ? null : engine.hitTestEdge(at);
    if (edge !== hoveredEdge()) setHoveredEdge(edge);
  }

  return (
    <div
      class="we-graph"
      ref={surface}
      style={{
        width: props.width ?? '100%',
        height: props.height ?? '100%',
        background: color(props.bg, 'neutral-0'),
      }}
    >
      {/*
        The canvas hit target. Every gesture is handled here, not on the root — see the note in the
        stylesheet for why that is what lets the chrome be an ordinary sibling rather than something
        each overlay has to opt out of.
      */}
      <div
        class="we-graph__surface"
        onPointerDown={(event) => {
          (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
          dispatch('onPointerDown', event);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => dispatch('onPointerUp', event)}
        // Without this a gesture interrupted by the browser leaves whichever behaviour was tracking it
        // latched onto a node.
        onPointerCancel={(event) => dispatch('onPointerCancel', event)}
        onDblClick={(event) => dispatch('onDoubleClick', event)}
        onWheel={(event) => {
          event.preventDefault();
          dispatch('onWheel', event);
        }}
      />

      {/*
        `--stale` while a reload runs, because what is drawn is the graph being replaced.

        `start` clears the store and only notifies once it has finished, so every node here belongs to
        the board that was open a moment ago. Fading them says which of the two the spinner is about
        — without it, a centred "Loading graph…" over a perfectly crisp board reads as though *that*
        board is what is arriving.
      */}
      <div
        classList={{ 'we-graph__layer': true, 'we-graph__layer--stale': status().reloading }}
        style={{
          transform: transform(),
          /*
            Load-bearing, and inline so it cannot be lost to a stale stylesheet.

            The layer is a viewport-sized box that sits *above* the hit surface, and the camera
            translates it — so with `pointer-events: auto` it silently covers whichever region it has
            been moved over, and gestures there never reach the surface underneath. That showed up as
            a dead quadrant of the canvas once handlers moved off the root.

            Everything the layer contains is already `pointer-events: none`, and picking is geometry
            the engine owns, so the layer never needs events at all.
          */
          'pointer-events': 'none',
          // Published so anything that must keep a constant on-screen size can divide by it in CSS,
          // rather than every such element needing its own reactive computation in JS.
          '--graph-zoom': String(zoom()),
        }}
      >
        <svg class="we-graph__edges" aria-hidden="true">
          <For each={edges()}>
            {(entry) => (
              <g>
                {/*
                  A wider, transparent copy of the line under the real one — the hover mark, and the
                  reason it is a second path rather than a thicker stroke: the visible line keeps its
                  own width, so nothing about the drawing changes shape when the pointer is near it.
                */}
                <Show when={hoveredEdge() === entry.edge.id}>
                  <path
                    class="we-graph__edge-hover"
                    d={entry.path}
                    fill="none"
                    stroke={color(entry.visual.color, 'neutral-300')}
                    stroke-width={entry.visual.width * 4}
                    vector-effect={entry.visual.scaleWithZoom ? undefined : 'non-scaling-stroke'}
                  />
                </Show>
                <path
                  d={entry.path}
                  fill="none"
                  stroke={color(entry.visual.color, 'neutral-300')}
                  stroke-width={entry.visual.width}
                  stroke-opacity={entry.visual.opacity ?? 1}
                  stroke-dasharray={entry.visual.dashed ? '4 4' : undefined}
                  // SVG's own answer to "keep this stroke a constant width whatever the transform".
                  vector-effect={entry.visual.scaleWithZoom ? undefined : 'non-scaling-stroke'}
                  marker-start={entry.visual.arrow === 'both' ? 'url(#we-graph-arrow)' : undefined}
                  marker-end={entry.visual.arrow === 'none' ? undefined : 'url(#we-graph-arrow)'}
                />
              </g>
            )}
          </For>
          {/*
            The line being drawn during a connect gesture.

            Dashed, so it reads as a proposal rather than as an edge that already exists, and drawn
            straight rather than through the curve machinery: it has no endpoints to bow apart from
            and no direction worth stating until it lands somewhere. It is not in the store — see
            `getPendingConnection` — so nothing lays it out, routes it, or counts it.
          */}
          <Show when={pending()}>
            {(line) => (
              <line
                x1={line().from.x}
                y1={line().from.y}
                x2={line().to.x}
                y2={line().to.y}
                stroke="var(--we-color-primary-500)"
                stroke-width="2"
                stroke-dasharray="6 4"
                vector-effect="non-scaling-stroke"
              />
            )}
          </Show>
          <defs>
            <marker
              id="we-graph-arrow"
              viewBox="0 0 10 10"
              // Base at the path end, not tip. The stroke is shortened by the same length in
              // `backOff`, so the line meets the arrowhead instead of running under it.
              refX="0"
              refY="5"
              markerWidth={ARROW_LENGTH}
              markerHeight={ARROW_LENGTH}
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--we-color-neutral-400)" />
            </marker>
          </defs>
        </svg>

        {/*
          Edge labels are DOM, not SVG `<text>`.

          They were SVG, and jittered for seconds after a zoom while everything around them moved
          cleanly — the browser rasterises SVG text into a cached texture and re-renders it at the new
          scale on its own schedule, which nothing on our side can hurry. Node labels never had the
          problem because they are ordinary HTML text, re-laid out with the transform.
          One text pipeline for the whole graph is the fix, rather than a third attempt at persuading
          the SVG one.

          Only labelled edges produce an element, so an unlabelled graph pays nothing.
        */}
        <For each={edges().filter((entry) => entry.visual.label)}>
          {(entry) => (
            <span
              class="we-graph__edge-label"
              style={{
                // Second translate centres the element on the midpoint. A percentage *margin* would
                // resolve against the containing block's width rather than the label's own, which is
                // the classic way to almost centre something.
                transform: `translate(${entry.route.mid.x}px, ${entry.route.mid.y}px) translate(-50%, -50%)`,
                color: color(entry.visual.labelColor, 'neutral-500'),
              }}
            >
              {entry.visual.label}
            </span>
          )}
        </For>

        <For each={nodes()}>
          {(entry) => (
            <div
              class="we-graph__node"
              classList={{
                'we-graph__node--selected': entry.selected,
                'we-graph__node--hovered': hovered() === entry.node.id,
                'we-graph__node--unresolved': entry.node.unresolved === true,
                'we-graph__node--card': entry.visual.shape === 'card',
                // Held state has to be visible — a node the layout will not move, looking exactly
                // like one it will, is a graph behaving differently for no reason you can see, and
                // the reason is usually a drag somebody forgot making. Only where it is an exception,
                // though: under a layout that reads positions from the data every node is placed, so
                // the same mark lands on all of them and says nothing.
                'we-graph__node--pinned': entry.at.fixed === true && engine.pinningIsMeaningful(),
              }}
              style={{
                transform: `translate(${boxOf(entry).x}px, ${boxOf(entry).y}px)`,
                '--node-size': `${entry.visual.size * 2}px`,
                '--node-width': `${boxOf(entry).width ?? entry.visual.size * 2}px`,
                '--node-height': `${boxOf(entry).height ?? entry.visual.size * 2}px`,
                '--node-color': color(entry.visual.color, 'primary-500'),
                '--node-border': color(entry.visual.borderColor, 'transparent'),
                '--node-border-width': `${entry.visual.borderWidth ?? 0}px`,
                '--node-radius': nodeRadius(entry.visual),
                '--content-scale': String(entry.visual.contentScale ?? 1),
                '--node-label-color': color(entry.visual.labelColor, 'neutral-800'),
                '--node-label-size': `${entry.visual.labelSize ?? 12}px`,
                '--label-scale': entry.visual.scaleLabelWithZoom ? '1' : 'calc(1 / var(--graph-zoom))',
                /*
                  Published for the drawn parts to read rather than set here, because `opacity`
                  composites the *whole* subtree and this element is not only the node — it also
                  anchors the resize handles and the action buttons.

                  A faded card is a statement about the record: unsettled, not yours yet. Faded
                  controls on top of it say the controls are unavailable, which is the opposite of
                  true — they are the way to settle it. So the fade goes on what is drawn and the
                  chrome anchored beside it stays legible.
                */
                '--node-opacity': String(entry.visual.opacity ?? 1),
              }}
              title={entry.visual.label}
            >
              {/*
                A card carries its text *inside* the box — the post-it, where the content is the node
                rather than a caption attached to a mark. Everything else keeps the label underneath,
                which is what keeps a dense map readable when the marks are 8px across.
              */}
              <Show
                when={entry.visual.shape === 'card'}
                fallback={
                  <>
                    <div class="we-graph__dot">
                      <Show when={entry.visual.image}>
                        <img class="we-graph__image" src={entry.visual.image} alt="" />
                      </Show>
                      <Show when={!entry.visual.image && entry.hasMore}>
                        {/* An open node with more to give says so — otherwise a paged expansion looks
                            identical to one that returned everything. */}
                        <span class="we-graph__more">+</span>
                      </Show>
                    </div>
                    <span class="we-graph__label">{entry.visual.label}</span>
                  </>
                }
              >
                <div class="we-graph__card">
                  {/*
                    The card's real content, when a style rule named one and the host supplies it.

                    Falls back to the label rather than to nothing — a card whose content component
                    is missing, or whose data has not arrived, still has to say what it is. That is
                    also what makes `contentMinZoom` cheap: below the threshold the card draws one
                    string instead of a document, which is all that is legible at that size anyway.
                  */}
                  <Show
                    when={cardContent(entry.visual)}
                    fallback={<span class="we-graph__card-text">{entry.visual.label}</span>}
                  >
                    {(Content) => (
                      <div class="we-graph__card-content">
                        {/*
                          The scale lives on an inner element because it has to change the box the
                          content is *laid out* in, not just how large the result is drawn. Scaling
                          the clipping element would shrink the drawing and leave the same amount of
                          text in it; a wider inner box at a smaller scale is what fits more of the
                          document into the same card.
                        */}
                        <div class="we-graph__card-scale">
                          <Dynamic component={Content()} node={entry.node} />
                        </div>
                      </div>
                    )}
                  </Show>
                  <Show when={entry.hasMore}>
                    <span class="we-graph__more we-graph__more--card">+</span>
                  </Show>
                </div>
              </Show>
              {/*
                Resize handles, on a selected card only.

                Only when the template is listening: a handle that moved and then changed nothing is
                worse than no handle. Only on the selection, because handles on every card would put
                grab targets over the content of each one — and selecting first is how you say which
                card you mean anyway.

                Eight of them, because an edge and a corner are different requests: an edge changes
                one dimension, a corner changes both. The corners are marked and the edges are not —
                an edge is a strip along the side of the card, found by the cursor changing, which is
                what every canvas tool does and what keeps a selected card from being ringed with
                furniture.
              */}
              <Show when={props.onNodeResize && entry.selected && entry.visual.shape === 'card'}>
                <For each={HANDLES}>
                  {(handle) => (
                    <div
                      class={`we-graph__resize we-graph__resize--${handle.id}`}
                      title="Resize"
                      onPointerDown={(event) => beginResize(event, entry, handle.grip)}
                    />
                  )}
                </For>
              </Show>
              {/*
                The node's own controls, above it, while it is selected.

                Above rather than over: a card's content is the reason it is on the board, and
                furniture inside the box hides the thing being decided about. Above the top edge is
                also where nothing else is — the resize handles ring the box, so a toolbar on any
                other side would sit on one of them.

                `matches` is the style rules' own clause, so which controls a node offers is written
                in the vocabulary that already decides how it looks. Filtered per node rather than
                once, because that is the point: a suggestion gets a tick and a cross, everything
                else gets whatever the interface offers for an ordinary card.
              */}
              <Show when={entry.selected && actionsFor(entry.node).length > 0}>
                <div class="we-graph__actions">
                  <For each={actionsFor(entry.node)}>
                    {(action) => (
                      <button
                        type="button"
                        class="we-graph__action"
                        classList={{ 'we-graph__action--danger': action.danger === true }}
                        title={action.title ?? action.id}
                        aria-label={action.title ?? action.id}
                        /*
                          `pointerdown`, stopped, as well as the click.

                          The canvas hit-tests in world space from a pointer press on the layer
                          beneath, so a press that reached it would start a drag of the very node
                          this button sits above — the button would work and the card would move.
                        */
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          const at = parseAddress(entry.node.id);
                          props.onNodeAction?.({
                            action: action.id,
                            id: entry.node.id,
                            ...(at?.kind === 'entity' && { recordId: at.id, recordType: at.type }),
                          });
                        }}
                      >
                        <we-icon name={action.icon} size="14px" />
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>

      {/*
        Chrome is design-system, canvas is not — and the line is drawn on cost, not taste.

        Everything below is ordinary UI that appears once, so it is `Column`/`Row` with design-system
        props and primitives inside: the theme reaches it, and there is no stylesheet to keep in sync.

        The canvas above is not. `we-graph__layer` is re-transformed every frame, and `we-graph__node`
        exists once per node — at a two-thousand-node budget that is two thousand component instances
        wrapping two thousand divs, on the hottest path in the system. They also have to survive a
        canvas renderer that has no elements at all. So they stay raw, and the SCSS that remains is
        exactly that: the canvas, plus where these overlays sit.
      */}
      <Show when={controls().length > 0}>
        <Column position="absolute" right={past('right')} bottom={past('bottom')} gap="100">
          <For each={controls()}>
            {(control) => {
              /*
                Recomputed against the live scene rather than captured once.

                A toggle has to redraw when what it reflects changes, and what it reflects is engine
                state — the selection for `pin`, the lock for `lock`. Reading it through the same
                signals everything else here depends on is what makes the button follow a selection
                made by clicking a node, rather than only by pressing the button itself.
              */
              const state = createMemo(() => {
                version();
                statusVersion();
                const ctx = controlContext();
                return {
                  active: control.active?.(ctx) ?? false,
                  enabled: control.enabled?.(ctx) ?? true,
                };
              });
              return (
                <we-button
                  variant={state().active ? 'primary' : 'secondary'}
                  size="sm"
                  square
                  disabled={!state().enabled}
                  title={(state().active && control.activeTitle) || control.title}
                  onClick={() => control.run(controlContext())}
                >
                  <we-icon name={(state().active && control.activeIcon) || control.icon} size="sm" />
                </we-button>
              );
            }}
          </For>
        </Column>
      </Show>

      <Show
        when={props.showStatus !== false && (backgroundLoading() || status().budgetReached || status().warnings.length)}
      >
        <Column
          class="we-graph__status"
          pointerEvents="none"
          position="absolute"
          left={past('left')}
          bottom={past('bottom')}
          gap="100"
          maxWidth="60%"
        >
          {/*
            Only ever background work. The whole-graph case is announced in the middle of the canvas
            instead — see `loadingWholeGraph` — and showing both would be one load reported twice.
          */}
          <Show when={backgroundLoading()}>
            <Row
              ay="center"
              gap="200"
              bg="surface-raised"
              border="1px solid border"
              shadow="sm"
              r="200"
              px="300"
              py="200"
            >
              <we-spinner size="xs" />
              <we-text variant="footnote" color="text-muted">
                Loading…
              </we-text>
            </Row>
          </Show>
          <Show when={status().budgetReached}>
            <we-alert variant="warning">Node limit reached — collapse something to keep exploring</we-alert>
          </Show>
          <For each={status().warnings}>{(warning) => <we-alert variant="warning">{warning}</we-alert>}</For>
        </Column>
      </Show>

      {/*
        One box for two states that must never both appear, and never both be absent.

        "Loading" and "nothing to show" answer the same question — why is there nothing here — and as
        two independent conditions they drifted: the empty state was suppressed while loading, so a
        first load left the middle of the canvas genuinely blank and the only word for it was a
        footnote in the far corner. Branching inside one centred box makes them exclusive by
        construction rather than by two conditions agreeing.

        Covers the whole canvas, so it must not intercept anything — an empty graph is still one you
        can pan and drop things onto.
      */}
      <Show when={loadingWholeGraph() || !nodes().length}>
        <Column
          pointerEvents="none"
          position="absolute"
          top="0"
          left="0"
          width="100%"
          height="100%"
          ax="center"
          ay="center"
        >
          <Show
            when={loadingWholeGraph()}
            fallback={
              <Column ax="center" ay="center" gap="200" maxWidth="34ch" px="400">
                <we-icon name={props.emptyIcon ?? 'graph'} size="lg" color="text-faint" />
                <we-text variant="footnote" color="text-faint" textAlign="center">
                  {props.empty ?? 'Nothing to show yet.'}
                </we-text>
              </Column>
            }
          >
            {/*
              Held back for a moment before it appears — see the stylesheet. A seed answered from a
              local cache resolves inside a frame, and a spinner that flashes on every fast load is
              worse than none at all.
            */}
            <Column class="we-graph__loading" ax="center" ay="center" gap="200">
              <we-spinner size="lg" />
              <we-text variant="footnote" color="text-muted">
                Loading graph…
              </we-text>
            </Column>
          </Show>
        </Column>
      </Show>
    </div>
  );
}

export type { GraphNode };
