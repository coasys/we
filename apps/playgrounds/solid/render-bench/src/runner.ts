/**
 * The measurement runner.
 *
 * Renders a fixture, times it in four phases, and reports the median of N samples.
 *
 * WHY THERE IS NO ROUTER
 *
 * The previous incarnation of this harness lived inside the main app and navigated between routes
 * to switch fixtures. That brought a chain of problems that were all really one problem — a router
 * will not re-render the route you are already on:
 *
 *   - repeat samples needed an "/idle" route to bounce through, plus a settle delay
 *   - a click handler that navigated could silently pre-empt the sampler's own navigation, and the
 *     run would hang forever on sample 1
 *   - the results panel rendered inside the measured route, so the suite measured its own output
 *
 * Here a fixture is just a value. Swapping it to `null` unmounts cleanly and synchronously; there
 * is no navigation, no settle delay, and nothing to race. Every one of those failure modes is
 * structurally impossible rather than guarded against.
 */
/** Wall-clock marks for one render. Durations are derived, not measured, so they always sum. */
export type Phases = {
  /**
   * Constructing the tree and inserting it — schema walk, prop resolution, DOM creation, insertion,
   * custom-element upgrade.
   *
   * Not split into build/mount as the previous harness did. That split relied on a probe *component
   * inside the tree*, whose body ran after its siblings were constructed and whose onMount ran after
   * insertion. Here `render()` constructs and inserts in one synchronous call, so there is no
   * boundary to measure between them, and a "mount" column would be reporting something else.
   */
  build: number;
  /** Attached → Lit's async first render and the design-system prop pipeline have flushed. */
  flush: number;
  /**
   * Flushed → the next frame is committed.
   *
   * Measured across a double `requestAnimationFrame`, so it CANNOT report less than one frame
   * interval of waiting. On a near-empty fixture this reads ~20ms — that is scheduling latency,
   * not work. Only interpretable well above one frame; the `minimal` fixture measures the floor so
   * it can be stated rather than guessed at.
   */
  paint: number;
  total: number;
};

export type Sample = Phases & { elements: number; customElements: number };

export type Result = {
  key: string;
  label: string;
  median: Sample;
  /** Trimmed range of warm samples (slowest dropped) as a percentage of the median total. */
  spreadPct: number;
  /** build + flush. Directly measured with no `rAF`, so trustworthy at any scale. */
  jsWork: number;
  sampleCount: number;
  /** Median of the reactive-update burst, for fixtures that measure one. */
  updateMs: number | null;
};

/** Discarded: the first render of a fixture pays one-time JIT and Lit template compilation. */
export const WARMUP = 1;
export const SAMPLES = 5;
const UPDATE_SAMPLES = 5;

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const microtask = () => new Promise<void>((r) => queueMicrotask(r));

type LitElement = Element & { updateComplete?: Promise<unknown> };

/**
 * Render once and time it.
 *
 * `mountFixture` must build and attach the tree synchronously, and return a dispose function.
 * Everything it does lands in Build + Mount; nothing may be deferred, or the attribution is wrong.
 */
export async function timeRender(
  container: HTMLElement,
  mountFixture: () => () => void,
  baselineElements: number,
): Promise<Sample> {
  const t0 = performance.now();
  const dispose = mountFixture();
  const built = performance.now();

  // Lit renders on a microtask. Collect the pending updates first, then await them: walking
  // thousands of elements to find them costs real time, and it is *instrumentation* — a user never
  // pays it. Excluded from every phase, which is why `total` is the sum of the phases rather than
  // raw elapsed time.
  const pending = Array.from(container.querySelectorAll('*'))
    .map((el) => (el as LitElement).updateComplete)
    .filter(Boolean);
  const collected = performance.now();
  await Promise.all(pending);
  await microtask();
  const flushed = performance.now();

  // A single rAF fires *before* paint. Two spans a committed frame.
  await nextFrame();
  await nextFrame();
  const painted = performance.now();

  const all = document.querySelectorAll('*');
  let customElements = 0;
  for (const el of all) if (el.tagName.includes('-')) customElements++;

  const build = built - t0;
  const flush = flushed - collected;
  const paint = painted - flushed;
  dispose();
  return {
    build,
    flush,
    paint,
    total: build + flush + paint,
    elements: all.length - baselineElements,
    customElements,
  };
}

const median = <T>(xs: T[], by: (x: T) => number): T =>
  [...xs].sort((a, b) => by(a) - by(b))[Math.floor((xs.length - 1) / 2)];

/**
 * Median by total rather than per-field, so every reported row is internally coherent. A per-field
 * median would produce a row whose phases do not add up to its own total, each field having come
 * from a different sample.
 */
export function summarise(key: string, label: string, samples: Sample[], updates: number[]): Result {
  const med = median(samples, (s) => s.total);
  const totals = [...samples.map((s) => s.total)].sort((a, b) => a - b);
  // Drop the slowest before measuring spread: plain min–max over five samples is dominated by a
  // single GC pause, which made it useless as the error bar it is meant to be.
  const trimmed = totals.length > 2 ? totals.slice(0, -1) : totals;
  const spreadPct =
    med.total > 0 && trimmed.length ? Math.round(((trimmed[trimmed.length - 1] - trimmed[0]) / med.total) * 100) : 0;

  return {
    key,
    label,
    median: med,
    spreadPct,
    jsWork: med.build + med.flush,
    sampleCount: samples.length,
    updateMs: updates.length ? median(updates, (x) => x) : null,
  };
}

/**
 * Time a reactive update burst against an already-mounted fixture, as **JS work**.
 *
 * Render cost and update cost are different questions: the renderer allocates a memo per prop and,
 * on the web-component path, an effect per prop — so a template can render acceptably and still
 * update badly. Update cost is also paid during interaction, where users notice it.
 *
 * Deliberately does NOT wait for paint. An earlier version bracketed a double `requestAnimationFrame`
 * and reported ~33ms, which was read as a worrying figure for months. It was the frame floor: the
 * same fixture measured this way does about 1ms of actual work. Measuring to the end of the
 * microtask keeps this comparable with the `jsWork` column and free of scheduling latency.
 */
export async function timeUpdates(container: HTMLElement, bump: () => void): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < WARMUP + UPDATE_SAMPLES; i++) {
    const t0 = performance.now();
    bump();
    const synced = performance.now();

    // Same exclusion as timeRender: the walk is instrumentation, not update cost.
    const pending = Array.from(container.querySelectorAll('*'))
      .map((el) => (el as LitElement).updateComplete)
      .filter(Boolean);
    const collected = performance.now();
    await Promise.all(pending);
    await microtask();
    const flushed = performance.now();

    out.push(synced - t0 + (flushed - collected));
  }
  return out.slice(WARMUP);
}
