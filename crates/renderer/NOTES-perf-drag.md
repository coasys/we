# Lane splitter drag: why it was slow, and what changed

Branch `port/perf-drag` (from `port/split` 4afcac112). The app at the `people` route
under Glow, 1280x800 logical, release build, on miguel.

## How it was measured

- `examples/drag_bench.rs` drives a drag on the tree lane's splitter through
  `RendererApp::frame_body` inside `Context::run_ui`, one `PointerMoved` of 3 px per
  frame, and tessellates the output as eframe does. No window and no GPU, so every
  number is CPU. It prints each frame's stages (from `RendererApp::stages`), the
  layout work counters (`we_layout::counters`: style resolves, taffy passes), the
  vertices, the texture upload bytes, and whether the pointer and the drawn edge
  disagree, then median and p95.

      cargo run --release -p we-app --example drag_bench -- glow 90 [ppp] [WxH]

- `WE_FRAME_LOG=1 we-app --coasys people --theme glow` prints one line per frame from
  the real window: time, input events, pointer, stage times, every lane's drawn width.
  The window runs were on `DISPLAY=:99` (Xvfb, llvmpipe), driven by `xdotool`.
- `perf` cannot run here (`perf_event_paranoid` is 4, no sudo) and there is no
  valgrind. The stage split comes from timers; where a stage needed breaking down I
  used temporary timers, and once a gdb sampler (`SIGUSR1` + `bt`), which proved
  biased towards allocation (signals land at syscall returns) and was used only to
  find the token-table copy below. None of the temporary timers are committed.
- The before column is commit ab194245a (4afcac112 plus the bench and the counters,
  no behaviour change); after is the branch head. Both binaries were run alternately
  on the same machine. The box was shared with other builds, so medians wobble by
  about ±0.3 ms between runs; three alternating runs gave before 6.86 / 6.91 / 6.76 ms
  and after 3.32 / 3.15 / 3.14 ms.

## Before and after

Per drag frame, 90 moves, Glow, 1280x800, ppp 1:

| stage                         | before median (p95) | after median (p95) |
| ----------------------------- | ------------------- | ------------------ |
| whole frame (`run_ui`)        | 6.8 ms (7.2)        | 3.2 ms (3.7)       |
| template resolve              | 1.05 (1.11)         | 1.05 (1.10)        |
| layout                        | 4.57 (4.68)         | 1.48 (1.71)        |
| — font walk (`prepare_fonts`) | 1.87                | 0                  |
| — style resolution            | ~1.1 (in the build) | one node           |
| — taffy compute incl. measure | 1.05                | ~1.0               |
| paint (paint list)            | 0.96 (1.00)         | 0.57 (0.82)        |
| tessellation                  | 0.06                | 0.07               |
| event dispatch                | < 0.01              | < 0.01             |
| `style_of` resolves per frame | 631 (190 nodes)     | 1                  |
| taffy passes per frame        | 1                   | 1                  |
| text measures per frame       | 13 (galley cache)   | 13                 |
| texture upload per frame      | 0 B (≤ 1.1 KB p95)  | same               |
| vertices                      | ~20.7k              | same               |
| frames where the edge lagged  | 90 of 90            | 0 of 90            |
| full frames per pointer event | 2                   | 1 (+ a paint-only) |

Input handling is inside egui's `run_ui` and the "rest" of the frame (about 0.05 ms);
there is no gradient or texture work on this branch during a drag (gradients are
meshes here, cached per size, and the lane's background is flat).

At ppp 2 (2560x1600 physical) and at 2560x1600 logical the CPU frame is the same within
noise (after: 3.86 and 3.94 ms against 3.79 ms in the same contended run); vertices go to
~27.9k at 2560x1600 and nothing else scales with the window or the DPI.

In the real window (llvmpipe, no vsync on Xvfb) the drawn edge was exactly under the
pointer on every input frame (`pointer.x - (72 + tree width) = 0`), and the app stopped
drawing the moment the button went up.

## Why it was slow — ranked

1. **Every move cost two full frames, and showed the width one frame late.** The lane's
   `onResize` was emitted by paint and dispatched after it, so the frame the pointer moved
   on drew the old width; the dispatch asked egui for another frame, which resolved and
   laid the whole tree out again to draw the new one. So a move cost about 2 × 6.8 ms of
   CPU, and under vsync two presents — at 60 Hz the edge trailed the pointer by a frame
   and moved at most every other refresh. This is the "feels slow" part more than any
   single frame time.
2. **Layout resolved every style three times over** (631 `style_of` calls for 190 laid-out
   nodes, 2.97 ms): once in a whole-tree walk before layout that only read `font-family`
   (1.87 ms on its own), once in the build, and in probes.
3. **Every style was resolved again on every layout**, although only the dragged lane's
   `laneWidth` changed: ~1.1 ms of `we_style::resolve` per frame.
4. **Paint copied the theme's whole token table per token read** (`tokens_of` cloned an
   IndexMap out of egui temp data for every `token_color`/`token_px`), ~0.4 ms.
5. The template resolve (1.05 ms) re-evaluates the whole app tree (~900 node resolutions,
   898 node ids of ~81 characters each) every time anything in screen state moves. Left as
   is; see the design proposal.

## What changed (commits, oldest first)

- `we-app: time each frame stage, count layout work, and a drag bench` — `Stages` on
  `RendererApp` (also shown in the F12 overlay), thread-local `we_layout::counters`, the
  bench.
- `we-egui: register fonts from the styles layout resolved` — `Measure::prepare` hands the
  build's effective styles to the frontend before anything is measured; the separate font
  walk is gone. Test: `drag_perf::a_layout_resolves_each_style_once` (631 vs 190 without).
- `we-app: a held lane drag writes its width before the frame resolves` — while the button
  is held, `frame_body` works the width out from the pointer and dispatches the lane's own
  `onResize` **before** `session.resolve()`: the same host wiring, the same
  `ScreenOp::SetLaneWidth`, then resolve → layout → paint as for any write. Nothing is held
  outside screen state; the only per-drag scratch is what the lane already kept (the width
  and pointer at the press) plus a "held" flag. Press and release stay paint's. Test:
  `drag_perf::a_drag_draws_its_width_on_the_frame_the_pointer_moved` (the frame draws
  280 instead of 287 without it; the follow-up frame lays nothing out).
- `we-app: WE_FRAME_LOG …` — the per-frame log, and bench options (window size, vertices,
  upload bytes).
- `we-layout: keep each resolved style under a hash of its inputs` — `style_of` is pure in
  the node's type and props, the token table (hashed once, `TokenTable::fingerprint`),
  theme, viewport, container width, metrics, inherited scope and the installed theme sheets
  (`stylesheet::installed_generation`); each answer is kept per thread under a hash of
  those. Tests: `drag_perf::a_drag_frame_resolves_only_the_dragged_lanes_style` (210 vs 1),
  `we-layout/tests/style_memo.rs`, and the existing
  `theme_css::installed_sheet_replaces_nothing_else`, which caught the installed-sheet
  input on the first try.
- `we-egui: share the stashed token table instead of copying it per read` — `Arc`, replaced
  only when the fingerprint changes. Test:
  `defaults::tests::the_stashed_table_is_shared_and_replaced_only_when_it_changes`.
- `we-app: the drag bench goes out and back …`.
- The rail animation (below): `we-layout: run CSS transitions on width, height and opacity`
  and `we-app: draw the transitions' tree, and keep drawing while one runs`.

The full suite passes at every step it was run (after the font fix, the token-table
commit, and the head); no pixel baseline changed.

## The pointer questions

- **Tracking.** The edge follows the pointer 1:1 at ppp 1 and 2, for 3 px and 40 px
  steps, a 300 px jump in one frame, out and back, and with the pointer leaving the window
  mid-drag. Headless, a sweep of presses along the whole edge (every 14 px of height, at
  −3, 0 and +3 px from it, ppp 1 and 2) started a drag every time; any press within ±6 px
  of the edge does. egui starts a drag-only widget's drag on the press, so there is no
  threshold to lose.
- **"Two very long drags did not register."** Not reproduced: on X11 the original binary
  and the head both took a 500 px drag in 100 steps, a held-then-dragged drag, and a 700 px
  jump. Leads, in order of likelihood: (1) egui ignores a press and a release that land in
  the same frame (`interaction.rs`: "a press-release in the same frame is NOT considered a
  drag"), which only happens when frames are very slow — the glow-parity gradients below
  make a drag frame 22 ms of CPU at ppp 2 before the GPU, and a debug build is slower
  still; (2) the handle is 8 px wide with ±5 px of hit radius and shows only a cursor
  change, so a press 10 px off the edge starts nothing; (3) something specific to the
  platform (macOS trackpad or Wayland) this box cannot run. `WE_FRAME_LOG=1` on the machine
  that shows it would tell which.
- **Repainting.** eframe runs reactively: no input, no frames. egui itself asks for one
  follow-up frame after any input (`InputState::wants_repaint_after`); before, that frame
  redid resolve and layout, now it finds both cached and only paints (~0.6 ms). Nothing
  throttles repaint during a drag; vsync paces presentation.
- **GPU side.** ~20.7k vertices, tessellation 0.06–0.09 ms, no texture upload on a drag
  frame beyond the occasional new glyph (≤ 1.1 KB), the same at ppp 2. At 2560x1600
  logical, ~27.9k vertices.

## Design proposal: incremental resolve (not built)

After the fixes a drag frame is resolve 1.05 + layout 1.5 + paint 0.6 ms, and the
resolve is now the largest single stage. It re-evaluates the whole app tree because the
runtime only knows that _some_ revision moved (`screen.version`, the bag, locals, the
query hub, surfaces), not which node read what. Making it incremental:

1. Record, per resolved subtree, the inputs its expressions read — screen fields by path
   (`shell.lanes.tree.width`), local slots, store paths, query cells — as the resolver
   already threads a `ResolveCx` through every read.
2. Have each write report what it touched (`ScreenOp::SetLaneWidth` touches one lane's
   path; a local write one slot).
3. On a frame, re-resolve only the subtrees whose recorded inputs intersect what moved,
   splicing them into the previous tree by `NodeId`; everything else keeps its `Arc`.
4. Downstream, an unchanged subtree's `Arc` identity lets layout skip the style lookups
   and lets a retained taffy tree mark only the changed nodes dirty (taffy caches per node
   between `compute_layout` calls; today a fresh `TaffyTree` is built every layout), which
   is where most of the remaining ~1 ms of layout goes.

The risk is all in step 1: a read the tracker misses is a stale screen. It wants its own
round with a conformance test that compares the incremental tree against a full resolve
after every write in the recorded routes.

Cheaper items left on the table: the text measure path resolves a font chain per call
(`fonts::resolve` builds the installed-family set each time) and runs egui's galley-cache
hash, ~1.6 µs × 240 `we-text` measures; `running_animation` formats a `NodeId` per painted
node; `LayoutKey` hashes the whole token table every frame where `TokenTable::fingerprint`
now holds it. Each is worth 0.05–0.2 ms.

## Glow parity gradients (measured, not changed)

`port/glow-parity` at 692e97e0d (the branch has since moved; the brief named this commit)
merged onto this branch in a scratch worktree, never committed here. Its gradients are
rasterised on the CPU per pixel into a texture cached per size, so a drag re-rasterises
every gradient box whose size changes — here the tree lane's background.

| per drag frame, Glow, 1280x800 | ppp 1             | ppp 2 (Retina)    |
| ------------------------------ | ----------------- | ----------------- |
| whole frame (CPU)              | 8.56 ms (9.08)    | 22.38 ms (25.54)  |
| gradient rasterise             | 4.30 ms — 50%     | 17.08 ms — 76%    |
| boxes rebuilt / pixels         | 1 / 0.30 Mpx      | 1 / 1.19 Mpx      |
| texture upload                 | 1.19 MB per frame | 4.77 MB per frame |
| paint (incl. rasterise)        | 5.00 ms           | 18.18 ms          |

That is large. Proposals, cheapest first (another worker owns that branch, so none is
implemented):

1. **Rasterise along the axis the gradient varies.** A linear gradient at 180deg (the lane
   backgrounds) depends only on y: cache a 1×H texture keyed on height and draw it
   stretched with `NEAREST`, which keeps the pixel-exact blend the branch exists for and
   makes a horizontal resize free. 0deg/90deg likewise; other angles and radials stay as
   they are. Rounded corners would have to move out of the texture into a textured
   `RectShape` (egui feathers those edges itself, a different rounding from the CPU
   coverage — check the baselines).
2. **Reuse while dragging.** While a box's size is changing every frame, draw the last
   texture stretched and rasterise once the size has held for a frame or two (or on the
   release). One frame of slightly stretched gradient during a drag, exact at rest.
3. Rasterise on a worker thread and swap the texture in when it lands; same visual
   compromise as 2, no frame cost.

## Rail expand/collapse animation

The web animates it. The rail is `transition: 'width 300 ease-in-out'` with
`width: local.expanded ? '256px' : '72px'` (`packages/schema-system/kit/src/layout/rail.ts`
line 211, and the same node in `bundles/coasys.bundle.json`). The `300` is an animation
token: `transition`'s duration tokens become `var(--we-transition-300)`
(`design-system/utils/src/index.ts`), which is `250ms` (`1-tokens/src/animation.ts`) and
what a theme's `animationSpeed` preset overrides; Glow records 250 ms. Easing is CSS
`ease-in-out`, cubic-bezier(0.42, 0, 0.58, 1). The labels beside the icons appear through
`$if` enter/exit transitions (a sideways reveal with a fade), which this round did not
touch.

Implemented here through the engine: `we_layout::animate::Transitions` reads each node's
computed style, starts a track when a transitioned `width`, `height` or `opacity` changes
(CSS rules: none on a node's first frame, a change mid-flight starts from the value on
screen, the new style's duration/delay/easing, non-length values and reduced motion jump),
and returns the tree with each in-between value written into the node's `styles` hatch;
`frame_body` lays out and paints that tree and asks for the next frame only while a track
runs. It is consulted only on frames where the tree re-resolved or a track is running.

Per frame while the rail animates (bench, ppp 1): resolve 0 (nothing re-resolves), layout
~1.4 ms, paint ~0.55 ms, whole frame ~2.2 ms; 15 frames at 60 Hz, 72 → 256 px eased. In the
llvmpipe window ~2.5 ms CPU per frame and ~7 ms frame-to-frame with no vsync. Tests:
`we-layout/tests/transitions.rs` (first frame, duration and end, reversal from the value on
screen, reduced motion, only the changed node rewritten) and
`we-app/tests/rail_transition.rs` (eases open and closed through in-between widths, ends
exactly at 256 and 72, asks for frames only while moving, an idle frame after lays nothing
out). Snapshot harnesses see the end state: kittest advances egui's clock 0.25 s per step,
so a 250 ms transition has finished by the second step, and no harness hovers the rail
before taking a picture.
