# Primitives

A **primitive** is a Lit custom element in `@we/primitives` with a `we-` name, such as `we-button`, `we-input` or `we-modal`. A template names a primitive by its tag, and any framework can render it.

**Why:** A primitive is the part of the design system that does not depend on a framework. The renderer sets its props and events in the same way for every tag, so no wrapper per framework is necessary on the render path. A primitive holds what data cannot express: focus, the top layer, keyboard input and measurement.

**Parent:** [Design system](README.md)

<details><summary>How it works</summary>

1. Each primitive is one file in `src/primitives` and registers itself with `@customElement('we-…')`. `build:cem` writes the Custom Elements Manifest, which the generated AI context reads.
2. A primitive extends a base class. `DesignSystemElement` is the default and takes the layout, visual, flex, typography and state props. `OverlayElement` adds a backdrop for modals and drawers.
3. Events use standard DOM names (`change`, `input`, `click`, `close`, …) with the new value in `detail`, and they cross the shadow boundary (`composed: true`).
4. A primitive joins theming through its entry in `COMPONENT_CASCADE`, which names its family, its type role and its surface image. A module adds an entry with `registerComponentCascade`.
5. `variant` says how a primitive is drawn (`solid`, `soft`, `outline`, `ghost`, `bare`). `tone` says which colour family it takes.
6. The shadow root has cascade layers: `we-base`, the tier layers, the state layers and `we-overlay`. A breakpoint or a state changes only the properties that it names.
7. A `part` that a theme may style is in `PUBLIC_PARTS`. `parts.test.ts` holds the list to the source.
8. `top-layer.ts` wraps `showPopover` and `showModal`. While the host holds the top layer for a prompt, an overlay outside the prompt waits until the host releases it ([Protected pieces](../chrome/protected-pieces.md)).

</details>

<details><summary>Where in the code</summary>

- [packages/design-system/3-primitives/src/primitives/](../../../packages/design-system/3-primitives/src/primitives): one file per primitive.
- [packages/design-system/3-primitives/src/shared/](../../../packages/design-system/3-primitives/src/shared): [helpers.ts](../../../packages/design-system/3-primitives/src/shared/helpers.ts) (`COMPONENT_CASCADE`, `registerComponentCascade`, `applyComponentTheme`), [design-system-element.ts](../../../packages/design-system/3-primitives/src/shared/design-system-element.ts), [overlay-element.ts](../../../packages/design-system/3-primitives/src/shared/overlay-element.ts), [top-layer.ts](../../../packages/design-system/3-primitives/src/shared/top-layer.ts).
- [parts.ts](../../../packages/design-system/3-primitives/src/parts.ts): `PUBLIC_PARTS`, `INTERNAL_PARTS`.
- [packages/design-system/3-primitives/CONVENTIONS.md](../../../packages/design-system/3-primitives/CONVENTIONS.md): how to write a primitive.

</details>
