# Render performance: what each layer of the stack costs

> Figures measured 2026-07-21, pre template-kit refactor (dev @ ~e43baec). Methodology and
> conclusions stand; re-run `apps/playgrounds/solid/render-bench` before quoting absolute numbers.


A like-for-like measurement of four ways to render the same page — raw DOM, plain Solid, Solid with
the WE design system, and WE's JSON template system — in a real browser, including paint.

Written for anyone deciding whether to build on WE templates, and for anyone working on WE who needs
to know where the time actually goes.

---

## Summary

**WE templates cost about 25% more JavaScript work than hand-writing the same page with the same
components, and about 3.4× a hand-rolled DOM page** — one with none of the design system's theming,
states, encapsulation or accessibility.

On a page of realistic size, none of that is perceptible. Both finish inside a single frame.

The 25% is measured on a 50-post feed — the fixture closest to a real page. The table below is the
simpler 400-card fixture, because it is the only one carrying raw-DOM and plain-Solid rungs to
compare against. Medians of three runs:

| Approach                       | Time to screen | JS work    |
| ------------------------------ | -------------- | ---------- |
| Raw DOM (`createElement`)      | 32.5ms         | 2.5ms      |
| Plain Solid JSX                | 32.4ms         | 0.8ms      |
| Solid + WE design system       | 97.1ms         | 65.8ms     |
| **WE templates (JSON schema)** | **110.3ms**    | **78.1ms** |

- **3.4× raw DOM in time to screen, 31× in JavaScript work.** The gap between those two numbers is
  the frame floor: ~33ms of every measurement is the browser waiting for its next frame, which
  compresses the totals and not the work.
- **Most of that is the design system, not the template system.** Of the 77.3ms the full stack adds
  over plain Solid, the design system is 65.0ms and the template layer 12.3ms.
- **Solid itself is free** — 0.8ms, marginally faster than a `createElement` loop.
- **Below roughly 1,000 elements the choice is unobservable.** Everything finishes within one frame,
  so a user cannot tell which approach rendered the page.

What the template layer buys, for that 12ms: templates that are data rather than code — editable at
runtime, authorable by AI, shareable and forkable without a build step, and safe to accept from
untrusted sources.

---

## Does that hold on realistic content?

The cards above are one `Column` wrapping a text and a button — clean for isolating layer costs, but
a fair objection is that attribution on trivial uniform content may not generalise.

So the same rungs were measured again on **50 feed posts**: 800 template nodes, seven component
types, three levels of nesting, and content that varies per card.

| Approach                       | Time to screen | JS work    |
| ------------------------------ | -------------- | ---------- |
| Solid + WE design system       | 63.8ms         | 37.7ms     |
| **WE templates (JSON schema)** | **64.7ms**     | **49.7ms** |

**The template layer costs 12.0ms here against 12.3ms on the simple cards** — nearly identical,
despite 800 nodes versus 1,200 and a structurally different card. That flatness is the finding: the
template layer's cost tracks neither node count nor node complexity over this range.

The design-system layer's totals are **not** comparable between the two fixtures, because this one is
smaller: 801 elements against 1,201. Per element the two agree closely — 46µs against 54µs — so the
design system costs about the same per unit of work on both, and the raw millisecond gap is size
rather than content. [Where the cost goes](#where-the-cost-goes) works through the normalisation.

Time to screen is 63.8 against 64.7ms: indistinguishable, because both sit near the frame floor.

Raw DOM and plain Solid are deliberately absent here. Hand-rolling an avatar, a badge and icon
buttons stops being a fair equivalent of the real components, and both rungs sit at the floor
regardless.

---

## How to read these numbers

**JS work is the figure that scales.** Build and flush are bracketed by direct `performance.now()`
reads around synchronous and microtask work, so they are trustworthy at any size.

**Time to screen is what a user waits**, but it carries a floor that compresses every comparison:

| Fixture             | Elements | Total  | of which "paint" |
| ------------------- | -------- | ------ | ---------------- |
| Minimal (one node)  | 2        | 33.2ms | 33.1ms           |
| Raw DOM (400 cards) | 1,201    | 32.5ms | 29.9ms           |

A page with two elements takes the same time as one with 1,201, because both are bounded by the
frame rather than by work. Paint is measured across a double `requestAnimationFrame`, which cannot
report less than one frame interval of waiting.

The size of that bound is not a mystery: the displays here run at **60 Hz**, so one frame is 16.7ms
and a double `requestAnimationFrame` spans up to two — **33.3ms**. The measured floor is 33.2ms. On a
120 Hz display it would be roughly half that, and every total would shrink accordingly while the JS
figures stayed the same.

So: **paint is only interpretable well above ~33ms.** Static 1000's 65–72ms across 8,002 elements is
real work; Raw DOM's 29.9ms across 1,201 is a frame boundary.

---

## Raw data

Medians of three consecutive runs, each itself the median of five samples. All figures in
milliseconds; ranges across runs in brackets.

**Note:** these are per-field medians, so a column will not sum exactly to its own total — each field
is the median of that field, and they can come from different runs. Robustness per figure was
preferred over a row that adds up.

### Realistic ladder — 50 posts, 800 template nodes

| Metric          | + DS (attribute) | + DS (`prop:`)   | + Templates      |
| --------------- | ---------------- | ---------------- | ---------------- |
| Build           | 8.6 (8.4–9.0)    | 7.8 (7.6–8.7)    | 23.4 (21.0–24.1) |
| Flush           | 29.1 (28.6–33.9) | 30.3 (29.3–31.8) | 26.1 (25.6–26.5) |
| Paint _(floor)_ | 20.9 (11.9–26.7) | 24.2 (11.7–26.2) | 15.0 (13.7–25.5) |
| **Total**       | **63.8 (49–64)** | **64.3 (49–65)** | **64.7 (64–73)** |
| **JS work**     | **37.7 (37–43)** | **38.1 (37–41)** | **49.7 (47–50)** |
| DOM elements    | 801              | 801              | 1,602            |
| Custom elements | 600              | 600              | 600              |

Each post is one `Column` containing a `Row` (avatar, nested `Column` of two texts, badge), a title,
a body, and a `Row` of two icon buttons with counts. Author, body length and badge variant vary per
post.

### Simple ladder — 400 cards, 1,200 template nodes

| Metric          | Raw DOM  | Plain Solid | + DS (attribute) | + DS (`prop:`)   | + Templates      |
| --------------- | -------- | ----------- | ---------------- | ---------------- | ---------------- |
| Build           | 2.5      | 0.8         | 13.0             | 11.2             | 36.4             |
| Flush           | 0.0      | 0.0         | 52.8             | 48.5             | 40.2             |
| Paint _(floor)_ | 29.9     | 31.6        | 30.9             | 24.2             | 32.2             |
| **Total**       | **32.5** | **32.4**    | **97.1**         | **81.7**         | **110.3**        |
| **JS work**     | **2.5**  | **0.8**     | **65.8 (65–67)** | **59.2 (57–61)** | **78.1 (74–81)** |
| DOM elements    | 1,201    | 1,201       | 1,201            | 1,201            | 2,402            |
| Custom elements | 0        | 0           | 800              | 800              | 800              |

Element counts were identical across all runs in both ladders. The design-system variants mount the
same custom elements as the template variant; the template variant's extra elements are its per-node
wrapper `div`s — exactly 2.0× in both ladders.

Phases: **Build** = construct the tree and insert it. **Flush** = Lit's first render and the
design-system prop pipeline. **Paint** = style, layout, raster, plus the frame wait.

---

## Where the cost goes

JS work attributed to each layer, from the simple ladder (which has the raw-DOM and plain-Solid rungs
the realistic one omits — both sit at the floor regardless):

| Layer           | Simple ladder (1,201 el) | Realistic ladder (801 el) | What it buys                                                                                    |
| --------------- | ------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------- |
| Raw DOM         | 2.5ms                    | —                         | —                                                                                               |
| Solid           | **−1.7ms**               | —                         | Reactivity, components, JSX — and it is _faster_ than a `createElement` loop                    |
| Design system   | **+65.0ms**              | **+36.9ms**               | Theming, hover/focus/active states, shadow-DOM encapsulation, accessibility, design-token props |
| Template system | **+12.3ms**              | **+12.0ms**               | Runtime-editable UI, AI-authorable templates, shareable and forkable without a build            |

The realistic ladder has no plain-Solid rung, so its design-system figure subtracts the simple
ladder's 0.8ms Solid baseline rather than one measured on that fixture. At this size the substitution
is worth well under a millisecond, but it is an approximation and not a measurement.

**The template layer costs almost exactly the same on both fixtures** — 12.3ms and 12.0ms — despite
one having 1,200 nodes and the other 800, and despite the second using seven component types rather
than three.

The design-system layer looks like it moves a lot with content — 65.0ms against 36.9ms — but almost
all of that is the fixtures being different sizes. Normalised:

| Fixture              | DS cost | Elements | Props | Per element | Per prop |
| -------------------- | ------- | -------- | ----- | ----------- | -------- |
| Simple (400 cards)   | 65.0ms  | 1,201    | 4,000 | 54µs        | 16µs     |
| Realistic (50 posts) | 36.9ms  | 801      | 1,950 | 46µs        | 19µs     |

"Props" counts every design-system prop, including those on `Column` and `Row`, because all of them
drive design-system work. Finding 3 quotes a smaller pair of numbers (2,400 and 1,450) for the same
fixtures — those are the subset that lands on custom elements as HTML attributes.

The two normalisations disagree in direction — the simple fixture is 17% more expensive per element
and 14% cheaper per prop — which is what you see when there is no real per-unit difference and the
fixtures simply differ in both element count and props per element. Both residuals are inside the
17–27% run-to-run spread of these particular rows, so the honest reading is that **the design system
costs about the same per unit of work on both fixtures**, and the raw millisecond gap is size.

That makes the design system **5.3× the template system's cost on the simple fixture and 3.1× on the
realistic one**. That ratio is a property of the pages measured, not a constant: it is elements ×
props on one side against template nodes on the other, so a page with fewer, more heavily-styled
components would move it.

---

## Findings

### 1. Solid is free, and marginally faster than hand-rolled DOM

Plain Solid does **0.8ms** of JS work against raw DOM's **2.5ms** — its compiler turns JSX into
template cloning, which beats a loop of `document.createElement` calls. Both are far below the frame
floor, so their totals are identical and the difference is visible only in JS work.

There is no performance argument for dropping to imperative DOM.

### 2. The design system dominates, and it is concentrated in one phase

Of the design system's cost, **flush is roughly four fifths** — 52.8 of 65.0ms on the simple ladder,
29.1 of 36.9ms on the realistic one. That is the per-element pipeline turning design-token props into
CSS custom properties.

This is a Lit and design-system cost, paid identically by hand-written TSX. It is not a
template-system cost, and it is the largest single number in this document.

### 3. `prop:` bindings help on one fixture and not the other — unexplained

Binding design-system props as DOM properties (Solid's `prop:` directive) rather than as HTML
attributes avoids a round-trip through `attributeChangedCallback` → converter → property → update
request. Whether that matters turns out to depend on the fixture:

| Ladder    | saving per run     | median     |
| --------- | ------------------ | ---------- |
| Simple    | +8.0, +7.5, +4.5ms | **+7.5ms** |
| Realistic | +2.4, +0.1, −0.4ms | **+0.1ms** |

On page-shaped content it is worth nothing; on the simple fixture it is worth 11% of design-system JS
work. Binding count does not explain the gap — the realistic fixture has ~1,450 attribute bindings
against the simple one's 2,400, which is the wrong ratio and the wrong direction.

**No recommendation follows from this.** An earlier draft proposed exposing `prop:` variants in the
generated types (they exist today only for the four object-valued state props, so property binding is
not otherwise expressible without a cast). On evidence that does not replicate, that would mean
changing over 800 `we-*` call sites across the repo on the strength of a single fixture.

Note that finding 5's anomaly is also much larger on the simple ladder than the realistic one. Both
oddities live in the same place and may share a cause.

### 4. The tax is a range, and drifts between sessions

| Ladder    | per-run          | median   |
| --------- | ---------------- | -------- |
| Realistic | +16%, +35%, +25% | **+25%** |
| Simple    | +16%, +15%, +23% | **+16%** |

On top of that within-session range, the figure moves between sessions: the simple ladder's tax
against the `prop:` control measured +25% in one session and +32% in another, from identical code.

Two ways of computing this tax give different answers, and it matters which is quoted. Dividing the
median JS-work figures in the raw-data tables gives **+32%** on the realistic ladder and **+19%** on
the simple one. The figures above instead compute the tax within each run and take the median of
those: **+25%** and **+16%**.

The per-run figure is the one used throughout. Each run is a paired comparison — both rungs saw the
same browser session, the same thermal state and the same window — whereas dividing medians combines
numbers from different runs, and with a denominator this noisy that inflates the result. Neither is
wrong, but they are not interchangeable, and the gap between them is itself a measure of how unstable
the design-system rows are.

So the honest statement is **~+25% with a range of roughly +15% to +35%**, not a point value. Both
design-system rungs are the noisiest non-floor-bound rows in the suite (17–27% within-run spread),
and they are the denominator.

### 5. The template system flushes faster than hand-written code, and we do not know why

| Ladder    | Hand-written flush | Templates flush | Difference  |
| --------- | ------------------ | --------------- | ----------- |
| Simple    | 52.8ms             | 40.2ms          | **−12.6ms** |
| Realistic | 29.1ms             | 26.1ms          | **−3.0ms**  |

The template path mounts twice the elements and still flushes sooner, consistently, on both fixtures
— but far more so on the simple one.

Property binding is the obvious explanation and finding 3 rules it out as sufficient. The mechanism
is unknown. **It should not be cited as a template-system advantage until it is understood.**

### 6. Reactive updates are effectively free

Propagating a single store change across 100 bound nodes costs **0.2ms**, identical in all three runs.

Measured as JS work — to the end of the microtask, before paint. Anyone reproducing this should do the
same: bracketing an update with a double `requestAnimationFrame` instead reports ~33ms, which is the
frame floor rather than any work the update did.

---

## How it scales

Measured on the template path:

| Fixture     | Elements | Time to screen | JS work |
| ----------- | -------- | -------------- | ------- |
| Static 50   | 402      | 32.0ms         | 8.5ms   |
| Static 200  | 1,602    | 61.9ms         | 36.2ms  |
| Static 1000 | 8,002    | 248.5ms        | 182.3ms |

JS work scales close to linearly — roughly **23µs per element** across a 20× size range.

Time to screen tells a different story at the small end: Static 50 sits at the floor, so its 8.5ms of
JS work is invisible to a user. The crossover is around 1,000–1,500 elements, below which the approach
you choose does not affect what anyone perceives.

---

## Is this getting better?

The design system is the target, not the template system — it is three to five times the cost, and
roughly four fifths of it is one per-element pipeline turning design-token props into CSS custom
properties.

Recent work there cut flush by 27–42% by skipping redundant CSSOM writes. One further reduction is
identified and unimplemented: all 79 non-state design-system props are registered for attribute
reflection, where roughly seven need it.

On the template system, the largest untried idea is resolving static props at template-install time so
the render path only walks dynamic ones. Removing the per-node wrapper `div` is worth ~11% of the
template tax — less than its 2× element count suggests, because `display: contents` generates no
layout box.

Paint is irreducible for a given element count; the only lever is rendering fewer elements.

Attribution measurements behind these, including approaches tried and rejected, are in the
[benchmark harness README](../../apps/playgrounds/solid/render-bench/README.md).

---

## What this does not tell you

- **Measured on a fast desktop, and nowhere else.** A Ryzen 9 7950X with 64 GB of RAM is close to a
  best case. Ratios should travel better than absolute figures, but neither has been checked on a
  low-end laptop, a phone, or anything thermally constrained — which is exactly where a UI framework's
  cost matters most. Treat the millisecond figures as a favourable bound.
- **Viewport size was not controlled.** Paint only rasterises visible content, so window dimensions
  affect it. Every fixture in a given run saw the same window, so comparisons hold, but the absolute
  paint figures are not reproducible without matching the window.
- **Two page shapes, both list-like.** The realistic ladder is a feed of posts — richer than the simple
  cards, but still a repeated unit in a grid. Neither fixture covers images, long-form text, deeply
  asymmetric layouts, or a page assembled from many different sections.
- **No comparison against other stacks.** Everything here compares WE against hand-written WE, which
  answers "what do templates cost" but gives no calibration against React, Vue, or a mainstream
  component library.
- **The design-system rungs are the least stable measurements** in the suite (17–27% within-run
  spread), and they are the denominator of every tax figure.
- **Interaction beyond a single store update is unmeasured.** Finding 6 covers one signal changing
  across 100 bound nodes. Larger reactive graphs, list reordering and query-driven updates are not
  characterised.

---

## Method

- **Harness:** `apps/playgrounds/solid/render-bench` — a standalone app with no AD4M, no stores, no app
  shell and no embedded apps. None of those are things the renderer depends on, and a team adopting WE
  brings their own shell rather than ours. The harness cannot build if the renderer or design system
  ever acquires an AD4M dependency, so it doubles as a portability guard.
- **Machine:** AMD Ryzen 9 7950X (16 cores / 32 threads, Zen 4), 64 GB RAM, NVIDIA RTX 5070, Linux
  Mint 22.2 (kernel 6.17), displays at 60 Hz. A fast desktop — see the caveat above.
- **Build:** production (`vite build` + `preview`), verified free of Lit's development-mode build.
  Dev-server figures are materially different and are not used here.
- **Browser:** Chrome 148, incognito window (extensions disabled), kept focused for the whole run —
  `requestAnimationFrame` is throttled in background tabs. Measuring inside VS Code's built-in browser
  was ~30% slower and should not be used.
- **Sampling:** each fixture renders 6 times; the first is discarded as warm-up and the median of the
  remaining 5 reported, with a trimmed range (slowest dropped) as an error bar. Three consecutive full
  runs; figures above are medians across those runs.
- **Instrumentation excluded:** the walk that collects pending Lit updates is measurement overhead a
  user never pays, so it is charged to no phase.
- **Equivalence:** every ladder rung is asserted to render identical content and mount identical
  custom elements by `tests/ladder.test.tsx`, which runs in CI. The schema fixtures and the
  hand-written controls are separate implementations, so a silent divergence would otherwise
  invalidate every ratio here while still looking plausible.

A second, headless harness (`bench/`) runs the same fixtures under happy-dom in seconds. It cannot see
paint and overstates flush by roughly 2.7×, so it is used as a filter during development — a
regression means stop, a win is a hypothesis — and never as a source of published figures.

**Reproduce:**
`pnpm --filter @we/playground-render-bench build && pnpm --filter @we/playground-render-bench preview`

---

## Bottom line

Adopting WE templates costs **~+25% in JavaScript work** versus hand-writing the same page with the
same design system — roughly **12ms** for a 50-post feed, with a run-to-run range of +15% to +35%.
That cost is stable across content shape: the same 12ms appeared on a structurally different fixture.

**The design system is 84% of the full stack's cost, not the template system** — so a team weighing
adoption is mostly weighing the design system, which they would also pay for by hand.
