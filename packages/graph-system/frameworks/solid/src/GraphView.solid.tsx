/**
 * The Solid adapter — a thin binding over `@we/graph-core`, and nothing else.
 *
 * The engine holds all the state and all the decisions; this file subscribes to it, converts "something
 * changed" into signals, and paints. That is the same seam the schema system uses (neutral semantics,
 * per-framework adapter), and it is why a React host would be a second file of this size rather than a
 * second implementation of the engine.
 *
 * ## Why edges are SVG and nodes are DOM
 *
 * Nodes want to be real elements — that is what makes a node able to hold a schema fragment, an
 * avatar, eventually an editable block. Edges want a single retained-mode surface with sub-pixel
 * curves, which SVG gives for free. Both live inside one transformed layer so a single camera moves
 * them together and nothing has to keep two coordinate systems in agreement.
 *
 * The engine owns hit-testing rather than the DOM, so behaviours work identically whichever surface a
 * node is drawn on. That is the property that keeps a dense canvas renderer additive later.
 */
import { Column, Row } from '@we/components/solid';
import {
  defaultBehaviours,
  defaultMetrics,
  dispatchPointer,
  edgeVisual,
  GraphEngine,
  nodeVisual,
  PluginRegistry,
  resolveStyle,
} from '@we/graph-core';
import { DEFAULT_REIFIED_EDGES, defaultExpanders } from '@we/graph-expanders';
import { defaultLayouts } from '@we/graph-layouts';
import type { Behaviour, GraphEdge, GraphNode, PointerInput } from '@we/graph-protocol';
import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from 'solid-js';

import { bowOffsets, edgePath, groupByEndpoints, trimToRadius } from './geometry';
import type { GraphViewProps } from './GraphView.types';

export type * from './GraphView.types';

/** Sensible without being opinionated: look around, select things, open things. */
const DEFAULT_BEHAVIOURS = ['pan-zoom', 'select', 'expand-on-double-click'];

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
  const [hovered, setHovered] = createSignal<string | null>(null);

  // Read once: expanders are constructed with their options, so changing `reified` needs a remount —
  // which is what a template does anyway when it swaps one graph for another.
  const registry = new PluginRegistry({
    ...defaultExpanders({ reified: props.reified ?? DEFAULT_REIFIED_EDGES }),
    layouts: defaultLayouts(),
    behaviours: defaultBehaviours(),
    metrics: defaultMetrics(),
  });

  const engine = new GraphEngine({
    spec: {},
    registry,
    context: {
      // The host binding takes a plain record: it is the seam where the graph's own query shape stops
      // and the deployment's data layer begins, so it is deliberately untyped rather than importing
      // the protocol into `app-shell`.
      query: (request) => props.host?.query({ ...request }) ?? Promise.resolve([]),
      defaultDataset: () => props.host?.defaultDataset() ?? null,
      models: (dataset) => props.host?.models(dataset) ?? [],
      warn: () => undefined,
    },
    onEvent: (event) => {
      switch (event.type) {
        case 'nodeClick': {
          // The behaviour only knows an address; the template wants the node, so it is resolved
          // here where the store is in reach.
          const node = engine.store.node(event.node.id);
          if (node) props.onNodeClick?.(node);
          break;
        }
        case 'nodeDoubleClick': {
          const node = engine.store.node(event.node.id);
          if (node) props.onNodeDoubleClick?.(node);
          break;
        }
        case 'edgeClick':
          props.onEdgeClick?.(event.edge);
          break;
        case 'selectionChange':
          props.onSelectionChange?.(event.ids);
          break;
        case 'nodeDragEnd':
          props.onNodeDragEnd?.({ id: event.node.id, x: event.position.x, y: event.position.y });
          break;
        default:
          break;
      }
    },
  });

  engine.subscribe((reason) => {
    batch(() => {
      if (reason === 'viewport') setViewportVersion((n) => n + 1);
      else if (reason === 'status') setStatusVersion((n) => n + 1);
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
  });

  // Reload when what the graph *is* changes — where it starts and how far it opens. Deliberately
  // narrow: recolouring a map must never re-run its queries, and depending on the whole prop bag
  // would do exactly that. `props.layout` is read untracked so a layout swap does not land here.
  createEffect(() => {
    void props.seeds;
    void props.expansion;
    untrack(() => {
      engine.setSpec(currentSpec());
      void engine.start();
    });
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
    return [...engine.store.nodes()].flatMap((node) => {
      const at = placed.get(node.id);
      if (!at) return [];
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

  const edges = createMemo(() => {
    version();
    const placed = engine.getPositions();
    const sized = new Map(nodes().map((entry) => [entry.node.id, entry.visual.size]));
    const all = [...engine.store.edges()];
    const result: {
      edge: GraphEdge;
      path: string;
      visual: ReturnType<typeof edgeVisual>;
      mid: { x: number; y: number };
    }[] = [];

    for (const group of groupByEndpoints(all).values()) {
      const offsets = bowOffsets(group.length);
      group.forEach((edge, index) => {
        const from = placed.get(edge.source);
        const to = placed.get(edge.target);
        if (!from || !to) return;
        const visual = edgeVisual(edge, resolveStyle(edge, props.edgeStyle), engine.getMetrics());
        const end = trimToRadius(from, to, (sized.get(edge.target) ?? 14) + 6);
        result.push({
          edge,
          path: edgePath(from, end, visual.curve, offsets[index]),
          visual,
          mid: { x: (from.x + end.x) / 2, y: (from.y + end.y) / 2 },
        });
      });
    }
    return result;
  });

  const transform = createMemo(() => {
    viewportVersion();
    version();
    const { x, y, zoom } = engine.viewport.get();
    return `translate(${x}px, ${y}px) scale(${zoom})`;
  });

  const status = createMemo(() => {
    statusVersion();
    return engine.getStatus();
  });

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

  function dispatch(phase: Parameters<typeof dispatchPointer>[1], event: PointerEvent | WheelEvent | MouseEvent) {
    dispatchPointer(behaviours(), phase, toInput(event), engine.behaviourContext());
  }

  function onPointerMove(event: PointerEvent) {
    dispatch('onPointerMove', event);
    // Hover is read straight off the index rather than from DOM enter/leave, so it behaves the same
    // whether the node is an element or a painted shape.
    const [hit] = engine.index.hitTest(engine.viewport.toWorld(toInput(event).at));
    if (hit !== hovered()) setHovered(hit ?? null);
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
      onPointerDown={(event) => {
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        dispatch('onPointerDown', event);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => dispatch('onPointerUp', event)}
      onDblClick={(event) => dispatch('onDoubleClick', event)}
      onWheel={(event) => {
        event.preventDefault();
        dispatch('onWheel', event);
      }}
    >
      <div class="we-graph__layer" style={{ transform: transform() }}>
        <svg class="we-graph__edges" aria-hidden="true">
          <For each={edges()}>
            {(entry) => (
              <g>
                <path
                  d={entry.path}
                  fill="none"
                  stroke={color(entry.visual.color, 'neutral-300')}
                  stroke-width={entry.visual.width}
                  stroke-opacity={entry.visual.opacity ?? 1}
                  stroke-dasharray={entry.visual.dashed ? '4 4' : undefined}
                  marker-end={entry.visual.arrow === 'none' ? undefined : 'url(#we-graph-arrow)'}
                  onClick={() => props.onEdgeClick?.(entry.edge)}
                />
                <Show when={entry.visual.label}>
                  <text
                    class="we-graph__edge-label"
                    x={entry.mid.x}
                    y={entry.mid.y}
                    fill={color(entry.visual.labelColor, 'neutral-500')}
                  >
                    {entry.visual.label}
                  </text>
                </Show>
              </g>
            )}
          </For>
          <defs>
            <marker
              id="we-graph-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--we-color-neutral-400)" />
            </marker>
          </defs>
        </svg>

        <For each={nodes()}>
          {(entry) => (
            <div
              class="we-graph__node"
              classList={{
                'we-graph__node--selected': entry.selected,
                'we-graph__node--hovered': hovered() === entry.node.id,
                'we-graph__node--unresolved': entry.node.unresolved === true,
              }}
              style={{
                transform: `translate(${entry.at.x}px, ${entry.at.y}px)`,
                '--node-size': `${entry.visual.size * 2}px`,
                '--node-color': color(entry.visual.color, 'primary-500'),
                '--node-border': color(entry.visual.borderColor, 'transparent'),
                '--node-border-width': `${entry.visual.borderWidth ?? 0}px`,
                '--node-radius': entry.visual.shape === 'rect' ? 'var(--we-radius-300)' : '50%',
                opacity: entry.visual.opacity ?? 1,
              }}
              title={entry.visual.label}
            >
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
              <span
                class="we-graph__label"
                style={{
                  color: color(entry.visual.labelColor, 'neutral-800'),
                  'font-size': `${entry.visual.labelSize ?? 12}px`,
                }}
              >
                {entry.visual.label}
              </span>
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
      <Show when={props.showControls !== false}>
        <Column position="absolute" right="300" bottom="300" gap="100">
          <we-button variant="secondary" size="sm" square title="Zoom in" onClick={() => zoomBy(engine, 1.25)}>
            <we-icon name="plus" size="sm" />
          </we-button>
          <we-button variant="secondary" size="sm" square title="Zoom out" onClick={() => zoomBy(engine, 0.8)}>
            <we-icon name="minus" size="sm" />
          </we-button>
          <we-button variant="secondary" size="sm" square title="Fit to view" onClick={() => engine.fit()}>
            <we-icon name="arrows-out" size="sm" />
          </we-button>
        </Column>
      </Show>

      <Show
        when={props.showStatus !== false && (status().loading || status().budgetReached || status().warnings.length)}
      >
        <Column position="absolute" left="300" bottom="300" gap="100" maxWidth="60%">
          <Show when={status().loading}>
            <Row ay="center" gap="200" bg="neutral-100" r="200" px="200" py="100">
              <we-spinner size="xs" />
              <we-text variant="footnote" color="neutral-600">
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

      <Show when={!nodes().length && !status().loading}>
        <Column position="absolute" top="0" left="0" width="100%" height="100%" ax="center" ay="center" gap="200">
          <we-icon name="graph" size="lg" color="neutral-300" />
          <we-text variant="footnote" color="neutral-400">
            Nothing to show yet.
          </we-text>
        </Column>
      </Show>
    </div>
  );
}

/** Zoom about the centre of the surface — what a button press means, as opposed to a wheel. */
function zoomBy(engine: GraphEngine, factor: number): void {
  const { width, height } = engine.viewport.get();
  engine.behaviourContext().zoomAt({ x: width / 2, y: height / 2 }, factor);
}

export type { GraphNode };
