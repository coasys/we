# Entities

An **entity** is a type of stored thing (`Space`, `TextBlock`, `Signal`); a **record** is one instance of an entity. `@we/entities` declares WE's core entities in a neutral manifest, generates their TypeScript record types from it, and exports one entity proxy per entity, which forwards to the class that the active backend registered.

**Why:** The manifest is the one source of truth for the entities. The neutral types, the AD4M classes and the runtime manifest are all derived from it, so they cannot disagree. Code outside the backend packages imports the proxies and the `*Record` types, never a backend class. That keeps `@coasys/*` inside the backend that uses it.

**Parent:** [Data](../README.md)

## Parts

- [Manifest](manifest.md): `CORE_DEFS`, `CORE_MANIFEST`, `EntitySchema`, and the two generators.
- [Entity proxies](proxies.md): `defineEntity`, the entity registry, and the entities registered for one dataset.
- [Write path](writes.md): the write check, the transaction runner and the file store that a backend registers.
- [Relations](relations.md): the three ways to connect two records, containment, and AI model provenance.

<details><summary>How it works</summary>

| Word   | Meaning in WE                                                                  |
| ------ | ------------------------------------------------------------------------------ |
| entity | a type, declared in the manifest                                               |
| record | one instance of an entity                                                      |
| block  | a concrete entity with `blockable: true`; it must declare a `version` property |
| model  | an AI model, not a data type                                                   |

1. An author edits one file in `src/manifest/` for each entity.
2. `generate:types` writes the neutral record types (`SpaceRecord`, …) to `src/manifest/types.ts`.
3. `generate:classes` in `@we/backend-ad4m` writes one AD4M class for each entity.
4. At runtime the adapter registers its classes by name. Code calls `Space.create(dataset, …)` on the proxy, and the proxy forwards the call.

Module entities are declared by the modules themselves ([Contributions](../../modules/contract/contributions.md)).

</details>

<details><summary>Where in the code</summary>

- [packages/entities/src/manifest/](../../../packages/entities/src/manifest): one file per entity, `index.ts`, `types.ts`.
- [packages/entities/src/index.ts](../../../packages/entities/src/index.ts): the exported proxies.
- [packages/entities/CONVENTIONS.md](../../../packages/entities/CONVENTIONS.md): the vocabulary and the rules for a new entity.
- [packages/entities/README.md](../../../packages/entities/README.md): the package overview.

</details>
