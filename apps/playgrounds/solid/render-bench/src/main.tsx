/**
 * WE render benchmarks — browser harness.
 *
 * Measures what each layer of WE's UI stack costs, in a real browser, including paint. The four
 * "ladder" fixtures render identical content with one layer removed at each step, so the gap
 * between adjacent rows is that layer's cost.
 *
 * Deliberately free of AD4M, stores, an app shell, and any embedded app — none of which the thing
 * being measured depends on, and all of which add noise a consumer of WE would not share. A team
 * adopting WE brings their own shell; ours is not representative of theirs.
 *
 * That absence is also load-bearing architecturally: this app cannot build if `@we/schema-solid`
 * or the design system ever acquires an AD4M dependency, so the benchmark doubles as a portability
 * guard for the seam that `portable-ui-slice` proves.
 *
 * WHY THE CHROME IS PLAIN HTML AND NOT THE DESIGN SYSTEM
 *
 * Tempting to dogfood `we-button` and `we-text` here. Deliberately not done: the harness must not be
 * built from the thing it measures. The status text updates before every sample — as a plain span
 * that is a synchronous text write costing microseconds and landing before the clock starts, but as
 * a Lit element it is an async microtask update that can land *inside* the measured window. An
 * animating `we-spinner` in the previous harness did exactly that, inflating every result in
 * proportion to DOM size until it was found and removed.
 *
 * The element counts depend on this too: `runner.ts` counts the whole document and subtracts a
 * baseline, which only holds while the chrome's element count is stable across a sample.
 *
 * Run: pnpm --filter @we/playground-render-bench dev      (http://localhost:3300)
 * Prod: pnpm --filter @we/playground-render-bench build && … preview
 */
import '@we/primitives'; // side-effect: defines all we-* custom elements
import '@we/tokens/css'; // design-token CSS variables

import { RenderSchema } from '@we/schema-solid';
import { createSignal, For, Show } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { render } from 'solid-js/web';

import { controls } from './controls';
import { benchStore, fixtures } from './fixtures';
import { registry } from './registry';
import { type Result, SAMPLES, summarise, timeRender, timeUpdates, WARMUP } from './runner';

const [results, setResults] = createStore<Record<string, Result>>({});
const [status, setStatus] = createSignal('');
const [progress, setProgress] = createSignal(0);

// The store the fixtures read through `$store`. `counter` is a signal so the update benchmark has
// something real to invalidate; everything else is static data.
const [counter, setCounter] = createSignal(0);
const stores = {
  benchStore: {
    ...benchStore,
    get counter() {
      return counter();
    },
  },
};

/** Where fixtures mount. Kept out of the results UI so the harness never measures its own output. */
const stage = document.createElement('div');
document.body.appendChild(stage);

/** Elements present with nothing mounted — subtracted so counts are fixture-only. */
const baselineElements = () => document.querySelectorAll('*').length;

/**
 * "Show" — mount a fixture and leave it up, so it can be looked at.
 *
 * This is the check the benchmark cannot perform on itself: whether a fixture actually renders what
 * it claims to. A control that silently rendered nothing would post excellent timings, and only
 * eyes catch that. `tests/ladder.test.tsx` guards the four ladder rungs automatically; this covers
 * everything else, and lets the rungs be compared visually side by side.
 *
 * Always torn down before sampling — a fixture left mounted would sit in the element counts and in
 * the browser's style and layout work for every subsequent measurement.
 */
const [shown, setShown] = createSignal<string | null>(null);
let disposeShown: (() => void) | undefined;

function clearShown() {
  disposeShown?.();
  disposeShown = undefined;
  setShown(null);
}

function show(fixtureKey: string) {
  const already = shown() === fixtureKey;
  clearShown();
  if (already) return; // clicking Show again hides it
  disposeShown = mountFixture(fixtureKey);
  setShown(fixtureKey);
}

function mountFixture(fixtureKey: string): () => void {
  const fixture = fixtures.find((f) => f.key === fixtureKey)!;
  if (fixture.control) {
    const Control = controls[fixture.control];
    return render(() => <Control />, stage);
  }
  return render(() => <RenderSchema node={fixture.node} stores={stores} registry={registry} />, stage);
}

async function runOne(fixtureKey: string): Promise<Result> {
  clearShown();
  const fixture = fixtures.find((f) => f.key === fixtureKey)!;
  const samples = [];
  for (let i = 0; i < WARMUP + SAMPLES; i++) {
    setStatus(`${fixture.label} — sample ${i + 1}/${WARMUP + SAMPLES}`);
    const base = baselineElements();
    samples.push(await timeRender(stage, () => mountFixture(fixtureKey), base));
  }

  let updates: number[] = [];
  if (fixture.measuresUpdate) {
    setStatus(`${fixture.label} — update burst`);
    const dispose = mountFixture(fixtureKey);
    updates = await timeUpdates(stage, () => setCounter((c) => c + 1));
    dispose();
  }

  // Discard the warm-up sample: one-time JIT and Lit template compilation land there.
  return summarise(fixture.key, fixture.label, samples.slice(WARMUP), updates);
}

/**
 * Wipe every result.
 *
 * `setResults({})` does NOT do this: setting a Solid store to a plain object *merges* it, so an
 * empty object merges nothing and every existing key survives. `reconcile` diffs against the new
 * value and removes what is missing.
 */
function clearResults() {
  setResults(reconcile({}));
}

async function runAll() {
  clearShown();
  clearResults();
  for (const [i, fixture] of fixtures.entries()) {
    setProgress(Math.round((i / fixtures.length) * 100));
    setResults(fixture.key, await runOne(fixture.key));
  }
  setProgress(0);
  setStatus('');
}

async function runSingle(fixtureKey: string) {
  const result = await runOne(fixtureKey);
  setResults(fixtureKey, result);
  setStatus('');
}

const ms = (n: number) => n.toFixed(1);

/** Right-aligned numeric cell. Generous horizontal padding — the columns are narrow and the headers
 *  ran together without it, which makes a results table easy to misread. */
const num = 'text-align:right;padding:3px 0 3px 18px;white-space:nowrap';
const numMuted = `${num};color:var(--we-color-neutral-500)`;

function ResultRow(props: { fixtureKey: string; label: string }) {
  const r = () => results[props.fixtureKey] as Result | undefined;
  const busy = () => !!status();
  return (
    <tr>
      <td style="padding:4px 10px 4px 0">
        <span style={shown() === props.fixtureKey ? 'font-weight:600' : ''}>{props.label}</span>
      </td>
      <td style="padding:0 8px 0 0;white-space:nowrap">
        {/* Plain <button>, deliberately. The harness chrome must not be built from the design
            system it measures: a we-button updates on a microtask and could land inside a measured
            window, which is the class of contamination an animating spinner already caused once. */}
        <button onClick={() => runSingle(props.fixtureKey)} disabled={busy()} style="font-size:11px">
          Run
        </button>{' '}
        <button onClick={() => show(props.fixtureKey)} disabled={busy()} style="font-size:11px">
          {shown() === props.fixtureKey ? 'Hide' : 'Show'}
        </button>
      </td>
      <td style={`${num};font-weight:600`}>{r() ? ms(r()!.median.total) : ''}</td>
      <td style={`${num};font-weight:600;color:var(--we-color-primary-700)`}>{r() ? ms(r()!.jsWork) : ''}</td>
      <td style={numMuted}>{r() ? ms(r()!.median.build) : ''}</td>
      <td style={numMuted}>{r() ? ms(r()!.median.flush) : ''}</td>
      <td style={numMuted}>{r() ? ms(r()!.median.paint) : ''}</td>
      <td style={num}>{r()?.median.elements ?? ''}</td>
      <td style={num}>{r()?.median.customElements ?? ''}</td>
      <td style={numMuted}>{r() ? `${r()!.spreadPct}%` : ''}</td>
      <td style={num}>{r()?.updateMs != null ? ms(r()!.updateMs!) : ''}</td>
    </tr>
  );
}

function Table(props: { title: string; keys: string[]; note?: string }) {
  // Driven by the fixture list, not by what has been measured — otherwise the per-row Run and Show
  // buttons would not exist until after a full run, which is when they are least useful.
  const rows = () => props.keys.map((k) => fixtures.find((f) => f.key === k)!);
  return (
    <Show when={rows().length}>
      <h2 style="font-size:15px;margin:24px 0 4px">{props.title}</h2>
      <Show when={props.note}>
        <p style="margin:0 0 8px;color:var(--we-color-neutral-500);font-size:13px">{props.note}</p>
      </Show>
      <table style="border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums">
        <thead style="color:var(--we-color-neutral-500)">
          <tr>
            <th style="text-align:left;padding:3px 10px 6px 0">Fixture</th>
            <th />
            <th style="text-align:right;padding:3px 0 6px 18px">total</th>
            <th style="text-align:right;padding:3px 0 6px 18px">JS work</th>
            <th style="text-align:right;padding:3px 0 6px 18px">build</th>
            <th style="text-align:right;padding:3px 0 6px 18px">flush</th>
            <th style="text-align:right;padding:3px 0 6px 18px">paint</th>
            <th style="text-align:right;padding:3px 0 6px 18px">el</th>
            <th style="text-align:right;padding:3px 0 6px 18px">custom</th>
            <th style="text-align:right;padding:3px 0 6px 18px">spread</th>
            <th style="text-align:right;padding:3px 0 6px 18px">update</th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>{(f) => <ResultRow fixtureKey={f.key} label={f.label} />}</For>
        </tbody>
      </table>
    </Show>
  );
}

function App() {
  const simple = fixtures.filter((f) => f.ladder === 'simple').map((f) => f.key);
  const realistic = fixtures.filter((f) => f.ladder === 'realistic').map((f) => f.key);
  const rest = fixtures.filter((f) => !f.ladder && f.key !== 'minimal').map((f) => f.key);

  return (
    <main style="font-family:system-ui,sans-serif;padding:24px;max-width:1100px">
      <h1 style="font-size:20px;margin:0 0 4px">WE render benchmarks</h1>
      <p style="margin:0 0 16px;color:var(--we-color-neutral-600);font-size:14px">
        Median of {SAMPLES} samples ({WARMUP} discarded as warm-up). <strong>JS work</strong> = build + flush, measured
        directly and trustworthy at any scale. <strong>paint</strong> spans a double requestAnimationFrame, so it can
        never report less than one frame of waiting — see the measurement floor below, and read totals near it with
        suspicion. <strong>update</strong> is JS work only, deliberately excluding the frame wait.
      </p>

      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <button onClick={runAll} disabled={!!status()} style="padding:6px 14px;font-size:14px">
          {status() ? 'Running…' : 'Run all'}
        </button>
        <button onClick={clearResults} disabled={!!status()} style="padding:6px 14px;font-size:14px">
          Clear
        </button>
        <Show when={status()}>
          <span style="font-size:13px;color:var(--we-color-neutral-600)">
            {status()} · {progress()}%
          </span>
        </Show>
      </div>

      <Table
        title="Simple ladder — one Column + text + button per card"
        keys={simple}
        note="The gap between adjacent rows is that layer's cost. Raw DOM and Plain Solid render the same shape but have no theming, states, encapsulation or accessibility."
      />
      <Table
        title="Realistic ladder — page-shaped posts, same rungs"
        keys={realistic}
        note="Four component types, three levels of nesting, content that varies per card. Shows whether the layer costs above hold on content someone would actually build, or only isolate cleanly on trivial uniform cards."
      />
      <Table
        title="Measurement floor"
        keys={['minimal']}
        note="A single node. Whatever this reports is scheduling latency, not work — every row above inherits it."
      />
      <Table title="Renderer scaling and feature cost" keys={rest} />
    </main>
  );
}

render(() => <App />, document.getElementById('root')!);
