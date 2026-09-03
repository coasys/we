# Panel lanes, tabs, and breakout sections

The branch `feat/panel-lanes-and-sections`. One PR, because it is one idea: **arrangement is data,
and the data has two coordinates.** Everything below is that idea applied to the next surface.

## The model, stated once

An **edge** holds **lanes**; a lane is a band across the edge, counting inward. The panels in a lane
divide it along its length, into **seats**. A seat holds one panel — or several, stacked, of which
one is showing. That is the whole vocabulary:

| Coordinate    | On the placement | Means                                                            |
| ------------- | ---------------- | ---------------------------------------------------------------- |
| which edge    | `snap`           | `left` `right` `top` `bottom`, a corner, or `home` (see below)   |
| which lane    | `band`           | Distance inboard. Absent means a lane of the panel's own.        |
| which seat    | `order`          | Position along the lane. Absent means a seat of the panel's own. |
| which tab     | `tab`            | Position within a shared seat.                                   |
| which showing | `activatedAt`    | The most recently touched, of a seat's members — and of floats.  |

Two rules that keep it a model rather than a list:

- **Absent means "of my own."** A panel with no `band` is alone in a lane; with no `order` it is
  alone in a seat. Sharing is something a drop or a template asks for. This is what keeps every
  arrangement that predates a coordinate working when the coordinate is added.
- **Fixed depth.** Edge → lane → seat → stack, and a section's node may not contain a lane. A
  position is therefore a few integers, which is what keeps two arrangements mergeable per panel —
  which is what makes a template's `meta.panels` a *suggestion* a drag overrules, and what makes
  "save as template" a data copy. Make it recursive and both go.

**Home lanes** put the same coordinates inside the template. A `$panels` outlet is a lane in the
template's own flow; a `meta.panels` entry with `home: '<lane>'` starts there rather than on an
edge. Breaking a section out is `snap: 'home'` → `snap: 'left'`. Putting it back is the reverse.
Reordering sections in a sidebar is `order`. None of it touches the tree.

What decides what a drag means is **who is writing**:

| Tier     | Writes                          | Can break a template |
| -------- | ------------------------------- | -------------------- |
| Reader   | placements — per person, device | never                |
| Composer | `meta.panels` entries           | never                |
| Author   | the tree, the lanes, the nodes  | that is the job      |

The reader tier is this PR. "Save as template" is the bridge to the composer tier. The visual
editor is the author tier and is unchanged.

## Phases

Each phase is a commit, green on its own: typecheck, `@we/app-shell` tests, `validate`, and the
context regenerated where a store member or the declaration changed.

### 0. Lanes — done

`band`/`order` separated; `edgeGroups`; `columnLayout` for a displacing lane; `arrangeDrop`;
`laneAxis`; legacy `order` migrated onto `band`. 152 geometry tests.

### 1. z-order

Every frame is `zIndex: 'sticky'`, one flat layer resolved by registry order — a panel registered
after the one you maximised paints over it, forever.

- `FloatPlacement.activatedAt` — a monotonic counter, not a timestamp; the store seeds it from the
  largest stored value so it survives a reload.
- `layerOrder(placements)` in `dockGeometry`: sorted by `activatedAt`, published as
  `DockGeometry.layer` (a number on the `sticky` band, `200 + n`). The frame binds `zIndex` to it.
- `raiseDock(id)`: written by pointerdown on a frame, `beginDockMove`, `beginDockResize`,
  `toggleMaximiseDock`. Maximising is an activation, so it comes to the front; a float clicked
  afterwards comes forward over it, which is what was asked for.
- `chromeLayering.test.ts` extended: chrome still above every panel layer.

### 2. The divider

Two bugs, both already true before lanes and both extended by them.

- **It is drawn where it cannot be seen.** The grip lives inside the earlier panel's frame at
  `bottom: -6px`, and the frame is `overflow: hidden`, so the outer half — and the whole accent
  line — is clipped. A divider is a property of the *seam*, not of a panel. It moves out of the
  frame: `DockGeometry.seam` publishes the gap after each seated panel, and the frame's wrapper
  (outside the clipped box, where `insertLines` already lives) draws a fixed `we-resize-handle`
  over it. Both panels' facing grips are suppressed.
- **It can only travel a fraction of the lane.** `resizeColumn` clamps within the sum of two stored
  bases, which for a `size: 'sm'` declaration are 16:9 card heights — 120px of travel on a 900px
  column. The first frame of a divider drag **normalises the lane**: every member's base becomes
  its rendered extent and its grow becomes the same number. Slack is then zero, the clamp is in
  real pixels, and a later window resize preserves the split instead of pulling it back to the
  declared ratio.

### 3. Per-panel minimum size

`MIN_DOCK_PX` and `MIN_FLOAT_PX` are global. A call stage and a transcript have different floors,
and lanes multiply the ways a panel is squeezed.

- `DockContribution.min` — a store key returning `{ width?, height? }`, in the pattern of `aspect`.
- `TemplatePanel.min` — `{ width?, height? }`. A floor is a fact about the content, which is why
  it is the one place a template writes pixels.
- `DockRequest.min`; `columnLayout`, `resolveDock`, `resizeDock`, `resizeColumn` floor per panel,
  falling back to the constants.

### 4. Collapse to titlebar

`FloatPlacement.collapsed`. A collapsed panel's extent along its lane is the titlebar; its grow is
zero; its content is `hidden`, not unmounted. A titlebar caret toggles it. Offered for lane members
and floats; greyed for a lone displacing panel, where collapsing would leave the inset and empty the
edge. This is also what `MIN_FLOAT_PX` was silently preventing.

### 5. Tabs

The overflow valve, and the piece of the split tree worth taking. Bands raised how many panels can
be on screen at once; this is what lets an edge hold more than it can show.

- Two panels sharing `band` **and** `order` explicitly share a seat. Absent `order` is a seat of
  its own — the same rule as `band`, so nothing that never said `order` changes.
- `tab` orders a seat's members; `activatedAt` picks the one showing. The seat's base and grow are
  the showing member's.
- Inactive members keep their frame, `hidden`. **Nothing remounts.** The showing member's titlebar
  carries a tab strip of its seat-mates (`DockGeometry.tabs`), each a `raiseDock`.
- A drop on the centre of a seated panel is `mode: 'tab'`; `arrangeDrop` writes the seat's band
  and order and appends a `tab`.
- Below 900px, every lane collapses to one seat — the mechanism the narrow-viewport sheets always
  were, now the same code.

### 6. Named layouts

The three-rung chain has one user slot. `saveLayout(name)` / `applyLayout(name)` /
`deleteLayout(name)` over the placements for the current template scope, in `localStorage` beside
them. `layoutNames`, `activeLayout`. The Workshop's "recording" and "reviewing" arrangements.

### 7. Home lanes and breakout sections

Picture-in-picture, generalised from `<video>` to any region of a template.

- **Declaration.** `TemplatePanel.home: '<lane>'` and `fixed: true` (not promotable). A `$panels`
  outlet — `{ type: '$panels', props: { lane, direction, accepts } }` — is a layout node that
  renders the sections whose placement says `home: lane`, in `order`. A lane with none renders
  nothing; a template that wants it to hold width says so with `minWidth`.
- **Placement.** `snap: 'home'` plus `home`. `edgeOfSnap('home')` is null; it neither displaces
  nor floats. The frame renders nothing for it; the outlet renders the body.
- **Two mount points, one remount at the gesture.** Inline in the template's flow when home; in the
  dock layer when not. A remount on a deliberate, rare transition is not the hazard the frame
  guards against, which is remounting on *move*. Sections are schema nodes: a re-query and a scroll
  reset, once. Module panels never take this path.
- **The affordance is host chrome over the section, not inside it.** The outlet wraps each section
  in a positioned host box carrying a hover-and-focus-revealed corner grip. Press-and-drag on it
  breaks out and begins the panel drag in one motion; click alone breaks out to the declared snap.
  The wrapper outlives the section, so the grip keeps its pointer capture through the remount, and
  becomes the placeholder — "Trending is floating · Bring back" — while the section is away.
- **Drops.** Seams between an outlet's children are `columnSlots` over their rects; a lane
  registers its element and direction so the store can measure them. `arrangeDrop` gains
  `mode: 'home'`. `accepts` refuses what the lane will not take.
- **Save as template.** `saveArrangementAsTemplate()`: a copy of the schema with the resolved
  placements written into its `meta.panels` — `home`, `order`, `snap`, `band`, `tab`, `size`,
  `grow` — handed to `templateStore.saveTemplateAs`. The tree is untouched. The new fork's own
  placements are cleared so it does not open showing itself as modified. Offered beside "Reset
  layout" wherever `layoutDirty`.
- **Validator.** A `$panels` outlet inside a section's node is an error. Lanes hold sections;
  sections do not hold lanes.

### 8. Drag session and drop density

- `beginDockMove` sets `html[data-we-dragging]` through the drag package so hover chrome stands
  down — the corner grips are hover chrome and must not flicker under a passing panel.
- The insert lines take their thickness and role from the shared drop line.
- **One target family at a time.** A dragged panel currently shows eight snap markers, band lines,
  lane seams, and now tab and home-lane targets. Home-lane seams show while the pointer is over the
  content region; an edge's band lines and lane seams show while the dragged panel overlaps that
  edge's outer band; snap markers stay, since they are small. Same arbitration, less on screen.

### 9. Prove it

- **Twitter** gains `left` and `right` home lanes and two sections in `right` — the space's
  reactions and its members. The spacer column becomes a lane; the empty `left` lane sits under
  the nav so a section can be carried across. The old "no fake suggestions rail" objection is
  respected: both sections show real data or say why they are empty. The **feed is not a section**:
  it holds the routes, and a section's node has no router to hand `$routes` its pages — so "the
  feed full-screen" is a follow-up (a route outlet inside a section), not a declaration.
- **Workshop**'s two left panels become a displacing lane (`band: 0`) with a floor on the
  transcript. The board stays a route, for the same reason as the feed. The right-hand column is
  unchanged.
- The panels fragment gains the lane rule with the force the panel rule has: *a lane is for a
  region a reader might move, break out or swap; `$each` over collections is content, not lanes.*
  Kanban, Discord's channel list and every chrome template stay as they are, deliberately, as the
  counter-example.
- Context regenerated; `chrome-and-panels.md` updated; `showcase.test.ts` covers the new shapes.

## Out of scope, on purpose

- **The composer tier** — a skeleton library and a widget palette dropped into lanes in the editor.
  Its own PR: it needs sections to be self-describing (`requires`), and an editor rule treating a
  section's node as atomic. This PR makes it possible; it does not build it.
- **Retrofitting the rest of the showcase.** Instagram, YouTube and Discord have honest lanes and
  should get them; after this lands, with the two above as the pattern.
- **Popouts to an OS window.** A multi-window problem, not a layout one.
- **Named layouts per space.** Scope is the template, as placements are. Revisit if wanted.
- **Layout undo.** `resetDockToLayout` covers the disaster case; VS Code has none either.

## What is deliberately not being unified

The drag *gesture*. `@we/drag` is the session and the payload, not the gestures, by its own account:
a panel drag carries a dock id and lands on computed rects; a Pocket drag carries a record reference
and lands on a registered zone. Phase 8 shares the state and the feedback and leaves the two
gestures as they are.
