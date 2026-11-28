# Schemas

`SchemaPort` installs entity schemas into a dataset and reads them back. It installs the root schemas (`installRoot`), the space schemas with module schemas (`installSpace`), and module schemas alone (`installModules`). It compiles a manifest into the backend's form (`declare`, `declareInDataset`), and it reports what a dataset holds (`hasCoreSchema`, `hasAnySchema`, `foreignSchemas`, `foreignEntries`).

**Why:** Only the backend knows how a manifest becomes something it can store and query (SHACL on AD4M). So the shell hands the port manifests and gets back neutral `EntityManifestEntry` lists. `installRoot`, `installSpace` and `ensure` are idempotent, and the methods that run on every space switch (`installModules`, `refreshSpace`) diff before they write, so a switch writes only the schemas that are out of date.

**Parent:** [Backend contract](README.md)

<details><summary>How it works</summary>

| Member | Use |
|---|---|
| `installRoot(dataset)` | the app configuration entities, for we-root |
| `installSpace(dataset, moduleSchemas)` | WE's space entities plus the given module entities |
| `installModules(dataset, moduleSchemas)` | module entities only |
| `refreshSpace(dataset)` | update stored space schemas that are behind this build; returns what it wrote |
| `ensure(dataset, schema)` | one schema payload |
| `hasCoreSchema` / `hasAnySchema` | "is this a WE space" / "does it hold any schema" |
| `foreignSchemas` / `foreignEntries` | another app's entities in the dataset: register them, or only read them |
| `declare`, `entries`, `declareInDataset` | compile a manifest, project it to entries, or compile and register it for one dataset |
| `interpretationHints`, `setInterpretationHints`, `resetInterpretationHints` | per-dataset hints for interpretation |
| `shapes?` | `ShapeStore`: where a space keeps its own shapes ([Shapes](../spaces/shapes.md)) |

Each module's schemas install on their own. When the backend refuses some modules, the others still install, and the call then rejects with `ModuleSchemasRefused`, which names the refused modules. A refused module writes nothing. `manifestEntries` projects a manifest to `EntityManifestEntry` rows: each property and relation with its predicate.

</details>

<details><summary>Where in the code</summary>

- [packages/backend-system/shared/src/backendPorts.ts](../../../packages/backend-system/shared/src/backendPorts.ts): `SchemaPort`, `ModuleSchemasRefused`.
- [packages/backend-system/shared/src/manifestEntry.ts](../../../packages/backend-system/shared/src/manifestEntry.ts): `EntityManifestEntry`, `manifestEntries`.
- [packages/backend-system/shared/src/shapes.ts](../../../packages/backend-system/shared/src/shapes.ts): `ShapeStore`, `StoredShape`, `ShapeInput`.
- [packages/backend-system/ad4m/src/backendPortsAdapter.ts](../../../packages/backend-system/ad4m/src/backendPortsAdapter.ts): `createAd4mSchemaPort`.
- [packages/backend-system/ad4m/src/sdnaEntities.ts](../../../packages/backend-system/ad4m/src/sdnaEntities.ts): `ROOT_MODELS`, `SPACE_MODELS`, `installRootSdna`, `installSpaceSdna`.
- [packages/backend-system/ad4m/docs/manifest-to-shacl.md](../../../packages/backend-system/ad4m/docs/manifest-to-shacl.md): how a manifest becomes SHACL.

</details>
