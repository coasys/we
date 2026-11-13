# NOTES — tree mode on the Coasys canvas (coasys/we#483)

What moved, what was shared, what stayed Workshop-only, and why.

## The shared module

`packages/templates/kit/src/we/canvasTree.ts` — one copy, imported by the
Workshop template and the Coasys space's `canvasPane`. Exported through
`@we/template-kit`:

- `TREE_LOCALS` — `treeMode` (`?tree=1`), `spine`, `order`, `signalType` (`?by`),
  `cardSize`, `voices`, `voiceSummary`. Same locals, same params, on both
  canvases. Declared on the pane, not the graph, because the strip is a sibling
  of the graph and locals only read downward.
- `TREE_QUERIES` — `relationshipKinds` + `treeSignalTypes`, subscribed. Any space
  can name connection kinds and reactions; neither query assumes a workshop.
- `treeLayout({ card })` — one layout expression (`forest` vs `manual`) over one
  `GraphView`. `card` is the caller's freeform park box: 180×135 for the
  Workshop, 200×140 for Coasys. Everything else — the forest options, the field
  `kindSizes`, the `canvasWidth`/`canvasHeight` placement fields — is shared.
  The old `TREE_LAYOUT` const is this function with no argument.
- `TREE_BEHAVIOURS` — `arrange-nodes` swaps in for `drag-node` in the tree;
  `marquee-select` drops; `select` stays ahead of both.
- `treeArrange(canvas)` — the `onNodeArrange` prop: `recordStore.arrangeOnTree`
  with the spine passed through, which only the reader knows.
- `TREE_CARD_STYLE` — one uniform box in the tree, the card's own
  `canvasWidth`/`canvasHeight`/`canvasCardShape`/`canvasContentScale` freeform,
  plus `z` flattening and the `reaction` badge under signal order.
- `TREE_EDGE_RULES` — `s`/`n` anchors + `ignoreRoute` along the spine; other
  connections faint. Inert (`[]`) off the tree.
- `TREE_REFRAME` — reframe on `cardSize` change, in the tree only.
- `TREE_WEIGH` / `TREE_WEIGHTS` / `TREE_VOICE_SUMMARY` — the weigh spec, the
  voice weighting, and the seed's voices summary.
- `treeStrip` — the corner strip: mode toggle, spine picker, order picker,
  signal picker, voices popover. `below` offsets it under pinned chrome where a
  route has some (the Workshop's call pill); the Coasys canvas has none, so the
  strip sits at its container's corner.
- `SIGNAL_IN_FORCE`, `BY_SIGNAL`, `TREE_ON`, `CANVAS_CARD` — the shared
  expression names the other pieces are built from.

## Shared even though it looks Workshop-ish

**Signal ordering and voices.** `order: 'signal'`, the signal picker, the
`voices` weighting popover, `TREE_WEIGH`, `TREE_WEIGHTS`, `TREE_VOICE_SUMMARY`.
These read `SignalType` entities — vocabulary any space defines (the Coasys
space already subscribes them for its Social DNA map) — plus `voices`/
`voicesParam` host functions and `spaceStore.mutedDids`, all generic host
surface. Nothing in them reads `WorkshopKey`. Left out, "By signal" would be an
order the Coasys picker could not offer — and the order picker is part of the
strip the issue asks to share.

## Left in the Workshop

**`TREE_HEAT_RULES`** — moved from `WorkshopTree.ts` into `WorkshopKey.ts`,
beside the vocabulary it reads. Both halves of the rule are Workshop's:

- the trigger is `BY_ORDER` — the `colour=order` lens, a query param only the
  Workshop's key and switcher write or read;
- the fills are `HEAT_LOW_FILL` / `HEAT_HIGH_FILL` / `HEAT_NONE_FILL` — colours
  stored as `@heatLow`/`@heatHigh`/`@heatNone` `TypeStyle` rows that the
  Workshop's key panel writes and nothing else renders.

The Coasys canvas has no lens param and no key panel, so there is nothing for a
heat map to hang off. If Coasys grows an order lens, the rule shape is generic —
the metric/scale expression reads only `local.order` and
`local.treeSignalTypes` — and can be lifted into the kit then.

`WorkshopTree.ts` is gone: everything it held is either the shared module or
the key's heat map.

## Behaviour differences that are deliberate

- `layout` on the Coasys `GraphView` is now the shared expression; its freeform
  branch still emits `manual` with `size: 200×140`, plus `kindSizes` and the
  `canvasWidth`/`canvasHeight` fields — inert for placed cards (positions come
  from placement data), and the same fields `PLACED_CARD_STYLE` already reads.
- `resizable` is now `!local.treeMode` — the Workshop's rule: a resize in the
  tree changes nothing on screen and its handles would sit over the reaction
  badge.
- `edgeStyle: [TREE_EDGE_RULES]` is new; off the tree it evaluates to `[]`, so
  freeform lines are exactly as they were.
- `weigh`/`weights` in the seed options evaluate to `null`/`''` freeform under a
  non-signal order — "weigh nothing", one projection fewer. Signal order is the
  one case the freeform canvas pays for, so the weights are already on the cards
  when the tree comes back.

## Placements are untouched

Switching never remounts the graph — one `GraphView`, one `layout` expression —
and the tree writes structure (`arrangeOnTree`), never coordinates. Freeform
positions live on placements and are only written by `dragOnCanvas`, which the
freeform behaviour list keeps exclusively. Asserted by
`the canvas's tree` in `cartridges.test.ts` (one `layout` prop, the gesture
swap, both handlers present).

## Address parameters

`tree`, `spine`, `order`, `by` (the signal), `voices` sync to the address while
on the canvas via `syncParam`, as the Workshop does. The Coasys space's other
params (`view`, `card`, `channel`, `dna`) are untouched; no name collides.
