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
import '@we/graph-solid/styles';
import './styles.css';

import { GraphView } from '@we/graph-solid';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';

import { createHost, type QueryLog } from './host';
import { LAYOUTS, type Scenario, SCENARIOS } from './scenarios';

function App() {
  const [scenarioId, setScenarioId] = createSignal(SCENARIOS[0].id);
  const [layoutOverride, setLayoutOverride] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<{ type: string; label?: string; kind: string } | null>(null);
  const [log, setLog] = createSignal<QueryLog['entries']>([]);

  // A live log of what the graph actually asked the data layer for. Worth having in front of you:
  // "one expansion, four queries" is the kind of thing that is obvious here and invisible in an app.
  const queryLog: QueryLog = { entries: [] };
  const host = createHost(queryLog);
  const flushLog = () => setLog([...queryLog.entries].slice(-12).reverse());

  const scenario = createMemo(() => SCENARIOS.find((s) => s.id === scenarioId()) ?? SCENARIOS[0]);

  /** The scenario's spec, with the layout picker applied over it. */
  const specFor = (current: Scenario) => {
    const override = layoutOverride();
    return override ? { ...current.spec, layout: { type: override } } : current.spec;
  };

  function pick(id: string) {
    queryLog.entries.length = 0;
    setLog([]);
    setSelected(null);
    setLayoutOverride(null);
    setScenarioId(id);
  }

  return (
    <div class="app">
      {/*
        Design-system all the way down, deliberately.

        A harness that hand-rolls its own buttons is a harness that stops telling you anything about
        the real thing — and it is the wrong advertisement for a repository whose whole argument is
        that the design system is what you build with. Primitives are Lit custom elements, so this
        costs no framework coupling.
      */}
      <aside class="rail">
        <div class="group">
          <we-text variant="heading-sm">Graph engine</we-text>
          <we-text variant="footnote" color="neutral-500">
            Real engine, in-memory data. No AD4M.
          </we-text>
        </div>

        <div class="group">
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
        </div>

        <we-alert variant="neutral">{scenario().note}</we-alert>

        <div class="group">
          <we-text variant="label" color="neutral-500" uppercase>
            Layout
          </we-text>
          <div class="row">
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
          </div>
        </div>

        <Show when={selected()}>
          {(node) => (
            <div class="group">
              <we-text variant="label" color="neutral-500" uppercase>
                Selected
              </we-text>
              <div class="row">
                <we-badge variant="primary" size="xs">
                  {node().kind}
                </we-badge>
                <we-badge size="xs">{node().type}</we-badge>
              </div>
              <we-text variant="footnote">{node().label}</we-text>
            </div>
          )}
        </Show>

        <div class="group grow">
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
        </div>

        <we-text variant="footnote" color="neutral-500">
          Drag the background to pan · wheel to zoom · double-click a node to expand or collapse it
        </we-text>
      </aside>

      <main class="stage">
        {/* Keyed on the scenario so switching is a genuine remount — the same thing a template does
            when a `$if` swaps one graph for another, and the path a leaked engine would show up on. */}
        <Show when={scenario()} keyed>
          {(current) => (
            <GraphView
              {...specFor(current)}
              host={host}
              width="100%"
              height="100%"
              bg="neutral-50"
              onNodeClick={(node) => {
                setSelected({ kind: node.kind, type: node.type, label: node.label });
                flushLog();
              }}
              onSelectionChange={() => flushLog()}
              onNodeDragEnd={() => flushLog()}
            />
          )}
        </Show>
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(() => <App />, root);
