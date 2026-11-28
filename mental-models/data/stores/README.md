# Stores

A **store** is a Solid context in `@we/app-shell` that holds reactive state and actions for one area: the session, the datasets, the records, the spaces, and so on. Stores read the data through the backend ports, and templates read the stores. Three framework-neutral packages hold state rules that several stores share: `@we/optimism`, `@we/history` and `@we/clock`.

**Why:** A template is data, so it cannot hold a connection or call a port. The stores are the one place where backend state becomes reactive values and named actions. They mount in a fixed order because each store reads the stores above it: session, then dataset, then profile is the dependency spine.

**Parent:** [Data](../README.md)

## Parts
- [Session store](session.md): `SessionStore`, the connection to the backend and the port bundle.
- [Datasets](datasets.md): `DatasetStore`, the dataset list, the current dataset and the system datasets.
- [Records](records.md): `RecordStore`, creating and arranging records, and canvas undo through `@we/history`.
- [Optimism](optimism.md): `@we/optimism`, a value shown before its write comes back.
- [Clocks](clocks.md): `@we/clock` and `ClockStore`, a shared moment and its playback.

<details><summary>How it works</summary>

`StoreProvider` mounts the providers in this order: Route → Clock → Shell → Chat → Account → Session → Runtime → Identity → Device → Dataset → Shape → Record → Profile → Theme → Template → Editor → App → Space, then `BootController`, Presence, Interpretation, Workflow and Bundle.

Other stores that touch data, each in one line:

| Store | What it holds |
|---|---|
| `ProfileStore` | the profile cache, and the write path for the agent's own profile; profiles are published to each agent's public dataset |
| `ShapeStore` | the shapes a space carries, and their editing surfaces ([Shapes](../spaces/shapes.md)) |
| `SpaceStore` | spaces, members and the write check ([Spaces](../spaces/README.md)) |
| `PresenceStore` | presence for the space on screen and for any space with a live call ([Ephemeral and presence](../backend/ephemeral.md)) |
| `InterpretationStore` | what extraction does in this space ([Interpretation](../../modules/bundled/transcription/interpretation.md)) |
| `WorkflowStore` | the space's workflows |

How a template reaches the data: `TemplateProvider` calls `backendPorts().dataBindings({...})` with the current dataset handle, the entity entries (the dataset's own, then core, then module entries), the profiles and the ephemeral port ([Data source](../backend/data-source.md)). Which store members a template may name is decided in `templateSurface.ts` ([Template tiers](../../interface/templates/tiers.md)).

</details>

<details><summary>Where in the code</summary>

- [packages/app-shell/src/frameworks/solid/stores/](../../../packages/app-shell/src/frameworks/solid/stores): every store.
- [packages/app-shell/src/frameworks/solid/providers/StoreProvider.tsx](../../../packages/app-shell/src/frameworks/solid/providers/StoreProvider.tsx): the provider order, with the reason for each place.
- [packages/app-shell/src/frameworks/solid/providers/TemplateProvider.tsx](../../../packages/app-shell/src/frameworks/solid/providers/TemplateProvider.tsx): the `dataBindings` call.
- [packages/app-shell/CONVENTIONS.md](../../../packages/app-shell/CONVENTIONS.md): the rules for a store.
- [docs/architecture/performance.md](../../../docs/architecture/performance.md): render cost, including the cost of one store change across many bound nodes.

</details>
