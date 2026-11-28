# Interface

In WE, the interface is data. A **template** is a JSON tree of **schema nodes**. The **renderer** walks this tree and mounts each node from the **component registry**, against a **template bag** of stores. **Themes** and the **design system** set how the result looks. The **chrome** around the template holds the sidebar, the module rail and the panels.

**Why:** Data can be read before it runs, forked, synced with a space and edited by an AI model. Code can do none of these things safely. So WE keeps arrangement in templates and keeps code for what data cannot express: behaviour, focus, accessibility, browser APIs, measurement. Templates, themes and bundles install at runtime. Primitives, components and the renderer ship in the repository.

**Parent:** [WE](../README.md)

## Parts
- [Schema language](schema/README.md): the node tree, expressions, handler tokens, node operators, shared definitions and validation.
- [Renderer](renderer/README.md): `RenderSchema` in `@we/schema-solid`, the reactivity port, the component registry, queries and foreign elements.
- [Templates](templates/README.md): shell, view, app and page templates, the packages that hold them, fragments, bundles, template tiers and the editor.
- [Design system](design-system/README.md): design tokens, themes, primitives, components, drag and the brand.
- [Chrome](chrome/README.md): the app template's sidebar and module rail, panels, routing, boards and the protected pieces.

<details><summary>How it works</summary>

```
 we-seed.json ─► generated registries (templates, views, bundles, elements)
                           │
 Template (JSON) ──► acceptTemplate ──► TemplateStore.commitTemplate
                           │
  TemplateProvider: buildTemplateBag(stores, tier) ─► template bag
                           │
  RenderSchema(node, bag, registry)       [@we/schema-solid]
     │  resolveProp(value, bag, context, createMemo)   [@we/schema-shared]
     │  $each / $if / $routes / ... ─► Solid control flow
     ▼
  registry[type] (Solid component) │ we-* tag (Lit primitive) │ allowed HTML element
                           │
  applyThemeVars(root, theme) ─► CSS variables          [@we/themes]
```

1. The host loads a template and checks its structure ([Template tiers](templates/tiers.md)).
2. The host builds a template bag. The bag holds only the store members that the template's tier grants.
3. The renderer resolves each prop through the shared resolvers and mounts each node ([Renderer](renderer/README.md)).
4. The theme writes CSS variables on its root. Primitives and components read these variables ([Themes](design-system/themes.md)).

Data, stores and spaces: [Data](../data/README.md). Feature modules, blocks, the graph system and the seed: [Modules](../modules/README.md). App boot and targets: [Hosts](../hosts/README.md).

</details>

<details><summary>Where in the code</summary>

- [packages/schema-system/](../../packages/schema-system): `@we/schema-shared` (semantics), `@we/schema-solid` (renderer), `@we/schema-kit` (portable fragments). Start with [CONVENTIONS.md](../../packages/schema-system/CONVENTIONS.md).
- [packages/templates/](../../packages/templates): the templates WE ships and `@we/template-kit`; see its [README.md](../../packages/templates/README.md).
- [packages/design-system/](../../packages/design-system): tokens, themes, primitives, components, widgets, utilities, drag; see [CONVENTIONS.md](../../packages/design-system/CONVENTIONS.md).
- [packages/editor/](../../packages/editor): the template and theme editor.
- [packages/app-shell/src/frameworks/solid/](../../packages/app-shell/src/frameworks/solid): the components, layouts and registries that mount templates and draw the chrome.
- [docs/architecture/capabilities-and-surfaces.md](../../docs/architecture/capabilities-and-surfaces.md): where each piece of interface goes.

</details>
