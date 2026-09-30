# Views — a space's sections, as their own unit

A **view** is a template that renders one section of a space rather than the whole interface.
A **shell** is a template that owns the chrome, the arrangement and the route table, and says where
its sections go. Both are `TemplateSchema`; `meta.role` is the difference, and absent means shell.

## Why this exists

Sections used to be routes hardcoded inside the shell template, listed twice — once as a `routes`
array and once as the nav strip beside it. That had two costs, and the first had already happened:

- **The two lists drift.** The default template's header layout listed About and Settings with Flux
  commented out; its sidebar layout listed Flux and neither of the other two. One template, two
  ideas of what a space contains.
- **A section is not forkable.** Wanting a seventh one meant forking the entire shell, and every
  later improvement to it arrived as a merge conflict. The thing people wanted to change was one
  page; the smallest thing they could fork was the whole interface.

[VISION.md](../../VISION.md) claims templates are the highest-volume contribution in the ecosystem.
That only works if the unit of contribution matches the unit of intent, and for most communities the
intent is "we want a different feed", not "we want a different application".

## The three layers

The same shape modules already use, one tier up:

| Layer      | Where                         | Who decides                   | Semantics                                                |
| ---------- | ----------------------------- | ----------------------------- | -------------------------------------------------------- |
| Deployment | `we-seed.json`'s `views` list | whoever builds the app        | which views exist at all; **order is the default order** |
| Community  | `Space.enabledViews`          | whoever administers the space | which sections this space _has_, and in what order       |
| Agent      | `SpacePreference.hiddenViews` | each member, privately        | which of those they bother to see                        |

Two rules carry across from modules, and both exist because of what their opposite would do:

- **Unset means "not decided", never "none".** Every space predating views has no stored list, so
  reading empty as "none" would land as every existing space losing every tab.
- **The agent layer holds exclusions, not inclusions.** A section the community adds later shows up,
  because silence about a view is "no opinion" rather than "no".

One rule deliberately does _not_ carry across. `activeModules` intersects an "installed by me" layer;
`spaceViews` has no such layer. A module is a capability an agent chooses to run, while a section is
part of what the space _is_ — and if a missing personal install could remove one, two members
opening the same URL would disagree about whether it exists.

## How a shell places its sections

```ts
routes: [{ path: VIEWS_MARKER }]; // '$views'
```

`expandViewRoutes` replaces the marker with one route per resolved section, at `/<segment>`, plus the
index redirect. The redirect comes from the expansion rather than from the shell on purpose: it has
to follow the list, or a community that turns off whichever section their shell happened to name
lands on a 404 in their own space.

A shell may have no marker at all — the showcase templates don't, and a Discord-shaped space having
channels rather than sections is a design rather than an omission. `spaceList[].usesSections` reports
this so the settings page explains instead of offering switches nothing reads.

The expansion happens once in `TemplateProvider`, before `buildRoutes`, so everything downstream —
the router, `keepAlive` stubs, `$nav` base depths — sees an ordinary route tree and knows nothing
about views.

## Segments

`meta.segment` is the view's **suggestion**. The space's section list is what actually pairs a view
with a segment, so two views can offer the same default and a community can put either at `/cards`.

Duplicates resolve first-come; the loser falls back to its id, which is unique by construction.
Renaming silently beats the alternative — a duplicate path makes the router match whichever route it
reaches first, so one of the two sections would be unreachable with nothing on screen to say which,
or why.

Segments are in the URL, so changing one breaks every link anyone has shared. Treat them as stable.

## Storage and the marketplace

A view is stored as an ordinary `Template` record: same install flow, same publish path, same
versioning. `Template.role` is a queryable mirror of `meta.role`, written at every save and publish
site the way `Template.themeId` mirrors `meta.themeId` — a marketplace listing cannot filter on a
field it would have to parse every record to read.

**Absent means shell**, so the templates shelf asks for `role: { not: 'view' }`. Asking for `'shell'`
would empty it of everything published before this existed.

They get separate shelves because they answer different questions. "What should this space look
like" and "what should this space have in it" are not alternatives.

## What a view may assume

That it renders somewhere inside a space, and nothing else. Not what surrounds it, not which segment
it was given, not which other sections exist. A view that reaches for its neighbours is a shell that
has not admitted it.

Views run at the **space tier** of [`templateSurface.ts`](../../packages/app-shell/src/shared/registries/templateSurface.ts),
the same grant a space template gets. Being compiled into the bundle confers no privilege — which is
what makes the marketplace category honest rather than decorative.

## Two things resolving at runtime cost

Both are paid, and both are the kind of thing that would otherwise fail silently:

- **Static validation.** `we-validate-schemas` walks `.schema.ts` files and descends into their
  imports; nothing statically imports a view any more. `packages/templates/views/src/Views.schema.ts`
  exists solely to give the walk a starting point. A view installed from a marketplace is beyond it
  by definition, and is validated at install instead.
- **Module requirements.** `spaceStore.requiredModules` derives dependencies by walking the schema,
  and now walks the shell _plus_ every resolved view. Missed, `missingModules` would stop reporting a
  real gap and — worse — the guard in `setModuleInstalled` would stop refusing, so uninstalling the
  globe module while a space had the globe section on would succeed and that section would render
  nothing.

## Where to look

| What                            | Where                                                      |
| ------------------------------- | ---------------------------------------------------------- |
| The marker and its expansion    | `packages/schema-system/shared/src/viewRoutes.ts`          |
| Resolution rules (pure, tested) | `packages/app-shell/src/shared/viewResolution.ts`          |
| The three layers, wired         | `SpaceStore`'s `spaceViews` / `viewNav` / `setViewEnabled` |
| Built-in views                  | `packages/templates/views/`                                |
| Which ones this build ships     | `we-seed.json`'s `views` → `bundledViews.generated.ts`     |
| Configuring them                | Settings → Spaces & data → a space → Sections              |
