# Module contract

A `ModuleDefinition` has three fields: a `manifest` (who the module is and what it requires), `contributes` (what it adds to the interface and the data), and an optional `createStore(deps)` (its only code). Every module package exports `createModule(host: ModuleHost)`, which returns its definition.

**Why:** The host must know what a module adds and what it reaches before it runs any of the module's code. Declarations carry that knowledge: the registry lints them, derives the module's capability list from them, and gates its chrome on them. `ModuleHost` lends framework components to the factory, so a module package that contributes a Solid component (the globe, the graph) does not import Solid itself.

**Parent:** [Modules](../README.md)

## Parts
- [Contributions](contributions.md): parts, panels, slots, anchors, launchers, `holds`, entities, blocks, views, functions, components and embeds.
- [Kernels](kernels.md): the named host capabilities that a store reaches through `deps.kernels`.
- [Store surface](store-surface.md): which store members a template can read or call, and how a store marks them.
- [Module settings](settings.md): what a deployment, an agent and a space decide about a module, and how the levels resolve.
- [Module testing](testing.md): `@we/module-testing`, fakes for every kernel and `buildStore`.

<details><summary>How it works</summary>

`ModuleManifest`:

| Field | Meaning |
|---|---|
| `id` | A lower-case letter, then lower-case letters, digits and dashes. It namespaces `modules.<id>.*`, part ids (`<id>.<name>`), dock ids (`<id>:<name>`) and predicates (`we://module/<id>/`). |
| `name`, `description`, `icon`, `version` | How the module is listed. |
| `scope` | `'space'` (the default) or `'agent'`. A space module's chrome shows where the space has the module on. An **agent-scoped module** shows wherever its agent has it installed. |
| `requires.backends`, `requires.frameworks` | The backends and frameworks the module runs on. An omitted list means any. |
| `requires.kernels` | The kernels the store receives. A kernel not named here is absent from `deps.kernels`. |
| `requires.permissions` | `ModulePermission`: `microphone`, `camera`, `screen-share`, `notifications`, `network:<host>`, `data:<name>`. Settings → Modules shows these in the module's capability list. |

`createStore(deps: ModuleStoreDeps)` runs once, at registration. `deps` injects reactivity (`signal`, `effect`, `onDispose`), the space context (`dataset`, `datasetUri`, `spaceRoot`, `selfId`), host services (`notify`, `identities`, `showPart`, `settings`, `firstScreen`, the call on screen) and the kernels. A store that uses `deps.signal` imports no framework.

The contract also exports two small async helpers that several stores use: `coalesceByKey` (one run per key, at most one more queued) and `latest` (an earlier async call can see that a later one overtook it). `DEV_FEATURES` and `devToolsEnabled` say whether a build shows developer affordances, such as the synthetic call peers.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/shared/src/module.ts](../../../packages/module-system/shared/src/module.ts): `ModuleDefinition`, `ModuleManifest`, `ModuleRequirements`, `ModuleContributions`, `ModuleStoreDeps`, `ModuleHost`, `defineModule`, `seedCapabilityToModule`.
- [packages/module-system/shared/src/coalesce.ts](../../../packages/module-system/shared/src/coalesce.ts), [latest.ts](../../../packages/module-system/shared/src/latest.ts), [devFeatures.ts](../../../packages/module-system/shared/src/devFeatures.ts), [devTools.ts](../../../packages/module-system/shared/src/devTools.ts): the helpers.
- [packages/module-system/shared/README.md](../../../packages/module-system/shared/README.md): the contract package, with an example module.
- [packages/module-system/README.md](../../../packages/module-system/README.md): the package list.
- [docs/guides/writing-a-module.md](../../../docs/guides/writing-a-module.md): the author's guide.

</details>
