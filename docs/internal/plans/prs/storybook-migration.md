# Plan: Root Storybook Migration

> Move Storybook from `3-primitives/` to the monorepo root so it can discover and display stories for components across all packages.

---

## Problem

Storybook currently lives inside `3-primitives/.storybook/` and can only render Lit web component stories. SolidJS components (`4-components/`, `5-widgets/`) have no story infrastructure — developers must run the full app to preview them. Cross-package composition stories (e.g. a FormField wrapping a Select) are impossible in the current setup.

## Current state

- **Location:** `packages/design-system/3-primitives/.storybook/`
- **Framework:** `@storybook/web-components-vite` (Lit only)
- **Stories:** 13 component stories + 1 MDX page, all in `.storybook/stories/`
- **Features:** Theme switcher (Light, Dark, Retro, Cyberpunk, Black), CEM integration for auto-docs
- **Scripts:** `pnpm start` (dev), `pnpm storybook:build` (build) in `3-primitives/package.json`

## Design

### Framework choice: `@storybook/html-vite`

The HTML renderer is framework-agnostic. Both Lit custom elements and SolidJS components render into plain DOM containers:

- **Lit primitives** — custom elements work natively in any HTML context
- **SolidJS components** — render via `render()` from `solid-js/web` into a container div

This avoids multi-framework adapter complexity entirely. One Storybook instance, one renderer.

### Co-located stories

Stories move from a central `stories/` directory to live next to their components:

```
3-primitives/src/primitives/button.ts
3-primitives/src/primitives/button.stories.ts      ← new location

4-components/src/components/layout/Card/Card.solid.tsx
4-components/src/components/layout/Card/Card.stories.tsx

5-widgets/src/widgets/.../Widget.solid.tsx
5-widgets/src/widgets/.../Widget.stories.tsx
```

### SolidJS story helper

Thin utility to render SolidJS components in HTML stories:

```typescript
// .storybook/solid-helper.ts
import { render } from 'solid-js/web';

export function renderSolid(Component: any, props: Record<string, any>) {
  return (container: HTMLElement) => {
    const dispose = render(() => Component(props), container);
    return { dispose };
  };
}
```

### Directory structure

```
we/
├── .storybook/
│   ├── main.ts              ← @storybook/html-vite, globs across packages/
│   ├── preview.ts            ← Theme switcher, global decorators (migrated from 3-primitives)
│   ├── solid-helper.ts       ← renderSolid() utility
│   └── manager.ts            ← Optional: sidebar customisation
├── packages/
│   ├── design-system/
│   │   ├── 3-primitives/src/primitives/
│   │   │   ├── button.ts
│   │   │   ├── button.stories.ts     ← co-located
│   │   │   ├── input.ts
│   │   │   ├── input.stories.ts
│   │   │   └── ...
│   │   ├── 4-components/src/components/
│   │   │   ├── layout/Card/Card.stories.tsx
│   │   │   └── ...
│   │   └── 5-widgets/src/widgets/
│   │       └── .../Widget.stories.tsx
```

### Config

```typescript
// .storybook/main.ts
import type { StorybookConfig } from '@storybook/html-vite';

const config: StorybookConfig = {
  framework: '@storybook/html-vite',
  stories: ['../packages/**/*.stories.@(ts|tsx|mdx)'],
  addons: ['@storybook/addon-essentials'],
};

export default config;
```

## Scope

### In scope

1. Create `we/.storybook/` with `main.ts`, `preview.ts`, `solid-helper.ts`
2. Migrate theme switcher and CEM integration from `3-primitives/.storybook/preview.ts`
3. Move existing 13 primitive stories to co-located `*.stories.ts` files next to each component
4. Add root-level scripts: `"storybook": "storybook dev -p 6006"`, `"storybook:build": "storybook build"`
5. Remove `3-primitives/.storybook/` directory and its storybook scripts/dependencies
6. Move storybook dependencies to root `package.json`
7. Verify all existing primitive stories render correctly under `@storybook/html-vite`

### Out of scope

- Writing new stories for existing SolidJS components (done per-PR as components are added/touched)
- External developer showcase tool (#7b remains separate)
- Visual regression testing setup (future enhancement)
- CEM auto-generation pipeline changes (keep existing `build:cem` in primitives)

## Migration checklist

| Existing story | Source                                   | Target                              |
| -------------- | ---------------------------------------- | ----------------------------------- |
| Avatar         | `.storybook/stories/Avatar.stories.tsx`  | `src/primitives/avatar.stories.ts`  |
| Badge          | `.storybook/stories/Badge.stories.tsx`   | `src/primitives/badge.stories.ts`   |
| Button         | `.storybook/stories/Button.stories.tsx`  | `src/primitives/button.stories.ts`  |
| Icon           | `.storybook/stories/Icon.stories.tsx`    | `src/primitives/icon.stories.ts`    |
| Image          | `.storybook/stories/Image.stories.tsx`   | `src/primitives/image.stories.ts`   |
| Input          | `.storybook/stories/Input.stories.tsx`   | `src/primitives/input.stories.ts`   |
| Menu           | `.storybook/stories/Menu.stories.tsx`    | `src/primitives/menu.stories.ts`    |
| Modal          | `.storybook/stories/Modal.stories.tsx`   | `src/primitives/modal.stories.ts`   |
| Popover        | `.storybook/stories/Popover.stories.tsx` | `src/primitives/popover.stories.ts` |
| Spinner        | `.storybook/stories/Spinner.stories.tsx` | `src/primitives/spinner.stories.ts` |
| Tabs           | `.storybook/stories/Tabs.stories.tsx`    | `src/primitives/tabs.stories.ts`    |
| Text           | `.storybook/stories/Text.stories.tsx`    | `src/primitives/text.stories.ts`    |
| Tooltip        | `.storybook/stories/Tooltip.stories.tsx` | `src/primitives/tooltip.stories.ts` |
| Home           | `.storybook/stories/Home.mdx`            | `.storybook/docs/Home.mdx` (root)   |

## Relationship to #7b Component Showcase

This PR and #7b serve different audiences:

- **#7c (this):** Internal monorepo Storybook for core team development, testing, and visual review. One URL for all components.
- **#7b:** External npm-publishable CLI tool (`@we/component-showcase`) for third-party developers building WE components outside the monorepo.

Both can coexist. #7c is simpler and higher priority for day-to-day development.

## Sizing

Small–Medium. Mostly mechanical: move config, relocate story files, verify rendering. The `solid-helper.ts` utility is ~10 lines. Main risk is ensuring Lit CEM integration works under `@storybook/html-vite` (may need `@storybook/web-components` addon for auto-docs).

## Dependencies

- No hard blockers. Can land any time.
- Benefits from Component Library Expansion (#10) landing first — more components to verify the cross-package story discovery works.
