# coasys — recorded snapshot of the Coasys space

`snapshot.json` is a recording of the real TypeScript WE app (`apps/we-preview`,
`@we/backend-inmemory`) rendering `bundles/coasys.bundle.json` over the fixture space in
`fixture.json`. The Rust app consumes it headless:

```sh
cargo run -p we-cli -- --snapshot fixtures/coasys/snapshot.json --route '/space/preview-coasys'
```

## Files

| file            | what                                                                                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixture.json`  | Deterministic in-memory space "Meridian Commons" (dataset `preview-coasys`): agents, channels+messages, calls+transcripts, board/canvas landmarks+placements, tasks, signals, relationships, DNA vocab, workflows, presence. Fixture epoch `createdAt: 2025-10-01T00:00:00.000Z`. |
| `snapshot.json` | Recorded `{ stores, queries, invokes }` plus a `routes` extension. Regenerate with `crates/renderer/scripts/record-coasys.sh`.                                                                                                                                                    |

## Snapshot shape

Same contract as `we-app/tests/data/tree-snapshot.json`, with one extension:

- `stores` / `queries` / `invokes` — flat tables, exactly the existing format. `stores`
  describes the landing route (`/`): for `routeStore` — which is route state, not space
  state — the flat table holds the landing route's values only. `invokes.<target>` is the
  canned reply for that `$invoke` target; every recorded target is `null` because none of
  them fire during a passive render.
- `routes.<id>` _(extension)_ — per-route truth the flat format cannot express:
  `web`/`rust` paths, `params`, the resolved `members` tree, per-route `queries` rows,
  `queryNotes` (why a query was skipped: `when`-false or `unanchored-scope`),
  `agents` (`$agent` profiles), `absent` (members that evaluated `undefined` — not a
  capture failure), and `invokeTargets` (the `$invoke` strings the surfaces declare).

Rationale: `routeStore.params`, param-scoped queries (`callRecord`, `channelRecord`,
`focusCall`…) and the person page's `$agent` payload differ per route by definition.
Keeping them per-route keeps `stores` honest as "the landing route's bag".

## Routes

`index` `/`, `workflows`, `channels`, `channel-design` (`?channel=coasys-chan-design`),
`calls`, `call` (`/record/CollectionBlock?kind=call&id=…`), `people`, `dna`,
`person` (`?did=did:agent:mara`), `about` (shell overlay `landing-page` over `/workflows`).

## Known gaps

- `$queries.candidates` (person route) — entity is `{$: 'field.target'}`; it only resolves
  inside the row context of its parent `$each`, so it cannot run standalone. Recorded in
  `routes.person.queryNotes`.
- `card`/`connections`/`link`/`involvements` — gate on `routeStore.params.card`; no card
  detail route exists in the capture set, so they record `[]` (skipped).
- `pictures`/`linked`/`threadRows` — row-scoped descriptors (`row[field.name]`,
  `local.discussionRoot`); same story: they only run inside their parent's row context.
- `typeStyles` executes and returns the two fixture `TypeStyle` rows seeded onto
  `Space.typeStyles` (a relation `applyFixture` cannot reach — the record hook in
  `inMemoryConnector` writes them under `?record=1`).
- Workflow `Item.since`/ask stamps are runtime clocks (`Date.now()`); the bridge clamps
  them to the fixture epoch in the snapshot — documented normalization, content unchanged.
- `modules` active in this preview: `call`, `transcribe` (+`feed` contributes parts).
  `graph` has no store; the bundle's `CesiumGlobe`/globe surface is not enabled here.

## Verification

```sh
crates/renderer/scripts/record-coasys.sh                 # regenerates snapshot + 60 PNGs
sha256sum crates/renderer/fixtures/coasys/snapshot.json  # deterministic: see NOTES-c2a.md
```
