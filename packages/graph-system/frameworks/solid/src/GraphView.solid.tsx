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

  /** The camera scale on its own, for anything that has to divide by it. */
  const zoom = createMemo(() => {
    viewportVersion();
    version();
    return engine.viewport.get().zoom;
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

  /**
   * Did this event start on the chrome rather than the canvas?
   *
   * The controls live *inside* the graph element, so without this the canvas treats a press on the
   * zoom button as a press on the background. That is not merely untidy: the canvas calls
   * `setPointerCapture` on itself, which retargets the subsequent pointer-up, so the browser fires
   * `click` on the canvas instead of on the button — and the controls silently stop working.
   *
   * `composedPath` rather than `closest`, because the buttons are Lit custom elements and the real
   * event target is inside their shadow root, where `closest` cannot see the marker.
   */
  function fromChrome(event: Event): boolean {
    return event
      .composedPath()
      .some((target) => target instanceof HTMLElement && target.hasAttribute('data-graph-chrome'));
  }

  function dispatch(phase: Parameters<typeof dispatchPointer>[1], event: PointerEvent | WheelEvent | MouseEvent) {
    dispatchPointer(behaviours(), phase, toInput(event), engine.behaviourContext());
  }

  function onPointerMove(event: PointerEvent) {
    if (fromChrome(event)) return;
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
        if (fromChrome(event)) return;
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        dispatch('onPointerDown', event);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => dispatch('onPointerUp', event)}
      // Without this a gesture interrupted by the browser leaves whichever behaviour was tracking it
      // latched onto a node.
      onPointerCancel={(event) => dispatch('onPointerCancel', event)}
      onDblClick={(event) => {
        if (fromChrome(event)) return;
        dispatch('onDoubleClick', event);
      }}
      onWheel={(event) => {
        // Scrolling over a status message should scroll it, not zoom the graph behind it.
        if (fromChrome(event)) return;
        event.preventDefault();
        dispatch('onWheel', event);
      }}
    >
      <div
        class="we-graph__layer"
        style={{
          transform: transform(),
          // Published so anything that must keep a constant on-screen size can divide by it in CSS,
          // rather than every such element needing its own reactive computation in JS.
          '--graph-zoom': String(zoom()),
        }}
      >
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
                  // SVG's own answer to "keep this stroke a constant width whatever the transform".
                  vector-effect={entry.visual.scaleWithZoom ? undefined : 'non-scaling-stroke'}
                  marker-end={entry.visual.arrow === 'none' ? undefined : 'url(#we-graph-arrow)'}
                  onClick={() => props.onEdgeClick?.(entry.edge)}
                />
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
                transform: `translate(${entry.mid.x}px, ${entry.mid.y}px) translate(-50%, -50%)`,
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
              }}
              style={{
                transform: `translate(${entry.at.x}px, ${entry.at.y}px)`,
                '--node-size': `${entry.visual.size * 2}px`,
                '--node-width': `${entry.visual.width ?? entry.visual.size * 2}px`,
                '--node-height': `${entry.visual.height ?? entry.visual.size * 2}px`,
                '--node-color': color(entry.visual.color, 'primary-500'),
                '--node-border': color(entry.visual.borderColor, 'transparent'),
                '--node-border-width': `${entry.visual.borderWidth ?? 0}px`,
                '--node-radius': entry.visual.shape === 'circle' ? '50%' : 'var(--we-radius-300)',
                '--node-label-color': color(entry.visual.labelColor, 'neutral-800'),
                '--node-label-size': `${entry.visual.labelSize ?? 12}px`,
                '--label-scale': entry.visual.scaleLabelWithZoom ? '1' : 'calc(1 / var(--graph-zoom))',
                opacity: entry.visual.opacity ?? 1,
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
                  <span class="we-graph__card-text">{entry.visual.label}</span>
                  <Show when={entry.hasMore}>
                    <span class="we-graph__more we-graph__more--card">+</span>
                  </Show>
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
      <Show when={props.showControls !== false}>
        <Column data-graph-chrome position="absolute" right="300" bottom="300" gap="100">
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
        <Column
          data-graph-chrome
          pointerEvents="none"
          position="absolute"
          left="300"
          bottom="300"
          gap="100"
          maxWidth="60%"
        >
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
        {/*
          Covers the whole canvas, so it must not be able to intercept anything — an empty graph is
          still one you can pan and drop things onto. The old stylesheet said `pointer-events: none`
          here and the conversion to `Column` lost it.
        */}
        <Column
          data-graph-chrome
          pointerEvents="none"
          position="absolute"
          top="0"
          left="0"
          width="100%"
          height="100%"
          ax="center"
          ay="center"
          gap="200"
        >
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
