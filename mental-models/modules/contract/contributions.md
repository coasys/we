# Contributions

`ModuleContributions` is everything a module adds, as data: chrome the host draws (panels, slots, launchers), fragments a template places (parts), surfaces it opens for other modules (anchors), and what it adds to the host's registries (entities, blocks, views, functions, components, an embedded app).

**Why:** Declared contributions let the host derive what a module does without running it. `moduleCapabilities` derives the capability list that Settings → Modules shows from the manifest and the contributions, so the list cannot fall out of step with the code. A panel is one object rather than a set of store keys, so that the host, not the module, places, frames and remembers it (`PanelContribution` comment).

**Parent:** [Module contract](README.md)

<details><summary>How it works</summary>

| Field | What it is |
|---|---|
| `parts` | Named fragments (a `SchemaNode` or a `ModulePart`). A template places one with `{ type: '$part', props: { id: '<moduleId>.<name>' } }`. A `ModulePart` can name its `subject` (the expression it is about, which a placer can replace), its `inputs` (names a placement must bind), and `whileShown` (store actions the host calls when the part is drawn and removed). A part is public API. |
| `panels` | `PanelContribution`: a surface the host places in a dock with id `<moduleId>:<name>`. It has a `title`, a `node`, a `bid` (`PanelBid`: `edge`, `size`, `float`, `aspect`, `min`, or a store key that returns one) and an `order`. A panel with an `icon` gets a rail button. The host owns whether a panel is open, unless the panel names `open`, `show` and `close` store keys; `reveal` brings an open panel forward. A panel insets the content. |
| `slots` | `SlotContribution` `{ anchor, node, order }`: chrome that overlays the content and survives navigation. A core anchor is `overlay`, `dock-left`, `dock-right`, `dock-bottom` or `banner`. Any other anchor is one that a module opened. |
| `anchors` | Anchor names that this module opens in its own chrome with `{ type: '$slot', props: { anchor } }`. Other modules fill them with slots. |
| `launchers` | `ModuleLauncher`: a rail button that is not a panel's. It names a store `action` and optional `activeWhen`, `busyWhen` and `availableWhen` store keys. |
| `holds` | A store key. While it is true, the module's chrome stays on screen in a space that has not enabled the module. |
| `reserve` | A store key that returns a `ChromeReserve`: a band that floating panels must keep clear. |
| `settings` | `ModuleSetting` list ([Module settings](settings.md)). |
| `activities` | `ActivityShape` per presence activity type that the store publishes: field name to `string`, `number`, `boolean` or `object`. |
| `entities` | `{ manifest: EntityManifest, predicates?, scope? }`. Predicates must be under `we://module/<id>/`. `scope: 'agent'` installs the entities into the agent's personal space. |
| `blocks` | `BlockContribution` `{ entity, nodeType?, card, input? }`: a declared entity that composes into a post as a block ([Blocks](../blocks/README.md)). |
| `views` | Templates with `meta.role: 'view'`: sections a space can enable. |
| `functions` | `ModuleFunction` `{ name, params, doc, example, fn }`: a function that expressions can call. |
| `components` | Framework components, by the name a template uses. A module that declares any must declare `requires.frameworks`. |
| `embed` | `{ url, allow, image? }`: a whole application in an iframe. |

Store keys in these fields are bare keys (`'active'`), not template paths (`'modules.call.active'`). The registry reads them on the module's store.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/shared/src/module.ts](../../../packages/module-system/shared/src/module.ts): `ModuleContributions`, `ModulePart`, `PartInput`, `PanelContribution`, `PanelBid`, `SlotContribution`, `CoreSlotAnchor`, `ModuleLauncher`, `ChromeReserve`, `ActivityShape`, `BlockContribution`, `ModuleFunction`, `ModuleEmbed`, `ModuleEntities`.
- [packages/app-shell/src/shared/registries/moduleParts.ts](../../../packages/app-shell/src/shared/registries/moduleParts.ts): how a `$part` resolves.
- [packages/app-shell/src/shared/registries/slotRegistry.ts](../../../packages/app-shell/src/shared/registries/slotRegistry.ts), [dockRegistry.ts](../../../packages/app-shell/src/shared/registries/dockRegistry.ts): where slots and panels go.
- [docs/architecture/chrome-and-panels.md](../../../docs/architecture/chrome-and-panels.md): docks, the rail and panel placement.

</details>
