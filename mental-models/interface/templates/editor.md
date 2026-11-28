# Editor

The **editor** (`@we/editor`) is the surface for editing templates and themes. It has an editing bar, an overlay over the rendered template, a code panel, an inspector panel, a theme panel and, in a separate entry, an AI panel. It reaches its host only through the `EditorHost` contract.

**Why:** The editor imports no backend, no store and no part of WE's shell. An application supplies `EditorHost` from the state it already has, so the editor can run outside WE (`index.ts`). Accessors in the contract are functions, so the host chooses its own reactivity (`host.ts`). The AI panel is the entry `@we/editor/ai`, so a deployment without an API key does not include a prompt.

**Parent:** [Templates](README.md)

<details><summary>How it works</summary>

1. `EditorHost` has the ports `template` (`TemplatePort`: the working copy, the catalogue, saving), `theme` (`ThemePort`), `session` (`SessionPort`) and `identity` (`EditorIdentityPort`). The optional fields are `targets` (what a session edits beyond the template on screen), `owners` (regions that another provider owns: parts, panels, views), `images`, `registry` (component metadata for the code and inspector panels) and `fragments` (fragments that the inspector can place).
2. WE supplies the host in `EditorHostAdapter.tsx` with `EditorHostProvider`. The member names of `TemplatePort` are the same as those of `templateStore`, so the adapter passes them through.
3. `@we/editor/runtime` holds the host contract and the panel geometry, which the shell needs on the first render. The shell imports the editing UI with `lazy`, so it loads only when one of its components renders.
4. `mountTemplateEditor(element, options)` mounts the editor into any element and returns a function that unmounts it.
5. The editor panels are entries of the component registry (`EditorCodePanel`, `EditorInspectorPanel`, `EditorThemePanel`, `AiPanel`). The shell places them as docks, like other panels ([Panels](../chrome/panels.md)).
6. The editor validates the working copy against a context that `EditorStore` builds with `buildValidationContext` and `withEntities` ([Validation](../schema/validation.md)).

How a language model edits a template: [Hosts](../../hosts/README.md).

</details>

<details><summary>Where in the code</summary>

- [packages/editor/src/](../../../packages/editor/src): [index.ts](../../../packages/editor/src/index.ts), [host.ts](../../../packages/editor/src/host.ts) (`EditorHost`, `EditorHostProvider`, `useEditorHost`), [runtime.ts](../../../packages/editor/src/runtime.ts), [mount.tsx](../../../packages/editor/src/mount.tsx) (`mountTemplateEditor`), [surface.ts](../../../packages/editor/src/surface.ts), [components/](../../../packages/editor/src/components), [ai/](../../../packages/editor/src/ai).
- [EditorHostAdapter.tsx](../../../packages/app-shell/src/frameworks/solid/providers/EditorHostAdapter.tsx): WE's host.
- [EditorStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/EditorStore.tsx): the editing session in the shell.
- [editorDocks.ts](../../../packages/app-shell/src/shared/registries/editorDocks.ts): the editor docks.

</details>
