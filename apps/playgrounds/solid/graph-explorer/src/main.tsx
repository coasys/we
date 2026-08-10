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
      <aside class="rail">
        <h1>Graph engine</h1>
        <p class="sub">Real engine, in-memory data. No AD4M.</p>

        <div class="group">
          <For each={SCENARIOS}>
            {(item) => (
              <button
                type="button"
                classList={{ item: true, 'item--active': scenarioId() === item.id }}
                onClick={() => pick(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>

        <p class="note">{scenario().note}</p>

        <div class="group">
          <span class="label">Layout</span>
          <div class="row">
            <button
              type="button"
              classList={{ chip: true, 'chip--active': layoutOverride() === null }}
              onClick={() => setLayoutOverride(null)}
            >
              default
            </button>
            <For each={LAYOUTS}>
              {(name) => (
                <button
                  type="button"
                  classList={{ chip: true, 'chip--active': layoutOverride() === name }}
                  onClick={() => setLayoutOverride(name)}
                >
                  {name}
                </button>
              )}
            </For>
          </div>
        </div>

        <Show when={selected()}>
          {(node) => (
            <div class="group">
              <span class="label">Selected</span>
              <div class="selected">
                <code>{node().kind}</code> · <code>{node().type}</code>
                <div>{node().label}</div>
              </div>
            </div>
          )}
        </Show>

        <div class="group grow">
          <span class="label">Queries served</span>
          <Show when={log().length} fallback={<p class="empty">none yet</p>}>
            <ul class="log">
              <For each={log()}>
                {(entry) => (
                  <li>
                    <code>{entry.entity}</code> <span>{entry.kind}</span> <b>{entry.rows}</b>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>

        <p class="hint">Drag the background to pan · wheel to zoom · double-click a node to expand or collapse it</p>
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
