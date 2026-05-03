# Plan: `we-expandable` Primitive + Schema-Composable Sidebar

> **Goal:** Replace the monolithic `CollapsibleSidebar` widget's internal layout logic with a general-purpose `we-expandable` Lit primitive that exposes its open/closed state via a CSS custom property, enabling fully composable schema-based sidebar layouts that AI can reason about and modify at the node level.

---

## Motivation

`CollapsibleSidebar` works well but is hard for templates to customise — it accepts a deeply nested `items: CollapsibleSidebarItem[]` array, and any structural change (adding a section, reordering groups, changing item layout) requires understanding the full widget type.

The primitives approach makes the sidebar a composition of independent nodes in the schema tree. The AI — and human template authors — can add, remove, and restyle individual pieces without touching the whole.

---

## Design

### The `--we-expanded` CSS custom property contract

`we-expandable` sets `--we-expanded: 0` (collapsed) or `--we-expanded: 1` (expanded) on its `:host`. CSS custom properties inherit through shadow DOM boundaries, so any descendant — however deeply nested — can read this to react to expansion state. This is the key mechanism that makes the label-fade animation work without a dedicated sidebar item primitive.

Example usage in a slotted child's styles:

```css
[part='label'] {
  max-width: calc(var(--we-expanded, 0) * 500px);
  opacity: var(--we-expanded, 0);
  transition:
    max-width 300ms ease,
    opacity 300ms ease;
}
```

---

## Part 1 — `we-expandable` Primitive

**File:** `packages/design-system/3-primitives/src/primitives/expandable.ts`

### Props

| Prop            | Type                           | Default        | Description                                            |
| --------------- | ------------------------------ | -------------- | ------------------------------------------------------ |
| `direction`     | `'horizontal' \| 'vertical'`   | `'horizontal'` | Which axis the expand animation operates on            |
| `trigger`       | `'hover' \| 'click' \| 'none'` | `'hover'`      | What causes the expand/collapse                        |
| `open`          | `boolean`                      | `false`        | Controlled open state                                  |
| `defaultOpen`   | `boolean`                      | `false`        | Uncontrolled initial state                             |
| `collapsedSize` | `string`                       | —              | Width (horizontal) or height (vertical) when collapsed |
| `expandedSize`  | `string`                       | —              | Width or height when expanded                          |
| `duration`      | `number`                       | `300`          | Transition duration in ms                              |

### Slots

| Slot        | Description                                                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `header`    | Optional toggle header — rendered above the content, wired to click trigger automatically when `trigger="click"`. Receives `--we-expanded` so children can react (e.g. rotate a caret icon). |
| _(default)_ | The content that shows/hides with the expand animation                                                                                                                                       |

### Events

| Event       | Detail              | Description                   |
| ----------- | ------------------- | ----------------------------- |
| `we-change` | `{ open: boolean }` | Fired when open state changes |

### Shadow DOM structure

```html
<div part="base">
  <slot name="header"></slot>
  <div part="content">
    <slot></slot>
  </div>
</div>
```

### CSS custom properties set on `:host`

| Property        | Values     | Description                                          |
| --------------- | ---------- | ---------------------------------------------------- |
| `--we-expanded` | `0` or `1` | Inherited by all descendants to read expansion state |

### CSS internal

- `[part="content"]` animates `width` (horizontal) or `max-height` / `grid-template-rows` (vertical) based on `--we-expanded`
- `trigger="hover"` wires `mouseenter`/`mouseleave` on `:host`
- `trigger="click"` wires `click` on `[slot="header"]` content via a `slotchange` listener
- `trigger="none"` means only the `open` prop controls state (fully controlled)

---

## Part 2 — Update `Sidebar.schema.ts`

The current schema passes the full items array to `CollapsibleSidebar`. After this change, the sidebar is expressed as composed `we-expandable` nodes.

### Before (simplified current shape)

```typescript
{
  component: 'we-collapsible-sidebar',
  props: {
    items: [
      { type: 'group', label: 'Spaces', reorderable: true, items: { $bind: 'adamStore.orderedPerspectives' } },
      ...
    ]
  }
}
```

### After (target schema shape)

```typescript
{
  component: 'we-expandable',
  props: { direction: 'horizontal', trigger: 'hover', collapsedSize: '56px', expandedSize: '240px' },
  children: [
    // Perspectives group
    {
      component: 'we-expandable',
      props: { direction: 'vertical', trigger: 'click', defaultOpen: true },
      children: [
        {
          slot: 'header',
          component: 'we-row',
          props: { width: '100%', ay: 'center', gap: '200', p: '200' },
          children: [
            { component: 'we-text', props: { label: 'Spaces', fontSize: '300', fontWeight: '600', color: 'neutral-400' } },
            { component: 'we-icon', props: { name: 'caret-down', size: 'xs', color: 'neutral-400' } }
          ]
        },
        // Reorderable items
        {
          component: 'we-sortable',
          props: { direction: 'vertical', width: '100%', onReorder: { $action: 'adamStore.reorderPerspectives' } },
          children: [
            {
              $each: { $store: 'adamStore.orderedPerspectives' },
              component: 'we-button',
              props: { width: '100%', ax: 'start', p: '300', gap: '0' },
              children: [
                { component: 'we-avatar', props: { image: '$item.avatar', initials: '$item.label' } },
                {
                  component: 'we-text',
                  props: { label: '$item.label' },
                  styles: {
                    'margin-left': 'var(--we-space-300)',
                    'max-width': 'calc(var(--we-expanded, 0) * 500px)',
                    'opacity': 'var(--we-expanded, 0)',
                    'transition': 'max-width 300ms ease, opacity 300ms ease',
                    'white-space': 'nowrap',
                    'overflow': 'hidden'
                  }
                }
              ]
            }
          ]
        }
      ]
    },
    // Footer items (settings, profile)
    {
      slot: 'footer',
      component: 'we-column',
      props: { width: '100%', gap: '100', p: '300' },
      children: [/* settings button, profile button */]
    }
  ]
}
```

The outer `we-expandable` (horizontal/hover) sets `--we-expanded` for the whole tree. Inner vertical `we-expandable` nodes set their own `--we-expanded` for their own children — the two don't conflict because each sets the variable on its own `:host`, and each consumes it locally.

---

## Part 3 — `CollapsibleSidebar` widget disposition

Two options:

1. **Keep as convenience wrapper** — `CollapsibleSidebar` remains for the data-driven `items[]` use case, implemented internally using `we-expandable` + `we-sortable` primitives. The schema-composable path is an alternative for templates that want full control.
2. **Deprecate** — once the schema approach is proven viable in the main shell, remove `CollapsibleSidebar` and have all consumers use composed primitives.

Recommendation: option 1 short-term (less churn, existing consumers unaffected), clear path to option 2.

---

## Implementation Order

1. **`we-expandable` primitive** — horizontal + vertical direction, hover + click triggers, `--we-expanded` CSS var, `header` slot
2. **Smoke test in isolation** — use in a `.schema.ts` test fixture to validate the CSS variable inheritance works across shadow DOM boundaries
3. **Update `Sidebar.schema.ts`** — rewrite using composed primitives, verify visual parity with current sidebar
4. **Update `CollapsibleSidebar` internals** (optional, step 3 above) — use `we-expandable` internally rather than duplicating the animation logic
5. **Register types** — add `we-expandable` JSX types to `solid-elements.d.ts`

---

## Open Questions

- Should `we-expandable` expose `--we-expanded` as `0/1` (numeric, usable in `calc()`) or as a named value? Numeric is more powerful for CSS math; named is more readable. Current recommendation: numeric.
- Does the schema renderer support a `styles` object on arbitrary nodes, or only on primitives that have an inline style mechanism? This needs confirming before the label-fade pattern is relied on in schemas.
- Should the caret icon rotation be built into the `header` slot wiring, or left entirely to the schema author?
