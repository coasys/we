# @we/editor

WE's template and theme editing surface — the visual overlay, the design toolbar, the panel dock, and
the inspector/code/theme panels.

## Embeddable

The editor reaches its host **entirely** through `EditorHost`. It imports no backend, no store, and
nothing from WE's shell:

```ts
import { EditorHostProvider, DesignToolbar, RightPanelContainer } from '@we/editor';

<EditorHostProvider value={{ template, theme, session, identity, images }}>
  <DesignToolbar />
  <RightPanelContainer />
</EditorHostProvider>
```

An application supplies those ports from whatever state it already has. WE forwards its stores
(`EditorHostAdapter`); a third-party app forwards its own; a test forwards plain signals.

The port surface is large, because the editor genuinely drives a lot — it is an authoring tool, not a
widget. It is also honest: that list *is* what an adopting application must satisfy, with nothing
hidden behind an ambient import.

## Why the ports, and not just imports

The editor previously called `useAiStore()` / `useThemeStore()` / … directly. Two consequences:

- It could only ever run inside WE.
- The dependency graph was **circular** — the shell imports the editor's components, and the editor
  imported the shell's stores. That is what blocked extracting it at all.

Both are fixed by depending on a shape rather than an implementation.

## `.` and `./ai`

The AI panel is a **separate entry point, not a separate package**. A deployment without an API key
needs to not *ship* prompt code, which is an import-level property that entry points already give.
A package boundary buys install-level optionality — worth it for heavy or licensed dependencies, not
for fetch calls and prompt strings.

The boundary is still real: **`src/components/**` must not import `src/ai/**`.** That keeps a later
extraction a `git mv` rather than a redesign, for the day a second consumer exists or the assistant
outgrows template editing.

## Still on the host's side of the line

Marked `TODO(editor)` in WE's adapter: `editingTheme` and the `updateEditing*` / `saveEditingTheme`
family are *editing session* state living in WE's `themeStore`. They belong here. Moving them changes
the adapter and nothing in this package — which is the property the port was introduced to get.
