# Manifest

The **manifest** is the neutral declaration of WE's entities: an `EntityManifest` maps each entity name to an `EntitySchema` with its `properties` and `relations`. `CORE_MANIFEST` is assembled from one hand-written `CoreEntityDef` per entity in `packages/entities/src/manifest/`. Two generators derive the record types and the AD4M classes from it.

**Why:** One authored source cannot disagree with itself. The neutral record types in `types.ts` are the record contract: the generated AD4M classes carry type-level assertions against them, so a class that drifts from the contract fails to compile. The manifest format stays small and closed, so the validator can judge any manifest: core, module or a space's own shape.

**Parent:** [Entities](README.md)

<details><summary>How it works</summary>

1. Each `src/manifest/<Entity>.ts` exports a `CoreEntityDef`: `base` (`'WeNode'` or `'Ad4mModel'`), the `entity` (`EntitySchema`), and AD4M generator hints (`optional`, `unions`, `methodRelations`, `typedArrays`).
2. `src/manifest/index.ts` collects them in `CORE_DEFS`. It builds `CORE_MANIFEST` (version `'1'`). An entity with `base: 'WeNode'` gets `WE_NODE_RELATIONS` merged after its own relations.
3. `pnpm --filter @we/entities generate:types` runs `scripts/generateTypes.mjs`. It writes `src/manifest/types.ts`: one `<Entity>Record` interface per entity, over `RecordInstance` (`base.ts` holds `WeNodeRecord`).
4. `pnpm --filter @we/backend-ad4m generate:classes` runs `scripts/generateClasses.mjs`. It writes one decorated class per entity to `packages/backend-system/ad4m/src/entities/`, plus `index.ts` and `conformance.ts` (the type assertions).
5. `validateManifest` (in `@we/backend-shared`) checks any manifest before use. For example, an entity with `blockable: true` must declare a `version` property.

| `EntitySchema` field | Meaning |
|---|---|
| `properties` | scalar fields (`PropertySchema`: `type`, `required`, `format: 'file'`, …) |
| `relations` | `RelationSchema`: `target`, `cardinality`, `predicate`, `reverseOf`, `containment` |
| `blockable` | the entity is a block and can be composed into documents |
| `extractable` | the entity is eligible as an interpretation target |
| `authoring`, `display` | the fields a generated form offers, and how a record is summarised |

Block types and their composer belong to [Modules](../../modules/README.md).

</details>

<details><summary>Where in the code</summary>

- [packages/entities/src/manifest/index.ts](../../../packages/entities/src/manifest/index.ts): `CORE_DEFS`, `CORE_MANIFEST`.
- [packages/entities/src/manifest/defs.ts](../../../packages/entities/src/manifest/defs.ts): `CoreEntityDef`.
- [packages/entities/src/manifest/shared.ts](../../../packages/entities/src/manifest/shared.ts): `WE_NODE_ENTITY`, `WE_NODE_RELATIONS`.
- [packages/entities/src/manifest/types.ts](../../../packages/entities/src/manifest/types.ts): the generated `*Record` types.
- [packages/entities/scripts/generateTypes.mjs](../../../packages/entities/scripts/generateTypes.mjs): the type generator.
- [packages/backend-system/ad4m/scripts/generateClasses.mjs](../../../packages/backend-system/ad4m/scripts/generateClasses.mjs) and [packages/backend-system/ad4m/src/entities/](../../../packages/backend-system/ad4m/src/entities): the AD4M class generator and its output.
- [packages/backend-system/shared/src/manifest.ts](../../../packages/backend-system/shared/src/manifest.ts): `EntityManifest`, `EntitySchema`, `PropertySchema`, `RelationSchema`, `validateManifest`, `blockableEntities`, `interpretableEntities`.
- [packages/backend-system/shared/src/recordContract.ts](../../../packages/backend-system/shared/src/recordContract.ts): `RecordInstance`, `EntityStatic`, `NewRecord`.
- [packages/entities/CONVENTIONS.md](../../../packages/entities/CONVENTIONS.md): how to add an entity.

</details>
