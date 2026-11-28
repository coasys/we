# Template format: panels

A panel is a surface the reader can move, fold, stack and close: a transcript beside a graph, an
inspector, a call. A template says which panels its interface has and where each starts, in
`meta.panels`. That declaration is a **suggestion**: the host draws the panels, and the reader's own
arrangement outranks it.

## The entry

`meta.panels` is a list of entries, each one panel:

| Key                          | Value                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                         | REQUIRED. Text, stable and the author's to choose: a reader's arrangement is remembered by it.                                                           |
| `module`                     | The module whose panel this places. The host's own panels are named the same way. Excludes `node`.                                                       |
| `dock`                       | Which of that module's panels, by its declared name, where the module has more than one.                                                                 |
| `node`                       | The panel's content, for a panel the template supplies. Excludes `module`.                                                                               |
| `title`                      | Text for its titlebar. Only with `node`.                                                                                                                 |
| `snap`                       | Where it opens: one of `top-left`, `top`, `top-right`, `right`, `bottom-right`, `bottom`, `bottom-left`, `left`.                                         |
| `home`                       | Starts in the template, at the [home lane](#home-lanes) of this name, rather than at an edge.                                                            |
| `order`, `band`, `tab`       | Where along its edge or lane it sits (lower is nearer the start), which lane counting inward from the edge, and its position among tabs sharing a seat.  |
| `displace`                   | `true`: it pushes the content aside rather than covering it. On an edge-centre snap only.                                                                |
| `size`, `box`, `min`, `grow` | How much room it asks for: a named `size` (`sm`, `md`, `lg`, `full`), or a `box` in pixels; the smallest usable box; its share of a lane's spare length. |
| `frame`                      | `window` (a titlebar), `flush` (part of the page around it) or `none`. Absent, the place decides.                                                        |
| `fixed`                      | `true`: a home section that cannot be broken out or moved.                                                                                               |
| `route`                      | A segment or a list of them: the panel is present only while one is in the address. Absent: every route. Whether, never where.                           |
| `open`                       | `false`: placed, not opened. Absent: opened.                                                                                                             |

An entry with both `module` and `node`, or neither, is invalid. An entry placing a module with more
than one panel MUST name `dock`; a host refuses it otherwise, and says which names exist.

**A panel's node** is drawn wherever the host docks it, as a pass of its own, and is a child of the
template's root: it sees the root's `$localState` and `$queries` and draws the root's shared shapes,
however far from the template area it is docked ([Scope across passes](handlers.md#scope-across-passes)).
It reads which panel it is as `panel.id`, and a panel opened more than once (an instance per input)
reads its inputs as `panel.inputs`. A `$panels` outlet MUST NOT be inside a panel's node.

> **Why names, not pixels.** A template cannot see the viewport, and a position it guessed would be
> wrong on a screen it never ran on. A size may be pixels because the host clamps it to the room
> there is.

---

Implemented by: [`types.ts`](../../../packages/schema-system/shared/src/types.ts) (`TemplatePanel`),
[`zodSchemas.ts`](../../../packages/schema-system/shared/src/zodSchemas.ts) (`zTemplateMeta`),
[`templatePanels.ts`](../../../packages/app-shell/src/shared/registries/templatePanels.ts),
[`TemplatePanelBody.tsx`](../../../packages/app-shell/src/frameworks/solid/components/TemplatePanelBody.tsx),
[`panelInstances.ts`](../../../packages/app-shell/src/shared/registries/panelInstances.ts).
Pinned by: [`semanticValidation.test.ts`](../../../packages/schema-system/shared/src/semanticValidation.test.ts)
(module panels, `dock`, `$panels` inside a panel, a panel reading the root's local state); render
vector `render.panels.root-scope`.

## Three rungs

Every reader-visible property of a panel (where it is, how big, whether it is open) resolves from
three rungs, each beating the one below:

1. **The suggestion** — what the panel's own owner offers: a module's opening bid, the host's
   default.
2. **The declaration** — the template's `meta.panels` entry.
3. **The disposition** — what the reader did: dragged it, resized it, closed it, opened it.

A host MUST resolve them in this order, and MUST keep the disposition per interface (per template)
and per panel id, so switching template changes the arrangement without overwriting anyone's
choice, and switching back restores it. A host MUST NOT write a disposition back into the template.
A host SHOULD offer the reader a way to drop their disposition and return to the declaration.

A declaration is **live**: when the template on screen changes, the declarations are the new
template's, wholesale.

**Openness.** The host owns whether a panel is open, unless its module claims the flag as its own
state; then the module's `open` is a request the host resolves against the declaration. A
declaration with `open: false` places a module's panel without opening it, so placing a panel never
makes a module do anything (a call module's opener joins a call).

> **Why a suggestion.** An author improving a layout must not be overruled forever by one stray
> drag, and a reader must not lose their arrangement because they tried another template.

---

Implemented by: [`templatePanels.ts`](../../../packages/app-shell/src/shared/registries/templatePanels.ts),
[`panelScope.ts`](../../../packages/app-shell/src/shared/panelScope.ts) (`activePanels`),
[`dockGeometry.ts`](../../../packages/app-shell/src/shared/dockGeometry.ts) (`resolvePlacement`),
[`ShellStore.ts`](../../../packages/app-shell/src/shared/stores/ShellStore.ts).
Pinned by: the panel vectors (`panels.json`: `panels.active.*`, `panels.placement.suggestion`,
`panels.placement.declaration`, `panels.placement.disposition`, `panels.placement.template-switch`
and the rest; [Conformance](conformance.md#running-each-family)),
[`dockGeometry.test.ts`](../../../packages/app-shell/tests/dockGeometry.test.ts), and the
dock layout's recorded vectors ([`dockLayout.json`](../../../packages/app-shell/src/shared/kernels/vectors/dockLayout.json),
scenarios over the entry points named in [`kernels/dockLayout.ts`](../../../packages/app-shell/src/shared/kernels/dockLayout.ts)).

## Home lanes

```json
{ "type": "$panels", "props": { "lane": "inspector", "resize": "start", "width": 320, "minWidth": 240 } }
```

A `$panels` outlet is a lane in the template's own flow. An entry with `home: '<lane>'` starts there,
drawn inline in its `order` among the lane's sections. Breaking a section out to an edge, and putting
it back, is a change of its disposition, never of the tree.

| `$panels` prop                  | Value                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `lane`                          | REQUIRED. The lane's name, matched by entries' `home`.                              |
| `frame`                         | The frame of a section that declares none. Default `flush`.                         |
| `resize`                        | `"start"` or `"end"`: a drag handle on that edge alone. Any other value is invalid. |
| `width`, `minWidth`, `maxWidth` | The lane's width at the start, and the bounds a reader's resize is held to.         |
| `direction`, `accepts`          | The lane's axis, and which panels a drag may drop into it.                          |

A lane holds sections; a section does not hold a lane. That fixed depth is what keeps a placement a
few numbers, and so what keeps a declaration and a reader's arrangement mergeable per panel.

The outlet is a leaf: it has no children. A host that does not draw panels in lanes MAY draw a home
lane's sections in order at the outlet, or nothing, and MUST NOT fail.

---

Implemented by: [`moduleParts.ts`](../../../packages/app-shell/src/shared/registries/moduleParts.ts)
(`$panels`), [`PanelLane.tsx`](../../../packages/app-shell/src/frameworks/solid/components/PanelLane.tsx),
[`semanticValidation.ts`](../../../packages/schema-system/shared/src/semanticValidation.ts).
Pinned by: render vector `render.panels.outlet`.
