/**
 * Panels — what a template can say about them, and when something should be one at all.
 *
 * Written down here because the capability does not exist until it reaches the generated context.
 * The globe is the cautionary case in this repo: a good layer protocol, no catalogue of layer names
 * in the context, and the conclusion on record is that an LLM cannot author a globe template.
 */
export const panels = `## Panels

A **panel** is a floating or docked surface the host places over a template's content: it can be
moved, resized, closed, and it survives navigation. A template declares which panels its interface
has and where each one starts, in \`meta.panels\`.

### When something should be a panel

**A region is a panel if any of these is true:**

- it must float over other content
- the reader must be able to move or resize it, and have that remembered
- it must be closable
- it must survive navigation
- it competes with other panels for a screen edge

**Otherwise it is ordinary layout** — \`Column\` / \`Row\` / \`Grid\`, in flow, inside the route,
arranged by its parent.

This matters more than it looks. A dashboard where nothing overlaps, nothing is dragged and nothing
persists position is a \`Grid\` of cards, and building it from panels instead gives something
busier, harder to read and worse on a phone. **Do not reach for a panel because somebody said the
word "panel"** — reach for one when a region needs to move, close, float or outlive the route.

### Declaring them

\`\`\`json
{
  "meta": {
    "name": "Workshop",
    "description": "…",
    "icon": "…",
    "panels": [
      { "id": "transcript", "module": "transcribe", "snap": "left", "order": 0, "size": "sm", "grow": 1 },
      { "id": "notes", "node": { "type": "Column", "children": ["…"] }, "title": "Notes", "snap": "left", "order": 1, "grow": 0 },
      { "id": "inspector", "node": { "…": "…" }, "snap": "right", "size": "md" }
    ]
  }
}
\`\`\`

Two kinds of entry, one list:

- **\`module\`** places a panel a feature module already contributes, and opens it. The module still
  owns what is inside it.
- **\`node\`** supplies the content itself. Use \`title\` to name it in the titlebar.

| Field      | What it means                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------- |
| \`id\`       | **Stable, and yours to choose.** Where the reader drags a panel is remembered per id.          |
| \`snap\`     | One of \`top-left\` \`top\` \`top-right\` \`left\` \`right\` \`bottom-left\` \`bottom\` \`bottom-right\`. |
| \`order\`    | Position *along* the edge among the panels sharing its lane — lower is nearer the start.       |
| \`band\`     | Which lane, counting inward from the edge. \`displace\` only. Absent means a lane of its own.    |
| \`size\`     | \`sm\` \`md\` \`lg\` \`full\`. Named, never pixels: only the host can see the viewport.             |
| \`grow\`     | Share of the *spare* room in a lane, relative to lane-mates. Absent means 1; 0 pins a size.    |
| \`displace\` | Push the content aside instead of covering it. Edge snaps only — ignored on a corner.          |
| \`tab\`      | Position in a seat shared with others — entries with the same lane and \`order\` are tabs.      |
| \`home\`     | Start **in the template**, at the \`$panels\` outlet of this name. See "Home lanes" below.        |
| \`fixed\`    | Not promotable: no break-out grip, no drop can move it. For a section with no standalone value. |
| \`min\`      | \`{ width?, height? }\` in pixels — the smallest box the content is usable in. A fact, not a size.  |
| \`route\`    | Only while one of these segments is in the path — a segment or a list. Absent means every route. |
| \`open\`     | Whether to open it as well as place it. Absent means yes — see the warning below.               |

**\`open: false\` when a module's launcher does more than open a panel.** Placing a \`module\` panel
invokes the action its launcher declares, and that is not always "open a panel" — the call module's
is \`goToCall\`, which *joins a call* when there is not one. Declaring the call window without
\`open: false\` would start a call the moment somebody entered the space.

**Never write pixels.** A template cannot see the viewport, and a guessed pixel is wrong on a
display it never ran on. That is what \`size\` and \`grow\` are for.

### An edge is two axes

**\`band\` is how far inboard, \`order\` is how far along.** A **lane** is a band across the edge;
the panels sharing one divide it along its length. Between them the two numbers say everything an
edge can hold:

\`\`\`
 lanes of one panel each          one lane of two            a lane of one, then a lane of two
 ┌────┬────┬──────────┐    ┌─────────┬──────────┐     ┌────┬─────┬──────────┐
 │    │    │          │    │    A    │          │     │    │  B  │          │
 │ A  │ B  │ content  │    ├─────────┤ content  │     │ A  ├─────┤ content  │
 │    │    │          │    │    B    │          │     │    │  C  │          │
 └────┴────┴──────────┘    └─────────┴──────────┘     └────┴─────┴──────────┘
   band 0  band 1              band 0, order 0/1        band 0    band 1, order 0/1
\`\`\`

- **\`band\` is for panels that \`displace\`.** Two that name the same band are one sidebar cut into
  pieces: they share a width, meet flush, and cost the content that width **once**. Two that name
  different bands stack inward and cost it both.
- **Absent \`band\` means a lane of its own**, after every lane that named one. So a declaration that
  says nothing about lanes gets the old behaviour — panels stacking inward — rather than silently
  halving each other.
- **A floating panel has no band.** It takes no room, so there is nothing to be inboard of: every
  float on an edge already shares one lane, and \`order\` divides it. Two panels snapped \`left\`
  share the height, one above the other.

A lane divides by base size and \`grow\`: spare room goes out by grow ratio. "The transcript takes
most of the height and the panel under it keeps its own" is a large panel with \`grow\` and a small
one with \`grow: 0\`.

**Seats.** Two entries in one lane with the same explicit \`order\` share a seat: one shows, the rest
stack behind it as tabs, and the one showing carries a strip naming them all. \`tab\` orders the
strip. Absent \`order\` is a seat of its own, so nothing that never said \`order\` starts sharing.

A stack the reader drags into open space, or into a corner, stays a stack — it just stops being a
place and starts being a name, since there is no lane left to imply membership from. That is a
reader's doing and not something a template can declare: **declare seats with \`order\`, in a lane.**

Below 900px of window width nothing displaces and a floating lane becomes one seat — every member a
full-bleed sheet, tabbed, since two narrow cards over content leave nothing of either.

### Home lanes — sections that start in the template

Picture-in-picture, for any region of a page. A **home lane** is a lane in the template's own flow:
an outlet in the tree says where it is, and \`meta.panels\` entries say which sections start there.

\`\`\`json
{
  "meta": {
    "panels": [
      { "id": "feed",     "node": { "…": "…" }, "home": "main",  "order": 0, "fixed": true },
      { "id": "trending", "node": { "…": "…" }, "home": "right", "order": 0, "title": "Trending" },
      { "id": "people",   "node": { "…": "…" }, "home": "right", "order": 1, "title": "Who to follow" }
    ]
  },
  "type": "Row",
  "children": [
    { "type": "$panels", "props": { "lane": "left", "width": "280px" } },
    { "type": "$panels", "props": { "lane": "main", "flex": "1" } },
    { "type": "$panels", "props": { "lane": "right", "width": "320px", "accepts": "trending,people" } }
  ]
}
\`\`\`

A section renders inline, with no frame, indistinguishable from the layout around it — until the
reader hovers it, when a grip appears in its corner. Dragging the grip breaks the section out into
a panel under the pointer; clicking it breaks it out to its declared \`snap\`. It is then an
ordinary panel: it can be docked, folded, stacked, saved in a layout — and its position menu offers
"Return to page". While it is away the outlet shows a placeholder in its place with the same offer.

- **\`$panels\` is a layout node.** It takes \`lane\` (required), \`direction\` (\`column\` by default, or
  \`row\`), \`accepts\` (section ids it will take, comma-separated; empty means any), and the ordinary
  layout props — \`width\`, \`flex\`, \`minWidth\` — which is how a template holds room for an empty lane.
- **Reordering within a lane is arrangement, not editing.** Dragging one section above another
  rewrites \`order\` on the reader's placement; nothing touches the tree, and "Reset layout" restores
  the author's order. Dragging a section to another lane changes \`home\`; to an edge, \`snap\`.
- **A lane holds sections; a section does not hold a lane.** A \`$panels\` inside a panel's node is
  refused. Fixed depth is what keeps every position a few integers, which is what keeps a
  template's declaration a suggestion a drag can overrule.
- **Not every region should be a section.** The test is standalone value: would somebody want it
  beside a *different* page? Trending, yes; the compose box, no — say \`fixed: true\`, or leave it as
  ordinary layout. A template where every region grows a corner grip reads as a widget grid. And
  \`$each\` over collections is content, never lanes: a kanban's columns are data.
- **A lane is not a Column.** Reach for one when a region should be movable by the reader. Two
  Columns side by side that nobody will ever rearrange are two Columns.

### Placing a module's own pieces

A module publishes **named parts** and composes its own panel out of them, so an interface that
wants them arranged differently places the pieces rather than copying them:

\`\`\`json
{ "type": "$part", "props": { "id": "transcribe.transcriptFeed" } }
\`\`\`

\`subject\` points a part at a different record from the one its module is about — a transcript feed
over a call somebody opened from a link rather than the one being recorded:

\`\`\`json
{ "type": "$part", "props": { "id": "transcribe.transcriptFeed", "subject": { "$": "routeStore.params.call" } } }
\`\`\`

A part naming a module nobody has installed renders nothing and reports itself, the same way a
contribution to an unprovided anchor does. Placing the module's *whole* panel is still
\`{ "module": "<id>" }\` in \`meta.panels\`; parts are for building something else out of it.

**Supplying a module's panel yourself.** A \`meta.panels\` entry carrying **both** \`module\` and
\`node\` means "that module's panel, arranged here": the module goes on deciding whether the surface
is up and how big it is, and the entry decides what is inside. Without it, an interface that wrote
its own version got *two* panels — the module opens its own when its state says so, and it had no
way to know somebody else was already showing it.

### It is a suggestion, not a setting

\`meta.panels\` is the middle rung of three. Whatever the reader last dragged a panel to wins; then
the template's declaration; then the module's own opening bid. The declaration is resolved live and
never written, so switching template or section is non-destructive.

A shell that routes itself — every showcase template does — scopes a declaration with \`route\`
instead, since it has no sections to hang one on. \`route\` says **whether**, never **where**: a
panel that changed position from one page to the next would work until the reader dragged it once,
since a stored placement is keyed by template and panel rather than by route and outranks every
declaration. A page that genuinely needs its own arrangement wants to be a view.

A **section** (\`meta.role: 'view'\`) may declare panels too, and should when the layout is about
that section rather than the whole interface — a graph wants a transcript beside it and an inbox
does not. The shell's declaration wins on a collision of \`id\`.

### Fixed chrome

If a shell pins its own bar or nav strip over the content, declare the band it occupies so floating
panels clear it:

\`\`\`json
{ "meta": { "chromeReserve": { "top": 56, "width": 420 } } }
\`\`\`

Report the height it has when **collapsed**. Chrome that grows as somebody opens a disclosure would
otherwise shove a floating panel down the screen mid-read.`;
