# @we/backend-shared

The backend contract: the typed surface the shell and feature modules consume, and every adapter
under `backend-system/` implements. Nothing here names a backend. What this package holds is where
the contract is _stated_ — the query grammar and the planner a query is checked against, the
manifest an entity is declared in, the record contract a consumer relies on, and the ports a peer
transport or a model is reached through. The reasons the layer exists are in the directory README.

## What belongs here

**Anything about getting data in and out, or talking to peers.**

- `DataSource` / `EntityClass` / `MutationApi` — the read and write surface
- `QueryAdapter` + the query layer — `QueryIR`, validation, capability planning, the compute-up engine
- `LiveQuery` — what `EntityClass.query` returns: one handle with `first` (the first result),
  `subscribe` (called at once with the current snapshot once the query is no longer loading, then on each change), `getSnapshot`
  and `dispose`. A snapshot says `initial` for the value the handle opened on. Results
  come as a `LivePage` (`{ results, totalCount? }`). A backend with no live query of its own builds
  one with `createLiveQuery` (a read plus a way to hear changes), `combineLiveQueries` (several
  into one) or `mapLiveQuery` (a result passed through a function). The conformance suite holds every
  backend to the same behaviour: a first result, `initial` only on that one, a snapshot for a later
  change, and no updates after `dispose`.
- `EphemeralPort` — peer-to-peer transport for coordination that isn't stored
- presence — roster, liveness, activities
- `EntityManifest` — the neutral description of an entity's shape
- `IdentityPort` — what a backend can do with a person's identity beyond the session (keys, devices,
  bots, plan); optional, and capabilities only until a backend answers the calls behind them

## What doesn't

**Anything that knows what a `SchemaNode` is.** This package imports nothing from the schema side and
should stay that way: it is the base layer, and a backend never needs to know how a template renders.

If you are about to import `@we/schema-shared` here, the thing you are adding probably belongs in
`@we/module-shared` (which already depends on both) or in the shell.

## Why it exists

It was part of `@we/schema-shared` until that package reached 9,000 LOC across five unrelated
concerns, which every feature module peer-depended on in full — `@we/module-call` needed four exports
and pulled the entire schema engine, indexer and validator to get them.
