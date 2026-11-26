# Class surface contract

A class is drawn by resolving its IRI on a surface to a template id. This is one fixture-backed path. It is not a new template format, and it is not a SHACL display vocabulary.

## What is resolved

The request is a pair:

- `classIri` — the class's target class IRI. This is the identity. Two classes may share a display name (`we://Topic` and `flux://Topic` are both "Topic"), and the name is not a key.
- `surface` — where the class is drawn. The fixture uses `card`, the canvas card (`recordStore.createCardOnCanvas`). No other surface is named here.

The answer is one of:

- `{ status: 'template', classIri, surface, templateId }` — the bindings for that class and surface name exactly one template id, and that id is an identity the caller knows. Two bindings that repeat the same id are one match.
- `{ status: 'no-template', classIri, surface }` — anything else. An unsupported class, a class on a surface it is not bound to, an empty request, two bindings that name different template ids, or a template id the caller does not know. The miss is explicit. The other class of the same display name is not a fallback.

`displayName` is carried on the binding so a caller can show what the class is called. Resolution never reads it, and it is not part of the match. Two bindings may share one.

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

## Card creation

Fixture-backed card creation is included: a matching class/surface binding creates a card through the shared canvas creation write group, with class IRI and template ID kept separate. A missing binding performs no writes. Published-template discovery and binding a live class remain out of scope; the current demo and production callers are unchanged.

The group is `writeCanvasCard` in `packages/app-shell/src/shared/canvasCardWrite.ts`. `RecordStore.createCardOnCanvas` calls it, and so does `createClassTemplateCard`. It opens one `runEntityTransaction`, creates the card with `createBlocks` (`kind: 'card'`, anchored to the canvas's content home, joined to the batch), and writes the placement in that batch when a point was given. The card's id is the one the registered collection model's `create` assigns. This path does not reserve an id of its own.

`CollectionBlock` has no class field and no template field. The class IRI and the template id are stored in a sidecar on the caller's port, keyed by the card id (`classCardSidecar`). They are not written onto the block.

The group commits together only where the connected backend's runner commits that batch when the callback settles and discards it when the callback throws. The default runner, until a backend registers one, runs the callback with no batch token and each write commits on its own. This slice does not add a second cleanup pass, and it does not claim a rollback the runner did not perform.

A port is one dataset. Hold the same port for every create against that dataset. While a create for one canvas, surface and class IRI is in flight on that port, a second call with the same triple shares the first result: the first request wins, including its position. A settled success is not a lifetime dedupe. The next call creates another card, with its own id. Two ports do not share in-flight calls or sidecars, even when they name the same canvas.
