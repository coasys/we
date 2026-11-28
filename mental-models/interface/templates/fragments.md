# Fragments

A **fragment** is a TypeScript function that takes one options object and returns plain schema nodes, for example `emptyState(opts)` or `taskBoard(opts)`. A template calls it when the template is written. The stored template holds only the nodes it returned. `@we/schema-kit` holds fragments that name no store. `@we/template-kit` holds fragments that read WE's own stores, such as `spaceStore` and `profileStore`.

**Why:** Templates that are copied from templates drift apart. A fragment holds one decision, such as what an empty state says while a query loads, so every template that uses it stays the same. The rule is "code owns only what data cannot express": arrangement is a fragment, focus and the top layer are a primitive, measurement is a component, and computation is an expression function (`templates/kit/CONVENTIONS.md`).

**Parent:** [Templates](README.md)

<details><summary>How it works</summary>

1. A fragment is extracted at three real uses of the same shape, or when copies that differ are a bug. A fragment is not made before it has uses.
2. A fragment takes one options object, never positional arguments, and its body reads as the tree it returns.
3. `@we/schema-kit` is portable: `portable.test.ts` reads the package source and fails if a fragment names a store. Its folders are `input` (`field`, `lineComposer`), `layout` (`railShell`, `panelShell`, `pageShell`, `recordCard`, `timeline`, …), `lists` (`cardList`, `treeRow`, `loadMore`, …), `overlays` (`confirmModal`, `formModal`, `pickerPopover`, …) and `states` (`emptyState`, `gatePrompt`, `skeletonList`, …).
4. `@we/template-kit` adds the WE-domain fragments in `src/we` (`taskBoard`, `marketplaceList`, `installedList`, `signalDisplay`, …) and `src/lists` (`channelRail`, `commentThread`, `collectionFeed`, `mediaGrid`).
5. A feature module can ship fragments beside its components under the same rules ([Modules](../../modules/README.md)).

A fragment expands when a template is written. A shape that repeats inside one stored template is a definition (`$defs` and `$ref`), which the template carries itself ([Schema nodes](../schema/nodes.md)).

</details>

<details><summary>Where in the code</summary>

- [packages/schema-system/kit/src/](../../../packages/schema-system/kit/src): `@we/schema-kit`; [portable.test.ts](../../../packages/schema-system/kit/src/portable.test.ts).
- [packages/templates/kit/src/](../../../packages/templates/kit/src): `@we/template-kit`.
- [packages/templates/kit/CONVENTIONS.md](../../../packages/templates/kit/CONVENTIONS.md): when to extract a fragment, and how to write one.
- [docs/architecture/template-fragments.md](../../../docs/architecture/template-fragments.md): how fragments work, in depth.

</details>
