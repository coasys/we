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

## Round 3

Branch head after round 2 was 2d52622b1. This round: memo key tests, the merge of port/split
(dc42a0c96) and port/glow-parity (75703db37), gradients during a drag, the frame queue, and
the rail labels' fade.

### 1. Style memo key coverage

`we-layout/tests/style_memo.rs` has one test per input `style_key` hashes: the same node with
only that input changed must resolve again, then be served its own style. Where the style
reads the input, the test also asserts the style differs. The tests share a lock, because
installing a sheet moves a process-wide generation that every key includes.

Each input was dropped from `style_key` on its own and the file run
(`cargo test --release -p we-layout --test style_memo`). Every drop was red:

| input dropped           | failing test                                |
| ----------------------- | ------------------------------------------- |
| node type               | `the_type`                                  |
| a prop's name           | `a_props_name`                              |
| a prop's value          | `a_props_value`, `a_nested_props_value`     |
| a nested (string) value | `a_props_value`, `a_nested_props_value`     |
| token table fingerprint | `the_token_table`                           |
| theme                   | `the_theme`                                 |
| installed sheets        | `the_installed_sheets`                      |
| viewport width          | `the_viewport_width`                        |
| viewport height         | `the_viewport_height`                       |
| container width         | `the_container_width` (an `lgUpProps` tier) |
| `root_px`               | `each_metric` (metric 0)                    |
| `font_px`               | `each_metric` (metric 1)                    |
| `ch_em`                 | `each_metric` (metric 2)                    |
| `ex_em`                 | `each_metric` (metric 3)                    |
| `lh_em`                 | `each_metric` (metric 4)                    |
| a scope entry's name    | `a_scope_name`                              |
| a scope entry's value   | `a_scope_value`                             |

The assertion each one failed was "changing only this input resolves again" (for the sheets,
"a new sheet resolves again"). Not covered: the two length prefixes (`props.len()`,
`scope.len()`). They only separate inputs that would hash the same as a sequence, and no
change of a single input can show that.

**Does `style_of` read anything the key does not hash?** No. `bag_for`, `type_defaults`,
`role_of`, `direction_of` and `type_role` read the node's type and props and the token
table. `unit_metrics` reads the tokens and `scx.metrics`. `we_style::resolve` reads the bag,
tokens, container width (the tier) and inherited scope. `theme_css::apply` matches the
node's type and props against a synthetic root carrying only `data-we-theme`, never real
ancestors, children, the node id, the slot or the handlers; the sheets it uses are the
built-in ones (static per theme name) and the installed ones (covered by the generation).
Viewport and metrics are passed through but no style reads them today: lengths keep their
units until layout. They stay in the key so a style that starts reading them cannot be
served stale, and for them the cache miss is the whole assertion.

### 2. Merge

port/split dc42a0c96 and port/glow-parity 75703db37 were fetched from coasys and merged
cleanly; `coasys_app` keeps `app.session.set_runtime(...)`. After the merge: `cargo test`
(158 suites, coasys pixel test unchanged), clippy, fmt, the wasm check and the egui-free
script were all green.

### 3. Gradients during a drag

The CPU gradients key a texture on the box's size in pixels, so every frame of a drag
rasterised the dragged lane's gradient again and uploaded it. The fix is in
`gradient::paint`. Boxes with the same gradient, radius, opacity, scale and units (not the
viewport) form a family. On a cache miss:

- if the exact key was also asked for on the previous frame (the size held), rasterise;
- else if the family also missed on the previous frame (it is being resized), draw the
  nearest texture it has, stretched, and ask for one more frame;
- otherwise rasterise.

A scene that never resizes rasterises every box exactly on its first frame, as before, so
the pixel gates are unchanged (the full suite passes). A drag pays one raster on its first
frame, stretches after that, and draws exactly on the release frame, since the size there
equals the last move's. The dragged edge itself is layout and never waits; only the gradient
behind it refines a frame later.

About has no lanes (nothing to drag), so for about the resize case is a window-width sweep
(60 frames, 3 px narrower each), which resizes every page-wide gradient box. Glow,
1280x800, CPU per frame, median (p95):

| case                     | before             | after          |
| ------------------------ | ------------------ | -------------- |
| people drag, ppp 1       | 7.78 ms (9.09)     | 3.47 ms (3.64) |
| people drag, ppp 2       | 20.48 ms (24.93)   | 3.43 ms (3.58) |
| people drag upload ppp 1 | 1.34 MB / frame    | 0 (p95 0)      |
| people drag upload ppp 2 | 5.35 MB / frame    | 0 (p95 0)      |
| people window, ppp 1     | 24.12 ms (27.08)   | 4.44 ms (5.35) |
| people window, ppp 2     | 83.56 ms (89.62)   | 4.54 ms (5.54) |
| about window, ppp 1      | 99.28 ms (108.36)  | 3.26 ms (4.77) |
| about window, ppp 2      | 396.67 ms (422.25) | 3.22 ms (4.30) |
| people rail, ppp 1       | 2.21 ms (5.13)     | 2.16 ms (4.58) |

During the rail hover on people (bench `rail` mode), the only rasters are one box at the start
of each animation and one when it settles (p95 0.07 Mpx at ppp 1, down from 0.16). On about the
rail does not animate: the page repaints every frame on its own (0.26 ms paint-only frames)
and its layout never moves.

"Before" is the same code with the stretch path disabled (`|| true` on the rasterise
condition); everything else, the counters included, is identical. Drag benches:
`cargo run --release -p we-app --example drag_bench -- glow 90 <ppp> 1280x800 people`; rail:
add `rail`. The window sweep was a scratch probe and is not committed.

Tests: `gradient::tests::a_box_resized_every_frame_stretches_until_its_size_holds` and
`a_still_scene_rasterises_every_box_on_its_first_frame` (the second caught a first version
that stretched the second box of a family on its very first frame — exactly the pixel-gate
risk), and `drag_perf::a_drag_rasterises_no_gradient_until_the_width_holds`. All three are
red with the stretch path disabled.

Two remaining costs. An upload of up to a few hundred bytes still happens on some drag frames:
that is a glyph newly wrapped into the font atlas, which is needed. The p95 of the people
drag is the first frame of the drag, which still rasterises once.

### 4. Frames queued before the screen

On miguel eframe uses wgpu (eframe's default feature). egui-wgpu's default surface is
`SurfaceConfig::HIGH_THROUGHPUT`: `PresentMode::AutoVsync` with
`desired_maximum_frame_latency: 2`. On a vsynced display a finished frame can wait behind
another, about one refresh (16.7 ms at 60 Hz) between the pointer and the drawn line that
no CPU saving removes. The windows now take egui's own `SurfaceConfig::LOW_LATENCY`:

- still `AutoVsync`, so no tearing;
- nothing is drawn while idle, because the app is reactive;
- at most one frame queued;
- left at wgpu's default on iOS, where egui notes that one halves the frame rate;
- on macOS, egui-wgpu's resize-jitter workaround still raises it to two while a window is
  being live-resized.

`WE_FRAME_LATENCY=2` puts egui's default back; `WE_PRESENT_MODE=fifo|mailbox|immediate|
auto-vsync|auto-no-vsync` picks a present mode. `immediate` and `auto-no-vsync` may tear, and
wgpu refuses a mode the surface does not offer. Test: `we-app/tests/present.rs`.

**What I could and could not measure.** Xvfb on `:99` has no vblank, and there wgpu runs on
the GL backend over Mesa's software gallium driver (the NVIDIA RTX 3090's Vulkan cannot
present to Xvfb). Presents never wait there, so there is no queue for the setting to shorten.
`scripts/x11-latency/settle.py` sends bursts of 20 XTest moves 2 ms apart and times from the last
move until one screen row shows the lane's border at the pointer (`XGetImage`, ~2 ms per
grab). Two alternating runs:

| queue depth | settle median (p95)                 |
| ----------- | ----------------------------------- |
| 2           | 13.4 ms (18.8), then 19.3 ms (42.0) |
| 1           | 14.1 ms (19.7), then 14.3 ms (18.4) |

That is within noise. Isolated moves 150 ms apart took 18.8 ms (depth 2) and 18.1 ms
(depth 1), as they should: the queue is empty for a single event. Idle CPU was 0 ticks over
5 s with either setting. The effect the change targets only exists on a real vsynced display
(Nico's X11 session on the NVIDIA card), which I did not drive. To check it there: run
`we-app --coasys people --theme glow` with and without `WE_FRAME_LATENCY=2` and drag; with
`WE_FRAME_LOG=1` both show the same per-frame CPU, so any difference felt is the queue.

### 5. Rail labels

The web mounts the rail's labels through a `$if` with `RAIL_REVEAL`: an inline reveal over
250 ms and a fade over 150 ms, the same on exit. `Transitions` now runs the enter fade. A
node carrying one that was not in the last tree starts at opacity 0 and eases to its own,
through the same styles hatch the CSS transitions use, never on the first tree seen.
Tests: `transitions::a_node_a_branch_mounts_fades_in_and_one_there_from_the_start_does_not`
and `rail_transition::the_rails_labels_fade_in_as_it_opens`. Not drawn yet: the inline
reveal (the label opening sideways; while the rail widens it clips the label anyway), slide
and scale, and every exit effect, which needs a node kept on screen after the resolve
dropped it.

### Left

- The incremental-resolve proposal above stands. Resolve is ~1.05 ms of the ~3.4 ms drag
  frame.
- The first frame of a drag or a resize still rasterises each resized gradient once.
- Exit transitions and the reveal/slide/scale enter effects.
- The frame-queue change needs a check on a real vsynced display.
- The disk on miguel filled up mid-round (other workers' builds). I freed my own: a 73 GB
  debug target and scratch worktrees. Nothing of anyone else's was touched.

## Round 4

Lal's review of round 2 (2d52622b1), on top of round 3 (ad91f7a34). There is one commit per finding, each
with a test. The red output below is each test run without its fix.

### P2-2: a lane folded while held kept its drag (c612f82b5)

Paint cleared `_resizeHeld` only on the handle's `drag_stopped`. A lane folded away (or taken out of the
tree) while its handle was held is not painted, so the release never reached the handle and the flag stayed
set. Once the lane opened again, a primary press anywhere resized it from the old press.

Fix: the press records the handle's egui id (`_resizeDragId`, as text, because a `u64` does not survive an
`f64`). `lane_drags`, which runs every frame before the resolve whether or not the lane is painted, now
counts a lane as held only while `ctx.dragged_id()` is that id. Otherwise it clears the flag. egui drops a
drag whose widget was not drawn the frame before (`interaction.rs`), and with the button up nothing has a
drag owner, so both cases clear it. That covers both of Lal's suggestions: clearing on button-up when the
widget is not painted, and checking egui's real drag owner.

Test: `lane_hold::a_lane_folded_while_held_lets_go_of_the_drag`, on the Coasys app at `people`. It presses
the tree lane's handle, drags 30px, folds the lane (`SetLaneCollapsed`), releases, opens the lane again,
then presses and drags 300px into the main view.

    assertion `left == right` failed: move 1: a press elsewhere leaves the lane alone
      left: 630.0
     right: 310.0

### P2-4: transitions saw only resolves (350040b91)

`Transitions` was asked again only when the resolve count moved, while `LayoutKey` also keys on width,
theme, tokens, metrics and viewport. Both now key on one `StyleInputs` (resolves, width, theme, token hash,
metrics, viewport); `LayoutKey` is that plus the drawn-tree count and `y`. A target that moves without a
resolve is now seen when it moves and transitions then, as CSS does on a resize.

A width-only change does not reproduce the bug: the surface report re-resolves on every width change. A
window that only gets shorter resolves nothing, so the test uses a `50vh` height.

Test: `transition_inputs::a_shorter_window_is_not_played_back_at_the_next_resolve`. The window goes from 600
to 400px tall (asserted to resolve nothing), 40 frames pass, then a query param a label reads changes.

    assertion `left == right` failed: frame 0 after an unrelated resolve: the box stays where the window put it
      left: 300.0
     right: 200.0

### P2-1: an authored onResize heard the same width several times (0eeaa20b3)

The early path and paint each compared the width against the drawn one. A template's own `onResize` that
snaps, refuses or defers leaves the drawn width short of the requested one, so both paths asked again, in
the same frame and on every frame after.

Fix: a drag remembers the last width it asked for (`_resizeAsked`, cleared at the press). The early path,
paint and the release ask only for a width it has not asked for yet. This dedupes within a frame and across
frames: each width reaches the handler once per drag. With the host's own wiring (`setLaneWidth`) nothing
changes, because the drawn width already matches.

Test: `lane_handlers::a_handler_that_keeps_the_width_hears_each_width_once`. It uses a hand-built template
whose lane `onResize` invokes `test.resized` and leaves the width alone. The calls are counted through
`StaticHost.dropped`: five 10px moves, then the release at the last of them.

    assertion `left == right` failed: one call per width asked for
      left: 13
     right: 5

### P2-3: reduced motion and a 0 duration mid-flight (62b26b21e)

Reduced motion and the duration were read only when the target changed. A track is now cleared on any frame
where reduced motion is set or its duration is 0. The same applies to a `$if` enter fade already running,
under reduced motion.

Tests, in `we-layout/tests/transitions.rs`. They track a 72→256px width over 200ms, or a 100ms fade, and
read it 50ms in:

    reduced_motion_asked_mid_flight_jumps_to_the_end:        left: 118.0  right: 256.0
    a_duration_dropped_to_zero_mid_flight_jumps_to_the_end:  left: 118.0  right: 256.0
    reduced_motion_asked_mid_fade_shows_the_node:            left: 0.5    right: 1.0

### P3: style memo collisions (a06a50fe1)

Each memo entry now keeps the inputs it was resolved from: type, props, token table, theme, sheet
generation, viewport, container width, metrics and scope. A hit is served only where those inputs are equal
(props are compared structurally, numbers by their bits). On a collision the style is resolved again and
the entry replaced.

The token table now holds its vars behind an `Arc`, so the kept copy is a pointer. `TokenTable::same`
compares pointers first and contents only for an equal table built separately, which then replaces the kept
copy so the next hit is a pointer compare. The 64-bit fingerprint is now only where to look, never the
answer.

Test: `defaults::memo_tests::a_colliding_hash_is_not_served_the_other_inputs_style`. It plants a collision,
putting node A's entry (100px) under node B's hash (200px).

    assertion `left == right` failed: b's own width, not the colliding entry's
      left: Some(Px(100.0))
     right: Some(Px(200.0))

Cost, on the drag bench (people, glow, ppp 1, 200 moves, 3 runs): layout median 1.29 / 1.29 / 1.31 ms before
and 1.31 / 1.31 / 1.32 ms after, about 0.015 ms a frame. The frame was 3.38–3.45 ms before and 3.44–3.47 ms
after, within noise. Kept.

### P3: the masked font test (019ba2c6e)

`drag_perf::a_layout_resolves_each_style_once` detected missing font registration only as an extra style
resolve per node, which the memo now makes a lookup. The new test,
`font_first_frame::a_stack_first_seen_on_the_first_frame_is_in_use_on_it`, lays out text in an installed
family and then text in `VT323, 'DM Sans'`, a two-family stack no install registers. It then asks whether
that chain is among egui's families after the first frame. Registered by `Measure::prepare` before
measuring, egui applies it at once. Registered only when a measure asks, it waits for the next pass, because
text was already laid out. Red, with the `fonts::prepare` call in `Measure::prepare` removed:

    the stack's chain is in use on the first frame that lays it out: ["Boldonse", ..., "VT323",
    "VT323, monospace", "phosphor", "phosphor-bold", "phosphor-fill"]     (no "VT323, DM Sans")

Two observables I tried first did not go red, so I dropped them:

- **Frame-1 vs settled rects on people/glow.** A chain's fallback is the stack's head family, so ASCII
  measures the same either way.
- **Frame-1 vs settled family sets on people/glow.** Its one stack, `'Bricolage Grotesque', system-ui, …,
sans-serif`, needs no registration.

### Session.runtime (16a70f3f6)

The field is private. `Session::runtime()` reads it, and `set_runtime` (which installs `LegacyBindings`) is
the only way to replace it. Every caller in the workspace only read it, and 23 files now go through the
getter.

Test: a `compile_fail` doctest on `Session` that assigns the field, beside one doing the same through
`set_runtime` that must compile, so the first fails for the right reason. Red with the field still `pub`:

    test we-session/src/lib.rs - Session (line 69) - compile fail ... FAILED
    Test compiled successfully, but it's marked `compile_fail`.

### Drag frames, re-measured

These are the round-3 head (ad91f7a34) and round-4 head bench binaries, run alternately, three runs each:
glow, 1280x800, 200 frames, CPU per frame, median (the range over the runs). `people` drags the tree lane.
`about` has no lane, so the resize it does have is the rail's width transition (`rail` mode, the frames
that animate).

| case               | round 3      | round 4      | layout r3 → r4        |
| ------------------ | ------------ | ------------ | --------------------- |
| people drag, ppp 1 | 3.39–3.42 ms | 3.44–3.49 ms | 1.30–1.31 → 1.31–1.35 |
| people drag, ppp 2 | 3.36–3.38 ms | 3.45–3.47 ms | 1.29 → 1.31–1.32      |
| about rail, ppp 1  | 0.26 ms      | 0.27 ms      | 0 → 0                 |
| about rail, ppp 2  | 0.26 ms      | 0.26–0.27 ms | 0 → 0                 |

Frames where the lane's width lagged the pointer: 0 in every `people` run, before and after.

Round 4 costs about 0.05–0.09 ms of a 3.4 ms drag frame (~2%). Split by stage (ppp 2, 3 runs):

- **layout:** +0.02 ms, from verifying memo hits (above);
- **dispatch:** +0.02 ms, from the pre-resolve drag reading egui's drag owner and writing the asked width to
  scratch;
- **resolve:** 1.34–1.35 → 1.35–1.38 ms, within noise;
- **paint, tess, style resolves per frame:** unchanged.

Nothing came back of what rounds 2 and 3 removed: no second style resolve and no gradient raster during the
drag.

Gates at the round-4 head: `cargo test --no-fail-fast` (163 suites, the coasys pixel test unchanged),
clippy `-D warnings`, fmt, the wasm check and the egui-free script all green. Each of the seven commits
builds and passes clippy on its own. The P2-1 commit first carried an unused import that only the next
commit removed; that was fixed in place before the notes.

### Left

- **Exit transitions and `reveal`/`slide`/`scale` enter effects,** as in round 3.
- **A real-display check of the frame queue,** as in round 3.
- **The dedupe in P2-1 is per drag, not per handler result.** A handler that defers and later applies a
  width it was asked for is not asked again for the same width. That is intended (it already has the
  request), but it means a handler cannot rely on being re-asked to retry.
