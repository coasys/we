# Class surface contract

A class is drawn by resolving its IRI on a surface to a template id. This is one fixture-backed path. It is not a new template format, and it is not a SHACL display vocabulary.

## What is resolved

The request is a pair:

- `classIri` — the class's target class IRI. This is the identity. Two classes may share a display name (`we://Topic` and `flux://Topic` are both "Topic"), and the name is not a key.
- `surface` — where the class is drawn. The fixture uses `card`, the canvas card (`recordStore.createCardOnCanvas`). No other surface is named here.

The answer is one of:

- `{ status: 'template', classIri, surface, templateId }` — exactly one binding matched, and its template id is an identity the caller knows.
- `{ status: 'no-template', classIri, surface }` — anything else. An unsupported class, a class on a surface it is not bound to, an empty request, two bindings that name different template ids, or a template id the caller does not know. The miss is explicit. The other class of the same display name is not a fallback.

`displayName` may sit on a binding so a caller can show what the class is called. Resolution never reads it.

## Template identity

`templateId` is the template's id: a key of the built-in registry, or an id `reserveId` would keep for a stored template. It is not `meta.name`. The fixture points at `acorn`. That template's display name is "Acorn", and a stored record that asked to be saved under `acorn` would be given a different id. The binding names the built-in itself.

`knownTemplate` is the caller's check. The fixture path passes `isValidTemplateId`, so a binding to an id this build does not ship answers `no-template`.

## The fixture

`CLASS_SURFACE_FIXTURE` in `packages/app-shell/src/shared/registries/templateRegistry.ts` holds one binding:

| class IRI                       | display name | surface | template id |
| ------------------------------- | ------------ | ------- | ----------- |
| `fixture://class-surface/topic` | Topic        | `card`  | `acorn`     |

The IRI is a fixture. It is not the live `we://Topic` class, so this path does not change how Topic is drawn. `resolveFixtureClassOnSurface` resolves that list and nothing else.

## What already resolved, and what this does not change

`templateSurface.ts` already has two resolvers, and neither takes a class:

- `buildTemplateBag` resolves a template's store paths against the capability grant at runtime. A path outside the grant is absent.
- `inspectTemplateSurface` classifies those references at install time.

This contract adds `resolveClassOnSurface` beside them. It does not change the grant, the bag, or any template schema.

## Dropped on purpose

Automatic published-template selection is not implemented. Nothing in the contract settles it. The `Template` record has `name`, `description`, `icon`, `origin`, `version`, `slug`, `schema`, `themeId`, and `role`. None of those says "the published template for this class IRI on this surface". `TemplateMeta.recordViews` is keyed by entity name, which is the collision this path exists to avoid, and changing it would be a new template format. Published-template discovery belongs to a later slice. Until a field is settled, a caller passes an explicit binding or gets `no-template`.

## Out of scope

Creating a card, choosing among several published templates, and binding a live class are not this slice. A class with no matching binding creates nothing here, because nothing is created here at all.
