# Query planning

The **query IR** (`QueryIR`) is the backend-neutral, versioned description of the data a template asks for: `entity`, `filter`, `sort`, `page`, `select`, `include`, `aggregate`, `scope` and `live`. `routeQuery(query, adapter)` compiles a template's flat query to the IR, asks the backend's `QueryAdapter` to plan it, and either lowers it to the backend's `QueryOptions` or refuses it.

**Why:** Each backend declares its `AdapterCapabilities`, and `planQuery` gives every feature a disposition. A query that a backend cannot run fails loud with the reason. There is no fallback that hands the backend the raw flat dialect: that dialect matches only AD4M's native query, so on another backend it would hide real gaps. The one exception is a `degraded` gap: the rows are correct but one named feature is not applied, so the query runs and returns a diagnostic. `routeQuery` lives in the contract, not in the renderer, so each branch of the decision is tested as a plain function.

**Parent:** [Backend contract](README.md)

<details><summary>How it works</summary>

1. The renderer gives `routeQuery` the resolved `$query` as a `FlatQuery` ([Queries](../../interface/renderer/queries.md)).
2. `compileQuery` produces the IR and a list of features the IR cannot express. A non-empty list refuses the query.
3. `adapter.plan(ir)` returns a `QueryPlan` with `gaps`. Any gap that is not `degraded` refuses the query.
4. `adapter.lower(ir)` returns the `QueryOptions` that the entity handle's `query` reads.
5. `routeQuery` also adds an `emptyId` diagnostic for a `where: { id: '' }`. The caller decides how to report each diagnostic.

| Disposition   | Meaning                                                           |
| ------------- | ----------------------------------------------------------------- |
| `native`      | the backend does it                                               |
| `compute-up`  | the backend does not, but JS can derive it from the returned rows |
| `degraded`    | the backend runs the query but ignores this one feature           |
| `unsupported` | it cannot run; the query fails loud                               |

- `executeQueryIR(query, dataset)` is the reference engine: filter, sort, paginate, hydrate relations and aggregate over in-memory rows. The in-memory adapter runs on it.
- A query whose `entity` is a list is a union. `combineEntityRows` merges the per-entity answers; `unionByFanOut` makes one handle over several.
- `validateQueryIR` checks the IR shape (Zod). `validateQueryAgainstManifest` checks the names against a manifest.

</details>

<details><summary>Where in the code</summary>

- [packages/backend-system/shared/src/queryIR.ts](../../../packages/backend-system/shared/src/queryIR.ts): `QueryIR`, `Filter`, `Op`, `Scope`, `validateQueryIR`.
- [packages/backend-system/shared/src/queryCompiler.ts](../../../packages/backend-system/shared/src/queryCompiler.ts): `FlatQuery`, `compileQuery`, `irToFlatQuery`.
- [packages/backend-system/shared/src/queryCapabilities.ts](../../../packages/backend-system/shared/src/queryCapabilities.ts): `AdapterCapabilities`, `Disposition`, `CapabilityGap`, `QueryPlan`, `planQuery`.
- [packages/backend-system/shared/src/queryRouting.ts](../../../packages/backend-system/shared/src/queryRouting.ts): `routeQuery`, `QueryRouting`, `QueryDiagnostic`.
- [packages/backend-system/shared/src/queryEngine.ts](../../../packages/backend-system/shared/src/queryEngine.ts): `executeQueryIR`, `InMemoryDataset`.
- [packages/backend-system/shared/src/queryUnion.ts](../../../packages/backend-system/shared/src/queryUnion.ts): `combineEntityRows`, `unionByFanOut`.
- [packages/backend-system/shared/src/queryValidation.ts](../../../packages/backend-system/shared/src/queryValidation.ts): `validateQueryAgainstManifest`.
- [packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx): the caller of `routeQuery`.

</details>
