# coasys — recorded snapshot of the Coasys space

`snapshot.json` is a recording of the real TypeScript WE app (`apps/we-preview`,
`@we/backend-inmemory`) rendering `bundles/coasys.bundle.json` over the fixture space in
`fixture.json`. The Rust app consumes it headless:

```sh
cargo run -p we-app -- dump --snapshot fixtures/coasys/snapshot.json --route '/space/preview-coasys'
```

## Files

| file            | what                                                                                                                                                                                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixture.json`  | Deterministic in-memory space "Meridian Commons" (dataset `preview-coasys`): agents, channels+messages, calls+transcripts, board/canvas landmarks+placements, tasks, signals, relationships, DNA vocab, workflows, presence. Fixture epoch `createdAt: 2025-10-01T00:00:00.000Z`.                                                      |
| `snapshot.json` | Recorded `{ meta, stores, queries, invokes, routes }`. `routes.<id>` is the primary shape. Regenerate with `crates/renderer/scripts/record-coasys.sh`.                                                                                                                                                                                 |
| `media/`        | The images the recorded routes paint, by their address (`media/coasys.org/films/film-poster-r13.webp` is `https://coasys.org/films/film-poster-r13.webp`), as downloaded on 2026-11-15. `coasys_render` serves them from here (`we-app/tests/support/media.rs`) so a pixel gate never compares against whatever the site serves today. |

## Snapshot shape

`meta` — `{ format: 'we-snapshot@2', fixture, dataset, flatScope, captureTheme }`.
`format` is the version gate a reader checks before trusting the layout — E6 round 3
reads it; there is deliberately no top-level `version` field. `flatScope` names the
route the flat tables repeat (`index`, or `null` when a `--routes` subset left it out —
the flat tables are then empty on purpose); `captureTheme` is the theme every route was
recorded under (asserted identical per route).

**`routes.<id>` — the primary shape.** Per-route truth: `web`/`rust` paths, `path`,
`params`, `theme` (the theme that capture ran under), the resolved `members` tree,
`queries`, `agents` (`$agent` profiles), `absent` (members that did not read back a
value — `undefined` at runtime, filtered out by the surface's tier, or unserializable;
not a capture failure), and `invokeTargets` (the `$invoke` strings the surfaces declare).

`routes.<id>.queries` is a **list of captures**, one per `$queries` declaration the
route's surfaces carry. A query's identity is its declaration site plus its resolved
request, not its local name — the tree's `signalTypes` sorts by name and the
inspector's does not. Every capture — answered, skipped or failed — carries the same
identity fields:

- `name` — the local query name (`local.<name>` in the template).
- `scope` — the declaration site: the canonical path of the `$queries`-holding node
  inside the bundle, e.g. `template.meta.panels[inspector].node`,
  `template.routes[/calls]`, `pages[about]`. `scope` + `name` names the declaration; a
  same-named query under another `scope` is another capture.
- `dataset` — the resolved dataset identity the bridge ran the query against
  (`preview-coasys`); `null` when resolution failed before a dataset existed.
- `request` — the resolved request handed the query adapter (entity +
  where/scope/order/limit/include), when resolution produced one.
- `surfaces` — which of the route's scanned surfaces declare it. The scan is static
  over the declared tree, not an observation of only-mounted surfaces: `root`
  recursion reaches panel, route and recordView declarations wherever they sit, so a
  route's capture list can name declarations its own `route:` surface does not mount —
  `scope` says where the declaration actually lives.

Then exactly one outcome:

- `rows` — an answered query (a real empty answer keeps `rows: []`).
- `skipped: 'when' | 'unanchored-scope'` — a descriptor the renderer would _not_ run
  on this route. No `rows`: skipped means never asked, which is not an answered empty
  list.
- `failed` — a descriptor that threw (`no-entity`, `no-dataset`, …).

Skipped and failed captures also carry `descriptor` — the authored descriptor as
written in the bundle — beside whatever of `request` resolved.

**Flat tables (`stores`/`queries`/`invokes`) — legacy, landing route only.** A lossy
projection of `routes.index`'s capture: `stores` is its `members` tree, `queries` a
`{name: rows}` map of the **first answered capture per name** (a name-keyed table
cannot hold the tree's and the inspector's two `signalTypes` answers — part of why the
real data lives in `routes`), `invokes` the index route's declared targets
(`<target>: null` — none fire during a passive render). When a `--routes` subset
excludes index, `meta.flatScope` is `null` and the flat tables are empty.

## Routes

`index` `/`, `workflows`, `channels`, `channel-design` (`?channel=coasys-chan-design`),
`calls`, `call` (`/record/CollectionBlock?kind=call&id=…`), `people`, `dna`,
`person` (`?did=did:agent:mara`), `about` (shell overlay `landing-page` over `/workflows`).

## Known gaps

- `$queries.candidates` — entity is `{$: 'field.target'}`; it only resolves inside the
  row context of its parent `$each`, so it records `failed: no-entity` on every route.
- `card`/`connections`/`link`/`involvements` — gate on `routeStore.params.card`; no card
  detail route exists in the capture set, so they record `skipped: when`.
- `pictures`/`linked`/`threadRows`/`discussionEdit`/`discussionFocus` — row/local-scoped
  descriptors (`row[field.name]`, `local.discussionRoot`); they only run inside their
  parent's row scope → `skipped`.
- `typeStyles` executes and returns the two fixture `TypeStyle` rows seeded onto
  `Space.typeStyles` (a relation `applyFixture` cannot reach — the record hook in
  `inMemoryConnector` writes them under `?record=1`).
- Workflow `Item.since`/ask stamps are runtime clocks (`Date.now()`); the bridge clamps
  them to the fixture epoch in the snapshot — documented normalization, content unchanged.
- `modules` active in this preview: `call`, `transcribe` (+`feed` contributes parts).
  `graph` has no store; the bundle's `CesiumGlobe`/globe surface is not enabled here.

## Regenerating

```sh
crates/renderer/scripts/record-coasys.sh                            # snapshot + 60 PNGs (10 routes × 6 themes)
node crates/renderer/scripts/record-coasys.mjs --themes dark,light  # a theme subset is fine; captured data is unchanged
node crates/renderer/scripts/record-coasys.mjs --routes index,call  # a routes subset changes the snapshot:
                                                                    #   omitting index leaves meta.flatScope null and the flat tables empty
sha256sum crates/renderer/fixtures/coasys/snapshot.json             # deterministic: see NOTES-c2a.md
```

Requirements: a dev-built `apps/we-preview` (the script starts `vite` itself) with the
workspace installed — `playwright-core` resolves from `apps/we-preview`'s devDependencies.
Browser: `WE_RECORD_CHROME` env var names the binary; default is playwright's `chrome`
channel (an installed Google Chrome).

The recorder is two passes: capture first (theme untouched, asserted identical on every
route), then photography — each theme switch resolves through the registered id
(`glow` → `coasys--glow`), verifies the applied `data-we-theme`/resolved id before
shooting, and restores the capture theme after each route.
