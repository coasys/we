/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PerspectiveProxy } from '@coasys/ad4m';
import { Ad4mModel, HasMany, Model, Property } from '@coasys/ad4m';
import { queryIRFlag } from '@shared/queryIRFlag';
import { registerModel } from '@shared/registries/modelRegistry';
import { type Accessor, createEffect, createSignal } from 'solid-js';

import { benchmarkBasePath, benchmarkRoutes } from './SchemaBenchmark.schema';

// ---------------------------------------------------------------------------
// Test model — lightweight AD4M model for $query testing
// ---------------------------------------------------------------------------

// A child model, so the query page can test the relation patterns (count / single projection /
// include) deterministically — the trickiest IR mappings — against real AD4M.
@Model({ name: 'TestChild' })
export class TestChild extends Ad4mModel {
  @Property({ through: 'we://test_child_label' }) label: string = '';
  @Property({ through: 'we://test_child_owner' }) owner: string = '';
}

@Model({ name: 'TestItem' })
export class TestItem extends Ad4mModel {
  @Property({ through: 'we://test_name', required: true }) name: string = '';
  @Property({ through: 'we://test_status' }) status: string = '';
  @Property({ through: 'we://test_category' }) category: string = '';
  @HasMany(() => TestChild, { through: 'we://test_child' }) children: string[] = [];
}

// ---------------------------------------------------------------------------
// Benchmark types
// ---------------------------------------------------------------------------

/** Raw timestamps reported by BenchmarkTimer. All are `performance.now()` values, not durations —
 *  the store derives the phase durations, so the timer stays a dumb probe with no notion of when
 *  navigation started. */
export type BenchMarks = {
  /** Timer component body ran — i.e. every preceding sibling node has been walked and built. */
  createdAt: number;
  /** Solid onMount — the tree is attached to the document. */
  mountedAt: number;
  /** Microtask checkpoint — Lit's async first render + updated() have flushed. */
  flushedAt: number;
  /** Second rAF — style, layout and paint for the frame have been committed. */
  paintedAt: number;
  /** Total elements in the document at paint time (route content + constant shell chrome). */
  elements: number;
  /** Of those, custom elements (tag name contains a hyphen). */
  customElements: number;
};

/** One measured render, split into phases. Durations in ms; counts are route content only
 *  (the shell chrome baseline captured on /idle has already been subtracted). */
export type BenchSample = {
  /** Navigation → tree built. Schema walk + token resolution + detached DOM construction. */
  build: number;
  /** Tree built → attached. DOM insertion and custom-element upgrade. */
  mount: number;
  /** Attached → Lit flushed. Per-instance DS prop computation and CSSOM writes. */
  flush: number;
  /** Lit flushed → painted. Style, layout, paint. */
  paint: number;
  /** Navigation → painted. */
  total: number;
  elements: number;
  customElements: number;
};

/** Aggregated result for one route. */
export type BenchResult = {
  label: string;
  /** Median across the warm samples — the headline number. */
  median: BenchSample | null;
  /** Fastest and slowest warm sample totals. Displayed as a spread so every result carries its own
   *  error bar: measured within-run spread ranges from 0.4% (Update Perf) to ~8% (Solid Components),
   *  so a delta smaller than a route's own spread means nothing. */
  spreadLow: number;
  spreadHigh: number;
  /** Each phase paired with its share of the median total, so the UI can render one row per phase
   *  from a single path.
   *
   *  Share is deliberately what gets emphasis, not absolute ms: Static Extreme's 563ms build is not
   *  "worse" than Deep Nesting's 9.4ms, it is 60× the work. And a share carries no quality
   *  judgment — so the dominant phase is highlighted rather than painted red. */
  phase: {
    build: { value: number; share: number };
    mount: { value: number; share: number };
    flush: { value: number; share: number };
    paint: { value: number; share: number };
  };
  /** Spread as a percentage of the median total. This one *is* a quality signal: a wide spread
   *  means the route's own noise exceeds the deltas we'd be trying to read from it. */
  spreadPct: number;
  /** How many warm samples contributed to `median`. */
  sampleCount: number;
  /** JS heap in MB while parked on /idle, immediately before this route rendered.
   *
   *  Here to test a specific hypothesis: across consecutive runs, custom-element-heavy routes
   *  ($each Flat, Nested $each, Web Components) drift *slower* while Solid Components drifts
   *  faster, with the rise concentrated in flush and paint. That pattern fits heap accumulation
   *  rather than CPU state — and the primitives carry a candidate, a retained per-instance
   *  `_prevDSSnapshot` JSON string. If this figure climbs down the list, that's the confirmation.
   *
   *  Chrome-only (`performance.memory` is non-standard); 0 elsewhere. */
  heapMb: number;
  /** Median total ÷ element count, in µs. The only figure comparable across routes. */
  usPerElement: number;
  /** Median total ÷ custom-element count, in µs. */
  usPerCustomElement: number;
  /** Median duration of a reactive update burst, for routes that measure one. */
  updateMs: number | null;
};

/** A route enqueued for measurement. */
type BenchTarget = {
  key: string;
  path: string;
  label: string;
  /** When set, the runner stays on the route after mount sampling and measures reactive updates. */
  measuresUpdate?: boolean;
};

// ---------------------------------------------------------------------------
// Store factory — test-oriented signals for integration test template
// ---------------------------------------------------------------------------

export function createTestStore(testPerspective: Accessor<PerspectiveProxy | null>, navigate: (to: string) => void) {
  registerModel('TestItem', TestItem as any);
  registerModel('TestChild', TestChild as any);

  // The "current agent" stand-in for the single-projection (`$myChild`) test's `where: { owner }`.
  const queryOwner = 'owner:me';

  // ---- Known values (for $store / assertion tests) ----
  const stringValue = 'hello';
  const numberValue = 42;
  const boolTrue = true;
  const boolFalse = false;

  // ---- Interactive signals ----
  const [counter, setCounter] = createSignal(0);
  const [typedText, setTypedText] = createSignal('');
  const [toggleValue, setToggleValue] = createSignal(false);
  const [queryFilterMode, setQueryFilterMode] = createSignal('all');

  // ---- Benchmark timing ----
  //
  // Both entry points — a single route's "Run" button and "Run All" — drive the same queue-based
  // runner below; an individual run is just a queue of length one. That matters more than it looks:
  // the sampling rules (warm-up discard, median-of-N, the /idle bounce) only yield comparable
  // numbers if both paths obey them identically, and two parallel implementations would drift.
  const [benchLastResult, setBenchLastResult] = createSignal<BenchResult | null>(null);
  const [benchResults, setBenchResults] = createSignal<Record<string, BenchResult>>({});
  const [benchStatus, setBenchStatus] = createSignal('');
  // Overall session progress, 0–100. Drives a *determinate* bar in the run overlay — deliberately
  // not a spinner, since an animating element would add continuous compositor work inside the
  // measured window on every sample.
  const [benchProgress, setBenchProgress] = createSignal(0);
  const [benchRouteProgress, setBenchRouteProgress] = createSignal('');
  /** Boolean form of benchStatus, for `loading`/`disabled` props that need a real boolean. */
  const benchRunning = () => benchStatus() !== '';

  // Runner state. Deliberately plain `let` rather than signals — nothing renders from it, and
  // making it reactive would re-run the route being measured mid-sample.
  let benchQueue: BenchTarget[] = [];
  let benchCurrent: BenchTarget | null = null;
  let benchPending: BenchSample[] = [];
  let benchNavStartedAt = 0;
  let benchBaseline = { elements: 0, customElements: 0 };
  let benchIdleHeapMb = 0;
  let benchUpdatePending: number[] = [];
  let benchTotalRoutes = 0;
  let benchDoneRoutes = 0;

  // ---- List data (for $each) ----
  const fruits = [
    { name: 'Apple', color: 'red', emoji: '🍎' },
    { name: 'Banana', color: 'yellow', emoji: '🍌' },
    { name: 'Cherry', color: 'red', emoji: '🍒' },
    { name: 'Grape', color: 'purple', emoji: '🍇' },
  ];
  const fruitCount = fruits.length;

  // Nested groups (for nested $each)
  const groups = [
    { name: 'Fruits', items: [{ label: 'Apple' }, { label: 'Banana' }] },
    { name: 'Veggies', items: [{ label: 'Carrot' }, { label: 'Broccoli' }] },
  ];

  // Key-value pairs (for $map)
  const properties = [
    { key: 'Language', value: 'TypeScript' },
    { key: 'Framework', value: 'SolidJS' },
    { key: 'Version', value: '2.0' },
  ];

  // Object with extra fields (for $pick)
  const fullObject = {
    name: 'Test Item',
    status: 'active',
    category: 'Frontend',
    secret: 'hidden-value',
  };

  // Empty list (for $each empty-array edge case)
  const emptyList: any[] = [];

  // Deep nested object (for $store 3+ depth traversal)
  const nested = { level1: { level2: { value: 'deep-value' } } };

  // Single config object (for $map on single object path)
  const singleConfig = { title: 'My App', version: '2.0', debug: false };

  // ---- Benchmark data ----
  const benchList100 = Array.from({ length: 100 }, (_, i) => ({
    name: `Item ${i + 1}`,
    category: `Category ${String.fromCharCode(65 + (i % 5))}`,
  }));

  const benchGroups = Array.from({ length: 10 }, (_, g) => ({
    name: `Group ${g + 1}`,
    items: Array.from({ length: 10 }, (_, i) => ({
      label: `Item ${g * 10 + i + 1}`,
      detail: `detail-${g}-${i}`,
    })),
  }));

  // ---- Actions ----
  function increment() {
    setCounter((c) => c + 1);
  }
  function setTypedTextFromArg(text: string) {
    setTypedText(text);
  }
  function toggle() {
    setToggleValue((v) => !v);
  }

  // Track how many items we've created for unique naming
  let createdCount = 0;

  // ---- Benchmark actions ----

  /** Discarded from the median. The first render of a route pays one-time costs that no later
   *  render repeats — Lit template compilation and the per-class CSSStyleSheet, plus JIT warm-up.
   *  Discarding it is also what makes an individual run comparable to a Run All run: in Run All
   *  only the *first* route is ever truly cold, so without this the same route would score
   *  differently depending on which button was pressed. */
  const BENCH_WARMUP = 1;
  /** Warm samples behind each median. Odd, so the median is a real sample rather than a mean. */
  const BENCH_SAMPLES = 5;
  const BENCH_UPDATE_SAMPLES = 5;
  /** Time parked on /idle between samples — lets the previous route tear down and gives the
   *  browser a little breathing room, so teardown cost never lands inside the next measurement. */
  const BENCH_IDLE_SETTLE_MS = 60;
  const benchIdlePath = `${benchmarkBasePath}/idle`;

  /** Single source of truth for what Run All covers, shared with the dashboard that lists them —
   *  so a route can never be added to the UI and silently missed by the runner. */
  const benchTargets: BenchTarget[] = benchmarkRoutes.map((r) => ({
    key: r.key,
    path: r.nav,
    label: r.label,
    measuresUpdate: r.measuresUpdate,
  }));

  /** One pass over the document for both counts. Called on /idle (baseline) and at paint. */
  function benchCountDom(): { elements: number; customElements: number } {
    const all = document.querySelectorAll('*');
    let custom = 0;
    for (const el of all) if (el.tagName.includes('-')) custom++;
    return { elements: all.length, customElements: custom };
  }

  /** `performance.memory` is a non-standard Chrome extension — absent elsewhere, hence the guard. */
  function benchHeapMb(): number {
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return mem ? Math.round(mem.usedJSHeapSize / 1048576) : 0;
  }

  function benchShare(part: number | undefined, total: number | undefined): number {
    if (!part || !total) return 0;
    return Math.round((part / total) * 100);
  }

  function benchMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  }

  /** Returns the sample whose `total` is the median, rather than taking a per-field median across
   *  samples. A per-field median would produce a row whose phases don't add up to its own total —
   *  each field could come from a different run. This keeps every reported row internally coherent. */
  function benchMedianSample(samples: BenchSample[]): BenchSample | null {
    if (samples.length === 0) return null;
    const sorted = [...samples].sort((a, b) => a.total - b.total);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  }

  function benchRun(key: string) {
    const target = benchTargets.find((t) => t.key === key);
    if (target) benchStart([target]);
  }

  function benchRunAll() {
    setBenchResults({});
    benchStart(benchTargets);
  }

  function benchStart(targets: BenchTarget[]) {
    benchQueue = [...targets];
    benchTotalRoutes = targets.length;
    benchDoneRoutes = 0;
    setBenchProgress(0);
    benchNextTarget();
  }

  function benchNextTarget() {
    const next = benchQueue.shift();
    if (!next) {
      benchCurrent = null;
      benchNavStartedAt = 0;
      setBenchStatus('');
      setBenchRouteProgress('');
      setBenchProgress(0);
      setTimeout(() => navigate(benchmarkBasePath), BENCH_IDLE_SETTLE_MS);
      return;
    }
    benchCurrent = next;
    benchPending = [];
    benchUpdatePending = [];
    benchNextSample();
  }

  function benchNextSample() {
    const target = benchCurrent;
    if (!target) return;
    const perRoute = BENCH_WARMUP + BENCH_SAMPLES;
    setBenchStatus(`${target.label} — render sample ${benchPending.length + 1}/${perRoute}`);
    setBenchRouteProgress(`Route ${benchDoneRoutes + 1} of ${benchTotalRoutes}`);
    // Progress across the whole session, counting part-finished routes so the bar advances
    // smoothly rather than jumping once per route.
    const fraction = (benchDoneRoutes + benchPending.length / perRoute) / Math.max(benchTotalRoutes, 1);
    setBenchProgress(Math.round(fraction * 100));

    // Bounce through /idle first. Navigating to the path we're already on is a no-op, so a repeat
    // sample would otherwise never remount and we'd measure nothing. Parking on a near-empty route
    // also means the previous route's teardown happens here, outside the measured window.
    navigate(benchIdlePath);
    setTimeout(() => {
      // Baseline is captured while /idle is mounted, so subtracting it from the paint-time count
      // leaves route content only — the surrounding shell chrome is constant and cancels out.
      benchBaseline = benchCountDom();
      // Sampled here rather than at paint: the question is whether heap is *accumulating* across
      // routes, and /idle is the only comparable point — same near-empty page every time, so a
      // rising figure down the results list is growth rather than a difference in route size.
      benchIdleHeapMb = benchHeapMb();
      benchNavStartedAt = performance.now();
      navigate(target.path);
    }, BENCH_IDLE_SETTLE_MS);
  }

  /** Called by BenchmarkTimer once a route has painted. */
  function benchRecordRender(marks: BenchMarks) {
    // No active session (someone navigated straight to a route URL) — there's no navigation
    // timestamp to measure `build` against, so recording it would report a garbage figure derived
    // from whenever the last session happened to start. Drop it rather than publish a wrong number.
    if (!benchCurrent || !benchNavStartedAt) return;

    // Rounded at capture so every downstream consumer (display, medians, baseline JSON) agrees on
    // the same value — rounding at display time only would let the median pick one sample while the
    // UI showed a different rounding of it.
    const round = (n: number) => Math.round(n * 10) / 10;
    benchPending.push({
      build: round(marks.createdAt - benchNavStartedAt),
      mount: round(marks.mountedAt - marks.createdAt),
      flush: round(marks.flushedAt - marks.mountedAt),
      paint: round(marks.paintedAt - marks.flushedAt),
      total: round(marks.paintedAt - benchNavStartedAt),
      elements: marks.elements - benchBaseline.elements,
      customElements: marks.customElements - benchBaseline.customElements,
    });

    if (benchPending.length < BENCH_WARMUP + BENCH_SAMPLES) {
      benchNextSample();
      return;
    }
    // Render sampling done. Update-measuring routes stay mounted for the burst below.
    if (benchCurrent.measuresUpdate) {
      benchRunUpdateBurst();
      return;
    }
    benchFinalize();
  }

  /**
   * Reactive-update measurement, run against the already-mounted route.
   *
   * Mount cost and update cost are separate questions: the renderer allocates a memo per prop and,
   * on the web-component path, an effect per prop as well — so a template can mount acceptably and
   * still update badly. Flipping one store signal and measuring through to the next committed paint
   * is the only figure that exercises that path.
   */
  function benchRunUpdateBurst() {
    if (benchUpdatePending.length >= BENCH_WARMUP + BENCH_UPDATE_SAMPLES) {
      // Drop the warm-up burst for the same reason as the render warm-up above.
      benchUpdatePending = benchUpdatePending.slice(BENCH_WARMUP);
      benchFinalize();
      return;
    }
    setBenchStatus(`${benchCurrent?.label} — update sample ${benchUpdatePending.length + 1}`);
    const startedAt = performance.now();
    setCounter((c) => c + 1);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        benchUpdatePending.push(performance.now() - startedAt);
        benchRunUpdateBurst();
      }),
    );
  }

  function benchFinalize() {
    const target = benchCurrent;
    if (!target) return;
    // The warm-up sample is still discarded — it is genuinely different for the first route of a
    // session — but no longer displayed. Measured across five runs its spread reached 32% on a
    // single route, so as a *reported* figure it was noise wearing the label of a finding.
    const [, ...warm] = benchPending;
    const median = benchMedianSample(warm);

    // Trimmed range: sort the warm samples and drop the single slowest before measuring spread.
    //
    // Plain min–max over five samples is dominated by one outlier, which made it useless as an
    // error bar — the one job it has. Measured across three consecutive runs, Static Small reported
    // 6% / 25% / 45% spread while its median moved less than 5% (42.5 / 42.3 / 40.5ms): four
    // samples sat near 38–41ms and a lone 55.9ms set the range. Those outliers line up with the GC
    // pauses visible in the heap figures, so trimming one sample removes the pause without hiding
    // genuine instability — a route that is really unstable is unstable in more than one sample.
    const sortedTotals = [...warm.map((s) => s.total)].sort((a, b) => a - b);
    const totals = sortedTotals.length > 2 ? sortedTotals.slice(0, -1) : sortedTotals;

    setBenchResults((prev) => ({
      ...prev,
      [target.key]: {
        label: target.label,
        median,
        spreadLow: totals.length ? Math.min(...totals) : 0,
        spreadHigh: totals.length ? Math.max(...totals) : 0,
        spreadPct:
          median && median.total > 0 && totals.length
            ? Math.round(((Math.max(...totals) - Math.min(...totals)) / median.total) * 100)
            : 0,
        phase: {
          build: { value: median?.build ?? 0, share: benchShare(median?.build, median?.total) },
          mount: { value: median?.mount ?? 0, share: benchShare(median?.mount, median?.total) },
          flush: { value: median?.flush ?? 0, share: benchShare(median?.flush, median?.total) },
          paint: { value: median?.paint ?? 0, share: benchShare(median?.paint, median?.total) },
        },
        heapMb: benchIdleHeapMb,
        sampleCount: warm.length,
        // µs, so small per-element figures stay legible as integers.
        usPerElement: median && median.elements > 0 ? Math.round((median.total * 1000) / median.elements) : 0,
        usPerCustomElement:
          median && median.customElements > 0 ? Math.round((median.total * 1000) / median.customElements) : 0,
        updateMs: benchUpdatePending.length ? Math.round(benchMedian(benchUpdatePending) * 10) / 10 : null,
      },
    }));
    benchDoneRoutes++;
    benchNextTarget();
  }

  function benchClearResults() {
    setBenchResults({});
    setBenchLastResult(null);
    setBenchStatus('');
    setBenchRouteProgress('');
    setBenchProgress(0);
    benchTotalRoutes = 0;
    benchDoneRoutes = 0;
    benchQueue = [];
    benchCurrent = null;
    benchPending = [];
    benchUpdatePending = [];
    benchNavStartedAt = 0;
  }

  // No in-app baseline. It was tried and removed: the workflow it existed for is
  // pin → change code → *reload* → re-run → read delta, and the reload is precisely where the
  // ~10% cross-session drift lives (Static Small settled 72.2 → 66.3 → 65.1 → 64.2 → 64.0 across
  // sessions while varying only 1.7% within one). A stored baseline would therefore have reported
  // drift as if it were signal. Comparing two pasted result sets is both simpler and honest about
  // what it's comparing.

  async function createTestItem() {
    const p = perspective();
    if (!p) return;
    createdCount++;
    try {
      await TestItem.create(p, {
        name: `Item-${createdCount}`,
        status: createdCount % 2 === 0 ? 'draft' : 'active',
        category: 'dynamic',
      });
    } catch (err) {
      console.error('TestStore: failed to create TestItem', err);
    }
  }

  async function deleteTestItem(id: string) {
    const p = perspective();
    if (!p || !id) return;
    try {
      await TestItem.delete(p, id);
    } catch (err) {
      console.error('TestStore: failed to delete TestItem', err);
    }
  }

  // Force a known, deterministic dataset for the query test page:
  //   Alpha (2 children, 1 mine) · Beta (0 children) · Gamma (1 child, mine)
  async function seedQueryData() {
    const p = perspective();
    if (!p) return;
    try {
      for (const c of await TestChild.findAll(p)) await TestChild.delete(p, c.id);
      for (const it of await TestItem.findAll(p)) await TestItem.delete(p, it.id);

      const alpha = await TestItem.create(p, { name: 'Alpha', status: 'active', category: 'A' });
      await TestItem.create(p, { name: 'Beta', status: 'draft', category: 'B' });
      const gamma = await TestItem.create(p, { name: 'Gamma', status: 'active', category: 'A' });

      const addChild = (parentId: string, label: string, owner: string) =>
        TestChild.create(p, { label, owner }, { parent: { id: parentId, predicate: 'we://test_child' } });
      await addChild(alpha.id, 'a-mine', queryOwner);
      await addChild(alpha.id, 'a-other', 'owner:other');
      await addChild(gamma.id, 'g-mine', queryOwner);
    } catch (err) {
      console.error('TestStore: failed to seed query data', err);
    }
  }

  // ---- AD4M perspective (lazy init for $query testing) ----
  const [perspective, setPerspective] = createSignal<PerspectiveProxy | null>(null);

  const seedItems = [
    { name: 'Alpha', status: 'active', category: 'A' },
    { name: 'Beta', status: 'draft', category: 'B' },
    { name: 'Gamma', status: 'active', category: 'A' },
  ];

  createEffect(() => {
    const p = testPerspective();
    if (!p) return;

    (async () => {
      try {
        await p.ensureSDNASubjectClass(TestItem);
        await p.ensureSDNASubjectClass(TestChild);

        // Ensure seed data exists
        const existing = await TestItem.findAll(p);
        if (!existing || existing.length === 0) {
          await new Promise((r) => setTimeout(r, 500));
          for (const item of seedItems) {
            await TestItem.create(p, item);
          }
        }

        setPerspective(p);
      } catch (err) {
        console.error('TestStore: failed to init perspective', err);
      }
    })();
  });

  // ---- Public API ----
  return {
    // Known values
    stringValue,
    numberValue,
    boolTrue,
    boolFalse,

    // Interactive
    counter,
    typedText,
    toggleValue,
    queryFilterMode,

    // Lists
    fruits,
    fruitCount,
    groups,
    properties,
    fullObject,
    emptyList,
    nested,
    singleConfig,
    benchList100,
    benchGroups,

    // Actions
    increment,
    setTypedText: setTypedTextFromArg,
    toggle,
    setQueryFilterMode: (mode: string) => setQueryFilterMode(mode),
    createTestItem,
    deleteTestItem,
    seedQueryData,
    queryOwner,
    queryIRenabled: queryIRFlag.enabled,
    toggleQueryIR: queryIRFlag.toggle,

    // Benchmark
    benchLastResult,
    benchResults,
    benchStatus,
    benchRunning,
    benchProgress,
    benchRouteProgress,
    benchRecordRender,
    benchClearResults,
    benchRun,
    benchRunAll,

    // AD4M
    perspective,
  };
}

export type TestStore = ReturnType<typeof createTestStore>;
