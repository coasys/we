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
- `EphemeralPort` — peer-to-peer transport for coordination that isn't stored
- presence — roster, liveness, activities
- `EntityManifest` — the neutral description of an entity's shape

## What doesn't

**Anything that knows what a `SchemaNode` is.** This package imports nothing from the schema side and
should stay that way: it is the base layer, and a backend never needs to know how a template renders.

If you are about to import `@we/schema-shared` here, the thing you are adding probably belongs in
`@we/module-shared` (which already depends on both) or in the shell.

## Why it exists

It was part of `@we/schema-shared` until that package reached 9,000 LOC across five unrelated
concerns, which every feature module peer-depended on in full — `@we/module-call` needed four exports
and pulled the entire schema engine, indexer and validator to get them.
