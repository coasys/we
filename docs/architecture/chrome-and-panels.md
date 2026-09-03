# Chrome and panels

The names for the things on screen around a template, and the rules about which of them moves for
which. Written down because they were being discussed as "the rail", "the sidebar" and "the panel"
without those meaning the same thing twice, and because the rules are not guessable from looking at
the app — a panel that floats and a panel that displaces look identical until something else opens.

## The vocabulary

| Term               | What it is                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sidebar**        | The strip on the **left** — spaces, profile, settings, logout. 80px collapsed, widens on hover to show labels. `SIDEBAR_PX`, `SHELL_SIDEBAR_WIDTH`, `Sidebar.schema.ts`.                     |
| **Module rail**    | The strip on the **right** — module launchers, space settings, the template and theme pickers. 56px, icon-only, never widens. `CHROME_RAIL_PX`, `CHROME_RAIL_WIDTH`, `ChromeRail.schema.ts`. |
| **Call bar**       | The bar centred at the **top**, contributed by `@we/module-call`, present only during a call or when one is running to join.                                                                 |
| **Chrome**         | All of the above, plus the editor's editing bar: app furniture that persists across spaces and templates, positions itself, and is never part of a template.                                 |
| **Panel**          | A surface a module opens — the call's video stage, notes, the transcript, the editor's four panels. Also called a **dock** in the code, which is the registry's word for the same thing.     |
| **Lane**           | A band across one edge, at a given distance inboard. The panels sharing one divide it along the edge's length. `band` says which, `order` says where in it — see below. |
| **Content region** | The window, minus the sidebar, minus every **displacing** panel. What a template is laid out inside.                                                                                         |
| **Inset**          | How much one edge of the content region has given up, in pixels. Published as `--we-chrome-<edge>`.                                                                                          |
| **Band**           | How far the module rail has dropped to clear something. Published as `--we-panel-chrome-top`.                                                                                                |

Both strips are built from the same `railShell` fragment, which is why "rail" alone is ambiguous.
Reserve **rail** for the right-hand one and **sidebar** for the left, as the code does.

## A panel has one position and four states

**Where** it is and **whether it takes room** are separate questions — they used to be one enum of
six placements, which meant a call among three people cost a full-height column of the window.

| State          | What it means                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Floating**   | A card over the content. Takes no room; the content is whole underneath it.                                                                            |
| **Snapped**    | Floating, parked at one of eight positions (four corners, four edge centres).                                                                          |
| **Displacing** | Spans its lane and insets the content by that lane's thickness. Offered on the four edge-centre snaps only — a rectangular layout cannot flow around a corner. |
| **Maximised**  | Fills the content region. Floats, so it takes no room from anything.                                                                                   |

Below `NARROW_VIEWPORT_PX` (900px of window width) displacing is switched off entirely and every
panel floats. A 440px panel beside a 400px viewport is not two usable things.

## An edge is two axes, not two arrangements

Where a panel sits on an edge is two questions — **how far inboard** and **where along it** — and
each has its own coordinate on the placement. A **lane** is a band across the edge; the panels
sharing one divide it along its length.

| Coordinate | What it means                                                                              |
| ---------- | ------------------------------------------------------------------------------------------ |
| `band`     | Which lane, counting inward from the edge. Displacing panels only. Absent means a lane of its own. |
| `order`    | Where along the edge, among the panels sharing that lane.                                  |

```
 lanes of one panel each          one lane of two            a lane of one, then a lane of two
 ┌────┬────┬──────────┐    ┌─────────┬──────────┐     ┌────┬─────┬──────────┐
 │    │    │          │    │    A    │          │     │    │  B  │          │
 │ A  │ B  │ content  │    ├─────────┤ content  │     │ A  ├─────┤ content  │
 │    │    │          │    │    B    │          │     │    │  C  │          │
 └────┴────┴──────────┘    └─────────┴──────────┘     └────┴─────┴──────────┘
```

Until `band` existed, `order` answered both questions and `displace` chose which — so a displacing
panel could only ever stack inward, a floating one could only ever divide the edge, and the third
picture was unreachable from either side. The arrangement a panel got was decided by a flag about
whether it took room, which is a different question entirely. This is the same knot the six
placements were, one level down: see the note at the top of `dockGeometry.ts`.

Two consequences worth knowing, both in `dockGeometry.ts`:

- **Lanes sum, lane-mates do not.** `contentInset` adds each lane's thickness and takes the *widest*
  panel within one, because two panels sharing a lane are one sidebar cut into pieces. Adding there
  would report an edge twice as deep as it is.
- **Absent `band` means a lane of its own, not lane 0.** That is what keeps every arrangement that
  predates lanes working: two module panels opening on one edge with nobody having arranged them
  stack inward as they always did, rather than silently halving each other. Sharing a lane is
  something a drop or a template asks for.

A floating panel has no band. It takes no room, so there is nothing to be inboard of: every float on
an edge shares one lane over the top of whatever is displacing there.

### Seats, and which panel is on top

Two panels in one lane that name the same explicit `order` share a **seat**: one shows, the rest
stack behind it as tabs, and the titlebar of the one showing carries a strip naming them all. `tab`
orders the strip. Absent `order` is a seat of its own — the same rule `band` follows — so nothing
that never said `order` starts sharing. Below the narrow width a floating lane is one seat, which
is what its full-bleed sheets always were.

Which tab shows, and which floating panel paints over which, are the same question: **the most
recently touched.** Every panel carries a monotonic `activatedAt` (beside the placements, not in
them, so a click pins nothing); `layerOrder` sorts it into a step on the `sticky` band, and a seat
shows its most recently touched member. A pointer landing on a frame, a drag, a resize and
maximising all touch. Chrome stays above every step — `chromeLayering.test.ts` pins the headroom.

### Floors, and folding

A panel says where usable stops: `DockContribution.min` for a module, `min` on a `meta.panels`
entry for a section — the one place a declaration writes pixels, because a floor is a fact about
the content. `floorOf` resolves it per axis over the host's defaults, and every division, drag and
divider honours it. A panel in a lane, or a float, can be **folded** to its titlebar: its extent
becomes the bar, its grow zero, its content hidden rather than unmounted. A lone displacing panel
is refused, since folding it would leave the inset and empty the edge.

### Home lanes

A `$panels` outlet is a lane in the template's own flow. A `meta.panels` entry with `home:
'<lane>'` starts there, inline and unframed; `snap: 'home'` is the placement. Breaking a section
out is a change of snap, putting it back is snapping to `home`, and reordering the sections in a
lane is `order`. None of it touches the tree, so "Reset layout" restores the author's picture, and
`saveArrangementAsTemplate` writes the reader's placements into a copy's `meta.panels` and nothing
else. A section is rendered by the outlet when home and by the dock layer when not — two mount
points, one remount at the gesture, never on a move. The grip is the host's, on a wrapper that
outlives the section and becomes its placeholder.

The one rule that keeps all of this a model: **a lane holds sections; a section does not hold a
lane.** The validator refuses a `$panels` inside a panel's node. Fixed depth is what keeps a
position a few integers, which is what keeps two arrangements mergeable per panel, which is what
makes the declaration a suggestion a drag can overrule.

### Named layouts

The three-rung chain has one user slot. `saveLayout(name)` snapshots everything it holds for the
interface on screen — placements, which tab of each seat is showing, which panels are closed —
under a name, scoped to the template as placements are; `applyLayout` puts it back wholesale.
Offered at the top of the template picker beside "Reset layout".

## Who moves for whom

This is the part that is not guessable, and every layout bug in this area has come from getting one
row of it wrong.

|                                                  | What happens                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A **displacing** panel vs the chrome at its edge | **The chrome moves.** The rail and the editing bar follow `--we-chrome-<edge>` and slide inwards; the panel takes the edge outright. This is why `RAIL_PX = 0` — a panel reserves nothing for the rail.                                                                     |
| A **floating** panel vs the same chrome          | **The panel moves.** It publishes no inset, so nothing slides for it, and it has to clear the chrome itself. `DEFAULT_FLOAT_CHROME`, threaded through the floating paths only.                                                                                              |
| A **maximised** panel                            | Same as floating: it clears the chrome rather than covering it, so its own titlebar controls stay reachable.                                                                                                                                                                |
| Chrome vs a **floating** panel                   | **Nothing moves.** A floating panel takes no room and somebody put it there by hand; chrome that ran away from that decision is worse than an overlap you can see and undo.                                                                                                 |
| Chrome vs **chrome**                             | **The rail moves.** The rail is pinned to the right of the content and the call bar to its centre, so a wide displacing panel moves the rail by its whole width and the bar by half — and they meet. `railBand` is that one collision, and the only one the shell computes. |

Between them these leave nothing for the band to do about panels, which is why `railBand` does not
consider them. It did, and the dead branch could only ever fire when two ways of measuring one edge
disagreed — which is how a rail asked to clear a 74px bar ended up parked halfway down the screen.

## The channel between packages

The shell computes the content region; the rail lives in `@we/template-shell`, the editing bar in
`@we/editor`, the call bar in `@we/module-call`. None of them can import the shell's store, so the
answer goes out as custom properties on `:root`:

| Property                                           | What it holds                                                                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `--we-chrome-left` / `-right` / `-top` / `-bottom` | Where the content's edges are — the same four numbers the content viewport is laid out from. The left includes the sidebar. |
| `--we-chrome-center-x`                             | How far the content's centre has moved from the window's, for anything centred rather than pinned.                          |
| `--we-chrome-rail-width`                           | The module rail's own width, for chrome that sits _outside_ it. The rail must not clear itself.                             |
| `--we-panel-chrome-top`                            | The band — how far the rail has dropped.                                                                                    |
| `--we-chrome-transition`                           | How long chrome should take to follow, collapsing to `0s` mid-drag so it does not trail the cursor.                         |

Chrome composes its position from these and never re-derives them. That rule is enforced by
`chromeInsets.test.ts`, because the failure mode is invisible: a `var()` with a `0px` fallback that
nobody publishes simply stops moving, quietly and for good.

## What a module declares

A module never positions its own chrome or its own panel. It says what it has and the host places it:

- `docks` — a panel, with the edge and size it would like. The host owns where it actually goes,
  because only the host can see the other panels.
- `slots` — chrome contributed at a named anchor. `launcher` puts an icon in the module rail.
- `close` — a key on its store naming the action that dismisses the panel. The host puts the button
  on the titlebar, last, after the position menu — so every panel closes in the same place at the
  same size, which they did not when each drew its own inside its own content.
- `chromeReserve` — a store accessor returning the box its fixed chrome currently occupies
  (`{ top, width }`), so floating panels can clear it and the rail can dodge it. Report the
  **collapsed** height: chrome that grows as somebody opens a disclosure would otherwise shove a
  panel down the screen mid-read.

## Where the code is

- `packages/app-shell/src/shared/dockGeometry.ts` — every rule above, as pure functions over a
  viewport and a list of panels. Tested without a browser; that is the point of it being pure.
- `packages/app-shell/src/frameworks/solid/stores/ShellStore.tsx` — the state, the drag handling,
  and the custom properties.
- `packages/app-shell/src/shared/registries/dockRegistry.ts` — the frame a panel is wrapped in.
- `packages/templates/shell/src/ChromeRail.schema.ts`, `Sidebar.schema.ts` — the two strips.
