# Graph system conventions

How to decide what belongs in this system's API, where a given decision lives, and what the defaults
are. Read `README.md` first for what the engine *is*; this is about how to extend it without making it
worse.

The forcing constraint behind all of it: **a graph is authored as JSON, by people and by an LLM from a
description.** Every knob you add is a knob something has to get right with no more context than a
sentence like "show me how these ideas connect". That makes the size and shape of the API a design
problem, not a convenience question.

---

## 1. What gets exposed

Ask: **could someone describe wanting this in a sentence about how their graph should look or
behave?**

- *"Keep the connections thin when I zoom out"* → intent. Expose it.
- *"Re-rasterise the layer on transform"* → nobody says that. Mechanism. Fix it in the renderer.

Three tiers, and the boundaries are not negotiable:

### Mechanism — never exposed

Implementation details with exactly one correct answer. There is no author who wants the wrong one, so
offering the choice only creates a way to be wrong.

Examples, all of which were bugs rather than settings:

| Decision | Why it is not a setting |
|---|---|
| `will-change` on the transformed layer | Promoting the layer makes zoom stretch a cached bitmap. Nobody wants a blurry graph. |
| Box vs circle hit-testing | A card is a rectangle. Picking it as a circle is wrong, not a preference. |
| Rebuilding the spatial index after a move | Skipping it means what you can click stops matching what you can see. |
| Broadcasting terminal pointer events | Not doing it leaves a behaviour latched onto a node. |

When you fix one of these, **leave the reasoning where the temptation is** — in a comment at the
property or function someone will reach for again. `will-change: transform` on a pan/zoom surface
looks like free performance; the comment in `GraphView.scss` exists so the blur is not reintroduced by
someone optimising in good faith.

### Intent — style rules and the spec

Genuine choices an author would have an opinion about. These go in `nodeStyle` / `edgeStyle` if they
vary per node or edge, and in the spec if they are graph-wide.

`scaleWithZoom` is the model case. A board wants edges to thicken as you zoom, because the drawing
*is* the document; a large network wants constant on-screen width, because hairlines vanish when you
zoom out to see the whole thing. Both are defensible, so it is a style property — alongside `width`,
`curve` and `dashed`, in the same cascade.

### Performance — automatic, with an override

Never a bare flag, because **an LLM cannot know how many nodes a query will return.** A
`renderer: 'canvas'` in a template is a promise the template cannot keep.

Choose from what is actually observable at runtime (node count, edge count), and offer an explicit
override for the rare case where the author knows better. And no `quality` knob — that is mechanism
wearing an intent costume.

---

## 2. The escape hatch is a plugin, never a flag

Anything genuinely computational or bespoke becomes a **named, registered plugin** — an expander, a
layout, a node renderer, a behaviour, a metric — referenced from JSON by name with parameters.

This is the same bargain templates make with components, one level down, and it is what keeps the spec
from slowly becoming a rendering-engine config file. `{ "metric": "degree", "range": [8, 30] }` is
data; the arithmetic behind it is code with a name.

**A plugin that is not in the catalog does not exist.** `@we/module-graph/src/catalog.ts` is what
reaches the generated AI reference, and the globe is the cautionary tale: a well-designed layer
protocol that an LLM cannot author for, because no catalog of layer names ever reached the docs. If
you add a plugin, add its entry — id, one-line description a non-expert understands, options, and a
worked example. If you cannot write that description, the thing is not ready to be public.

---

## 3. Defaults carry the weight

Most graphs will be authored by something that sets three fields and leaves the rest. So the default
for every option is the answer for the *common* case, and the option exists for the minority one.

| Option | Default | Why |
|---|---|---|
| `layout.type` | `force` | The only layout that says something useful about an arbitrary graph. |
| `expansion.defaultDepth` | `0` | Opening nothing is safe and cheap. A seed that draws its own relations already looks connected; auto-expanding by default would fire queries nobody asked for. |
| `expansion.direction` | `both` | "What is this connected to" rarely means one direction. |
| `expansion.limit` | `50` | Enough to be worth the round trip, few enough to stay readable. |
| `expansion.maxNodes` | `2000` | Roughly where DOM nodes stop being comfortable. Reaching it reports rather than truncates. |
| `behaviours` | `pan-zoom`, `select`, `expand-on-double-click` | Look around, select things, open things. |
| node `shape` | `circle` | A mark, not a box — boxes read as content and most nodes are not. |
| node `size` | `14` | Visible at a glance, small enough that a hundred fit. |
| node `color` | `primary-500` | A token, so it answers to the theme. |
| card `width` / `height` | `160` × 75% | Post-it proportions; height derives so widening keeps the shape. |
| `scaleLabelWithZoom` | `true` | The intuition people arrive with is a board, where zoom magnifies everything. |
| edge `curve` | `bezier` | Bowed edges separate mutual pairs and read better when dense. |
| edge `arrow` | `target` | Relations are directional; hiding that loses information. |
| edge `width` / `color` | `1.5` / `neutral-300` | Present without competing with the nodes. |
| `scaleWithZoom` (edge) | `true` | Same reasoning as labels. |

Two rules when adding one:

1. **The default must be usable with nothing else set.** If a field is only correct in combination
   with another, that is one field, not two.
2. **Absent means default, not off.** `undefined` and `false` must never be the same thing — an
   author omitting a field has said nothing, and a renderer treating that as "no" is how a graph ends
   up with no arrows because somebody did not mention arrows.

---

## 4. Invariants worth protecting

Learned from bugs, each of which was invisible rather than loud:

- **Node geometry comes from one function.** `nodeVisual()` produces both what is drawn and what is
  picked. Two derivations of the same thing drift, and they have twice — once giving a long-labelled
  node a hit area offset from its dot, once giving a 170px card an 18px grab spot. Any future
  renderer must resolve geometry through the same call.
- **Every path that moves a node reindexes.** There is one `reindex()`; use it. Skipping it fails
  silently, and self-heals under a ticking layout, which makes it look intermittent.
- **Claiming an event stops the ones behind it, except at the end of a gesture.** A behaviour holding
  state must be told the gesture finished whether or not something ahead of it also cared.
- **A placeholder must look like one.** In a peer-to-peer system an unresolved reference is normal,
  and "not here yet" must be visually distinct from "nothing there".
- **Nothing silently truncates.** Budgets, paging and dropped references report. A map that quietly
  stops growing reads as complete, and every conclusion drawn from it is wrong.
- **The core stays free of the DOM and of any backend.** It is what makes collapse, budgets and
  expansion testable without a browser, which is the only reason they are tested at all.

---

## 5. Where things live

| Decision | Home |
|---|---|
| What a node is, how it is addressed | `@we/graph-protocol` |
| Expansion, collapse, budgets, hit-testing, styling | `@we/graph-core` |
| Where nodes come from | `@we/graph-expanders` |
| Where nodes go | `@we/graph-layouts` |
| How they are painted | `@we/graph-solid` (or a future adapter) |
| What a template may name | `@we/module-graph/src/catalog.ts` |
| How *this* deployment reads data | the host — `app-shell`'s `GraphHost` |
