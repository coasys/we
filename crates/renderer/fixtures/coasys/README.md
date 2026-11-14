# coasys — recorded snapshot of the Coasys space

`snapshot.json` is a recording of the real TypeScript WE app (`apps/we-preview`,
`@we/backend-inmemory`) rendering `bundles/coasys.bundle.json` over the fixture space in
`fixture.json`. The Rust app consumes it headless:

```sh
cargo run -p we-app -- dump --snapshot fixtures/coasys/snapshot.json --route '/space/preview-coasys'
```

## Files

| file            | what                                                                                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixture.json`  | Deterministic in-memory space "Meridian Commons" (dataset `preview-coasys`): agents, channels+messages, calls+transcripts, board/canvas landmarks+placements, tasks, signals, relationships, DNA vocab, workflows, presence. Fixture epoch `createdAt: 2025-10-01T00:00:00.000Z`. |
| `snapshot.json` | Recorded `{ meta, stores, queries, invokes, routes }`. `routes.<id>` is the primary shape. Regenerate with `crates/renderer/scripts/record-coasys.sh`.                                                                                                                            |

## Snapshot shape

`meta` — `{ format: 'we-snapshot@2', fixture, dataset, flatScope, captureTheme }`.
`flatScope` names the route the flat tables repeat (`index`); `captureTheme` is the theme
every route was recorded under (asserted identical per route).

**`routes.<id>` — the primary shape.** Per-route truth: `web`/`rust` paths, `path`,
`params`, `theme` (the theme that capture ran under), the resolved `members` tree,
`queries`, `agents` (`$agent` profiles), `absent` (members that evaluated `undefined` —
not a capture failure), and `invokeTargets` (the `$invoke` strings the surfaces declare).

`routes.<id>.queries` is a **list of captures**, not a name-keyed table — a query's
identity is its resolved request, not its local name:

- `{ name, request, rows, surfaces }` — an answered query. `request` is the resolved
  descriptor the renderer handed the adapter (entity + scope/where/sort/limit/include).
  Two same-named queries with different requests are different answers and record
  separately — the tree's `signalTypes` sorts by name, the inspector's does not.
- `{ name, skipped, request?, surfaces }` — a descriptor the renderer would _not_ run on
  this route (`when` false or `unanchored-scope`). No `rows`: skipped means never asked,
  which is not the same as an answered `rows: []`.
- `{ name, failed, surfaces }` — a descriptor that threw (`no-entity`, `no-dataset`, …).

**Flat tables (`stores`/`queries`/`invokes`) — legacy, landing route only.** Exactly
`routes.index`'s capture: `stores` is its `members` tree, `queries` a `{name: rows}` map
of its answered captures (first request per name — a name-keyed table cannot hold two
answers honestly, which is part of why the real data lives in `routes`), `invokes` the
union of declared targets (`<target>: null` — none fire during a passive render). Read
`routes.<id>` instead; E6 does.

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
crates/renderer/scripts/record-coasys.sh                  # snapshot + 60 PNGs (10 routes × 6 themes)
node record-coasys.mjs --themes dark,light --routes index # subsets are fine; capture is unchanged
sha256sum crates/renderer/fixtures/coasys/snapshot.json   # deterministic: see NOTES-c2a.md
```

Requirements: a dev-built `apps/we-preview` (the script starts `vite` itself) with the
workspace installed — `playwright-core` resolves from `apps/we-preview`'s devDependencies.
Browser: `WE_RECORD_CHROME` env var names the binary; default is playwright's `chrome`
channel (an installed Google Chrome).

The recorder is two passes: capture first (theme untouched, asserted identical on every
route), then photography — each theme switch resolves through the registered id
(`glow` → `coasys--glow`), verifies the applied `data-we-theme`/resolved id before
shooting, and restores the capture theme after each route.
