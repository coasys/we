# Shapes

A **shape** is an entity that a space defines for itself. It is stored once, in the form its backend's schema uses, and WE reads and writes it as an `EntityManifest` through `SchemaPort.shapes`. `ShapeStore` reads a space's shapes on every switch into it and registers them for that dataset only.

**Why:** Two copies of one shape can disagree, and then one of them must win. With one copy, nothing can drift, and an edit that other software makes to the schema is read, not reverted. The manifest stays the one format above the backend because it is small, closed and checkable. How a type looks is not part of the shape: a community that renames its card titles does not change what the thing is, so presentation is a separate `TypeStyle` override.

**Parent:** [Spaces](README.md)

<details><summary>How it works</summary>

| Backend | Where a shape lives | `ShapeStore` port |
|---|---|---|
| AD4M | the class's SHACL, plus annotation links on its nodes for what SHACL cannot say | `createAd4mShapeStore` |
| no schema language of its own | a `Shape` record that holds the manifest as a document | `createJsonShapeStore` |

1. `SchemaPort.shapes` has `list(dataset)`, `save(dataset, shape, id?)` and `remove(dataset, id)`.
2. The adoption rail: on a switch into a WE space, `ShapeStore` lists the shapes and checks each with `validateManifest` (against core vocabulary, sibling shapes and foreign entities). `adoptShape` compiles it with `declareInDataset` (module id `shape/<id>`) and installs its schema with `installModules`. After that, `$query { entity: "<ShapeName>" }`, the record forms and extraction work on it.
3. The shape wizard: `openShapeWizard`, the draft (`shapeDraft`) and `saveShapeDraft`. The structured editor and the AI flow (`generateShapeDraft`) fill the same draft.
4. The hint editor: per-space interpretation hints through `SchemaPort.interpretationHints`.
5. On AD4M, `remove` takes away the annotations only. The SHACL stays, so records of that entity stay readable. A shape that holds more than a manifest can say reads back as not editable.
6. `TypeStyle` overrides only what it sets. All other presentation comes from the entity's defaults, and a template can still override it in its own nodes.

</details>

<details><summary>Where in the code</summary>

- [packages/app-shell/src/frameworks/solid/stores/ShapeStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/ShapeStore.tsx): `ShapeStore`, `adoptShape`, `spaceShapes`, the wizard and the hint editor.
- [packages/backend-system/shared/src/shapes.ts](../../../packages/backend-system/shared/src/shapes.ts): `ShapeStore` (the port), `StoredShape`, `ShapeInput`.
- [packages/entities/src/shapeStore.ts](../../../packages/entities/src/shapeStore.ts): `createJsonShapeStore`.
- [packages/backend-system/ad4m/src/nativeShapes.ts](../../../packages/backend-system/ad4m/src/nativeShapes.ts), [shapeCodec.ts](../../../packages/backend-system/ad4m/src/shapeCodec.ts): `createAd4mShapeStore` and the annotations.
- [packages/app-shell/src/shared/shapes/presentation.ts](../../../packages/app-shell/src/shared/shapes/presentation.ts): `TypeStyle` overrides.
- [docs/architecture/decisions/2026-10-25-a-space-model-is-stored-once.md](../../../docs/architecture/decisions/2026-10-25-a-space-model-is-stored-once.md): the decision.

</details>
