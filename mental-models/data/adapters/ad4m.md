# AD4M adapter

`createAd4mBackendPorts(backendClient, ctx, options)` builds `BackendPorts` over an AD4M client. A dataset handle is a `PerspectiveProxy`, a shared dataset is a neighbourhood, and an entity class is an `Ad4mModel` subclass whose SHACL is installed in the perspective.

**Why:** AD4M knowledge stays in this one package, and `@coasys/ad4m` is a dependency of this package only. The package imports nothing from the shell: `installSpaceSdna(p, moduleEntities)` takes the module entities as an argument instead of reading the host's module registry. The patches on `Ad4mModel` install on the base class, so they cover the generated classes, the classes compiled from a manifest at runtime, and the classes built from foreign SHACL, including classes that do not exist yet.

**Parent:** [Adapters](README.md)

<details><summary>How it works</summary>

1. `createAd4mBackendPorts` installs four patches on `Ad4mModel`: `installRelationWrites`, `installWriteChecks` ([Write path](../entities/writes.md)), `installContainmentPredicate` and `installParentByRelation` (a `parent` named by relation becomes a predicate).
2. It registers every class in `ROOT_MODELS` and `SPACE_MODELS` with `registerEntity`, by `className`. It registers `Ad4mModel.transaction` as the transaction runner, and a file store over `FILE_STORAGE_LANGUAGE`.
3. It builds the ports: `createAd4mAgentSession`, `createAd4mDatasetLifecycle`, `createAd4mSchemaPort`, `createAd4mProfileDirectory`, `createAd4mEphemeralPort`, and the optional ports (runtime, models, transcription, language model, agents, interpretation, workflows, references, identity, call).
4. `installRootSdna` installs `ROOT_MODELS` into we-root. `installSpaceSdna` installs `SPACE_MODELS` plus module entities. `refreshSpaceSdna` sends the space entities again in one `registerShapes` call; the executor writes only what changed.
5. `compileManifest` turns an `EntityManifest` into `Ad4mModel` classes through AD4M's own decorators (`@Model`, `@Property`, `@Flag`, `@HasMany`, `@HasOne`). `toNeutralManifest` projects manifest entries back to a neutral `EntityManifest`.
6. `getForeignShacl` and `buildEntityClasses` read another app's SHACL and build classes for it.
7. `createAd4mQueryAdapter` declares `ad4mCapabilities`. A `compute-up` gap is refused on this path, as `unsupported` is. A relation-path or projection sort without a `limit` is `degraded`.
8. `createAd4mShapeStore` keeps a space's own shapes as SHACL plus annotation links (`shapeCodec.ts`).

</details>

<details><summary>Where in the code</summary>

- [packages/backend-system/ad4m/src/backendPortsAdapter.ts](../../../packages/backend-system/ad4m/src/backendPortsAdapter.ts): `createAd4mBackendPorts`, `createAd4mSchemaPort`, `createAd4mProfileDirectory`.
- [packages/backend-system/ad4m/src/sdnaEntities.ts](../../../packages/backend-system/ad4m/src/sdnaEntities.ts): `ROOT_MODELS`, `SPACE_MODELS`, `installRootSdna`, `installSpaceSdna`, `installModuleSdna`, `refreshSpaceSdna`, `ensureEntityRegistered`.
- [packages/backend-system/ad4m/src/manifestCompiler.ts](../../../packages/backend-system/ad4m/src/manifestCompiler.ts): `compileManifest`, `manifestToEntries`, `CORE_VOCABULARY`; [neutralManifest.ts](../../../packages/backend-system/ad4m/src/neutralManifest.ts): `toNeutralManifest`.
- [packages/backend-system/ad4m/src/ad4mAdapter.ts](../../../packages/backend-system/ad4m/src/ad4mAdapter.ts): `ad4mCapabilities`, `createAd4mQueryAdapter`, `createAd4mDataBindings`.
- [packages/backend-system/ad4m/src/lifecycleAdapter.ts](../../../packages/backend-system/ad4m/src/lifecycleAdapter.ts): `createAd4mDatasetLifecycle`, `createAd4mAgentSession`.
- [packages/backend-system/ad4m/src/relationWrites.ts](../../../packages/backend-system/ad4m/src/relationWrites.ts), [writeChecks.ts](../../../packages/backend-system/ad4m/src/writeChecks.ts), [containment.ts](../../../packages/backend-system/ad4m/src/containment.ts), [parentByRelation.ts](../../../packages/backend-system/ad4m/src/parentByRelation.ts): the patches on `Ad4mModel`.
- [packages/backend-system/ad4m/src/perspectiveHelpers.ts](../../../packages/backend-system/ad4m/src/perspectiveHelpers.ts): `getForeignShacl`, `buildEntityClasses`.
- [packages/backend-system/ad4m/src/nativeShapes.ts](../../../packages/backend-system/ad4m/src/nativeShapes.ts), [shapeCodec.ts](../../../packages/backend-system/ad4m/src/shapeCodec.ts): `createAd4mShapeStore`.
- [packages/backend-system/ad4m/src/entities/](../../../packages/backend-system/ad4m/src/entities): the generated classes.
- [packages/backend-system/ad4m/docs/manifest-to-shacl.md](../../../packages/backend-system/ad4m/docs/manifest-to-shacl.md): how a manifest becomes SHACL.

</details>
