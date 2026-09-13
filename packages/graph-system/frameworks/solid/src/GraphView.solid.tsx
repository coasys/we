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
import { ROLE_NAMES } from '@we/design-utils';
import { dragSession } from '@we/drag';
import type { EdgeWaypoint } from '@we/graph-core';
import {
  bendPoints,
  connectionTarget,
  DEFAULT_CONTROLS,
  defaultBehaviours,
  defaultControls,
  defaultMetrics,
  dispatchPointer,
  distanceToEdge,
  edgeVisual,
  endOf,
  GraphEngine,
  matches,
  nodeVisual,
  PluginRegistry,
  polyline,
  readField,
  resolveStyle,
  routesAlike,
  splineThrough,
  waypointFromWorld,
  waypointsOf,
  waypointToWorld,
} from '@we/graph-core';
import { DEFAULT_REIFIED_EDGES, defaultExpanders } from '@we/graph-expanders';
import { defaultLayouts } from '@we/graph-layouts';
import type {
  Behaviour,
  CardShape,
  ControlContext,
  EdgeGeometry,
  EdgeSide,
  GraphNode,
  GraphValue,
  Point,
  PointerInput,
} from '@we/graph-protocol';
import { cardSilhouette, parseAddress } from '@we/graph-protocol';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { createStore, reconcile, type SetStoreFunction } from 'solid-js/store';
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
  const { from, control, control2, elbows, segments } = route;
  const to = endGap > 0 ? backOff(route, endGap) : route.to;
  /*
    A hand-shaped route: one command per segment, and the last one ends where the arrowhead does.

    First, because a route with segments carries none of the other three fields — they describe one
    span between two nodes and this is several.
  */
  if (segments) {
    const drawn = segments.map((segment, index) => {
      const end = index === segments.length - 1 ? to : segment.to;
      return segment.control && segment.control2
        ? `C ${segment.control.x} ${segment.control.y} ${segment.control2.x} ${segment.control2.y} ${end.x} ${end.y}`
        : `L ${end.x} ${end.y}`;
    });
    return `M ${from.x} ${from.y} ` + drawn.join(' ');
  }
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
  const { to, control, control2, elbows, segments } = route;
  // The closing tangent of whichever shape this is. For a hand-shaped route that is the last
  // segment's second control, or the point before it when the leg is straight.
  const last = segments?.[segments.length - 1];
  const previous =
    (last && (last.control2 ?? (segments!.length > 1 ? segments![segments!.length - 2].to : route.from))) ??
    elbows?.[elbows.length - 1] ??
    control2 ??
    control ??
    route.from;
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
 * Stroke width of the connect gesture's preview.
 *
 * Named because it is used twice and the two have to agree: `markerUnits` defaults to `strokeWidth`,
 * so the arrowhead is `ARROW_LENGTH` multiples of it, and the stroke is shortened by exactly that
 * much so the line meets the head instead of running under it. See `backOff`.
 */
const PENDING_WIDTH = 2;

/**
 * How near a node's centre an anchor drag counts as "no side at all", as a fraction of its half-size.
 *
 * The way back out. An anchor overrules the geometry for as long as it exists, so there has to be a
 * gesture that removes one, and dragging the end back onto the card it belongs to is the one nobody
 * has to be taught. Well inside the rim, so aiming at a side is never accidentally a clear.
 */
const CLEAR_ANCHOR_WITHIN = 0.45;

/** Radius of an edge's endpoint grip, in screen pixels. Divided by the camera where it is drawn. */
const ANCHOR_HANDLE_R = 5;

/**
 * Radius of the invisible circle that actually takes the press, in screen pixels.
 *
 * The same split the connect dots make, and for the same reason said differently: the dot is a
 * *hint* and the target is what a mouse has to land on. Painted at five pixels they were smaller
 * than the cursor covering them, so aiming at one was guesswork and a miss grabbed the card behind
 * it or panned the canvas — which reads as the handle not working rather than as having been missed.
 *
 * Twelve rather than the connect dots' fifteen: several of these can sit along one line, and a
 * target greedy enough to swallow the presses meant for its neighbours trades one aiming problem
 * for another.
 */
const HANDLE_HIT_R = 12;

/** How far a card's connect dot sits off its edge, in screen pixels — `--reach` in the stylesheet. */
const CONNECT_DOT_REACH = 20;

/**
 * How far outside a card a dragged endpoint still snaps to it, in screen pixels.
 *
 * The sides a drag is aiming at sit *outside* the box — an anchor stands off the rim so an arrowhead
 * lands on the card rather than inside it — so a snap armed only over the card body would arm past
 * the thing it is aiming for. Roughly the standoff plus a thumb's worth of slack.
 */
const ANCHOR_SNAP_REACH = 24;

/**
 * How far above the handle a tooltip is anchored, in screen pixels.
 *
 * Enough for the plate to clear the grip rather than rest on it. Not a fix for the flicker — that
 * was the tooltip taking the pointer, and is answered in the stylesheet — but a plate touching the
 * dot it describes reads as part of it.
 */
const TOOLTIP_LIFT = 6;

/**
 * How near its own route a dragged waypoint has to be dropped to be removed, in screen pixels.
 *
 * Generous, because this is the way back from a bend somebody did not mean to add, and a gesture
 * that has to be aimed is one people stop trusting. Nothing is lost by being wrong in this direction:
 * a point removed by accident is one drag from existing again.
 */
const REMOVE_WAYPOINT_WITHIN = 10;

/** A waypoint's grip, and the hollow one that stands for a gap. Screen pixels; divided by the camera. */
const WAYPOINT_HANDLE_R = 5;
const WAYPOINT_GHOST_R = 4;

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

/**
 * A **role** first, then a scale position, then raw CSS.
 *
 * The same precedence the design system's own resolver uses, and it was missing here — every colour
 * in a graph resolved to `--we-color-<token>`, so a style rule could only ever name a scale
 * position. That is the one thing a scale position cannot do: it is a step on a ramp that flips with
 * the theme's polarity, so cards picked to look like pale tints in a light theme came out as deep
 * ones in a dark theme, and no choice of number fixes both. A role is what a theme *redefines*.
 *
 * Scale positions stay, and stay right for what they are for: a palette, where the colours mean
 * "different from each other" rather than "this kind of thing".
 *
 * Unknown names fall through to `--we-color-<token>` exactly as before, so nothing that worked
 * stops — including a name this build's role list has not heard of.
 */
export function color(value: string | undefined, fallback: string): string {
  /*
    `||`, not `??`: an empty value means "nothing chosen" and should reach the fallback, where `??`
    took it as a choice and returned it. And the fallback is resolved by the same rules rather than
    returned raw — every caller passes a role name (`page`), so returning it untouched produced
    `background: page`, which is not a colour. Unreachable while every caller also passes a value,
    which is the kind of trap that waits for the caller that does not.
  */
  const token = value || fallback;
  if (!token) return '';
  /*
    A CSS colour, passed through untouched.

    The modern functions were missing — `oklch()`, `oklab()`, `lab()`, `lch()`, `hwb()`, `color()` —
    so a card fill written in one became `var(--we-color-oklch(90% 0.06 150))`, which is not a
    variable and paints nothing. Silent, and reachable by a person rather than only by an author:
    `we-color-picker` emits **oklch** as one of its four formats, so picking a colour for a card in
    that format left the card uncoloured with nothing to say why.
  */
  if (/^#/.test(token)) return token;
  if (/^(rgba?|hsla?|oklch|oklab|lch|lab|hwb|color|color-mix|var)\(/i.test(token)) return token;
  if (/^(transparent|currentcolor)$/i.test(token)) return token;
  if (ROLE_NAMES.has(token)) return `var(--we-role-${token})`;
  return `var(--we-color-${token})`;
}

/**
 * The arrowhead a line in this colour uses — an id per colour rather than per edge, since a marker
 * is shared by every line drawn in it.
 *
 * Sanitised rather than interpolated: a colour is `oklch(90% 0.06 150)` or `#86c2ff`, and an id
 * carrying a bracket, a percent or a hash makes `url(#…)` reference nothing — the arrowhead would
 * simply not be drawn, with no error. The same silent class as a colour that resolves to no
 * variable, one layer along.
 */
/**
 * The edge whose endpoint grip is under a point — the one exception to "nodes win".
 *
 * An endpoint can sit *inside* a node's box: a cut card's outline is inset from the box it is cut
 * out of, so an edge anchored to a triangle's left side ends 45px in from that box's left edge. The
 * grip is drawn there, and grips are only drawn while the edge is hovered — so the pointer crossed
 * into the box, the hover cleared, and the handle it was reaching for vanished before it arrived.
 * The anchor could be set once and never changed again.
 *
 * A grip beating the node under it is the rule the rest of the chrome already follows: the resize
 * handles and the connect dots sit over the card and take their own presses. This is that rule for
 * the one control drawn in the edge layer rather than in the node's.
 *
 * Nearest wins where two ends are within reach of each other, so a short edge between two cards
 * hands the press to the end actually being aimed at.
 */
export function edgeEndAt(
  at: Point,
  edges: readonly { edge: { id: string }; route: { from: Point; to: Point } }[],
  reach: number,
): string | null {
  let nearest: string | null = null;
  let best = reach;
  for (const entry of edges) {
    for (const end of [entry.route.from, entry.route.to]) {
      const distance = Math.hypot(end.x - at.x, end.y - at.y);
      if (distance <= best) {
        best = distance;
        nearest = entry.edge.id;
      }
    }
  }
  return nearest;
}

export function arrowId(stroke?: string): string {
  return stroke ? `we-graph-arrow-${stroke.replace(/[^a-z0-9]+/gi, '-')}` : 'we-graph-arrow';
}

export function GraphView(props: GraphViewProps) {
  let surface: HTMLDivElement | undefined;

  const [version, setVersion] = createSignal(0);
  const [viewportVersion, setViewportVersion] = createSignal(0);
  const [statusVersion, setStatusVersion] = createSignal(0);
  const [connectionVersion, setConnectionVersion] = createSignal(0);
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = createSignal<string | null>(null);
  /**
   * The anchor being dragged, and then the one just written — held until the data says the same.
   *
   * One draft rather than a map: an anchor drag is a pointer gesture, and there is exactly one
   * pointer. It outlives the gesture on purpose — see `setEdgeOverlay` for why letting go at the
   * release would snap the line back for a round trip and then move it again.
   */
  const [anchorDraft, setAnchorDraft] = createSignal<{ id: string; patch: Record<string, GraphValue> } | null>(null);
  /**
   * What the handle under the pointer does, and where it is — for the tooltip that says so.
   *
   * Both gestures a handle carries are invisible: dragging an end onto another card re-attaches the
   * connection, and double-clicking a point removes it. Neither is guessable, and a gesture nobody
   * can find is one that may as well not exist.
   */
  const [handleHint, setHandleHint] = createSignal<{ at: Point; text: string } | null>(null);
  /**
   * The connection a handle gesture is under way on — its edge id, or `connect` for a new line.
   *
   * Two jobs, both of which need the gesture to outlive the pointer's whereabouts. The hint is
   * raised by the pointer entering a handle, and a dragged end now *follows* the pointer — so the
   * handle arrives back under the cursor on every frame and re-raises the plate it was dismissed
   * with, leaving a tooltip parked over the drag for the whole of it; a gesture being performed has
   * nothing left to explain. And the grips are shown while the edge is hovered or has a draft
   * pending, neither of which is reliably true mid-drag: a snap that happens to match what is stored
   * settles the draft on the spot, and the handles would vanish from under the finger holding them.
   */
  const [gesturing, setGesturing] = createSignal<string | null>(null);

  /**
   * True only while `focus` is selecting something — see the effect that applies it.
   *
   * Declared above the engine because the engine's event handler reads it, and a `let` read before
   * its declaration throws. Emission is synchronous, so a flag set around the call is exact: every
   * event raised while it is up was raised by the selection this graph made on the interface's behalf.
   */
  let applyingFocus = false;

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
            // `recordType` beside `recordId`, as every other payload here carries them — a template
            // that wants to *do* something with the record needs its class: `$query` cannot ask what
            // type an id is, and neither can `recordStore.displays`. Double-click and the node
            // actions both carried it already; this was the one that made a caller reach for the
            // double-click handler to answer a single click's question.
            ...(at?.kind === 'entity' && { recordId: at.id, recordType: at.type }),
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
          // Not while `focus` is selecting: the interface asked for this selection, and hearing it
          // back is an echo — a harmful one when a line is chosen, since clearing the node selection
          // reports an empty list and an interface reads that as "close the panel".
          if (applyingFocus) break;
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

  /**
   * The edge whose route is open for editing.
   *
   * Declared **after** the engine, like every other memo that reads it. `createMemo` runs its body
   * eagerly, so one written up beside the signals it looks like — `hovered`, `hoveredEdge` — reaches
   * a `const` that is not initialised yet and takes the whole app down with a `ReferenceError`
   * before anything renders. The signals can sit there because they read nothing.
   *
   * On the general version rather than a channel of its own: `selection` is one of the reasons that
   * falls through to it, and a fourth signal would be a fourth thing to keep in step for a value
   * that changes on a click.
   */
  const selectedEdge = createMemo(() => {
    version();
    return engine.getSelectedEdge();
  });

  /*
    Rebuilt when the behaviour specs change by value, and never otherwise.

    A behaviour is stateful — `drag-node` holds the card being dragged, `select` the press it is
    waiting to see released — so building a fresh set drops whatever gesture is under way. And a
    re-read of `props.behaviours` is not evidence that anything changed: the schema renderer hands a
    component all its props through one memo, so *any* prop moving re-runs every read of every other.
    On the workshop's canvas that meant a card let go of mid-drag whenever the pending suggestions
    or the lens rules re-resolved — frozen wherever it was, with no `onNodeDragEnd` to save it.

    The key is a string, so its memo stops propagation when nothing changed; the build reads the
    specs untracked, since the key has already said everything about them worth reacting to. An
    armed `connect-nodes` still rebuilds when its `armed` flips, which is the change that matters.
  */
  const behaviourKey = createMemo(() => JSON.stringify(props.behaviours ?? DEFAULT_BEHAVIOURS));
  const behaviours = createMemo<Behaviour[]>(() => {
    behaviourKey();
    const specs = untrack(() => props.behaviours ?? DEFAULT_BEHAVIOURS);
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
    user was working in, which is exactly the failure that made a canvas impossible to build on.

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
    canvas changes which part of it is clear, and a card parked afterwards should land in the part
    that is clear *now*.
  */
  createEffect(() => engine.viewport.setObscured(props.host?.obscured?.()));

  /**
   * What `focus` names, if the graph holds it yet: the element standing for that record, and the
   * world point to bring into view.
   *
   * A node first, then a line. A record is drawn as one or the other on any given graph, never both —
   * a reified class collapses into an edge precisely so it does not also appear as a dot — so the
   * order only matters if that ever stopped being true, and a card is the less surprising answer.
   *
   * A line's point is the midpoint of its ends. For a route bent round a card that is not on the
   * line itself, but it is between the two things the line joins, which is what bringing a
   * connection into view is for.
   */
  function focusTarget(recordId: string): { kind: 'node' | 'edge'; id: string; at: Point } | null {
    const positions = engine.getPositions();
    for (const node of engine.store.nodes()) {
      const address = parseAddress(node.id);
      if (address?.kind !== 'entity' || address.id !== recordId) continue;
      const at = positions.get(node.id);
      if (at) return { kind: 'node', id: node.id, at: { x: at.x, y: at.y } };
    }
    const geometry = engine.getEdgeGeometry();
    for (const edge of engine.store.edges()) {
      if (!edge.reifiedAs) continue;
      const behind = parseAddress(edge.reifiedAs);
      if (behind?.kind !== 'entity' || behind.id !== recordId) continue;
      const route = geometry.get(edge.id);
      if (route) {
        return {
          kind: 'edge',
          id: edge.id,
          at: { x: (route.from.x + route.to.x) / 2, y: (route.from.y + route.to.y) / 2 },
        };
      }
    }
    return null;
  }

  /** How far inside the clear part of the canvas a point must be to count as already in view. */
  const REVEAL_MARGIN = 48;

  /**
   * Centre a world point in the part of the canvas nobody is covering — unless it is already there.
   *
   * The margin is what "already there" means. A card whose centre is two pixels inside the edge is
   * technically on screen and practically not: most of it is cut off. Nothing moves for anything
   * comfortably inside, which is what makes binding `focus` to a click's own selection a no-op.
   *
   * No surface yet, no move. Before the canvas has been measured the clear rectangle is empty, every
   * point is outside it, and centring against a zero-sized box would throw the camera somewhere
   * arbitrary for the fit that follows to correct.
   */
  function revealPoint(world: Point): void {
    const clear = engine.viewport.visibleRect();
    if (!clear.width || !clear.height) return;
    const screen = engine.viewport.toScreen(world);
    const inside =
      screen.x >= clear.x + REVEAL_MARGIN &&
      screen.x <= clear.x + clear.width - REVEAL_MARGIN &&
      screen.y >= clear.y + REVEAL_MARGIN &&
      screen.y <= clear.y + clear.height - REVEAL_MARGIN;
    if (inside) return;
    engine.behaviourContext().pan(clear.x + clear.width / 2 - screen.x, clear.y + clear.height / 2 - screen.y);
  }

  /**
   * Apply `focus` — once per value, and as soon as the graph holds what it names.
   *
   * Reads `version()` so it runs again as the graph fills in: a line written a moment ago is not
   * drawn until the canvas re-reads, and a link opened cold names a card the first load has not
   * reached. Each run that finds nothing waits for the next.
   *
   * `applied` is what stops it applying again once it has. Without it every redraw — and a live graph
   * redraws whenever the data changes — would re-centre on the focused card, so somebody panning away
   * from it would be dragged back by the next write anyone made. Set *before* selecting, because
   * selecting bumps `version` and the run that causes would otherwise see an unapplied value.
   *
   * Cleared when `focus` empties, so the same record named again — a background click, then the same
   * card chosen from the panel — is applied again rather than taken for the one already done.
   */
  let applied: string | undefined;
  /**
   * The focus value the selection was last cleared for, while what it names is not on the graph.
   *
   * Clearing once rather than on every run: a card somebody then selects by hand while the named
   * record is still missing must stay selected, not be swept away by the next redraw.
   */
  let clearedFor: string | undefined;
  createEffect(() => {
    version();
    const recordId = props.focus;
    if (!recordId) {
      applied = undefined;
      clearedFor = undefined;
      return;
    }
    if (recordId === applied) return;
    const target = untrack(() => focusTarget(recordId));

    applyingFocus = true;
    try {
      if (!target) {
        /*
          Named, and not here — so whatever *is* selected is not what the interface is showing.

          The case is ordinary: an inspector listing a card's connections opens a record that lives on
          another canvas. Left alone, the canvas goes on ringing the card somebody came from while the
          panel beside it describes a different one, and the two read as one statement that is false.
          Nothing selected is the true answer.

          It may also just be early — a line written a moment ago — in which case the selection is
          made as soon as the record arrives, and the gap between is a frame of nothing selected.
        */
        if (clearedFor !== recordId) {
          clearedFor = recordId;
          if (engine.getSelection().length || engine.getSelectedEdge()) engine.select([]);
        }
        return;
      }
      applied = recordId;
      if (target.kind === 'node') {
        const selection = engine.getSelection();
        if (selection.length !== 1 || selection[0] !== target.id) engine.select([target.id]);
      } else {
        // `selectEdge` returns early for the line already open, so no guard is needed here.
        engine.selectEdge(target.id);
      }
    } finally {
      applyingFocus = false;
    }
    untrack(() => revealPoint(target.at));
  });

  /**
   * The graph's own chrome, kept out from under whatever the host has floating over the canvas.
   *
   * The status strip sits at the bottom-left of the graph's box, which on the workshop's canvas is
   * behind the transcript panel: a warning nobody could read, about a canvas that was working. Same
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
    One row per node, kept across ticks.

    `nodes()` builds a fresh entry per node every time the engine's version moves — a settle, a
    reload, a drag frame — and `<For>` keys by reference, so every card's DOM was torn down and
    rebuilt on each tick. That cost was invisible until something in a card held state of its own:
    a header control's popup, or the colour picker's, closed by itself a few seconds after opening,
    on the next watch reload.

    So each node gets a row that lives as long as the node does, holding its entry in a store; a
    tick reconciles the store rather than replacing the row. The JSX below reads `entry.x` exactly
    as before and every read is tracked through the proxy, so a changed position or selection still
    repaints only what it touches — and everything else, controls included, stays mounted.

    Reconciled inside the memo rather than in an effect, because the rows have to be current on the
    same pass the list is read, or a frame would draw the new list with the old entries.
  */
  type NodeEntry = ReturnType<typeof nodes>[number];
  const rowsById = new Map<string, { entry: NodeEntry; set: SetStoreFunction<NodeEntry> }>();
  const nodeRows = createMemo(() => {
    const fresh = nodes();
    const seen = new Set<string>();
    const rows = fresh.map((entry) => {
      const id = entry.node.id;
      seen.add(id);
      let row = rowsById.get(id);
      if (!row) {
        const [store, set] = createStore(entry);
        row = { entry: store, set };
        rowsById.set(id, row);
      } else {
        row.set(reconcile(entry));
      }
      return row;
    });
    for (const id of rowsById.keys()) if (!seen.has(id)) rowsById.delete(id);
    return rows;
  });

  /**
   * The rows whose chrome is drawn. The same row objects, so a tick that leaves the selection alone
   * leaves the chrome mounted — a picker the bar opened stays open, for the reason the rows exist.
   */
  const selectedRows = createMemo(() => nodeRows().filter((row) => row.entry.selected));

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

  /*
    The anchor draft, handed to the engine so the line follows it, and dropped once it is redundant.

    The same shape as the node overlay above and settled by the same question — asked of the edge's
    *seeded* data, since the one the renderer draws already carries the draft and would report every
    anchor confirmed the instant it was applied.
  */
  createEffect(() => {
    version();
    const draft = anchorDraft();
    if (!draft) return;
    const raw = engine.store.edge(draft.id);
    /*
      Settled means the stored data already *routes* the same, not that the fields are spelled the
      same — which is why this asks `routesAlike` rather than `isSettled`. Clearing an anchor writes
      `''` and the seed answers by omitting the field altogether, so compared literally a clear could
      never settle and the overlay would outlive the graph.
    */
    /*
      An endpoint the draft has moved is settled when the edge itself says so.

      `routesAlike` asks about the fields one canvas draws with, and a re-attachment is not one of
      them — the claim changed, so the edge comes back from the seed attached somewhere else. Asking
      only the data would call the move settled on the frame it was made, drop the overlay, and snap
      the end back to the card it came from until the write returned.
    */
    const endsArrived = (['source', 'target'] as const).every((end) => {
      const wanted = draft.patch[end];
      return typeof wanted !== 'string' || !wanted || raw?.[end] === wanted;
    });
    /*
      A draft holding a loose end is never settled — the pointer is still down.

      Nothing stored can agree with a point that is wherever the cursor is, and the fields *beside*
      it can: dragging an end back to the side it was already on writes an anchor identical to the
      stored one, which without this reads as "nothing left to preview", drops the overlay, and
      leaves the line frozen for the rest of the gesture.
    */
    const loose = ['sourceX', 'sourceY', 'targetX', 'targetY'].some((key) => key in draft.patch);
    if (raw && !loose && endsArrived && routesAlike(raw.data, { ...raw.data, ...draft.patch })) {
      setAnchorDraft(null);
      engine.setEdgeOverlay(new Map());
      return;
    }
    // Only when it would change something. `setEdgeOverlay` notifies, which re-runs this — so an
    // unconditional call is an infinite loop rather than a redundant one.
    const applied = engine.edgeOverlayFor(draft.id);
    const same =
      applied &&
      Object.entries(draft.patch).every(([field, value]) => applied[field] === value) &&
      Object.keys(applied).length === Object.keys(draft.patch).length;
    if (!same) engine.setEdgeOverlay(new Map([[draft.id, draft.patch]]));
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

  /**
   * The colours the arrowheads have to exist in — the distinct ones anybody has asked for.
   *
   * Only edges that carry a colour of their own: an ordinary graph asks for none, emits no extra
   * markers, and keeps the default head it has always had, which is deliberately a shade darker
   * than the line it finishes.
   */
  const arrowColors = createMemo(() => [
    ...new Set(
      edges()
        .map((entry) => entry.visual.color)
        .filter((value): value is string => !!value),
    ),
  ]);

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
   * component trees, and at the zoom where a canvas is a wall of coloured rectangles not one of them
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
    // The note: rounded enough that choosing it over a square is visible on the card itself.
    return 'var(--we-radius-500)';
  }

  /**
   * The shapes a radius cannot make, as fractions of the card's box, clockwise from the top.
   *
   * One set of points, from which **four** things are derived so they cannot disagree: the clip the
   * card is cut to, the ring drawn behind it when it is hovered or selected, the floats its text
   * wraps to, and — since the table moved to `@we/graph-protocol` — where an edge attaches. The
   * fourth was the reason it moved: routing met the card's *box*, which is the shape a card is cut
   * out of, so a line stopped 45px short of a triangle's side. A round card is not cut — its radius
   * draws it — but it flows, so it gets points of its own below.
   */
  /** Points in the box's own 0..1 space, as the shared table gives them. */
  type Outline = readonly (readonly [number, number])[];
  type Shaped = { shape: string; cardShape?: string };
  const cutPoints = (visual: Shaped) =>
    visual.shape === 'card' ? cardSilhouette(visual.cardShape as CardShape | undefined) : undefined;
  const pct = (value: number) => `${Math.round(value * 10000) / 100}%`;

  /** The polygon a card is cut to. A clip rather than a drawn outline, so the card stays a box. */
  function nodeClip(visual: Shaped): string {
    const points = cutPoints(visual);
    return points ? `polygon(${points.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(', ')})` : 'none';
  }

  /** The outline text wraps to: a cut shape's own points, or an ellipse sampled for a round card. */
  function flowPoints(visual: Shaped): Outline | undefined {
    if (visual.shape !== 'card') return undefined;
    if (visual.cardShape === 'round') {
      const steps = 24;
      return Array.from({ length: steps }, (_, i) => {
        const angle = -Math.PI / 2 + (i / steps) * Math.PI * 2;
        return [0.5 + 0.5 * Math.cos(angle), 0.5 + 0.5 * Math.sin(angle)] as const;
      });
    }
    return cutPoints(visual);
  }

  /**
   * The exterior of the shape on each side, for the floats — see `.we-graph__card-flow`.
   *
   * Each float is half the card wide and the full content height, and its polygon is the chain of
   * outline points down its side — from the topmost point to the bottommost, taking the rightmost
   * of a flat top for the right float and the leftmost for the left — closed along the box's outer
   * edge, in the float's own coordinates, since that is what `shape-outside` measures in: the
   * card's 25% is the left float's 50%. A point the other side of the middle clamps to the float's
   * edge, so a chain can never claim space it does not border.
   */
  function nodeFlow(visual: Shaped): { left: string; right: string } {
    const points = flowPoints(visual);
    if (!points) return { left: 'none', right: 'none' };
    const n = points.length;
    const pick = (better: (a: readonly [number, number], b: readonly [number, number]) => boolean) =>
      points.reduce((best, p, i) => (better(p, points[best]) ? i : best), 0);
    const topRight = pick((a, b) => a[1] < b[1] || (a[1] === b[1] && a[0] > b[0]));
    const bottomRight = pick((a, b) => a[1] > b[1] || (a[1] === b[1] && a[0] > b[0]));
    const topLeft = pick((a, b) => a[1] < b[1] || (a[1] === b[1] && a[0] < b[0]));
    const bottomLeft = pick((a, b) => a[1] > b[1] || (a[1] === b[1] && a[0] < b[0]));
    // Clockwise from one index to another, inclusive.
    const chain = (from: number, to: number) => {
      const out: (readonly [number, number])[] = [];
      for (let i = from; ; i = (i + 1) % n) {
        out.push(points[i]);
        if (i === to) break;
      }
      return out;
    };
    const right = chain(topRight, bottomRight).map(([x, y]) => `${pct(Math.max(0, (x - 0.5) * 2))} ${pct(y)}`);
    const left = chain(bottomLeft, topLeft)
      .reverse()
      .map(([x, y]) => `${pct(Math.min(1, x * 2))} ${pct(y)}`);
    return {
      left: `polygon(0 0, ${left.join(', ')}, 0 100%)`,
      right: `polygon(100% 0, ${right.join(', ')}, 100% 100%)`,
    };
  }

  /**
   * The ring behind a cut shape: the same outline pushed out by a constant distance.
   *
   * Pushed out, not scaled. A scaled copy moves a flat edge by the whole enlargement and a steep one
   * by a fraction of it, which is why a triangle's base had a ring and its sides barely did. Each
   * edge is shifted along its own outward normal by `ring`, and each corner is where two shifted
   * edges meet — so every edge is the same thickness and every corner is sharp. In pixels of the
   * card's box, plus the pad the pseudo-element is inset by, since that is the box it is clipped in.
   */
  function ringClip(visual: Shaped, width: number, height: number, ring: number, pad: number): string {
    const points = cutPoints(visual);
    if (!points) return 'none';
    const px = points.map(([x, y]) => ({ x: x * width, y: y * height }));
    const n = px.length;
    // Each edge, shifted: a point on it and its direction.
    const edges = px.map((from, i) => {
      const to = px[(i + 1) % n];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      // Outward for a clockwise polygon in screen coordinates.
      const nx = dy / length;
      const ny = -dx / length;
      return { x: from.x + nx * ring, y: from.y + ny * ring, dx, dy };
    });
    const corners = edges.map((edge, i) => {
      const prev = edges[(i - 1 + n) % n];
      // Where the previous shifted edge meets this one.
      const det = prev.dx * edge.dy - prev.dy * edge.dx;
      if (Math.abs(det) < 1e-9) return { x: edge.x, y: edge.y };
      const t = ((edge.x - prev.x) * edge.dy - (edge.y - prev.y) * edge.dx) / det;
      return { x: prev.x + prev.dx * t, y: prev.y + prev.dy * t };
    });
    const round = (value: number) => Math.round(value * 100) / 100;
    return `polygon(${corners.map((c) => `${round(c.x + pad)}px ${round(c.y + pad)}px`).join(', ')})`;
  }

  /**
   * Width over height for a shape drawn true — what a resize holds to while the key is down.
   *
   * A circle and a square are 1. A regular hexagon with its points left and right, and an
   * equilateral triangle, are both 2/√3 wide for their height; a regular pentagon is a little
   * wider than tall. Held to 1 those came out squashed, which is what a square is to a hexagon.
   */
  function shapeRatio(visual: Shaped): number {
    if (visual.shape !== 'card') return 1;
    switch (visual.cardShape) {
      case 'triangle':
      case 'hexagon':
        return 2 / Math.sqrt(3);
      case 'pentagon':
        return 1.0515;
      default:
        return 1;
    }
  }

  /**
   * How far in from each side a block that cannot flow — an image, an embed — should sit, so it
   * lands in the largest rectangle the shape holds. Text needs none of this: it wraps to the floats
   * the stylesheet lays along the outline.
   */
  function nodeInset(visual: Shaped): string {
    if (visual.shape !== 'card') return '0';
    switch (visual.cardShape) {
      case 'triangle':
      case 'diamond':
      case 'hexagon':
        return '25%';
      case 'pentagon':
        return '18%';
      case 'round':
        return '15%';
      default:
        return '0';
    }
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
   * only notifies at the end, so the graph on screen during a canvas switch is the *old* graph, and
   * saying so in a corner is how a stale canvas gets read as a live one. `loading` with no nodes is
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
  /**
   * The four edges a connection can be drawn from, as the DOM knows them, and the arrow each shows.
   *
   * Midpoints rather than corners, because the corners are the resize grips — an affordance for
   * "make this bigger" and one for "join this to something" sharing a pixel is a coin toss every
   * time somebody reaches for either.
   *
   * A named arrow per edge rather than one glyph turned four ways. It was a CSS chevron — two
   * borders on a rotated square — with a one-pixel nudge per edge to correct for its mass sitting on
   * two sides rather than in the middle. A `translate` after a `rotate` applies in the *rotated*
   * frame, so all four nudges came out as the same 1.4px sideways shove in screen space: right for
   * the east arrow by luck, and visibly off-centre on the other three. An arrow that is centred in
   * its own box needs no correction, and four names cost less than the arithmetic that was wrong.
   */
  const CONNECT_EDGES = [
    { edge: 'n', icon: 'arrow-up' },
    { edge: 'e', icon: 'arrow-right' },
    { edge: 's', icon: 'arrow-down' },
    { edge: 'w', icon: 'arrow-left' },
  ] as const;

  /**
   * Drag a connection out of one edge of a card.
   *
   * A DOM handle rather than the `connect-nodes` behaviour, and the difference is the whole reason
   * this exists. That behaviour claims a press *anywhere on a node*, so it has to be armed — a mode
   * switch somebody turns on to connect and off to go back to moving cards, which is a thing to
   * remember and a thing to forget. A grab area that only exists on the edge of a selected card
   * needs no mode: the gesture is unambiguous because the target is.
   *
   * Everything after the press is the same machinery the behaviour uses, reached through
   * `behaviourContext` exactly as the resize handles reach `pin`: the same preview line, the same
   * world-space hit test, and the same `edgeCreate` event — so a connection drawn this way is
   * indistinguishable downstream from one drawn any other, and a template needs no second handler.
   */
  function beginConnect(event: PointerEvent, entry: { node: GraphNode }) {
    setHandleHint(null);
    setGesturing('connect');
    // Never reaches the canvas dispatcher: the node under the handle is the node being connected
    // *from*, so a press that fell through would also start dragging it across the canvas.
    event.stopPropagation();
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture?.(event.pointerId);
    const ctx = engine.behaviourContext();
    const source = entry.node.id;

    // Surface-relative, like `toInput` — the canvas sits inside a template with panels and headers,
    // and page coordinates would put every hit test out by however much chrome precedes it.
    const at = (moved: PointerEvent) => {
      const box = surface?.getBoundingClientRect();
      return { x: moved.clientX - (box?.left ?? 0), y: moved.clientY - (box?.top ?? 0) };
    };

    const move = (moved: PointerEvent) => {
      // The same guard the behaviour keeps: a dropped pointer-up would otherwise leave a line
      // following the cursor around the canvas with no way to put it down.
      if (moved.buttons === 0) {
        ctx.drawConnection(null);
        setHovered(null);
        return;
      }
      const world = ctx.toWorld(at(moved));
      ctx.drawConnection(source, world);
      /*
        Marking the card under the line, here, because nothing else can while this gesture runs.

        `onPointerMove` is the only writer of `hovered` and it is bound to `.we-graph__surface`,
        which is a *sibling* of the layer holding the cards and these handles. The press sets pointer
        capture on the handle, so every move that follows is retargeted into that subtree and reaches
        the surface's listener never — the highlight froze wherever it was when the drag began, and
        came back only once the gesture was over and the pointer moved again. Which reads as a drag
        that is not working, since the line is the half that never broke.

        Through `connectionTarget`, so what lights up is what a release would actually connect to:
        the source card is refused, and so is empty canvas. A mark that promised a connection the
        drop then declines is worse than no mark.
      */
      setHovered(connectionTarget(ctx.hitTest(world)[0], source));
    };

    const end = (ended: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setGesturing(null);
      const [hit] = ctx.hitTest(ctx.toWorld(at(ended)));
      ctx.drawConnection(null);
      // The gesture owned the mark; it does not own what happens next. The surface re-establishes it
      // on the next move, and a drop that opens a dialog leaves no card lit behind it.
      setHovered(null);
      const target = connectionTarget(hit, source);
      if (!target) return;
      ctx.emit({
        type: 'edgeCreate',
        source: { id: source, kind: 'entity', type: '' },
        target: { id: target, kind: 'entity', type: '' },
      });
    };

    /*
      On `window`, not on the handle — and this is what made the drop do nothing.

      A press sets pointer capture, which *usually* routes the rest of the gesture back to the
      element it started on. Usually is not good enough here: the handle is a node in a list the
      renderer rebuilds, it is inside a subtree whose `:hover` sizing changes the moment the pointer
      leaves it, and capture is released outright if the element goes away. Any of those and the
      `pointerup` lands somewhere with no listener, so the line follows the cursor to another card
      and releasing it does nothing at all — which is exactly the failure, and it is invisible,
      because the half of the gesture that draws worked fine.

      The window sees the release wherever it happens. Capture stays because it keeps the events
      coming while the element does exist, and they bubble up to here either way.
    */
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /**
   * Which side of a box a point is on, by the direction from its centre.
   *
   * The diagonals divide it, so a card is four triangles rather than four bands — which is what makes
   * a corner unambiguous, and what makes the answer change where the pointer visibly crosses. Scaled
   * by the box's own half-extents first, so a wide card's top is reached by going *up* rather than by
   * getting past its length: unscaled, the north triangle of a 400×100 card is a sliver nobody can
   * aim at.
   *
   * Inside a small middle the answer is nothing, which is how an anchor is cleared: drag the end back
   * onto the card and let go. There has to be some way back, and a fifth region beats a fifth control.
   */
  function sideOf(at: Point, centre: Point, halfWidth: number, halfHeight: number): EdgeSide | '' {
    const dx = (at.x - centre.x) / Math.max(halfWidth, 1);
    const dy = (at.y - centre.y) / Math.max(halfHeight, 1);
    if (Math.hypot(dx, dy) < CLEAR_ANCHOR_WITHIN) return '';
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'e' : 'w') : dy >= 0 ? 's' : 'n';
  }

  /**
   * Drag one end of a connection around a node's rim, pinning the side it attaches to.
   *
   * A handle on the line's own endpoint rather than something on the card, because the question is
   * about *this* connection: a card with four connections leaving it has four answers, and a control
   * on the card could only ask one of them.
   *
   * Deliberately not set by which of the four connect dots a connection was dragged out of. Today you
   * grab whichever is nearest and the edge still routes sensibly; pinning that silently would hand
   * people connectors leaving the top of a card and looping around, for having picked the closest
   * handle. Anchoring is its own act, and the dots stay hints.
   *
   * Previewed through the engine's edge overlay rather than by drawing something beside the line, so
   * what moves under the pointer is the connection itself — and the same overlay then holds the
   * answer while the write goes round the data layer and comes back. See `setEdgeOverlay`.
   */
  function beginAnchor(event: PointerEvent, edgeId: string, end: 'source' | 'target') {
    // Nothing to explain once the gesture is under way, and a plate over the drag is in the way.
    setHandleHint(null);
    setGesturing(edgeId);
    // Never reaches the canvas dispatcher: a press here would otherwise also be a press on whatever
    // is under it, which for an endpoint is the node this edge attaches to.
    event.stopPropagation();
    event.preventDefault();
    const edge = engine.store.edge(edgeId);
    if (!edge) return;
    const nodeId = end === 'source' ? edge.source : edge.target;
    // The box the renderer is drawing, not one derived again — a card being dragged carries a live
    // position, and asking the engine's settled one would measure the sides against where it was.
    const entry = nodes().find((row) => row.node.id === nodeId);
    if (!entry) return;
    const box = boxOf(entry);
    const centre = { x: box.x, y: box.y };
    const halfWidth = (box.width ?? entry.visual.size * 2) / 2;
    const halfHeight = (box.height ?? entry.visual.size * 2) / 2;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);

    const field = end === 'source' ? 'sourceAnchor' : 'targetAnchor';
    // The end that is staying put: what a re-attachment must not land on, since a connection from a
    // card to itself is not a thing the graph can draw or the data can hold. `connectionTarget`'s rule.
    const opposite = end === 'source' ? edge.target : edge.source;
    const at = (moved: PointerEvent) => {
      const surfaceBox = surface?.getBoundingClientRect();
      return engine.viewport.toWorld({
        x: moved.clientX - (surfaceBox?.left ?? 0),
        y: moved.clientY - (surfaceBox?.top ?? 0),
      });
    };
    let side: EdgeSide | '' = '';
    let landing: string | null = null;
    /** Whether the pointer is somewhere a release would attach to — see the note in `move`. */
    let armed = false;

    /*
      Merge into whatever the draft already holds, and drop the loose point.

      Merged rather than replaced so pinning one end and then the other does not lose the first end's
      preview while its write is still in flight; and the loose point is cleared in the same write,
      because it only ever describes a pointer that is still down. Left behind, it would outrank the
      side that was just chosen and hold the end at the last place the cursor was.
    */
    const draft = (patch: Record<string, GraphValue>) => {
      setAnchorDraft((previous) => {
        const held = previous?.id === edgeId ? { ...previous.patch } : {};
        delete held[`${end}X`];
        delete held[`${end}Y`];
        return { id: edgeId, patch: { ...held, ...patch } };
      });
    };

    const move = (moved: PointerEvent) => {
      if (moved.buttons === 0) return;
      const world = at(moved);
      /*
        Over another card, this stops being an anchor drag and becomes a re-attachment.

        The standard behaviour everywhere connectors exist, and the handle was already tracking the
        pointer — it simply ignored everything outside its own card. Back over its own card, or over
        nothing, it is an anchor drag again.
      */
      const over = connectionTarget(engine.index.hitTest(world)[0], opposite);
      landing = over && over !== nodeId ? over : null;
      // The candidate says so by lighting up — the mark a card already carries for being under the
      // pointer, so there is nothing new to learn and nothing new to draw.
      setHovered(landing);
      side = sideOf(world, centre, halfWidth, halfHeight);
      /*
        Loose between the cards, snapped once it is over one — and that is the whole gesture.

        Free movement is what makes a drag feel like a drag rather than a five-way switch, and it is
        also what leaves somebody guessing: a line ending under the cursor says nothing about where
        it would attach if they let go. So the two are split by where the pointer is. Over open
        canvas the end follows it exactly. Over a card — its own or another — it jumps to where a
        release would actually put it and stays there while the pointer moves around inside, which is
        the answer to "is it safe to drop here", drawn as the thing itself rather than as a marker
        beside it.

        Its own card gets a margin, because the sides are *outside* the box: without one the snap
        would only arm once the cursor was over the card body, past the anchors it is aiming at.
        Another card does not, since being over it is what a re-attachment already means on release —
        one rule, so the preview cannot promise what the drop refuses.
      */
      const margin = ANCHOR_SNAP_REACH / engine.viewport.get().zoom;
      const onOwn =
        Math.abs(world.x - centre.x) <= halfWidth + margin && Math.abs(world.y - centre.y) <= halfHeight + margin;
      armed = Boolean(landing) || onOwn;
      const snapped = landing ? { [end]: landing, [field]: '' } : onOwn ? { [end]: '', [field]: side } : null;
      /*
        Off every card the end is held loose and nothing is pinned yet — including the anchor, which
        is why the previous field is left alone rather than written from `side`. `sideOf` answers for
        any point on the canvas, so writing it here would pin a side from a cursor nowhere near the
        card and undo the snap the moment the pointer left it.
      */
      draft(snapped ?? { [end]: '', [`${end}X`]: world.x, [`${end}Y`]: world.y });
    };

    const finish = () => {
      // On `window` for the reason `beginConnect`'s listeners are: capture is released outright if
      // the element goes away, and this one is inside a list the renderer rebuilds on every reroute —
      // which this gesture causes on every frame of itself.
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setGesturing(null);
      setHovered(null);
      const behind = edge.reifiedAs ? parseAddress(edge.reifiedAs) : null;
      const connection = behind?.kind === 'entity' ? { recordId: behind.id, recordType: behind.type } : {};
      const arrived = landing ? parseAddress(landing) : null;
      /*
        A re-attachment rewrites the *claim*; an anchor rewrites how one canvas draws it.

        Two scopes on one gesture, decided by where it was let go, and worth being explicit about:
        "this connection actually goes there" is an edit to what the relationship asserts, so it
        changes on every canvas and for everyone. Where it *attaches* is this canvas's business alone.
      */
      if (landing && arrived?.kind === 'entity' && arrived.id && props.onEdgeRetarget) {
        // The end settles onto the card it was dropped on, and the preview holds it there until the
        // write comes back round the data layer as an edge attached somewhere else.
        draft({ [end]: landing, [field]: '' });
        props.onEdgeRetarget({
          id: edgeId,
          end,
          ...connection,
          nodeId: arrived.id,
          // Empty rather than absent for an address that named no type — the store needs a type to
          // write beside the endpoint, and a missing one is a refusal it can make for itself.
          nodeType: arrived.type ?? '',
        });
        return;
      }
      /*
        Let go where nothing was offered, and nothing happens.

        The release has to agree with what the drag was showing. Off every card the end was drawn
        loose under the cursor, promising nothing — and `sideOf` answers for any point on the canvas,
        so anchoring anyway would pin a side chosen by a cursor nowhere near the card, which is a
        decision nobody made. So the preview is dropped and the line goes back to what is stored.

        This is also the exit from the gesture: pull the end off into open space and let go.
      */
      if (!armed) {
        setAnchorDraft((previous) => {
          if (previous?.id !== edgeId) return previous;
          const held = { ...previous.patch };
          for (const key of [end, field, `${end}X`, `${end}Y`]) delete held[key];
          return { id: edgeId, patch: held };
        });
        return;
      }
      /*
        Otherwise it was an anchor drag — including a drop on another card that nothing is listening
        for. A canvas that has not wired re-attachment would otherwise swallow the gesture whole,
        leaving the end previewed on a card it never moved to, so the preview is withdrawn here
        rather than left for a write that is not coming.
      */
      draft({ [end]: '', [field]: side });
      props.onEdgeAnchor?.({ id: edgeId, end, side, ...connection });
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  /**
   * Drag a point on a connection, adding one where there was none.
   *
   * `index` is where the point sits in the stored list; `insert` says whether the press was on an
   * existing point or on the line between two, which is how a route grows without a separate "add a
   * point" mode. Miro's gesture, and the reason it needs no instruction: the line is the control.
   *
   * Previewed through the same edge overlay the anchors use, so what moves under the pointer is the
   * connection itself and the shape holds while the write goes round the data layer.
   *
   * **Dropped back onto the line it came from, a point is removed.** An added bend has to be
   * removable by the gesture that made it, or the only way back from a mis-click is a menu; and
   * "this point is doing nothing" is a thing the shape already says, which is why the test is
   * geometric rather than a modifier key. Double-clicking one removes it too — see the markup.
   */
  function beginWaypoint(event: PointerEvent, edgeId: string, index: number, insert: boolean) {
    // Nothing to explain once the gesture is under way, and a plate over the drag is in the way.
    setHandleHint(null);
    setGesturing(edgeId);
    event.stopPropagation();
    event.preventDefault();
    const edge = engine.store.edge(edgeId);
    if (!edge) return;
    const patch = engine.edgeOverlayFor(edgeId);
    // The frame a point is stored in, resolved the way the router resolves it — an end whose
    // re-attachment has not come back from the data layer yet is where the overlay says, not where
    // the store does, and reading past that would place the point against the wrong two ends.
    const source = endOf(patch, 'source', edge.source);
    const target = endOf(patch, 'target', edge.target);
    const from = source.loose ?? engine.getPositions().get(source.node);
    const to = target.loose ?? engine.getPositions().get(target.node);
    if (!from || !to) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);

    const stored = waypointsOf({ ...edge.data, ...patch });
    const at = (moved: PointerEvent) => {
      const surfaceBox = surface?.getBoundingClientRect();
      return engine.viewport.toWorld({
        x: moved.clientX - (surfaceBox?.left ?? 0),
        y: moved.clientY - (surfaceBox?.top ?? 0),
      });
    };
    let points = stored;
    let removing = false;

    const move = (moved: PointerEvent) => {
      if (moved.buttons === 0) return;
      const world = at(moved);
      const next = [...stored];
      const point = waypointFromWorld(world, { x: from.x, y: from.y }, { x: to.x, y: to.y });
      if (insert) next.splice(index, 0, point);
      else next[index] = point;
      /*
        Back on the line, and it goes.

        Measured against the shape the remaining points make, rather than against the straight chord:
        on a line already bent twice, "on the line" means on the curve its neighbours draw, which is
        nowhere near the chord. With no points left it *is* the chord — an approximation of the
        derived curve, which is close enough for a ten-pixel tolerance and is exact at both ends.

        Only for a point that already existed: an insert that never left the line simply never
        becomes one, so there is nothing to undo.
      */
      removing = !insert && nearRoute(next, index, world, { x: from.x, y: from.y }, { x: to.x, y: to.y });
      points = removing ? next.filter((_, at) => at !== index) : next;
      setAnchorDraft({ id: edgeId, patch: { waypoints: JSON.stringify(points) } });
    };

    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setGesturing(null);
      // A press that never moved is not an edit. Without this, clicking a handle to look at it
      // would write the route back unchanged and cost a round trip for nothing.
      if (points === stored) return;
      const behind = edge.reifiedAs ? parseAddress(edge.reifiedAs) : null;
      props.onEdgeReroute?.({
        id: edgeId,
        points,
        ...(behind?.kind === 'entity' && { recordId: behind.id, recordType: behind.type }),
      });
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  /**
   * The grips on one route: a filled one per waypoint, a hollow one in each gap between them.
   *
   * `index` is where a drag would write into the stored list, which is the same number for both
   * kinds — a point at index *i* is replaced, and a gap at index *i* is inserted before it. That is
   * what lets one gesture serve moving and adding.
   *
   * The gaps are placed on the drawn route rather than half-way between the points, so a hollow grip
   * sits on the line somebody is looking at. `polyline` samples whatever shape this is, so the same
   * arithmetic serves a spline, a polyline and an orthogonal route.
   */
  function waypointHandles(edgeId: string, route: EdgeGeometry): { index: number; at: Point; insert: boolean }[] {
    const edge = engine.store.edge(edgeId);
    if (!edge) return [];
    /*
      Resolved through `endOf`, exactly as the router resolves them.

      A waypoint is stored in the edge's own frame, so placing one means knowing where that frame's
      two ends are — and while an end is being dragged, they are not where the store says. Reading
      the settled positions left the grips frozen at the old endpoints while the line they belong to
      moved with the pointer, which is the whole reason this resolution lives in the core.
    */
    const patch = engine.edgeOverlayFor(edgeId);
    const source = endOf(patch, 'source', edge.source);
    const target = endOf(patch, 'target', edge.target);
    const from = source.loose ?? engine.getPositions().get(source.node);
    const to = target.loose ?? engine.getPositions().get(target.node);
    if (!from || !to) return [];
    const points = waypointsOf({ ...edge.data, ...patch });
    const world = points.map((point) => waypointToWorld(point, { x: from.x, y: from.y }, { x: to.x, y: to.y }));
    const handles = world.map((at, index) => ({ index, at, insert: false }));
    /*
      One offer per gap — before the first point, between each pair, and after the last — placed by
      measuring where the existing points fall along the drawn line rather than by dividing it into
      equal lengths. `bendPoints` carries the reasoning; the short of it is that a point sits
      wherever somebody put it, so the k-th equal division is not the k-th gap, and an offer drawn in
      the wrong gap splices its new point at an index the pointer was never near.
    */
    const gaps = bendPoints(polyline(route), world).map((at, index) => ({ index, at, insert: true }));
    return [...handles, ...gaps];
  }

  /** Take one point out of a route — the double-click path. See `beginWaypoint` for the other. */
  function removeWaypoint(edgeId: string, index: number) {
    const edge = engine.store.edge(edgeId);
    if (!edge) return;
    const points = waypointsOf({ ...edge.data, ...engine.edgeOverlayFor(edgeId) }).filter((_, at) => at !== index);
    setAnchorDraft({ id: edgeId, patch: { waypoints: JSON.stringify(points) } });
    const behind = edge.reifiedAs ? parseAddress(edge.reifiedAs) : null;
    props.onEdgeReroute?.({
      id: edgeId,
      points,
      ...(behind?.kind === 'entity' && { recordId: behind.id, recordType: behind.type }),
    });
  }

  /**
   * Where a card's connect dot sits in the world, for the tooltip to point at.
   *
   * Derived here rather than measured, because the dot is placed by CSS — `left`/`top` off the
   * node's own box plus a reach in screen pixels — and asking the DOM for it would mean reading a
   * layout back out of the thing that just wrote it. The same two numbers, said once more.
   */
  function connectDotAt(entry: { node: GraphNode }, edge: 'n' | 'e' | 's' | 'w'): Point {
    const row = nodes().find((candidate) => candidate.node.id === entry.node.id);
    const box = row ? boxOf(row) : { x: 0, y: 0, width: 0, height: 0 };
    const half = { x: (box.width ?? 0) / 2, y: (box.height ?? 0) / 2 };
    // `--reach` in the stylesheet, in screen pixels, so it is divided by the camera exactly as the
    // dot itself is. One number in two places is a drift waiting to happen; it is small enough that
    // a tooltip a few pixels out is invisible, and naming it here is what makes that a decision.
    const reach = CONNECT_DOT_REACH / zoom();
    return {
      x: box.x + (edge === 'e' ? half.x + reach : edge === 'w' ? -(half.x + reach) : 0),
      y: box.y + (edge === 's' ? half.y + reach : edge === 'n' ? -(half.y + reach) : 0),
    };
  }

  /** Whether a point has been dropped back onto the route its neighbours would draw without it. */
  function nearRoute(points: EdgeWaypoint[], index: number, world: Point, from: Point, to: Point): boolean {
    const without = points.filter((_, at) => at !== index);
    const through = [from, ...without.map((point) => waypointToWorld(point, from, to)), to];
    const route = { id: '', from: through[0], to: through[through.length - 1], curve: 'smooth' as const, mid: world };
    const shape = without.length ? { ...route, segments: splineThrough(through) } : route;
    return distanceToEdge(world, shape) <= REMOVE_WAYPOINT_WITHIN / engine.viewport.get().zoom;
  }

  function beginResize(
    event: PointerEvent,
    entry: {
      node: GraphNode;
      at: { x: number; y: number };
      visual: { shape: string; cardShape?: string; width?: number; height?: number };
    },
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
      // Held to the shape's own proportions while the key is down — a circle, a square, a regular
      // hexagon — see `shapeRatio`.
      const next = resizeBox({ at: entry.at, width, height }, grip, delta, MIN_CARD, {
        ...(moved.ctrlKey ? { ratio: shapeRatio(entry.visual) } : {}),
      });
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

  /**
   * Where a node is and how large, as the style both its own element and its chrome's are placed by.
   *
   * One function for the two because the chrome is a separate element now (see the layer after the
   * nodes), and a handle positioned from a second copy of this arithmetic would drift off its card
   * the first time one of the copies changed — during a resize, say, which is exactly when both are
   * being read every frame.
   */
  function anchorStyle(entry: NodeEntry): JSX.CSSProperties {
    const box = boxOf(entry);
    return {
      transform: `translate(${box.x}px, ${box.y}px)`,
      '--node-width': `${box.width ?? entry.visual.size * 2}px`,
      '--node-height': `${box.height ?? entry.visual.size * 2}px`,
    };
  }

  /** This graph's endpoint grips, at the camera's scale — see `edgeEndAt`. */
  const edgeEndUnder = (at: Point): string | null =>
    props.onEdgeAnchor ? edgeEndAt(at, edges(), HANDLE_HIT_R / zoom()) : null;

  function dispatch(phase: Parameters<typeof dispatchPointer>[1], event: PointerEvent | WheelEvent | MouseEvent) {
    dispatchPointer(behaviours(), phase, toInput(event), engine.behaviourContext());
  }

  /**
   * The delete key, on whatever is selected.
   *
   * The graph's only keyboard, and it is deliberately one key. A canvas is operated by pointing at
   * it; what a keyboard buys here is the accelerator for the one action whose alternative — reach
   * for the panel, find the control — is disproportionate to how often it is wanted.
   *
   * **On the surface rather than on `window`.** The alternative was tempting and wrong: a document
   * listener would fire while somebody is typing a label into the inspector beside the canvas, so a
   * Backspace mid-word would delete the record the word is about. Guarding that by sniffing
   * `event.target` for editability is a list of element names that is wrong the first time a control
   * puts its input in a shadow root. Focus is the question actually being asked — is the canvas what
   * the keyboard is aimed at — so focus is what answers it.
   *
   * The listener writes nothing. See `onDeleteSelection` for why the graph reports rather than acts.
   */
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const report = props.onDeleteSelection;
    if (!report) return;

    /*
      The edge first, and then the nodes — never both.

      `selectEdge` clears the node selection and `select` clears the edge, so at most one of these is
      ever non-empty. Asking in this order is belt and braces rather than a rule: if that invariant
      ever broke, deleting the line somebody can see handles is the less surprising of the two.
    */
    const edgeId = engine.getSelectedEdge();
    if (edgeId) {
      const edge = engine.store.edge(edgeId);
      // The record behind the line, as `edgeClick` resolves it. Absent on an ordinary edge, which
      // stands for a declared relation and has no record to delete — the payload then carries a
      // count and no ids, and the interface says so rather than removing something else.
      const behind = edge?.reifiedAs ? parseAddress(edge.reifiedAs) : null;
      event.preventDefault();
      report({
        count: 1,
        kind: 'edge',
        ...(behind?.kind === 'entity' && { recordId: behind.id, recordType: behind.type }),
      });
      return;
    }

    const ids = engine.getSelection();
    if (!ids.length) return;
    // Only an entity node stands for a record. A property, a literal or a synthetic cluster has
    // nothing to delete, so it reports as a selection with no id rather than as no press at all.
    const at = ids.length === 1 ? parseAddress(ids[0]) : null;
    event.preventDefault();
    report({
      count: ids.length,
      ...(ids.length === 1 && { kind: 'node' as const }),
      ...(at?.kind === 'entity' && { recordId: at.id, recordType: at.type }),
    });
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
    const edge = hit ? edgeEndUnder(at) : engine.hitTestEdge(at);
    if (edge !== hoveredEdge()) setHoveredEdge(edge);
  }

  /*
    The graph as a drop target, for whatever the app's drag session carries.

    Registered here rather than by wrapping the graph in a `we-drop-zone`, because the zone hands
    its receiver a client point and a canvas needs a world one — and only this component holds the
    camera. Only while `onDrop` is bound: a graph nobody asked to receive drops should not light up
    as a target when something is carried past it. The session decides the innermost zone and fires
    exactly once, so a drop on a card lands on the canvas beneath it at the card's point, which is
    the right reading — the card was never the destination.
  */
  onMount(() => {
    if (!props.onDrop || !surface) return;
    const el = surface;
    const unregister = dragSession.registerZone({
      el,
      label: 'the canvas',
      onDrop: ({ payload, point }) => {
        const box = el.getBoundingClientRect();
        const world = engine.viewport.toWorld({ x: point.x - box.left, y: point.y - box.top });
        for (const item of payload.items) {
          props.onDrop?.({
            entity: item.ref.entity,
            id: item.ref.id,
            ...(item.ref.dataset ? { dataset: item.ref.dataset } : {}),
            label: item.label,
            x: world.x,
            y: world.y,
          });
        }
      },
    });
    onCleanup(unregister);
  });

  return (
    <div
      class="we-graph"
      ref={surface}
      style={{
        width: props.width ?? '100%',
        height: props.height ?? '100%',
        /*
          `page`, the role, not `neutral-0`, the step.

          A graph fills its route, so its ground is the route's ground — and every consumer takes
          this default, which meant every canvas in the app painted one step off whatever the
          template around it painted. On the workshop template that put the canvas visibly darker
          than the tasks and events routes beside it, because a scale position follows the theme's
          polarity and `neutral-0` is the *darkest* end in a dark theme where `page` is not.

          A step cannot follow what a theme decides a page is, and the contrast corrections at apply
          time skip it entirely. `role-audit` exists to catch exactly this and structurally cannot
          see it here: it walks composed schema trees, and this is a component's own style.
        */
        background: color(props.bg, 'page'),
      }}
    >
      {/*
        The canvas hit target. Every gesture is handled here, not on the root — see the note in the
        stylesheet for why that is what lets the chrome be an ordinary sibling rather than something
        each overlay has to opt out of.
      */}
      <div
        class="we-graph__surface"
        /*
          Focusable only where the delete key is bound — see `onDeleteSelection`.

          A graph with no answer for the key has no reason to be a tab stop, and making every one of
          them focusable would add a stop to every page holding a map, for a focus that does nothing.
          `0` rather than `-1` so the keyboard can reach it at all: a canvas only a mouse can focus is
          a canvas only a mouse can delete from.
        */
        tabIndex={props.onDeleteSelection ? 0 : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
          /*
            Pointing at the canvas is aiming the keyboard at it — which is also what takes focus off
            whatever field was being typed into, correctly: the press was on the canvas.

            `preventScroll`, because focusing an element scrolls it into view by default and this one
            fills its container. In a template where the graph sits below the fold, a click on a card
            would otherwise jump the page.
          */
          (event.currentTarget as HTMLElement).focus?.({ preventScroll: true });
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
        the canvas that was open a moment ago. Fading them says which of the two the spinner is about
        — without it, a centred "Loading graph…" over a perfectly crisp canvas reads as though *that*
        canvas is what is arriving.
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
                  marker-start={entry.visual.arrow === 'both' ? `url(#${arrowId(entry.visual.color)})` : undefined}
                  marker-end={entry.visual.arrow === 'none' ? undefined : `url(#${arrowId(entry.visual.color)})`}
                />
                {/*
                  A grip on each end, for dragging the attachment around the node's rim.

                  Only where the template is listening, like the connect dots and the resize handles:
                  a gesture that ends in nothing is worse than an affordance that was never offered.
                  On hover rather than always, for the reason the dots are on the selection — a grip
                  at both ends of every line would speckle a canvas with furniture over the cards it is
                  there to show.

                  And on the edge being dragged whatever the pointer is over, because the pointer
                  leaves the line immediately: that is the gesture.
                */}
                {/*
                  The points this route is bent through, and the gaps between them.

                  A filled handle is a point that exists; a hollow one is the middle of a leg, which
                  becomes a point the moment it is dragged. That is what lets a route grow with no
                  "add a point" mode — the line is the control, which needs no instruction.

                  On the **selected** edge rather than the hovered one, unlike the anchors: reshaping
                  is sustained work where anchoring is a flick, and grips that vanished the moment the
                  pointer left the line would be unusable for the first. Which is also why clicking a
                  line selects it — see `selectBehaviour`.
                */}
                <Show when={props.onEdgeReroute && (selectedEdge() === entry.edge.id || gesturing() === entry.edge.id)}>
                  <For each={waypointHandles(entry.edge.id, entry.route)}>
                    {(handle) => (
                      <g
                        class="we-graph__handle we-graph__handle--waypoint"
                        classList={{ 'we-graph__handle--ghost': handle.insert }}
                        onPointerDown={(event) => beginWaypoint(event, entry.edge.id, handle.index, handle.insert)}
                        // The other way to remove one, for a point somebody would rather not have to
                        // land back on the line. Both exist because they suit different moments.
                        onDblClick={(event) => {
                          if (handle.insert) return;
                          event.stopPropagation();
                          removeWaypoint(entry.edge.id, handle.index);
                        }}
                        onPointerEnter={() =>
                          setHandleHint({
                            at: handle.at,
                            text: handle.insert
                              ? 'Drag to bend the line here'
                              : 'Drag to move · double-click to remove',
                          })
                        }
                        onPointerLeave={() => setHandleHint(null)}
                      >
                        <circle
                          class="we-graph__handle-hit"
                          cx={handle.at.x}
                          cy={handle.at.y}
                          r={HANDLE_HIT_R / zoom()}
                        />
                        <circle
                          class="we-graph__handle-dot"
                          cx={handle.at.x}
                          cy={handle.at.y}
                          r={(handle.insert ? WAYPOINT_GHOST_R : WAYPOINT_HANDLE_R) / zoom()}
                          stroke-width={1.5 / zoom()}
                        />
                      </g>
                    )}
                  </For>
                </Show>
                <Show
                  when={
                    props.onEdgeAnchor &&
                    (hoveredEdge() === entry.edge.id ||
                      anchorDraft()?.id === entry.edge.id ||
                      // Held open for the whole gesture: a snap onto the side an edge is already
                      // anchored to settles the draft on the spot, and without this the grips would
                      // vanish from under the finger holding one.
                      gesturing() === entry.edge.id)
                  }
                >
                  <For each={['source', 'target'] as const}>
                    {(end) => (
                      <g
                        class="we-graph__handle we-graph__handle--anchor"
                        onPointerDown={(event) => beginAnchor(event, entry.edge.id, end)}
                        onPointerEnter={() =>
                          setHandleHint({
                            at: end === 'source' ? entry.route.from : entry.route.to,
                            text: 'Drag around the card to pin a side · onto another card to reconnect',
                          })
                        }
                        onPointerLeave={() => setHandleHint(null)}
                      >
                        {/*
                          The target, and then the dot. Two circles because they answer different
                          questions — see `HANDLE_HIT_R`; the first is invisible and takes the press,
                          the second is painted and takes none, so the paint can stay small.
                        */}
                        <circle
                          class="we-graph__handle-hit"
                          cx={end === 'source' ? entry.route.from.x : entry.route.to.x}
                          cy={end === 'source' ? entry.route.from.y : entry.route.to.y}
                          r={HANDLE_HIT_R / zoom()}
                        />
                        <circle
                          class="we-graph__handle-dot"
                          cx={end === 'source' ? entry.route.from.x : entry.route.to.x}
                          cy={end === 'source' ? entry.route.from.y : entry.route.to.y}
                          // World units over zoom, so the grip is one size on screen at every camera
                          // — the same arithmetic every other handle in here does.
                          r={ANCHOR_HANDLE_R / zoom()}
                          stroke-width={1.5 / zoom()}
                        />
                      </g>
                    )}
                  </For>
                </Show>
              </g>
            )}
          </For>
          {/*
            The line being drawn during a connect gesture.

            Routed exactly as the edge it is proposing — see `getPendingConnection` — so nothing about
            the drawing changes at the moment of commitment. It was a straight segment between two raw
            points, which became an S-curve leaving a different side of the card the instant it landed:
            a jump at the one moment somebody is deciding whether the gesture did what they meant.

            Dashed, and that is the only difference kept on purpose: it says proposal. It is still not
            in the store, so nothing lays it out, hit-tests it or counts it.

            The arrowhead says which way round the connection will be, which nothing else does — the
            highlight under the pointer names the card and not the direction. Its own marker rather
            than the edges', because that one is filled `neutral-400` and this line is not; `context-
            stroke` would say it once, and Safari does not support it.
          */}
          <Show when={pending()}>
            {(route) => (
              <path
                d={pathFrom(route(), ARROW_LENGTH * PENDING_WIDTH)}
                fill="none"
                stroke="var(--we-color-primary-500)"
                stroke-width={PENDING_WIDTH}
                stroke-dasharray="6 4"
                vector-effect="non-scaling-stroke"
                marker-end="url(#we-graph-arrow-pending)"
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
            {/*
              One head per colour anybody has actually asked for.

              A marker paints in its own right rather than inheriting from the path referencing it,
              and `context-stroke` — the one way to say it once — is SVG 2 and unsupported in Safari.
              So a coloured line kept the default grey head, which reads as a line that failed to
              finish rather than as a colour. These are generated from the edges on screen, so an
              uncoloured graph emits none of them and looks exactly as it did.
            */}
            <For each={arrowColors()}>
              {(stroke) => (
                <marker
                  id={arrowId(stroke)}
                  viewBox="0 0 10 10"
                  refX="0"
                  refY="5"
                  markerWidth={ARROW_LENGTH}
                  markerHeight={ARROW_LENGTH}
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={color(stroke, 'neutral-400')} />
                </marker>
              )}
            </For>
            {/*
              The same head in the proposal's colour. A marker paints in its own right rather than
              inheriting from the path that references it, and the one way to say it once —
              `context-stroke` — is SVG 2 and unsupported in Safari, so this is a copy on purpose.
            */}
            <marker
              id="we-graph-arrow-pending"
              viewBox="0 0 10 10"
              refX="0"
              refY="5"
              markerWidth={ARROW_LENGTH}
              markerHeight={ARROW_LENGTH}
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--we-color-primary-500)" />
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
                /*
                  A custom property, not `color` — so the default lives in the stylesheet, as a node
                  label's does.

                  It was `color(labelColor, 'neutral-500')`, and 500 is the one step on the neutral
                  ramp that a theme's polarity does not move: it is the ramp's fixed point, so the
                  same mid-grey came out in a light theme and a dark one. Legible on paper-white,
                  and on a dark canvas a label sat dimmer than every other word on screen — the
                  worst place for it, since what an edge label says is what a line *means*.

                  `DEFAULT_NODE` already argues this for node labels: a fixed step on the neutral
                  ramp gets ink right in neither polarity, and the renderer's own stylesheet does.
                  So the same shape here, and a rule that names a colour still wins.
                */
                ...(entry.visual.labelColor ? { '--edge-label-color': color(entry.visual.labelColor, '') } : {}),
              }}
            >
              {entry.visual.label}
            </span>
          )}
        </For>

        {/*
          The nodes, in a stacking context of their own — see `.we-graph__nodes`. A card's `z` orders
          it among the other cards and can never lift it over the selection chrome drawn after this.
        */}
        <div class="we-graph__nodes">
          <For each={nodeRows()}>
            {({ entry }) => (
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
                  ...anchorStyle(entry),
                  // Only where a rule chose an order; unset, document order stands, as it always has.
                  ...(entry.visual.z !== undefined ? { 'z-index': String(entry.visual.z) } : {}),
                  '--node-size': `${entry.visual.size * 2}px`,
                  '--node-color': color(entry.visual.color, 'primary-500'),
                  '--node-border': color(entry.visual.borderColor, 'transparent'),
                  '--node-border-width': `${entry.visual.borderWidth ?? 0}px`,
                  '--node-radius': nodeRadius(entry.visual),
                  '--node-clip': nodeClip(entry.visual),
                  '--node-inset': nodeInset(entry.visual),
                  '--flow-left': nodeFlow(entry.visual).left,
                  '--flow-right': nodeFlow(entry.visual).right,
                  /*
                  The ring behind a cut shape, only while it is wanted — hovered or selected — and
                  worked out at this zoom, since it is a screen-constant thickness in world units.
                  A cut shape at rest carries no ring and pays nothing for one.
                */
                  ...(() => {
                    const wanted = entry.selected ? 3 : hovered() === entry.node.id ? 2 : 0;
                    if (!wanted || nodeClip(entry.visual) === 'none') return {};
                    const scale = zoom() || 1;
                    const ring = wanted / scale;
                    const pad = ring + 1 / scale;
                    const box = boxOf(entry);
                    return {
                      '--ring-pad': `${pad}px`,
                      '--ring-clip': ringClip(
                        entry.visual,
                        box.width ?? DEFAULT_CARD_WIDTH,
                        box.height ?? DEFAULT_CARD_HEIGHT,
                        ring,
                        pad,
                      ),
                    };
                  })(),
                  '--content-scale': String(entry.visual.contentScale ?? 1),
                  /*
                  Only where a rule chose one. Left unset, the stylesheet answers: a caption under a
                  dot in the page's own text colour, and a card's text in black or white by the
                  lightness of its fill — see `.we-graph__card`. The old fixed default here was
                  `neutral-800`, which in a dark theme is near-white on a pale post-it.
                */
                  ...(entry.visual.labelColor ? { '--node-label-color': color(entry.visual.labelColor, '') } : {}),
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
                  {/*
                  Two layers. The outer is the card's box — where it is, how large, how faded — and
                  carries the selection ring. The inner is its shape: the fill, the border, the
                  radius and, for the polygons, the clip. Split because a clip cuts everything on
                  its own element, including a ring drawn around it; a ring on the box outside the
                  clip follows the shape's silhouette instead — see `.we-graph__card--cut`.
                */}
                  <div
                    class="we-graph__card"
                    classList={{
                      'we-graph__card--cut': nodeClip(entry.visual) !== 'none',
                      'we-graph__card--flow': nodeFlow(entry.visual).left !== 'none',
                    }}
                  >
                    <div class="we-graph__card-shape">
                      {/*
                    The card's real content, when a style rule named one and the host supplies it.

                    Falls back to the label rather than to nothing — a card whose content component
                    is missing, or whose data has not arrived, still has to say what it is. That is
                    also what makes `contentMinZoom` cheap: below the threshold the card draws one
                    string instead of a document, which is all that is legible at that size anyway.
                  */}
                      <div class="we-graph__card-content">
                        {/*
                        The scale lives on an inner element because it has to change the box the
                        content is *laid out* in, not just how large the result is drawn. Scaling
                        the clipping element would shrink the drawing and leave the same amount of
                        text in it; a wider inner box at a smaller scale is what fits more of the
                        document into the same card.

                        The fallback label lives in the same box as a document, so it flows to the
                        shape the same way — it used to sit outside, where no float could reach it.
                      */}
                        <div class="we-graph__card-scale">
                          {/*
                          For a shape with an outline, two floats hugging its edges — the exterior
                          on each side — so every line wraps to it. `shape-inside` does not exist;
                          this is what does.
                        */}
                          <Show when={nodeFlow(entry.visual).left !== 'none'}>
                            <div class="we-graph__card-flow we-graph__card-flow--left" />
                            <div class="we-graph__card-flow we-graph__card-flow--right" />
                          </Show>
                          <Show
                            when={cardContent(entry.visual)}
                            fallback={<span class="we-graph__card-text">{entry.visual.label}</span>}
                          >
                            {(Content) => <Dynamic component={Content()} node={entry.node} />}
                          </Show>
                        </div>
                      </div>
                      <Show when={entry.hasMore}>
                        <span class="we-graph__more we-graph__more--card">+</span>
                      </Show>
                    </div>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>

        {/*
          The selected node's chrome — resize handles, connect dots, the action bar — in a layer of
          its own, after every node.

          It used to live inside the node it belongs to, and that cannot work: each node is
          positioned with a transform, which makes it a stacking context, so nothing inside one can
          ever be drawn over a sibling however high its `z-index`. Every card later in the list
          painted over the bar, the handles and any picker the bar opened. Out here the chrome is
          above all of them, and a card's own stacking order stays what somebody chose rather than
          jumping forward whenever it is selected.

          Same anchor and the same custom properties the node publishes, so the stylesheet places
          everything exactly as it did against the node.
        */}
        <For each={selectedRows()}>
          {({ entry }) => (
            <div
              class="we-graph__chrome"
              classList={{
                /*
                  Drawing connect dots, which the action bar above the card has to clear — the dot
                  at the top edge sits exactly where the bar hung, so a selected card's bar covered
                  it and took every press meant for it. The same condition the dots themselves are
                  rendered on, and it is a class rather than a style because what CSS needs to know
                  is only whether there is a dot up there.
                */
                'we-graph__chrome--connectable': !!props.onEdgeCreate && entry.visual.shape === 'card',
              }}
              style={anchorStyle(entry)}
            >
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
              <Show when={props.onNodeResize && entry.visual.shape === 'card'}>
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

                Above rather than over: a card's content is the reason it is on the canvas, and
                furniture inside the box hides the thing being decided about. Above the top edge is
                also where nothing else is — the resize handles ring the box, so a toolbar on any
                other side would sit on one of them.

                `matches` is the style rules' own clause, so which controls a node offers is written
                in the vocabulary that already decides how it looks. Filtered per node rather than
                once, because that is the point: a suggestion gets a tick and a cross, everything
                else gets whatever the interface offers for an ordinary card.
              */}
              {/*
                A dot off each edge of a selected card: press one and drag to connect.

                Only where the template is listening, like the resize handles — a gesture that ends
                in nothing is worse than an affordance that was never offered. Only on the selection,
                for the same reason as those: dots on every card would ring the whole canvas with
                furniture over the content it is there to show, and selecting first is how you say
                which card you mean anyway.

                Off the edge rather than on it, so they do not sit on the resize strips: the corners
                and edges of the box are already a grab area for changing its size.
              */}
              <Show when={props.onEdgeCreate && entry.visual.shape === 'card'}>
                <For each={CONNECT_EDGES}>
                  {(handle) => (
                    <div
                      class={`we-graph__connect we-graph__connect--${handle.edge}`}
                      onPointerDown={(event) => beginConnect(event, entry)}
                      /*
                        The same tooltip the route handles use, rather than the `title` attribute
                        this carried. A native tooltip is the browser's: it ignores the theme
                        outright — a blue plate with a white outline over a canvas that is neither —
                        and there is no way to style one.
                      */
                      onPointerEnter={() =>
                        setHandleHint({ at: connectDotAt(entry, handle.edge), text: 'Drag to connect' })
                      }
                      onPointerLeave={() => setHandleHint(null)}
                    >
                      {/*
                        A plain screen-pixel length: the handle is laid out at its real size and
                        counter-scaled by the camera, so nothing in here divides by the zoom. See the
                        stylesheet for why that is not the same as dividing — an arrow asked for at
                        3.75px lands wherever sub-pixel snapping puts it, which is what made it drift
                        off centre the further in you zoomed. `size` takes a length as well as a
                        token, and the element writes it to its own `--icon-size`.
                      */}
                      <we-icon name={handle.icon} size="17px" />
                    </div>
                  )}
                </For>
              </Show>
              <Show when={actionsFor(entry.node).length > 0}>
                {/*
                  `pointerdown` stopped, as well as the click — on the bar, once, for everything in
                  it. The canvas hit-tests in world space from a pointer press on the layer beneath,
                  so a press that reached it would start a drag of the very node the bar sits above:
                  the button would work and the card would move. A click that reached it would
                  reselect. Here rather than per button, because a host control is arbitrary DOM
                  and the press that opens a picker needs stopping just the same.
                */}
                <div
                  class="we-graph__actions"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  {/*
                    The bar itself is a design-system row, so its padding and gap are spacing
                    tokens rather than pixels of its own; the box around it only positions it and
                    takes the presses. One bar, not a row of pills: the buttons used to be raised
                    discs each with a border and a shadow, and a host control stretched its disc
                    into whatever ellipse its contents needed.
                  */}
                  <Row ay="center" gap="0" p="200" bg="surface-raised" border="1px solid border" r="300" shadow="md">
                    <For each={actionsFor(entry.node)}>
                      {(action) => {
                        const report = (extra: { value?: unknown; preview?: boolean } = {}) => {
                          const at = parseAddress(entry.node.id);
                          props.onNodeAction?.({
                            action: action.id,
                            id: entry.node.id,
                            ...(at?.kind === 'entity' && { recordId: at.id, recordType: at.type }),
                            ...extra,
                          });
                        };
                        const control = () => (action.control ? props.host?.nodeControls?.[action.control] : undefined);
                        return (
                          <Show
                            when={control()}
                            fallback={
                              /*
                              The design system's own button, ghost and square: the bar is chrome
                              that appears once, for the selected node, so the per-node cost that
                              keeps the card itself raw does not apply. `sm` is the bar's square,
                              and the icon inside takes the size a small control gives it.

                              The two answers, coloured — a status foreground at rest, the status
                              fill on hover. Said in colour rather than only in the icon: a bin and
                              a tick the same shade is a pair of buttons you have to read before
                              pressing.
                            */
                              <we-tooltip content={action.title ?? action.id}>
                                <we-button
                                  variant="ghost"
                                  square
                                  size="md"
                                  label={action.title ?? action.id}
                                  color={
                                    action.tone === 'positive'
                                      ? 'success-text'
                                      : action.tone === 'danger'
                                        ? 'danger-text'
                                        : 'text-muted'
                                  }
                                  // Hover behaves as every other button's does; only the glyph
                                  // strengthens, from the status text role to the status fill.
                                  prop:hoverProps={
                                    action.tone === 'positive'
                                      ? { color: 'success' }
                                      : action.tone === 'danger'
                                        ? { color: 'danger' }
                                        : { color: 'text' }
                                  }
                                  onClick={() => report()}
                                >
                                  <we-icon name={action.icon ?? 'dot'} />
                                </we-button>
                              </we-tooltip>
                            }
                          >
                            {(component) => (
                              <div class="we-graph__control">
                                <Dynamic
                                  component={component()}
                                  node={entry.node}
                                  value={action.value ? readField(entry.node, action.value.from) : undefined}
                                  fill={color(entry.visual.color, 'primary-500')}
                                  title={action.title}
                                  onPreview={(value: unknown) => report({ value, preview: true })}
                                  onChange={(value: unknown) => report({ value })}
                                />
                              </div>
                            )}
                          </Show>
                        );
                      }}
                    </For>
                  </Row>
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

      {/*
        What the handle under the pointer does.

        `we-tooltip` rather than a `title` attribute or a box of our own: the native tooltip is the
        browser's, so it ignores the theme entirely — a blue plate with a white outline over a canvas
        that is neither — and a box built here would be a copy of the primitive's look that stops
        matching the first time the design system moves.

        The primitive wraps its own trigger and positions against it, so the trigger is a zero-size
        div put where the handle is. Outside the scaled layer and placed in *screen* coordinates,
        which is what keeps the tooltip one size at every zoom without any counter-scaling: it is
        chrome, and chrome is not part of the drawing.
      */}
      <Show when={!gesturing() && handleHint()}>
        {(hint) => (
          <we-tooltip
            open
            content={hint().text}
            placement="top"
            style={{
              position: 'absolute',
              left: `${engine.viewport.toScreen(hint().at).x}px`,
              // Lifted clear of the handle: the plate is placed above its trigger, and a trigger
              // sitting exactly on the dot leaves the two touching.
              top: `${engine.viewport.toScreen(hint().at).y - TOOLTIP_LIFT}px`,
              'pointer-events': 'none',
            }}
          >
            <div style={{ width: '0px', height: '0px' }} />
          </we-tooltip>
        )}
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
          {/*
            The empty state is sized as a page's placeholder, not as a footnote.

            It stands in the middle of a whole canvas — often the first thing a reader sees of a
            template — where `lg` and a footnote read as a caption for content that is about to
            appear. Icon at `xl`, body text and the narrow measure: the same scale every other
            full-surface placeholder uses, so a route that gates on one thing and a canvas that is
            empty for another do not look like two different qualities of nothing.
          */}
          <Show
            when={loadingWholeGraph()}
            fallback={
              <Column ax="center" ay="center" gap="400" maxWidth="var(--we-layout-xs)" px="400">
                <we-icon
                  name={props.emptyIcon ?? 'graph'}
                  size="xl"
                  gradient={props.emptyGradient ?? ''}
                  color={props.emptyGradient ? '' : 'text-faint'}
                />
                <we-text variant="body" color="text-muted" textAlign="center">
                  {props.empty ?? 'Nothing to show yet.'}
                </we-text>
                {/*
                  The one part of this box that takes the pointer back.

                  Everything around it is `pointerEvents: none`, because an empty graph is still one
                  you can pan and drop things onto — and a transparent sheet over the whole canvas
                  would swallow both. A control inside that sheet has to opt back in, or it renders,
                  looks pressable and does nothing.

                  `display: contents`, so the wrapper is not a box. A caller's action is usually a
                  node that decides for itself whether to draw anything — the canvas passes one
                  gated on there being no call — so a real element here would be an empty child on
                  every other reading, and the column's `gap` would put 16px of nothing under the
                  sentence. Pointer-events inherits through a contents box, which is what makes the
                  opt-in survive not having one.
                */}
                <Show when={props.emptyAction}>
                  <div style={{ display: 'contents', 'pointer-events': 'auto' }}>{props.emptyAction}</div>
                </Show>
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
