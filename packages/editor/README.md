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

## Geometry

The panel dock pins to whichever element `mountTemplateEditor` was given
(`positioning: 'container'`, the default), or to the window (`positioning: 'viewport'`). WE's shell
uses the viewport default — its dock runs the full height of the screen and the shell offsets its own
content viewport to make room.

Opt-in rather than inferred. Always using `absolute` and expecting the host to supply a positioned
ancestor would silently drop the dock against the window in any host that has none — a layout that
looks *nearly* right, which is the worst kind of wrong. `mountTemplateEditor` also sets
`position: relative` on the element it is given when needed, so the default works without further
setup.

**The selection overlay is the exception.** Its highlight and drag-ghost maths run in viewport
coordinates via `getBoundingClientRect`, so it is correct over a full-window template and would need
offsetting by the container's rect to be correct inside a panel. It is off by default in
`mountTemplateEditor` for that reason.

## What belongs on which side

**The host owns state the host renders from; the editor mutates it through ports.**

That rule explains what can look like an inconsistency. `editingTheme` and the `updateEditing*` family
sound like editor state, and are not: a theme being edited is a draft of a persisted entity that the
host renders — the live preview reads it — which makes it the same shape as `currentTemplate`. Both
working copies live in the host; the editor mutates both through the port.

The same test explains why panel widths and edit modes sit in the host too: `computeRightOffset` reads
them to size the shell's own content viewport.

An earlier version of this file proposed migrating the theme session into the editor. That was wrong —
it would move state away from the code that renders it and need a `previewEditing` port to push it
back. Recorded here because the mistake is an easy one to repeat: "editing" in a name is not evidence
of where state belongs.
