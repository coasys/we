# Render benchmarks — what each layer of WE's UI stack costs

Measures WE's renderer and design system against hand-written controls, in a real browser,
including paint. Published figures live in
[docs/architecture/performance.md](../../../../docs/architecture/performance.md).

## Run

```sh
pnpm --filter @we/playground-render-bench dev      # browser harness → http://localhost:3300
pnpm --filter @we/playground-render-bench test     # correctness tests (also run in CI)
pnpm --filter @we/playground-render-bench bench    # headless timings (never in CI)

# production figures — what the doc should quote
pnpm --filter @we/playground-render-bench build
pnpm --filter @we/playground-render-bench preview
```

## The ladder

Four fixtures render **identical content** with one layer removed at each step, so the gap between
adjacent rows is that layer's cost:

| Rung                | Adds                                         |
| ------------------- | -------------------------------------------- |
| Raw DOM             | nothing — `createElement` + inline styles    |
| Plain Solid         | Solid                                        |
| Solid + design sys. | `Column` / `we-text` / `we-button`           |
| WE templates        | the schema renderer over the same components |

`tests/ladder.test.tsx` asserts they stay equivalent. Nothing in the code enforces it — the schema
fixture lives in `src/fixtures.ts` and the controls reimplement it in `src/controls.tsx` — so an
edit to one would otherwise invalidate every published ratio while still looking plausible.

**The controls are not capability-equivalent.** Raw DOM and Plain Solid render the same shape with
similar styling via the same tokens, but have no theming, no hover/focus/active states, no
shadow-DOM encapsulation, and no accessibility affordance beyond a bare `<button>`. "Raw DOM is
faster" always means "faster, and missing all of that".

## Why this is a separate app

It has **no AD4M, no stores, no app shell, and no embedded apps** — none of which the thing being
measured depends on, and all of which add noise a consumer of WE would not share. A team adopting
WE brings their own shell; ours is not representative of theirs.

That absence is load-bearing architecturally: this app cannot build if `@we/schema-solid` or the
design system ever acquires an AD4M dependency, so the benchmark doubles as a portability guard for
the seam its sibling [`portable-ui-slice`](../portable-ui-slice) proves. Verify with
`pnpm why @coasys/ad4m` in this package — it should resolve to nothing.

## Reading the numbers

- **JS work** (`build + mount + flush`) is bracketed by direct `performance.now()` reads. Trustworthy
  at any scale, and the figure that scales.
- **Paint** spans a double `requestAnimationFrame`, so it can never report less than one frame of
  waiting. The `minimal` fixture exists to measure that floor — on a near-empty tree it reads ~20ms,
  which is scheduling latency, not work. Paint is only interpretable well above one frame.
- **Time to screen** is what a user actually waits, floor included. Honest for UX, but it compresses
  ratios because ~20ms of it is fixed for everyone.
- **Spread** is the trimmed range of warm samples (slowest dropped, since plain min–max over five is
  dominated by a single GC pause). A delta smaller than a fixture's spread means nothing.

Protocol: run three times and use the third. The first run of a session is consistently ~15% slower
(V8 tiering, Lit template compilation, per-class `CSSStyleSheet` creation), and cross-session drift
is larger than within-session variation, so only same-session numbers are ever compared.

## Headless vs browser

`bench/` runs the same fixtures under happy-dom in seconds — the fast filter for renderer changes,
because a browser round-trip is slow enough to encourage guessing. It cannot see Paint and
overstates Flush by roughly 2.7×.

**A regression there means stop; a win there is only a hypothesis.** Confirm in the browser before
believing a number, and never publish headless figures.

## Ablation notes

Attribution figures gathered by disabling code and re-running. These informed
[the performance doc](../../../../docs/architecture/performance.md) but are engineering notes rather
than published results — several were measured under an earlier in-app harness on a dev build, so
read them as direction and rough proportion, not as magnitudes comparable with that doc's tables.

**Design system**

- Skipping `removeProperty` for custom properties never written cut Flush 27–42%. An ablation
  disabling `updateAllCustomVars` entirely showed this recovered ~87% of what that path had to give.
- The `JSON.stringify` dirty-check in `DesignSystemElement.updated()` is ~1.6% of Flush. Not worth
  touching.
- Memoising `getKeysForLayers` measured no detectable change. Kept anyway as redundancy removal —
  ~20 primitives were re-deriving per instance what the base class derives once per class.
- **Untested:** all 78 design-system props are registered `reflect: true`, so Lit writes an attribute
  for each, but only ~7 have `:host([...])` selectors that need it.

**Renderer**

- Consolidating per-prop memos into one shared memo per node measured **slower**. Recorded at the
  site in `SchemaRenderer.tsx` so it is not retried blind.
- Removing the per-node wrapper `div` is worth ~11% of the template tax — less than its 2× element
  count suggests, because `display: contents` generates no layout box.
