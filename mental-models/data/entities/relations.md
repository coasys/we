# Relations

A connection between two records lives in one of three tiers: a free-text `label` on a `Relationship` record, a `Relationship` that names a community-defined `RelationshipType`, or a relation declared on the entity (`RelationSchema`). Every `WeNode` also carries the fixed relations in `WE_NODE_RELATIONS`: containment (`partOf`), responses (`responses`/`respondsTo`), threads (`thread`/`inThread`), extraction (`extractedFrom`), AI model provenance (`runs`, `generatedBy`), `signals`, `participants` and `mentions`.

**Why:** A declared relation is a fact about the type. It gets the full query surface, but it carries nothing about itself: no author, no date, nothing to comment on or rate. A reified connection (`Relationship`, `Placement`, `Signal`) is a record about a pair. It carries all of that, but it has no query pushdown. So the type's facts are declared, and the claims about a pair are reified.

**Parent:** [Entities](README.md)

<details><summary>How it works</summary>

| Tier | Authored by | Query by it | Carries its own data |
|---|---|---|---|
| free-text `label` | any member | no | yes |
| `RelationshipType` | the community, as a record | `where: { relationshipTypeId }` | yes |
| declared relation | whoever owns the schema | fully | no |

- Containment uses `CONTAINMENT_PREDICATE` (`we://child`): `CollectionBlock.children`, read back as `WeNode.partOf`. A record has at most one container. The AD4M adapter stores it as `ad4m://has_child` and translates at its boundary (`installContainmentPredicate`).
- A response is never a child. Where a response was said is derived: `inThread`, then `partOf`.
- A position on a canvas is a `Placement` record, not `x`/`y` on the block.
- A reaction is a `Signal`, typed by a space's `SignalType`.
- A record that a model wrote names its `ModelRun` in `generatedBy`. `generatedRun(record)` reads it. A change that a model suggested to an existing record, and that somebody kept, is an `Amendment`: one record per property, with the previous value.

</details>

<details><summary>Where in the code</summary>

- [docs/architecture/relations.md](../../../docs/architecture/relations.md): the full decision procedure.
- [packages/entities/src/manifest/shared.ts](../../../packages/entities/src/manifest/shared.ts): `WE_NODE_RELATIONS`.
- [packages/entities/src/manifest/Relationship.ts](../../../packages/entities/src/manifest/Relationship.ts), [RelationshipType.ts](../../../packages/entities/src/manifest/RelationshipType.ts), [Placement.ts](../../../packages/entities/src/manifest/Placement.ts), [Signal.ts](../../../packages/entities/src/manifest/Signal.ts), [SignalType.ts](../../../packages/entities/src/manifest/SignalType.ts): the reified forms.
- [packages/entities/src/manifest/ModelRun.ts](../../../packages/entities/src/manifest/ModelRun.ts), [Amendment.ts](../../../packages/entities/src/manifest/Amendment.ts), [packages/entities/src/utils/provenance.ts](../../../packages/entities/src/utils/provenance.ts): provenance, `generatedRun`.
- [packages/backend-system/shared/src/manifest.ts](../../../packages/backend-system/shared/src/manifest.ts): `RelationSchema`, `CONTAINMENT_PREDICATE`.
- [packages/backend-system/ad4m/src/containment.ts](../../../packages/backend-system/ad4m/src/containment.ts): `installContainmentPredicate`.

</details>
