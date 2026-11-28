# Templates

A **template** is a root schema node with `meta`. Its `meta.role` says which of four kinds it is. A **shell template** (the default) owns a space's chrome, arrangement and route table. A **view** renders one section inside a shell. An **app template** is the chrome around every space. An **app page** is a page of an app, opened above everything.

**Why:** `meta.role` sets what a change costs. A community that wants one more section installs or writes one view, and keeps the shell that it shares with other communities (`types.ts`). An absent `meta.role` means shell.

**Parent:** [Interface](../README.md)

## Parts

- [Fragments](fragments.md): `@we/schema-kit` and `@we/template-kit`, the authoring-time functions that expand to plain nodes.
- [Views](views.md): sections of a space, the `$views` marker, and the three lists that decide which sections a space shows.
- [Bundles](bundles.md): a whole app (app template, templates, pages, themes, record types) as one `we-bundle` file.
- [Template tiers](tiers.md): the capability groups, the template bag, and the acceptance check.
- [Editor](editor.md): `@we/editor`, the surface for editing templates and themes, and its `EditorHost` contract.

<details><summary>How it works</summary>

| Package                   | What it holds                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `@we/template-default`    | `DefaultTemplate`, the built-in space shell                                                                                        |
| `@we/template-showcase`   | whole-interface shells: Discord, Events, Instagram, Scrapbook, Theme Lab, Trello, Twitter, Workshop, YouTube                       |
| `@we/template-views`      | the views: about, boards, calendar, cards, flux, globe, graph, and the record page                                                 |
| `@we/template-shell`      | WE's own surfaces as data: `WeApp` (the app template), the boot screen, settings, the sidebar, the module rail, the safety prompts |
| `@we/template-cartridges` | the bundles WE ships, as source ([Bundles](bundles.md))                                                                            |
| `@we/template-kit`        | fragments that name WE stores ([Fragments](fragments.md))                                                                          |
| `@we/template-fixtures`   | sample data for previews and screenshots; not shipped                                                                              |

1. The seed's `templates` and `views` lists select the built-in templates. `generate-templates` and `generate-views` write the imports, so the bundler does not include a template that the seed does not select.
2. A [space](../../data/spaces/README.md) has a default template. The agent's library (in [we-root](../../data/stores/datasets.md)) and the space itself can hold more templates as `Template` records.
3. The app template is the agent's choice (`AgentSettings.appTemplateId`), else the deployment's, else `we-app`. In safe mode it is always `we-app` ([Protected pieces](../chrome/protected-pieces.md)).
4. Each template passes `acceptTemplate` before it is used ([Template tiers](tiers.md)).

</details>

<details><summary>Where in the code</summary>

- [packages/templates/](../../../packages/templates): the template packages; see its [README.md](../../../packages/templates/README.md).
- [templateRegistry.ts](../../../packages/app-shell/src/shared/registries/templateRegistry.ts), [bundledTemplates.generated.ts](../../../packages/app-shell/src/shared/registries/bundledTemplates.generated.ts): the built-in templates.
- [appTemplates.ts](../../../packages/app-shell/src/shared/registries/appTemplates.ts): `DEFAULT_APP_ID`, `appTemplateRegistry`, `resolveAppTemplate`.
- [TemplateStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/TemplateStore.tsx): the store that loads, switches, saves and installs templates.
- [packages/app-shell/scripts/generateTemplateRegistry.mjs](../../../packages/app-shell/scripts/generateTemplateRegistry.mjs): the generator.

</details>
