# Component registry

The **component registry** maps a PascalCase `type` name to a Solid component. A template renders against `componentRegistry`. The app template, shell overlays and the app's own panels render against `chromeComponentRegistry`, which adds `AgentChat` and `AgentChatSheet`.

**Why:** A name that is not in the registry is absent: the renderer draws the dashed "unknown component" box, as for any unregistered name. So the host controls which components a space template can mount by what it puts in each registry, with no check per name. `AgentChat` reaches the executor's AI sessions, so only trees that the host controls name it (`componentRegistry.tsx`).

**Parent:** [Renderer](README.md)

<details><summary>How it works</summary>

- `componentRegistry` holds the layout and composite components of `@we/components` (`Column`, `Row`, `Grid`, `Card`, `Canvas`, `Select`, `Calendar`, …), the block displays and `BlockComposer` of `@we/block-solid`, the editor panels (`EditingBar`, `TemplateCard`, `AiPanel`, `EditorCodePanel`, `EditorInspectorPanel`, `EditorThemePanel`), `CredentialField`, `SignalControl`, `CountMark` and `WeCube`. Large entries load lazily.
- `PanelLane`, `PartFrame`, `PanelSlot` and `TemplatePanelBody` are in the registry for host rewrites. A template writes `$panels` and `$part`, not these names ([Node operators](../schema/operators.md)).
- `TemplatePanelBody` picks `chromeComponentRegistry` only for panels that the app template declares.
- `registerModuleComponents(contributed)` adds the components that modules contribute to both registries at boot. A module component with the name of a host component is not registered and a warning is given.
- The host lends Solid components to modules through `moduleHostComponents` (`CesiumGlobe`, `GraphView`), so a module has no framework import.
- `@we/primitives` are not in the registry. The renderer mounts a `we-*` tag directly ([Primitives](../design-system/primitives.md)).

A new component goes in `@we/components` and gets an entry in `componentRegistry.tsx`; then `generate-context` adds it to the AI context ([Components](../design-system/components.md)). Feature modules: [Modules](../../modules/README.md).

</details>

<details><summary>Where in the code</summary>

- [componentRegistry.tsx](../../../packages/app-shell/src/frameworks/solid/registries/componentRegistry.tsx): `componentRegistry`, `chromeComponentRegistry`, `registerModuleComponents`.
- [moduleComponents.tsx](../../../packages/app-shell/src/frameworks/solid/registries/moduleComponents.tsx): `moduleHostComponents`.
- [types.ts](../../../packages/schema-system/frameworks/solid/src/types.ts): `ComponentRegistry`.
- [docs/architecture/capabilities-and-surfaces.md](../../../docs/architecture/capabilities-and-surfaces.md): component, primitive or fragment.

</details>
