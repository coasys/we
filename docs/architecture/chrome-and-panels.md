# Chrome and panels

The names for the things on screen around a template, and the rules about which of them moves for
which. Written down because they were being discussed as "the rail", "the sidebar" and "the panel"
without those meaning the same thing twice, and because the rules are not guessable from looking at
the app — a panel that floats and a panel that displaces look identical until something else opens.

## The vocabulary

| Term               | What it is                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sidebar**        | The strip on the **left** — spaces, profile, settings, logout. 80px collapsed, widens on hover to show labels. `SIDEBAR_PX`, `SHELL_SIDEBAR_WIDTH`, `Sidebar.schema.ts`.                                 |
| **Module rail**    | The strip on the **right** — module launchers, space settings, the template and theme pickers. 56px, icon-only, never widens. `CHROME_RAIL_PX`, `CHROME_RAIL_WIDTH`, `ChromeRail.schema.ts`.             |
| **Call bar**       | The bar centred at the **top**, contributed by `@we/module-call`, present only during a call or when one is running to join.                                                                             |
| **Chrome**         | All of the above, plus the editor's editing bar: app furniture that persists across spaces and templates and positions itself. The sidebar and rail are drawn from the **app template**; see below.      |
| **Panel**          | A surface a module opens — the call's video stage, notes, the transcript, the editor's four panels. Also called a **dock** in the code, which is the registry's word for the same thing.                 |
| **Lane**           | Panels along an axis. At a window edge, a band at a given distance inboard, divided along the edge's length: `band` says which, `order` says where in it — see below. In a template, a `$panels` outlet. |
| **Group / seat**   | Panels sharing one place in a lane, as tabs — one showing.                                                                                                                                               |
| **Content region** | The window, minus the bands the app's chrome holds (`meta.frame`), minus every **displacing** panel. What a template is laid out inside.                                                                 |
| **Inset**          | How much one edge of the content region has given up, in pixels. Published as `--we-chrome-<edge>`.                                                                                                      |
| **Band**           | How far the module rail has dropped to clear something. Published as `--we-panel-chrome-top`.                                                                                                            |

Both strips are built from the same `railShell` fragment, which is why "rail" alone is ambiguous.
Reserve **rail** for the right-hand one and **sidebar** for the left, as the code does.

## The app template, and the bands its chrome holds

The sidebar and the rail are not drawn by the shell directly: they are **host parts** an **app
template** places (`meta.role: 'app'`, `host.sidebar`, `host.rail`). WE's own app
(`templates/shell/src/WeApp.schema.ts`) is today's arrangement written as data. An agent may choose
an app of their own — in Settings → Apps & templates, or in the template picker's App section, which sits
above the templates and offers to edit or fork each — and edit it where it is drawn: the editor bar's
**Page | App** switch says which of the two the session edits, one at a time, and WE's app — built
in — is forked from the bar the inspector shows while it is the target. An app of your own is
deleted in Settings → Apps & templates, which puts you back in WE's if it was the one you were in. An app
can also arrive in a bundle — built in by the seed, or installed from a file — with templates, a
theme and record types of its own; see `apps-as-data.md`. Safe
mode always draws WE's. The sign-in screen is the app's to take whole, recompose from WE's parts
(`host.signIn.form`, `host.signIn.accounts`) or redraw, as its chrome is; see `apps-as-data.md`.
Everything else here — the editor's panels and bar, the modals, module chrome, the safety prompts —
the host draws whatever the app says.

**The pattern for any host surface an app may change.** Three depths, as a module's panel has: take it
whole and re-theme it; place its parts in an arrangement of your own, changing their words through
inputs; or redraw it. Two rules make the middle one cheap and safe: what the surface _does_ lives in a
store or inside its parts, never in the arrangement around them (the sign-in step is
`sessionStore.signInStep`), and WE's own version is built from the same parts, so a fix to one
reaches every app that placed it. A surface that is the host asking somebody a question (the safety
prompts) is never offered this — see `protected-pieces.md`.

The geometry does not assume a sidebar. The app declares how much of each edge its chrome holds,
`meta.frame: { left, right, top, bottom }`, and that is the frame (`AppFrame` in `dockGeometry.ts`,
held by `shared/registries/appFrame.ts`) everything measures against: the content region, panel
docking, floating clearance, the rail's band, and `--we-sidebar-width` / `--we-chrome-rail-width`.
WE's app declares `{ left: 80, right: 56 }`, which is what `SIDEBAR_PX` and `CHROME_RAIL_PX` were. An
app with a top bar declares `top`, and the content and the panels clear it; an app with no rail
declares no `right`, and nothing keeps clear of a rail that is not there.

## Where a panel is drawn

Four ideas, each answered in one place:

- **A panel is drawn once.** `PanelHost` draws every panel's content, inside the app's providers,
  into a wrapper of its own; a place holds a `PanelSlot` naming the panel, and the wrapper is moved
  into whichever slot shows it — with `moveBefore` where the browser has it, which keeps an embedded
  page, focus and a WebGL context across the move. So a panel dragged from a template's lane to an
  edge to a card is the same element throughout, and nothing about a place owns a panel's lifetime.
- **A group** is one or more panels sharing a place — tabs when there are several, one showing, the
  rest hidden and still mounted. One component wherever a group is (`PanelGroup` in a template's
  lane; a seat of an edge lane).
- **A lane** is groups along an axis: their order, their share of its length (flex, `grow 1 base`,
  never below a floor), the grips between them, a fold or a strip to put it away. A template's
  `$panels` outlet is one (`PanelLane`); each window edge has its own (`EdgeLanes`).
- **A place** only positions a box: a lane in the page's flow; a lane at a window edge pushing the
  content aside; a lane at an edge over the content, for cards snapped there; or the free layer — a
  card anywhere, a corner, full screen.

How a panel is **framed** is its own option, wherever it is (`PanelFrame`): `window` (a titlebar
with its grip, menu and close), `flush` (part of the page around it, as a sidebar is — a grip and a
close in its corner, shown on hover or focus), or `none`. A panel's declaration chooses; else its
lane's default — `frame` on a `$panels` outlet, flush when unsaid; an app's `meta.edges` for the
panels pushing the content aside at an edge, a window when unsaid. A card over the content is a
window unless its own declaration says otherwise.

The geometry engine (`dockGeometry.ts`) still answers how thick each lane at an edge is
(`displacingLanes`, which the content inset sums, so the two cannot disagree) and where a card on the
free layer goes. It also still works out every lane's division as boxes — the same division the flex
draws, from the same numbers (`laneBase`) — because the drop targets and a drag's origin are measured
from those boxes. Measuring them from the lanes on screen instead is what would let that half go.

## A panel has one position and four states

**Where** it is and **whether it takes room** are separate questions — they used to be one enum of
six placements, which meant a call among three people cost a full-height column of the window.

| State          | What it means                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Floating**   | A card over the content. Takes no room; the content is whole underneath it.                                                                                    |
| **Snapped**    | Floating, parked at one of eight positions (four corners, four edge centres).                                                                                  |
| **Displacing** | Spans its lane and insets the content by that lane's thickness. Offered on the four edge-centre snaps only — a rectangular layout cannot flow around a corner. |
| **Maximised**  | Full screen: the whole window, sidebar included. Every other panel is hidden — never unmounted — until it ends, and the sidebar and rail hide with them.       |

Below `NARROW_VIEWPORT_PX` (900px of window width) displacing is switched off entirely and every
panel floats. A 440px panel beside a 400px viewport is not two usable things.

## An edge is two axes, not two arrangements

Where a panel sits on an edge is two questions — **how far inboard** and **where along it** — and
each has its own coordinate on the placement. A **lane** is a band across the edge; the panels
sharing one divide it along its length.

| Coordinate | What it means                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `band`     | Which lane, counting inward from the edge. Displacing panels only. Absent means a lane of its own. |
| `order`    | Where along the edge, among the panels sharing that lane.                                          |

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

- **Lanes sum, lane-mates do not.** `contentInset` adds each lane's thickness and takes the _widest_
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
divider honours it. A panel can be **folded** to its titlebar: its content is hidden rather than
unmounted, and the bar shows the panel's name — a panel alone names itself inside its content, which
folding hides, so a column of folded bars would otherwise be a column of identical grips. Pressing a
folded bar without dragging opens it; a double-click on it opens it too, rather than going full
screen.

**A fold always takes height**, on every edge, because the titlebar is always horizontal. Down a side
lane that is the axis the lane divides, so the fold's extent becomes the bar and its lane-mates take
the room. Across a top or bottom lane the lane divides the _width_, so a folded member keeps its
width and becomes a bar against the edge; the lane stays as thick as its tallest **open** member, and
only when every member has folded does it shrink to a bar and hand the room to the content
(`laneThickness`, `laneShrunk`). A fold belongs to the **seat**: the titlebar is the seat's, so it
folds every tab stacked there.

Folding is offered wherever there is **somewhere for the room to go** (`canFold`). A float hands its
room back to the screen, so it always may. Across a top or bottom lane the last fold is the one that
hands it back, so there it always may too. Down a side, a displacing panel hands it to a lane-mate, so
it needs an _open_ one — which refuses both a sidebar alone on its edge and the last open member of a
lane, each of which would otherwise leave the edge at its full width holding nothing but titlebars.
Those are what collapsing to the edge is for. An already-folded panel may always unfold, or folding
the second-to-last member would disable the control that undoes it.

### Collapsing a lane to its edge

A whole displacing lane can be put away (`toggleStowLane`): it becomes a **strip** `STRIP_PX` thick
against its edge, with one vertical tab per panel in it — every tab of every seat — and the content
takes the rest. Offered first on the lane's first titlebar (`canStow`), ahead of its tabs and grip —
the same end the strip's open glyph sits at — as double chevrons pointing at the
edge, since it acts on the column rather than the panel; and by dragging the lane's inboard edge past
`STOW_DRAG_PX` and letting go, which dims the lane while the drag says so.

```
 open                        collapsed to its edge
 ┌──────────┬──────────┐    ┌──┬───────────────────┐
 │ Transcr… │          │    │T │                   │
 │          │ content  │    │r │     content       │
 ├──────────┤          │    ├──┤                   │
 │ Notes    │          │    │N │                   │
 └──────────┴──────────┘    └──┴───────────────────┘
```

Every member carries `stowed`, so the lane is stowed when all of them are, and it travels through
saved layouts and resets like any coordinate. Nothing else about a member changes — size, seat,
which tab shows, whether it is folded — so opening the lane brings back exactly what was there.
Gestures that take a panel out of its lane (a drag off it, a snap elsewhere, turning displacing off)
drop the flag; a drop into a stowed lane is not offered, and joining one some other way opens it.

The strip is **one button**: a press anywhere on it opens the whole lane. It leads with the open
glyph and then names every panel in the lane, laid out from its head — from the top down a side, from
the left along the top or bottom — faint until pointed at, like a folded bar's name. There is no
opening one panel on its own. That was tried as a peek, a card sliding out beside the strip, and it
was easy to trigger by accident on a strip this thin, and a panel floating out of a collapsed column
read as the arrangement having come apart.

Opening and closing ease the lane's thickness between the strip's and its own, on the same clock as
the content beside it (`--we-chrome-transition`), and contents re-laid out at every step of that would
arrive crushed and unfold, or fold up on the way out. For the length of the move a panel's titlebar
and contents are held at the lane's open size (`layoutWidth` / `layoutHeight`, through `laidOutAt`),
so the lane uncovers or covers them like a drawer, and they fade in or out (`contentsFaded`); a
closing lane's frames stay on screen until it has shrunk onto its strip, fading whole — borders
included. While stowed, each seat keeps its place along the edge at the strip's thickness, so only the
thickness ever moves. The strip is the lane's own (`StowStrip`), drawn beneath its frames, which
shrink onto it over the top. At rest a panel's contents fill its frame as they always have.

### Bringing a panel into sight

A panel can be open and out of sight three ways: behind another tab of its seat, folded, or in a
collapsed lane. `revealDock` undoes whichever it is — opens the lane, unfolds, brings the tab to the
front —
and flashes the tab when it came forward in a stack (`DockGeometry.landedTab`), because the frame did not
move and which tab is lit is the only change on screen. A drop into a seat flashes the same way.

The module rail depends on it. A launcher's action is usually a toggle, so a button lit for a panel
stacked out of sight used to close a panel nobody could see. `moduleLaunchers` rows carry
`concealed` (the rail lights on `active && !concealed`), and `launchModule` reveals a concealed panel
instead of calling the module; a press that opens a panel reveals it too, so a panel reopening into a
stack comes back in front. Which dock a launcher is about is `moduleRegistry.dockOfLauncher`: the dock
named by its `key`, or the module's first.

### Putting every panel away

Every panel can be put away at once — the eye toggle above the rail's gear, or Cmd/Ctrl+\ — and the
same happens on its own while a shell overlay (settings, profile, about) is up. An overlay is drawn
inside the content region with every panel layered above it, so a settings page opened from a space
used to come up squeezed between that space's sidebars with its floating cards on top, reading as part
of the space rather than somewhere else.

Both are one state (`panelsAway` in the shell store): every panel fades out and is hidden — never
unmounted, so a call keeps its streams — the content region takes back the room they held, and closing
the overlay or the toggle brings them all back exactly as they were. Nothing is written, so there is
nothing to restore. Only the deliberate half is `panelsHidden`, which lights the toggle; an overlay
does not set it. Asking for one panel — a rail launcher, `revealDock` — brings them all back and
closes an overlay in front of them, and a maximised panel that is away stops hiding the sidebar and
rail, or the way back would go with it.

### Home lanes

A `$panels` outlet is a lane in the template's own flow. A `meta.panels` entry with `home:
'<lane>'` starts there, inline and unframed; `snap: 'home'` is the placement. Breaking a section
out is a change of snap, putting it back is snapping to `home`, and reordering the sections in a
lane is `order`. None of it touches the tree, so "Reset layout" restores the author's picture, and
`saveArrangementAsTemplate` writes the reader's placements into a copy's `meta.panels` and nothing
else. A section is placed by the outlet when home and by an edge or the free layer when not; its
content is drawn once and moves between them (see "Where a panel is drawn"). The grip is the host's,
and a drag that takes a section out of its lane carries on from the window once the lane's grip has
gone with it (`carryPastTheGrip`).

**A lane can be a sidebar.** `resize: 'end'` (or `'start'`) on the outlet puts a drag handle on that
edge alone; the width somebody leaves it at is kept per agent and per template
(`shellStore.laneWidth`), clamped to the outlet's `minWidth` and `maxWidth`, and its `width` is where
it starts. `shellStore.toggleLane(name)` folds a lane away and back — its sections stay mounted and
hidden — and a space template may call it, since folding its own sidebar is its own view state. Both
are part of a saved layout and undone by "Reset layout". Below `NARROW_VIEWPORT_PX` a kept width
means nothing, so the lane takes its parent's width and the handle goes; how the page stacks there is
the template's own layout.

**A section is as long as its content unless it says `grow`.** With `grow`, it takes that share of
the length the lane has left, as a panel in a docked lane does, and is held to it — so a section that
fills a sidebar (a tree, a list) reaches the end of the lane and scrolls inside itself rather than
running past it. Its wrapper is a column, so what the section draws can say `height: 100%`.

**Grips are quiet.** A section's grip shows where the pointer or the keyboard is, so a page made of
sections reads as a page; `shellStore.toggleCustomiseLayout` shows every grip at once, for a reader
asking what can be moved.

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
| A **maximised** panel                            | **Chrome that stays paints over it.** The sidebar and rail hide; the call bar sits on the `chrome` layer above every panel, centred on the window, and the panel pads its content by the bar's reserve (`padBottom`). Its titlebar is the way out, and Escape.              |
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

## A panel names itself, once, at the top

The host's titlebar carries the move handle and the window controls and draws **no text** — except
the panel's name while it is folded, when the panel's own header is hidden with its content. A panel's
name is its own to draw — but not its own to design: **open every panel with `panelHeader` or
`panelShell` from `@we/schema-kit`.**

```ts
panelShell({ title: 'Inspector', children: [/* … */] });
panelShell({ title: 'Calls', aside: startCall, children: [/* … */] });
```

That gives a quiet capitalised label — `variant: 'label'`, `text-muted`, uppercase, `letterSpacing:
'wide'` — as the first child, in a `p: '300'` box that clips. Not a heading: the panel's _content_
is the thing being read, and a title competing with it has misunderstood the job. `aside` takes the
one control that belongs beside the name — a record button, a switch, "start a call".

Four rules, each of which was broken by at least one panel before the fragment existed:

- **First child, above every `$if`.** A title inside a condition is missing in the state that most
  needs one — the state where the panel is explaining why it has nothing to show.
- **The panel's name, not a region's.** A capitalised line further down that labels a list reads as
  the panel's name when it is the only one there. Use `sectionLabel` for a region inside a panel; it
  is deliberately quieter so the two do not compete.
- **No second bar.** The titlebar above already has a bottom border. A panel drawing its own bordered
  header sits two bars deep.
- **One padding.** `300`, which `panelShell` applies. Panels share edges, and two paddings read as a
  wobble.

**A panel explains itself behind a glyph, not in its body.** `help` on either fragment puts an info
glyph against the name; pointing at it (or focusing it) shows two to four sentences on how the panel
works. The extraction panel used to say all of that in its body — a lead-in above the chips, a
footnote under the button — and it was read once and then furniture, in a docked panel with no room
to spare. Prose about _how something works_ goes in `help`; prose about _the current state_ (why a
control is disabled, what a pass found) stays in the body, because it is news rather than a manual.
Not every panel wants one: a glyph on every header is noise of its own.

```ts
panelShell({ title: 'Extraction', help: 'A model reads the transcript and writes what it finds …', children });
```

TSX panels cannot call a schema fragment, so they spread `PANEL_TITLE_PROPS` onto a `we-text` —
one definition, two languages.

Two panels are exceptions, and both say so in place: the **call stage**, whose fit-to-content height
is computed from its padding and gap and cannot absorb a header row, and **space settings**, which
opens with the space's avatar and name because it is _about_ a space and a caps label above that
would name the surface twice. Add a third only with the same kind of reason written next to it.

Home-lane sections (`meta.panels` with `home`) are not this. They render inline as cards, so they
keep a card's heading.

## Where the code is

- `packages/app-shell/src/shared/dockGeometry.ts` — every rule above, as pure functions over a
  viewport and a list of panels. Tested without a browser; that is the point of it being pure.
- `packages/app-shell/src/frameworks/solid/stores/ShellStore.tsx` — the state, the drag handling,
  and the custom properties.
- `packages/app-shell/src/shared/registries/dockRegistry.ts` — the frame a panel is wrapped in
  (`frameBox`), over the window or filling its seat in an edge lane.
- `packages/app-shell/src/frameworks/solid/components/PanelHost.tsx` — every panel's content, drawn
  once and moved to its slot.
- `packages/app-shell/src/frameworks/solid/components/EdgeLanes.tsx` — the lanes at the window's
  edges, their grips and strips; `PanelLane.tsx` and `PanelGroup.tsx` — a template's lane and a group.
- `packages/schema-system/kit/src/layout/panelShell.ts` — the header every panel body opens with.
- `packages/templates/shell/src/ChromeRail.schema.ts`, `Sidebar.schema.ts` — the two strips.
