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
| \`order\`    | Position among the panels sharing an edge — lower is nearer the edge.                          |
| \`size\`     | \`sm\` \`md\` \`lg\` \`full\`. Named, never pixels: only the host can see the viewport.             |
| \`grow\`     | Share of the *spare* room in a column, relative to neighbours. Absent means 1; 0 pins a height. |
| \`displace\` | Push the content aside instead of covering it. Edge snaps only — ignored on a corner.          |
| \`route\`    | Only while this segment is in the path. Absent means every route.                               |
| \`open\`     | Whether to open it as well as place it. Absent means yes — see the warning below.               |

**\`open: false\` when a module's launcher does more than open a panel.** Placing a \`module\` panel
invokes the action its launcher declares, and that is not always "open a panel" — the call module's
is \`goToCall\`, which *joins a call* when there is not one. Declaring the call window without
\`open: false\` would start a call the moment somebody entered the space.

**Never write pixels.** A template cannot see the viewport, and a guessed pixel is wrong on a
display it never ran on. That is what \`size\` and \`grow\` are for.

### Two arrangements on an edge

- A **strip** is panels that \`displace\` the same edge. They stack *inward*: each spans the edge and
  the next sits further in, so the content is inset by all of them.
- A **column** is panels that *float* on the same edge. They divide the edge *along* its length —
  two panels snapped \`left\` share the height, one above the other.

A column divides by base size and \`grow\`: spare room goes out by grow ratio. "The transcript takes
most of the height and the panel under it keeps its own" is a large panel with \`grow\` and a small
one with \`grow: 0\`.

Below 900px of window width a column collapses — every member takes the whole content region as a
full-bleed sheet, since two narrow cards over content leave nothing of either.

### It is a suggestion, not a setting

\`meta.panels\` is the middle rung of three. Whatever the reader last dragged a panel to wins; then
the template's declaration; then the module's own opening bid. The declaration is resolved live and
never written, so switching template or section is non-destructive.

A shell that routes itself — every showcase template does — scopes a declaration with \`route\`
instead, since it has no sections to hang one on.

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
