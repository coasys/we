/**
 * Browser harness for the graph engine — the real engine, the real expanders, the real Solid
 * renderer, over plain arrays instead of AD4M.
 *
 * The point is that nothing here is a mock of the graph. Only the *data layer* is substituted, through
 * the same three-function port the app binds, so a behaviour that works here works against a live
 * dataset with the same shapes. It is also the fastest way to see the parts that are otherwise
 * invisible: collapse bundling, the budget guard, reverse traversal.
 */
import '@we/primitives';
import '@we/tokens/css';
// Every theme, switched by the `data-we-theme` attribute below — the same mechanism the app uses.
import '@we/themes';
import '@we/graph-solid/styles';
import './styles.css';

import { Column, Row } from '@we/components/solid';
import type { GraphNode } from '@we/graph-protocol';
import { type GraphHostBindings, GraphView, type GraphViewProps } from '@we/graph-solid';
import { applyThemeVars } from '@we/schema-shared';
import { THEME_PRESETS, type ThemeName } from '@we/themes/presets';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';

import { clearPositions, editableField, restorePositions, savePosition, writeField } from './fixture';
import { createHost, type QueryLog } from './host';
import { CURVES, LAYOUTS, type Scenario, SCENARIOS } from './scenarios';

/**
 * The graph, wrapped so its remount key has somewhere to live.
 *
 * `Show keyed` hands the key to its child and `GraphView` has no use for it, so rather than smuggle
 * it past the types this makes it a real prop. The wrapper also keeps the scenario switch honest: a
 * new key is a genuine remount, which is what a template does when a `$if` swaps one graph for
 * another, and the path a leaked engine would show up on.
 */
function Graph(props: {
  remountKey: { scenario: string; version: number };
  spec: GraphViewProps;
  host: GraphHostBindings;
  onNodeClick: (node: GraphNode) => void;
  onChanged: () => void;
  onNodeDragEnd: (payload: { id: string; x: number; y: number }) => void;
}) {
  void props.remountKey;
  return (
    <GraphView
      {...props.spec}
      host={props.host}
      width="100%"
      height="100%"
      bg="neutral-50"
      onNodeClick={props.onNodeClick}
      onSelectionChange={props.onChanged}
      onNodeDragEnd={props.onNodeDragEnd}
    />
  );
}

restorePositions();

function App() {
  const [scenarioId, setScenarioId] = createSignal(SCENARIOS[0].id);
  const [layoutOverride, setLayoutOverride] = createSignal<string | null>(null);
  const [curveOverride, setCurveOverride] = createSignal<(typeof CURVES)[number] | null>(null);
  /*
    Live force tuning, and deliberately here rather than in the graph's own chrome.

    `distance`, `charge` and `collide` are already authorable — they are the force layout's options —
    so what is missing is not a way to express them but a way to *find* the numbers worth writing
    down. That is a playground's job. Putting sliders in the engine's chrome would make every graph
    ship a tuning panel for a decision its author already made, and hand a reader controls over
    something they have no reason to have an opinion about.
  */
  const [force, setForce] = createSignal({ distance: 90, charge: -220, collide: 28 });
  const [selected, setSelected] = createSignal<GraphNode | null>(null);
  /** Bumped after a fixture edit, to force the graph to re-seed and pick the new value up. */
  const [dataVersion, setDataVersion] = createSignal(0);
  const [log, setLog] = createSignal<QueryLog['entries']>([]);
  const [theme, setTheme] = createSignal<ThemeName>('light');

  /**
   * Applying a theme is two things, and the first attempt here did only the second.
   *
   * A theme is a *parameter set* — hue, saturation, and a multiplier that inverts the lightness ramp
   * — written onto the root as custom properties. That is what actually recolours anything. The
   * `data-we-theme` attribute drives the handful of rules that cannot be parametric (a modal shadow,
   * a tooltip inversion), so setting it alone changes almost nothing, which is exactly what the first
   * version of this toggle did.
   *
   * Both halves come from shared code rather than from numbers copied into the harness: the presets
   * are the design system's, and `applyThemeVars` is the same function the app uses.
   *
   * Worth having beyond convenience — the graph paints tokens rather than colours, and flipping the
   * theme is the fastest way to catch anything that does not.
   */
  createEffect(() => {
    const name = theme();
    document.documentElement.setAttribute('data-we-theme', name);
    applyThemeVars(document.documentElement, THEME_PRESETS[name].parameters);
  });

  // A live log of what the graph actually asked the data layer for. Worth having in front of you:
  // "one expansion, four queries" is the kind of thing that is obvious here and invisible in an app.
  const queryLog: QueryLog = { entries: [] };
  const host = createHost(queryLog);
  const flushLog = () => setLog([...queryLog.entries].slice(-12).reverse());

  const scenario = createMemo(() => SCENARIOS.find((s) => s.id === scenarioId()) ?? SCENARIOS[0]);

  /**
   * Identity of the graph currently mounted.
   *
   * An object rather than a string because `Show keyed` compares by reference, and a memo only mints
   * a new one when the scenario or the data actually changed — which is precisely when the graph
   * should be rebuilt from scratch.
   */
  const graphKey = createMemo(() => ({ scenario: scenarioId(), version: dataVersion() }));

  /** The scenario's spec, with the pickers applied over it. */
  const specFor = (current: Scenario) => {
    const layout = layoutOverride();
    const curve = curveOverride();
    let spec = current.spec;
    if (layout) spec = { ...spec, layout: { type: layout } };
    // Tuning applies wherever the graph is actually running a force layout, whether that came from
    // the scenario or from the picker above.
    if ((spec.layout as { type?: string } | undefined)?.type === 'force') {
      spec = { ...spec, layout: { type: 'force', options: force() } };
    }
    if (curve) {
      // Appended rather than replacing, so a scenario's own edge rules still decide colour, width and
      // labels — the picker is overriding one property, not the styling.
      spec = { ...spec, edgeStyle: [...(spec.edgeStyle ?? []), { style: { curve } }] };
    }
    return spec;
  };

  function pick(id: string) {
    queryLog.entries.length = 0;
    setLog([]);
    setSelected(null);
    setLayoutOverride(null);
    setCurveOverride(null);
    setScenarioId(id);
  }

  return (
    <Row width="100%" height="100dvh">
      {/*
        Design-system all the way down, deliberately.

        A harness that hand-rolls its own buttons is a harness that stops telling you anything about
        the real thing — and it is the wrong advertisement for a repository whose whole argument is
        that the design system is what you build with. Primitives are Lit custom elements, so this
        costs no framework coupling.
      */}
      <Column
        width="280px"
        height="100%"
        gap="500"
        p="400"
        overflow="auto"
        bg="neutral-0"
        borderRight="1px solid neutral-200"
        flex="0 0 auto"
      >
        <Column gap="100">
          <Row ax="between" ay="center" gap="200">
            <we-text variant="heading-sm">Graph engine</we-text>
            <we-button
              variant="ghost"
              size="sm"
              square
              title={`Theme: ${THEME_PRESETS[theme()].name}`}
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            >
              <we-icon name={THEME_PRESETS[theme() === 'dark' ? 'light' : 'dark'].icon} size="sm" />
            </we-button>
          </Row>
          <we-text variant="footnote" color="neutral-500">
            Real engine, in-memory data.
          </we-text>
        </Column>

        <Column gap="100">
          <For each={SCENARIOS}>
            {(item) => (
              <we-button
                variant={scenarioId() === item.id ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => pick(item.id)}
              >
                {item.label}
              </we-button>
            )}
          </For>
        </Column>

        <we-alert variant="neutral">{scenario().note}</we-alert>

        <Column gap="200">
          <we-text variant="label" color="neutral-500" uppercase>
            Layout
          </we-text>
          <Row gap="100" wrap>
            <we-button
              variant={layoutOverride() === null ? 'primary' : 'outline'}
              size="xs"
              onClick={() => setLayoutOverride(null)}
            >
              default
            </we-button>
            <For each={LAYOUTS}>
              {(name) => (
                <we-button
                  variant={layoutOverride() === name ? 'primary' : 'outline'}
                  size="xs"
                  onClick={() => setLayoutOverride(name)}
                >
                  {name}
                </we-button>
              )}
            </For>
          </Row>
        </Column>

        <Show when={(specFor(scenario()).layout as { type?: string } | undefined)?.type === 'force'}>
          <Column gap="200">
            <we-text variant="label" color="neutral-500" uppercase>
              Force
            </we-text>
            <For
              each={
                [
                  { key: 'distance', label: 'link distance', min: 30, max: 300, step: 10 },
                  { key: 'charge', label: 'repulsion', min: -800, max: -20, step: 20 },
                  { key: 'collide', label: 'spacing', min: 0, max: 80, step: 2 },
                ] as const
              }
            >
              {(control) => (
                <Column gap="100">
                  <Row ax="between" ay="center">
                    <we-text variant="footnote" color="neutral-500">
                      {control.label}
                    </we-text>
                    <we-text variant="footnote" color="neutral-700">
                      {force()[control.key]}
                    </we-text>
                  </Row>
                  <we-slider
                    value={force()[control.key]}
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    // `input` rather than `change`: the point of a slider here is watching the graph
                    // answer while you drag it, not after you let go.
                    on:input={(event: CustomEvent<number>) =>
                      setForce((current) => ({ ...current, [control.key]: event.detail }))
                    }
                  />
                </Column>
              )}
            </For>
          </Column>
        </Show>

        <Column gap="200">
          <we-text variant="label" color="neutral-500" uppercase>
            Board positions
          </we-text>
          <Row gap="100" wrap ay="center">
            <we-button
              variant="outline"
              size="xs"
              title="Forget every saved card position"
              onClick={() => {
                clearPositions();
                setDataVersion((n) => n + 1);
              }}
            >
              reset saved positions
            </we-button>
          </Row>
          <we-text variant="footnote" color="neutral-500">
            Dragging a card on the board scenario writes its position and survives a reload.
          </we-text>
        </Column>

        <Column gap="200">
          <we-text variant="label" color="neutral-500" uppercase>
            Edge shape
          </we-text>
          <Row gap="100" wrap>
            <we-button
              variant={curveOverride() === null ? 'primary' : 'outline'}
              size="xs"
              onClick={() => setCurveOverride(null)}
            >
              default
            </we-button>
            <For each={CURVES}>
              {(name) => (
                <we-button
                  variant={curveOverride() === name ? 'primary' : 'outline'}
                  size="xs"
                  onClick={() => setCurveOverride(name)}
                >
                  {name}
                </we-button>
              )}
            </For>
          </Row>
        </Column>

        {/*
          The inspector.

          A graph shows structure and hides everything else, so a node's actual content has to be
          readable somewhere. This is host territory rather than engine — the engine already hands the
          whole node to `onNodeClick`, and where the detail goes is a template's decision.

          The label is editable here to exercise the *write* path, deliberately from a panel rather
          than inline on the canvas: text editing inside a transformed, zoomable surface is the hard
          part of the board project, and faking it here would teach the wrong thing about what exists.
        */}
        <Show when={selected()}>
          {(node) => (
            <Column gap="200">
              <Row ax="between" ay="center">
                <we-text variant="label" color="neutral-500" uppercase>
                  Inspector
                </we-text>
                <we-button variant="ghost" size="xs" square title="Clear" onClick={() => setSelected(null)}>
                  <we-icon name="x" size="xs" />
                </we-button>
              </Row>

              <Row gap="100" wrap>
                <we-badge variant="primary" size="xs">
                  {node().kind}
                </we-badge>
                <we-badge size="xs">{node().type}</we-badge>
                <Show when={node().unresolved}>
                  <we-badge variant="warning" size="xs">
                    not synced
                  </we-badge>
                </Show>
              </Row>

              <Show when={editableField(node())} keyed>
                {(field) => (
                  <Column gap="100">
                    <we-text variant="footnote" color="neutral-500">
                      {field}
                    </we-text>
                    <we-textarea
                      rows={3}
                      value={String(node().data?.[field] ?? '')}
                      onChange={(event: Event) => {
                        const value = (event.target as HTMLTextAreaElement).value;
                        if (writeField(node(), field, value)) {
                          setSelected(null);
                          setDataVersion((n) => n + 1);
                        }
                      }}
                    />
                  </Column>
                )}
              </Show>

              <Column gap="100">
                <For each={Object.entries(node().data ?? {})}>
                  {([key, value]) => (
                    <Row gap="200" ax="between">
                      <we-text variant="footnote" color="neutral-500">
                        {key}
                      </we-text>
                      <we-text variant="footnote" truncate>
                        {String(value ?? '—')}
                      </we-text>
                    </Row>
                  )}
                </For>
              </Column>

              <we-text variant="footnote" color="neutral-400" truncate>
                {node().id}
              </we-text>
            </Column>
          )}
        </Show>

        <Column gap="200" flex="1" overflow="hidden">
          <we-text variant="label" color="neutral-500" uppercase>
            Queries served
          </we-text>
          <Show
            when={log().length}
            fallback={
              <we-text variant="footnote" color="neutral-400">
                none yet
              </we-text>
            }
          >
            <ul class="log">
              <For each={log()}>
                {(entry) => (
                  <li>
                    <we-badge size="xs">{entry.entity}</we-badge>
                    <we-text variant="footnote" color="neutral-500" truncate>
                      {entry.kind}
                    </we-text>
                    <we-text variant="footnote" fontWeight="700">
                      {entry.rows}
                    </we-text>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Column>

        <we-text variant="footnote" color="neutral-500">
          Drag the background to pan · wheel to zoom · double-click a node to expand or collapse it
        </we-text>
      </Column>

      <Column flex="1" height="100%" position="relative" overflow="hidden">
        {/* Keyed on the scenario so switching is a genuine remount — the same thing a template does
            when a `$if` swaps one graph for another, and the path a leaked engine would show up on. */}
        {/* Keyed on scenario *and* data version, so an edit re-seeds through the real path rather
            than being patched into the rendered node. */}
        <Show when={graphKey()} keyed>
          {(remountKey) => (
            <Graph
              remountKey={remountKey}
              spec={specFor(scenario())}
              host={host}
              onNodeClick={(node) => {
                setSelected(node);
                flushLog();
              }}
              onChanged={flushLog}
              /*
                The persistence path a board actually takes: the drop is written to the record, and
                the next query reads it back as an ordinary field. Nothing here keeps a side-map of
                positions — a playground that did would demonstrate persistence while testing none of
                the wiring that has to work.
              */
              onNodeDragEnd={(at) => {
                savePosition(at.id, at);
                flushLog();
              }}
            />
          )}
        </Show>
      </Column>
    </Row>
  );
}

const root = document.getElementById('root');
if (root) render(() => <App />, root);
