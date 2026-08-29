# @we/backend-shared

The backend contract. Every adapter — `@we/backend-ad4m`, `@we/backend-inmemory` — implements these;
the shell and feature modules consume them.

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
