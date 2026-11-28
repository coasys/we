# Components

A **component** is a Solid component in `@we/components`, such as `Column`, `Card`, `AvatarStack` or `DropdownMenu`. It is made from primitives and holds behaviour that needs the host's reactive framework. `@we/widgets` is the package for larger composite components, and it exports nothing now.

**Why:** A component must do something that a `Column` of primitives cannot: `AvatarStack` calculates overlap, `CollapsedContent` measures, `DropdownMenu` manages focus. A component that only arranges primitives is a fragment ([Fragments](../templates/fragments.md)), because a template can edit a fragment and cannot edit a component (`design-system/CONVENTIONS.md`).

**Parent:** [Design system](README.md)

<details><summary>How it works</summary>

1. A component has two files. `X.types.ts` holds the props with no framework types. `X.solid.tsx` holds the implementation.
2. The folders in `src/components` are `cards`, `data`, `feedback`, `inputs`, `layout`, `media`, `menus`, `people`, `signals` and `testing`.
3. `createLayoutComponent({ name, … })` builds `Column`, `Row`, `Grid`, `Card` and `Canvas`. The `name` puts the component in the theme's component tier, for example `components.card.radius`.
4. A schema reaches a component only through the component registry. The editor and the shell chrome import components directly ([Component registry](../renderer/component-registry.md)).
5. **Shared prop logic.** `@we/design-utils` turns design-system props into CSS for primitives and components. It holds the prop key lists (`paddingKeys`, `TIER_PROP_KEYS`, `designSystemKeys`, …) and `tokenVar`, which resolves a token or a role name to its variable. Its `solid` entry adds `weProps` and `toValue`.
6. **Shared types.** `@we/design-types` holds `DesignSystemProps` and the CSS keyword types.

</details>

<details><summary>Where in the code</summary>

- [packages/design-system/4-components/src/components/](../../../packages/design-system/4-components/src/components); [createLayoutComponent.tsx](../../../packages/design-system/4-components/src/components/layout/createLayoutComponent.tsx).
- [packages/design-system/5-widgets/](../../../packages/design-system/5-widgets): `@we/widgets`.
- [packages/design-system/utils/src/index.ts](../../../packages/design-system/utils/src/index.ts), [utils/src/solid/index.ts](../../../packages/design-system/utils/src/solid/index.ts): `@we/design-utils`.
- [packages/design-system/types/src/index.ts](../../../packages/design-system/types/src/index.ts): `@we/design-types`.
- [packages/design-system/CONVENTIONS.md](../../../packages/design-system/CONVENTIONS.md): how to write a component.

</details>
