# Renderer

The **renderer** is `RenderSchema` in `@we/schema-solid`. It walks a schema tree, resolves each prop through `@we/schema-shared`, maps the node operators onto Solid's control flow, and mounts each node: a component from the **component registry**, a `we-*` custom element, or an allowed HTML element.

**Why:** The schema semantics take a **reactivity port**: `resolveProp` receives a `memo` function, and `markReactive` tags the accessors it makes. The Solid renderer passes `createMemo`, so the renderer is a thin adapter, and a renderer for another framework supplies only its own signal primitive (`propResolvers/types.ts`). Primitives are custom elements, so the renderer sets their props generically and needs no wrapper per primitive.

**Parent:** [Interface](../README.md)

## Parts

- [Component registry](component-registry.md): the map from a `type` name to a Solid component, and how modules add to it.
- [Template queries](queries.md): `$query` and `$queries`, and the subscription pool that shares one live question between nodes.
- [Foreign elements](foreign-elements.md): custom elements from a library, named in the seed, and the content security policy.

<details><summary>How it works</summary>

1. `RenderSchema` expands `$defs` once (`expandDefinitions`). A mounted node keeps its `type`.
2. `RenderNode` creates the signals of `$localState` ([Handler tokens](../schema/handlers.md)) and the subscriptions of `$queries` ([Template queries](queries.md)).
3. A node operator returns early ([Node operators](../schema/operators.md)).
4. The renderer resolves the component in this order: `registry[type]`; a lowercase HTML element only if `isTemplateElement(type)`; a name with a hyphen as a custom element. An HTML element that is not on the list renders nothing and warns once. Any other unknown `type` draws a dashed box that names it, so one missing component costs one node.
5. Each prop resolves with `createMemo` as the `memo`. A custom element gets each prop as a DOM property, except `data-*` and `aria-*` props, which become attributes. A prop whose name starts with `on` and an upper-case letter is an event handler. URL-bearing props refuse a script scheme (`refusedProp`).
6. A node `theme` writes its variables on a `display: contents` wrapper (`applyThemeVars`), with `data-we-theme` set to the theme name.
7. The children of a node are built once and reused, so an unrelated prop change does not rebuild the subtree or repeat its queries.

`updateSchema` applies a patch to a mounted tree in place. `VisualEditorProvider` lets the editor find the node under the pointer. `createSurface` measures a `$surface`.

</details>

<details><summary>Where in the code</summary>

- [packages/schema-system/frameworks/solid/src/](../../../packages/schema-system/frameworks/solid/src): [SchemaRenderer.tsx](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx) (`RenderSchema`, `RenderNode`), [schemaUpdater.ts](../../../packages/schema-system/frameworks/solid/src/schemaUpdater.ts) (`updateSchema`), [VisualEditorContext.ts](../../../packages/schema-system/frameworks/solid/src/VisualEditorContext.ts), [createSurface.ts](../../../packages/schema-system/frameworks/solid/src/createSurface.ts), [transitionUtils.ts](../../../packages/schema-system/frameworks/solid/src/transitionUtils.ts).
- [propResolvers/reactive.ts](../../../packages/schema-system/shared/src/propResolvers/reactive.ts): `REACTIVE_ACCESSOR`, `markReactive`, `deepUnwrap`. [propResolvers/types.ts](../../../packages/schema-system/shared/src/propResolvers/types.ts): `Memo`, `noMemo`.
- [templateElements.ts](../../../packages/schema-system/shared/src/templateElements.ts): `TEMPLATE_HTML_ELEMENTS`, `isTemplateElement`, `refusedProp`.
- [packages/schema-system/README.md](../../../packages/schema-system/README.md): the schema system in depth.

</details>
